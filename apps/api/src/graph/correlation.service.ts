import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AiCallFailure, AiCallMetrics, AiGateway } from '../ai/ai-gateway.service';
import { PrismaService } from '../database/prisma.service';
import { ProvenanceService } from '../provenance/provenance.service';
import {
  CORRELATE_INSTRUCTIONS,
  CORRELATE_PROMPT_VERSION,
  correlateEnvelope,
  correlateJsonSchema,
  correlationBlocks,
} from './correlate-prompt';
import {
  CorrelationInput,
  ValidRelationship,
  deterministicRelationships,
  supportCount,
  validateRelationship,
} from './correlation-rules';

export class CorrelationInputChanged extends Error {}
export class CorrelationFailure extends Error {
  constructor(
    readonly code: string,
    readonly metrics: AiCallMetrics | null = null,
  ) {
    super(code);
  }
}
export type PreparedCorrelation = {
  inputHash: string;
  proposals: unknown[];
  metrics: AiCallMetrics | null;
};

const fingerprint = (input: CorrelationInput) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** The graph module owns relationship data (04 §5.4). No graph endpoint or UI in Phase 7. */
@Injectable()
export class CorrelationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGateway,
    private readonly provenance: ProvenanceService,
  ) {}

  /** The local snapshot and optional provider call happen outside the write transaction. */
  async prepare(caseId: string): Promise<PreparedCorrelation> {
    const input = await this.prisma.$transaction((tx) => this.load(tx, caseId), {
      isolationLevel: 'RepeatableRead',
    });
    const inputHash = fingerprint(input);
    if (!this.gateway.enabled) return { inputHash, proposals: [], metrics: null };
    try {
      const result = await this.gateway.generate({
        step: 'CORRELATE',
        promptVersion: CORRELATE_PROMPT_VERSION,
        instructions: CORRELATE_INSTRUCTIONS,
        evidenceBlocks: correlationBlocks(input),
        schema: correlateJsonSchema,
        envelope: correlateEnvelope,
        evidenceSha256s: input.evidence.map((e) => e.sha256),
      });
      return { inputHash, proposals: result.output.relationships, metrics: result.metrics };
    } catch (error) {
      if (error instanceof AiCallFailure) throw new CorrelationFailure(error.code, error.metrics);
      throw new CorrelationFailure('CORRELATION_FAILED');
    }
  }

  /** Caller holds the case lock and commits facts, sources and step status together. */
  async save(
    tx: Prisma.TransactionClient,
    caseId: string,
    stepId: string,
    prepared: PreparedCorrelation,
  ) {
    const input = await this.load(tx, caseId);
    if (fingerprint(input) !== prepared.inputHash) throw new CorrelationInputChanged();
    const candidates = [...deterministicRelationships(input), ...prepared.proposals];
    const edges = new Map<string, ValidRelationship>();
    let rejected = 0;
    for (const candidate of candidates) {
      const accepted = validateRelationship(input, candidate);
      if (!accepted) {
        rejected++;
        continue;
      }
      const key = `${accepted.fromEntityId}:${accepted.relationType}:${accepted.toEntityId}`;
      const previous = edges.get(key);
      edges.set(
        key,
        previous
          ? {
              ...accepted,
              evidenceIds: [...new Set([...previous.evidenceIds, ...accepted.evidenceIds])].sort(),
              extractionIds: [
                ...new Set([...previous.extractionIds, ...accepted.extractionIds]),
              ].sort(),
            }
          : accepted,
      );
    }
    const retained: string[] = [];
    for (const edge of edges.values()) {
      const naturalKey = {
        caseId,
        fromEntityId: edge.fromEntityId,
        relationType: edge.relationType,
        toEntityId: edge.toEntityId,
      };
      const row = await tx.relationship.upsert({
        where: { caseId_fromEntityId_relationType_toEntityId: naturalKey },
        create: { ...naturalKey, agentStepId: stepId },
        update: { agentStepId: stepId },
      });
      await this.provenance.replaceRelationshipSources(tx, caseId, row.id, edge.extractionIds);
      retained.push(row.id);
    }
    const removed = await tx.relationship.deleteMany({
      where: { caseId, id: { notIn: retained } },
    });
    return {
      relationships: retained.length,
      rejected,
      staleRemoved: removed.count,
      supportingItems: supportCount([...edges.values()].flatMap((e) => e.evidenceIds)),
      llm: prepared.metrics ? 'USED' : 'DISABLED',
    };
  }

  /** Case-scoped handoff; only validated extractions of PROCESSED evidence can support edges. */
  async load(tx: Prisma.TransactionClient, caseId: string): Promise<CorrelationInput> {
    const evidence = await tx.evidenceItem.findMany({
      where: { caseId, processingStatus: 'PROCESSED' },
      orderBy: { sequenceNo: 'asc' },
      select: {
        id: true,
        evidenceRef: true,
        evidenceType: true,
        sha256: true,
        sourceLines: {
          orderBy: [{ pageNumber: 'asc' }, { lineNumber: 'asc' }],
          select: { id: true, text: true, headerName: true, locationKind: true },
        },
        extractions: {
          where: { entityId: { not: null }, normalizationStatus: 'NORMALIZED' },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            entityId: true,
            rawValue: true,
            sourceLines: { orderBy: { ordinal: 'asc' }, select: { sourceLineId: true } },
          },
        },
      },
    });
    const entities = await tx.entity.findMany({
      where: {
        caseId,
        isUserStated: false,
        extractions: { some: { evidence: { processingStatus: 'PROCESSED' } } },
      },
      orderBy: { id: 'asc' },
      select: { id: true, entityType: true, canonicalValue: true, maskedValue: true },
    });
    return {
      caseId,
      entities,
      evidence: evidence.map(({ sourceLines, extractions, sha256, ...item }) => ({
        ...item,
        sha256: sha256!,
        lines: sourceLines,
        extractions: extractions
          .filter((x) => x.sourceLines.length > 0)
          .map((x) => ({
            id: x.id,
            entityId: x.entityId!,
            rawValue: x.rawValue,
            lineIds: x.sourceLines.map((l) => l.sourceLineId),
          })),
      })),
    };
  }
}
