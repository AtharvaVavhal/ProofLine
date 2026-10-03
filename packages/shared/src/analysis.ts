/** POST /cases/:id/analyze (05 §11.1). */
export type AnalysisRunSummary = {
  id: string;
  kind: 'ANALYSIS' | 'REPORT_GENERATION';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  trigger: string;
  plan: string[] | null;
};

export type StartAnalysisResponse = { run: AnalysisRunSummary; alreadyActive?: true };

/** GET /cases/:id/activity (05 §11.2). Steps and results only; no model reasoning. */
export type ActivityResponse = {
  run:
    | (AnalysisRunSummary & {
        fallbackUsed: boolean;
        startedAt: string | null;
        finishedAt: string | null;
        failure: { code: string; retryable: boolean } | null;
      })
    | null;
  steps: {
    id: string;
    stepName: string;
    evidenceRef: string | null;
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
    description: string;
    fallbackUsed: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    failure: { code: string; retryable: boolean } | null;
  }[];
  evidenceProgress: { processed: number; total: number };
  pollAfterMs: number;
};

/** GET /evidence/:id/source (05 §10). Redacted text only. */
export type EvidenceSourceResponse = {
  evidenceId: string;
  evidenceRef: string;
  parserKind: string;
  engine: string;
  pages: {
    pageNumber: number;
    hasUsableTextLayer: boolean | null;
    nonWhitespaceCharCount: number | null;
  }[];
  lines: {
    id: string;
    pageNumber: number;
    lineNumber: number;
    locationKind: 'TEXT_LINE' | 'EMAIL_HEADER' | 'EMAIL_BODY_LINE';
    headerName: string | null;
    text: string;
    bbox: { x: number; y: number; w: number; h: number } | null;
  }[];
};
