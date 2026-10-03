import type { Extraction, SourceLine } from '@prisma/client';
import type { ExtractionView } from '@proofline/shared';

export type ExtractionWithSources = Extraction & {
  evidence: { evidenceRef: string };
  sourceLines: { ordinal: number; sourceLine: SourceLine }[];
};

/**
 * Extraction object of 05 §13. Only the band is shown; validation status is derived (03 §9.2);
 * the original values are always returned next to any correction (FR-013).
 */
export function presentExtraction(row: ExtractionWithSources): ExtractionView {
  const lines = [...row.sourceLines].sort((a, b) => a.ordinal - b.ordinal).map((l) => l.sourceLine);
  const first = lines[0];
  return {
    id: row.id,
    evidenceId: row.evidenceId,
    evidenceRef: row.evidence.evidenceRef,
    fieldType: row.fieldType,
    rawValue: row.rawValue,
    normalizedValue: row.normalizedValue,
    normalizationStatus: row.normalizationStatus,
    method: row.method as ExtractionView['method'],
    confidenceBand: row.confidenceBand,
    validationStatus:
      row.correctionStatus === 'USER_CORRECTED' ? 'USER_CORRECTED' : 'VALIDATED_AGAINST_SOURCE',
    sourceLabel: row.sourceLabel,
    snippet: row.snippet,
    location: {
      pageNumber: first?.pageNumber ?? 1,
      lineNumbers: lines.filter((l) => l.pageNumber === first?.pageNumber).map((l) => l.lineNumber),
      headerName: first?.headerName ?? null,
      bbox: (first?.bbox as ExtractionView['location']['bbox']) ?? null,
    },
    correction:
      row.correctionStatus === 'USER_CORRECTED' && row.correctedValue && row.correctionStatementId
        ? {
            correctedValue: row.correctedValue,
            correctedNormalizedValue: row.correctedNormalizedValue,
            correctedAt: (row.correctedAt ?? row.updatedAt).toISOString(),
            statementId: row.correctionStatementId,
          }
        : null,
  };
}

export const EXTRACTION_INCLUDE = {
  evidence: { select: { evidenceRef: true } },
  sourceLines: { include: { sourceLine: true } },
} as const;
