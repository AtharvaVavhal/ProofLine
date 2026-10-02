import { Injectable } from '@nestjs/common';
import type { Case } from '@prisma/client';
import type { CaseListItem, CaseResponse, EvidenceStatusCounts } from '@proofline/shared';
import { Prisma } from '@prisma/client';
import { Cursor, cursorTimestampSql, encodeCursor } from '../common/cursor';
import { PrismaService } from '../database/prisma.service';

/** Row of the `case_overview` view (03 §5.3). */
type OverviewRow = {
  evidence_total: number;
  evidence_uploading: number;
  evidence_uploaded: number;
  evidence_processing: number;
  evidence_processed: number;
  evidence_failed: number;
  latest_run_id: string | null;
  latest_report_version: number | null;
  latest_report_status: string | null;
  current_report_id: string | null;
  current_report_version: number | null;
  has_active_confirmation: boolean;
  urgency_level: string | null;
  urgency_out_of_date: boolean;
  entity_counts: Record<string, number>;
};

type ListRow = {
  id: string;
  case_reference: string;
  status: string;
  incident_type: string | null;
  created_at: Date;
  updated_at: Date;
  cursor_at: string;
  urgency_level: string | null;
  evidence_total: number;
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * Builds the Case object (05 §7.3) from the case row and the `case_overview` view. It only
 * reads; the caller has already checked ownership. Scam signals and urgency reasons carry
 * SourceRefs and are rendered by the phases that produce them (09 scam analysis, 12 urgency);
 * until then they are empty lists.
 */
@Injectable()
export class CaseReadModel {
  constructor(private readonly prisma: PrismaService) {}

  async getCase(caseId: string): Promise<CaseResponse> {
    const kase = await this.prisma.case.findUniqueOrThrow({ where: { id: caseId } });
    const [overview] = await this.prisma.$queryRaw<OverviewRow[]>`
      SELECT * FROM case_overview WHERE case_id = ${caseId}::uuid`;
    if (!overview) throw new Error('case_overview row missing');

    const [latestRun, assessment, confirmation] = await Promise.all([
      overview.latest_run_id
        ? this.prisma.analysisRun.findUnique({
            where: { id: overview.latest_run_id },
            select: {
              id: true,
              kind: true,
              status: true,
              fallbackUsed: true,
              failedStep: { select: { stepName: true } },
            },
          })
        : null,
      overview.urgency_level
        ? this.prisma.urgencyAssessment.findFirst({ where: { caseId, isCurrent: true } })
        : null,
      overview.current_report_id && overview.has_active_confirmation
        ? this.prisma.reviewConfirmation.findFirst({
            where: { reportId: overview.current_report_id, voidedAt: null },
            select: { confirmedAt: true },
          })
        : null,
    ]);

    const byStatus: EvidenceStatusCounts = {
      UPLOADING: overview.evidence_uploading,
      UPLOADED: overview.evidence_uploaded,
      PROCESSING: overview.evidence_processing,
      PROCESSED: overview.evidence_processed,
      FAILED: overview.evidence_failed,
    };

    return {
      ...this.caseFields(kase),
      evidence: { total: overview.evidence_total, byStatus },
      latestRun: latestRun
        ? {
            id: latestRun.id,
            kind: latestRun.kind,
            status: latestRun.status,
            failedStep: latestRun.failedStep?.stepName ?? null,
            fallbackUsed: latestRun.fallbackUsed,
          }
        : null,
      scamSignals: [],
      urgency: assessment
        ? {
            assessed: true,
            level: assessment.level,
            outOfDate: overview.urgency_out_of_date,
            ruleVersion: assessment.ruleVersion,
            explanation: assessment.explanationText,
            disclaimer: assessment.disclaimerText,
            reasons: [],
            computedAt: assessment.computedAt.toISOString(),
          }
        : {
            assessed: false,
            level: null,
            outOfDate: false,
            ruleVersion: null,
            explanation: null,
            disclaimer: null,
            reasons: [],
            computedAt: null,
          },
      entityCounts: overview.entity_counts,
      // The current version is the highest GENERATED one (03 §17.2); before any version is
      // generated, the latest attempt is shown with its status.
      report:
        overview.latest_report_version === null
          ? null
          : {
              currentVersion: overview.current_report_version ?? overview.latest_report_version,
              currentStatus: overview.current_report_id
                ? 'GENERATED'
                : overview.latest_report_status!,
              reviewed: overview.has_active_confirmation,
              confirmedAt: iso(confirmation?.confirmedAt ?? null),
            },
      createdAt: kase.createdAt.toISOString(),
      updatedAt: kase.updatedAt.toISOString(),
    };
  }

  /** The owner's cases, newest update first with an id tiebreak (05 §26). */
  async listCases(
    userId: string,
    limit: number,
    after: Cursor | null,
  ): Promise<{ items: CaseListItem[]; nextCursor: string | null }> {
    const position = after
      ? Prisma.sql`AND (c.updated_at, c.id) < (${after.at}::timestamptz, ${after.id}::uuid)`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT c.id, c.case_reference, c.status::text AS status, c.incident_type::text AS incident_type,
             c.created_at, c.updated_at, ${Prisma.raw(cursorTimestampSql('c.updated_at'))} AS cursor_at,
             o.urgency_level::text AS urgency_level, o.evidence_total
      FROM cases c
      JOIN case_overview o ON o.case_id = c.id
      WHERE c.user_id = ${userId}::uuid ${position}
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ${limit + 1}`;

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        id: row.id,
        caseReference: row.case_reference,
        status: row.status,
        incidentType: row.incident_type,
        urgency: { level: row.urgency_level },
        evidence: { total: row.evidence_total },
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ at: last.cursor_at, id: last.id }) : null,
    };
  }

  private caseFields(kase: Case) {
    return {
      id: kase.id,
      caseReference: kase.caseReference,
      status: kase.status,
      statusChangedAt: kase.statusChangedAt.toISOString(),
      incidentTime: iso(kase.incidentTime),
      incidentTimePrecision: kase.incidentTimePrecision,
      contact: kase.contactText,
      location: kase.locationText,
      summary: kase.summary,
      incidentType: kase.incidentType,
      financialLossReported: kase.financialLossReported,
    };
  }
}
