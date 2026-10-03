import {
  ANALYSIS_PLAN,
  AVAILABLE_CASE_STEPS,
  DEPENDENCIES,
  UNAVAILABLE_STEPS,
  completionGate,
  planFor,
} from '../src/orchestrator/analysis-plan';
import { isAllowedTransition } from '../src/cases/case-state.service';

describe('Phase 8 deterministic orchestration contracts (06 §4; DECISIONS §12)', () => {
  it('stores the exact full plan; REPORT never appears in an analysis plan', () => {
    expect(ANALYSIS_PLAN).toEqual([
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
    ]);
    expect(ANALYSIS_PLAN).not.toContain('REPORT');
  });
  it.each(['USER_START', 'USER_RETRY', 'EVIDENCE_DELETION'] as const)(
    '%s has a deterministic full contract',
    (trigger) => {
      expect(planFor(trigger)).toEqual(ANALYSIS_PLAN);
      expect(planFor(trigger)).toEqual(planFor(trigger));
    },
  );
  it('extraction correction re-enters at NORMALIZE without reparsing', () => {
    expect(planFor('CORRECTION', { state: 'EXTRACTED' })).toEqual([
      'PLAN',
      ...ANALYSIS_PLAN.slice(3),
    ]);
  });
  it('timeline correction contracts re-enter at ACTIONS, or MISSING_INFO if a checked time changed', () => {
    expect(planFor('CORRECTION', { state: 'TIMELINE_READY' })).toEqual([
      'PLAN',
      'ACTIONS',
      'URGENCY',
    ]);
    expect(planFor('CORRECTION', { state: 'TIMELINE_READY', timeChanged: true })).toEqual([
      'PLAN',
      'MISSING_INFO',
      'ACTIONS',
      'URGENCY',
    ]);
  });
  it('answer contracts re-enter at MISSING_INFO, or TIMELINE for a time answer', () => {
    expect(planFor('ANSWER')).toEqual(['PLAN', 'MISSING_INFO', 'ACTIONS', 'URGENCY']);
    expect(planFor('ANSWER', { timeChanged: true })).toEqual([
      'PLAN',
      'TIMELINE',
      'MISSING_INFO',
      'ACTIONS',
      'URGENCY',
    ]);
  });
  it.each(Object.entries(DEPENDENCIES))('%s dependencies precede it', (name, dependencies) => {
    for (const dependency of dependencies)
      expect(ANALYSIS_PLAN.indexOf(dependency)).toBeLessThan(
        ANALYSIS_PLAN.indexOf(name as (typeof ANALYSIS_PLAN)[number]),
      );
  });
  it('Phase 7 correlation has a fact dependency and a distinct later lifecycle gate', () => {
    expect(DEPENDENCIES.CORRELATE).toEqual(['NORMALIZE']);
    expect(
      completionGate(
        [
          { stepName: 'CORRELATE', status: 'SUCCEEDED' },
          { stepName: 'SCAM_ANALYSIS', status: 'PENDING' },
        ],
        ['SCAM_ANALYSIS', 'CORRELATE'],
      ),
    ).toBe(false);
  });
  it('only existing case processors are available; later contracts produce nothing', () => {
    expect(AVAILABLE_CASE_STEPS).toEqual(['NORMALIZE', 'CORRELATE']);
    expect(UNAVAILABLE_STEPS).toEqual([
      'SCAM_ANALYSIS',
      'TIMELINE',
      'MISSING_INFO',
      'ACTIONS',
      'URGENCY',
    ]);
  });
  it.each(['PENDING', 'RUNNING', 'FAILED', 'SKIPPED'] as const)(
    '%s does not pass a completion gate',
    (status) => {
      expect(completionGate([{ stepName: 'URGENCY', status }], ['URGENCY'])).toBe(false);
    },
  );
  it('a missing step never passes a completion gate', () =>
    expect(completionGate([], ['URGENCY'])).toBe(false));
  it.each([
    ['NEW', 'INGESTING'],
    ['INGESTING', 'EXTRACTED'],
    ['EXTRACTED', 'ANALYZING'],
    ['ANALYZING', 'CORRELATED'],
    ['CORRELATED', 'TIMELINE_READY'],
    ['TIMELINE_READY', 'ACTIONS_READY'],
  ] as const)('%s → %s is the allowed lifecycle edge', (from, to) =>
    expect(isAllowedTransition(from, to)).toBe(true),
  );
  it.each([
    ['INGESTING', 'ACTIONS_READY'],
    ['EXTRACTED', 'CORRELATED'],
    ['EXTRACTED', 'ACTIONS_READY'],
    ['CORRELATED', 'ACTIONS_READY'],
    ['NEW', 'USER_REVIEW'],
  ] as const)('%s cannot jump to %s', (from, to) =>
    expect(isAllowedTransition(from, to)).toBe(false),
  );
});
