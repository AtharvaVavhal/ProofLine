import type { CaseStatus } from '@prisma/client';
import { isAllowedTransition } from '../src/cases/case-state.service';
import { decodeCursor, encodeCursor } from '../src/common/cursor';

describe('case transition table (03 §23.1)', () => {
  it.each<[CaseStatus, CaseStatus]>([
    ['NEW', 'INGESTING'],
    ['INGESTING', 'EXTRACTED'],
    ['EXTRACTED', 'ANALYZING'],
    ['ANALYZING', 'CORRELATED'],
    ['CORRELATED', 'TIMELINE_READY'],
    ['TIMELINE_READY', 'ACTIONS_READY'],
    ['ACTIONS_READY', 'REPORT_DRAFT'],
    ['REPORT_DRAFT', 'USER_REVIEW'],
    ['USER_REVIEW', 'EXPORTED'],
    ['EXPORTED', 'INGESTING'], // new evidence
    ['USER_REVIEW', 'EXTRACTED'], // extraction correction
    ['EXPORTED', 'TIMELINE_READY'], // timeline correction
    ['USER_REVIEW', 'ACTIONS_READY'], // follow-up answer
    ['EXPORTED', 'REPORT_DRAFT'], // regeneration
    ['USER_REVIEW', 'NEW'], // last evidence deleted
  ])('allows %s → %s', (from, to) => {
    expect(isAllowedTransition(from, to)).toBe(true);
  });

  it.each<[CaseStatus, CaseStatus]>([
    ['NEW', 'EXTRACTED'],
    ['INGESTING', 'ANALYZING'],
    ['NEW', 'ACTIONS_READY'],
    ['TIMELINE_READY', 'REPORT_DRAFT'],
    ['ACTIONS_READY', 'USER_REVIEW'],
    ['REPORT_DRAFT', 'EXPORTED'],
    ['EXTRACTED', 'TIMELINE_READY'],
    ['INGESTING', 'CORRELATED'],
  ])('rejects %s → %s', (from, to) => {
    expect(isAllowedTransition(from, to)).toBe(false);
  });
});

describe('cursor encoding', () => {
  it('round-trips and rejects tampered values', () => {
    const cursor = {
      at: '2026-10-02T05:00:00.123456Z',
      id: '0b7c5b1e-6a3c-4d7e-9f1a-2b3c4d5e6f70',
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor(undefined)).toBeNull();
    for (const bad of [
      '',
      'x',
      Buffer.from('{"a":1}').toString('base64url'),
      Buffer.from(`["${cursor.at}","1; DROP TABLE cases"]`).toString('base64url'),
    ]) {
      expect(() => decodeCursor(bad)).toThrow();
    }
  });
});
