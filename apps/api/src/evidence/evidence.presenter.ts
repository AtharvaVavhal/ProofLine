import { Injectable } from '@nestjs/common';
import type { EvidenceItem, Prisma } from '@prisma/client';
import type { EvidenceResponse } from '@proofline/shared';
import { PrismaService } from '../database/prisma.service';

type Integrity = EvidenceResponse['integrity'];

const NOT_VERIFIED: Integrity = { latestResult: 'NOT_YET_VERIFIED', verifiedAt: null };

/** Maps evidence rows to the Evidence object (05 §8.4). Storage keys are never exposed. */
@Injectable()
export class EvidencePresenter {
  constructor(private readonly prisma: PrismaService) {}

  async present(
    items: EvidenceItem[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<EvidenceResponse[]> {
    const integrity = await this.latestIntegrity(
      items.map((item) => item.id),
      db,
    );
    return items.map((item) => toResponse(item, integrity.get(item.id) ?? NOT_VERIFIED));
  }

  async presentOne(item: EvidenceItem, db?: Prisma.TransactionClient): Promise<EvidenceResponse> {
    const [response] = await this.present([item], db);
    return response!;
  }

  /** Latest verification per item (03 §18.2); none → NOT_YET_VERIFIED. */
  private async latestIntegrity(ids: string[], db: Prisma.TransactionClient) {
    const map = new Map<string, Integrity>();
    if (ids.length === 0) return map;
    const rows = await db.$queryRaw<
      { evidence_id: string; result: Integrity['latestResult']; verified_at: Date }[]
    >`
      SELECT DISTINCT ON (evidence_id) evidence_id, result::text AS result, verified_at
      FROM integrity_verifications
      WHERE evidence_id = ANY(${ids}::uuid[])
      ORDER BY evidence_id, verified_at DESC, id DESC`;
    for (const row of rows) {
      map.set(row.evidence_id, {
        latestResult: row.result,
        verifiedAt: row.verified_at.toISOString(),
      });
    }
    return map;
  }
}

function toResponse(item: EvidenceItem, integrity: Integrity): EvidenceResponse {
  const detail = (item.failureDetail ?? {}) as { pages_without_text?: number[] };
  const metadata = item.sourceMetadata as {
    attachments?: { filename: string; content_type: string; size_bytes: number }[];
  };
  return {
    id: item.id,
    evidenceRef: item.evidenceRef,
    evidenceType: item.evidenceType,
    pasteKind: item.pasteKind,
    label: item.label,
    originalFilename: item.originalFilename,
    contentType: item.detectedContentType ?? item.declaredContentType,
    byteSize: item.byteSize === null ? null : Number(item.byteSize),
    pageCount: item.pageCount,
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    textCharCount: item.textCharCount,
    sha256: item.sha256,
    uploadedAt: item.uploadedAt?.toISOString() ?? null,
    processingStatus: item.processingStatus,
    failure:
      item.failureCode === null
        ? null
        : {
            code: item.failureCode,
            retryable: item.failureRetryable ?? false,
            ...(item.failureRetryable === false && detail.pages_without_text
              ? { pagesWithoutText: detail.pages_without_text }
              : {}),
          },
    integrity,
    // Attachments are listed by the EML parser during processing (07 §12); null until then.
    email:
      item.evidenceType === 'EML' && metadata.attachments
        ? {
            attachments: metadata.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.content_type,
              sizeBytes: a.size_bytes,
            })),
            attachmentsProcessed: false,
          }
        : null,
    createdAt: item.createdAt.toISOString(),
  };
}
