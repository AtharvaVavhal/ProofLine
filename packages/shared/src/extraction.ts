import { z } from 'zod';
import type { AnalysisRunSummary } from './analysis';

/** Counts Unicode code points, matching PostgreSQL char_length(). */
const text = (max: number) =>
  z.string().refine((value) => [...value].length <= max, { message: `at most ${max} characters` });

/** POST /cases/:id/extractions/:extractionId/correction (05 #24). */
export const correctExtractionSchema = z.strictObject({
  correctedValue: text(2000).refine((v) => v.trim().length > 0, { message: 'required' }),
  note: text(2000).nullable().optional(),
});
export type CorrectExtractionInput = z.infer<typeof correctExtractionSchema>;

/** Provenance reference (05 §3.1, AD-02). */
export type SourceRef = {
  kind: 'EXTRACTION' | 'EVIDENCE' | 'USER_STATEMENT';
  id: string;
  evidenceId: string | null;
  evidenceRef: string | null;
  location: { pageNumber: number; lineNumbers: number[]; headerName: string | null } | null;
  snippet: string | null;
  statementText: string | null;
};

/** Extraction object (05 §13). Numeric confidence is never returned (AD-02). */
export type ExtractionView = {
  id: string;
  evidenceId: string;
  evidenceRef: string;
  fieldType: string;
  rawValue: string;
  normalizedValue: string | null;
  normalizationStatus: 'NORMALIZED' | 'NOT_NORMALIZED' | 'NOT_APPLICABLE';
  method: 'OCR' | 'PDF_TEXT' | 'TEXT_PARSE' | 'RULE' | 'LLM';
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
  validationStatus: 'VALIDATED_AGAINST_SOURCE' | 'USER_CORRECTED';
  sourceLabel: string | null;
  snippet: string;
  location: {
    pageNumber: number;
    lineNumbers: number[];
    headerName: string | null;
    bbox: { x: number; y: number; w: number; h: number } | null;
  };
  correction: {
    correctedValue: string;
    correctedNormalizedValue: string | null;
    correctedAt: string;
    statementId: string;
  } | null;
};

export type CorrectExtractionResponse = { extraction: ExtractionView; run: AnalysisRunSummary };
