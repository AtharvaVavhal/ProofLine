import type { CaseStatus, RunTrigger, StepName, StepStatus } from '@prisma/client';

/** 06 §4.2; 14 P8. REPORT belongs only to report runs. */
export const ANALYSIS_PLAN: readonly StepName[] = [
  'PLAN',
  'PARSE',
  'EXTRACT',
  'NORMALIZE',
  'SCAM_ANALYSIS',
  'CORRELATE',
  'TIMELINE',
  'MISSING_INFO',
  'ACTIONS',
  'URGENCY',
];

/** Step contracts, not implementations of the later domain processors (DECISIONS §12). */
export const DEPENDENCIES: Partial<Record<StepName, readonly StepName[]>> = {
  PARSE: ['PLAN'],
  EXTRACT: ['PARSE'],
  NORMALIZE: ['EXTRACT'],
  SCAM_ANALYSIS: ['NORMALIZE'],
  // Phase 7 relationship facts use canonical entities. The lifecycle gate additionally
  // requires scam analysis; computing facts never means that gate has been passed.
  CORRELATE: ['NORMALIZE'],
  TIMELINE: ['SCAM_ANALYSIS', 'CORRELATE'],
  MISSING_INFO: ['TIMELINE'],
  ACTIONS: ['MISSING_INFO'],
  URGENCY: ['ACTIONS'],
};

export const AVAILABLE_CASE_STEPS: readonly StepName[] = ['NORMALIZE', 'CORRELATE'];
export const UNAVAILABLE_STEPS: readonly StepName[] = [
  'SCAM_ANALYSIS',
  'TIMELINE',
  'MISSING_INFO',
  'ACTIONS',
  'URGENCY',
];

/** Re-entry context is server-derived (06 §4.3), never an API body. */
export function planFor(
  trigger: RunTrigger,
  context: {
    state?: CaseStatus;
    timeChanged?: boolean;
  } = {},
): StepName[] {
  let from: StepName = 'PARSE';
  if (trigger === 'ANSWER') from = context.timeChanged ? 'TIMELINE' : 'MISSING_INFO';
  if (trigger === 'CORRECTION') {
    from =
      context.state === 'TIMELINE_READY'
        ? context.timeChanged
          ? 'MISSING_INFO'
          : 'ACTIONS'
        : 'NORMALIZE';
  }
  return ['PLAN', ...ANALYSIS_PLAN.slice(ANALYSIS_PLAN.indexOf(from))];
}

/** A case transition requires all contributing steps to have genuinely succeeded. */
export function completionGate(
  steps: { stepName: StepName; status: StepStatus }[],
  required: readonly StepName[],
): boolean {
  return required.every((name) =>
    steps.some((s) => s.stepName === name && s.status === 'SUCCEEDED'),
  );
}
