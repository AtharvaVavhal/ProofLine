import type { EntityType, RelationType } from '@prisma/client';
import {
  CorrelationInput,
  ValidRelationship,
  deterministicRelationships,
  supportCount,
  validateRelationship,
} from '../src/graph/correlation-rules';
import { maskedValue } from '../src/entities/entity-masking';
import { AD03, correlationFixture, proposal } from './phase7-fixtures';

const refsOf = (input: CorrelationInput, entityId: string) =>
  input.evidence
    .filter((e) => e.extractions.some((x) => x.entityId === entityId))
    .map((e) => e.evidenceRef);

const entity = (input: CorrelationInput, type: EntityType, canonical: string) => {
  const found = input.entities.filter(
    (e) => e.entityType === type && e.canonicalValue === canonical,
  );
  expect(found).toHaveLength(1);
  return found[0]!;
};

/** What CORRELATE writes: one edge per (from, type, to), support merged across items (08 §9.3). */
function correlate(input: CorrelationInput, proposals: unknown[] = []) {
  const edges = new Map<string, ValidRelationship>();
  for (const candidate of [...deterministicRelationships(input), ...proposals]) {
    const valid = validateRelationship(input, candidate);
    if (!valid) continue;
    const key = `${valid.fromEntityId}|${valid.relationType}|${valid.toEntityId}`;
    const prior = edges.get(key);
    edges.set(
      key,
      prior
        ? {
            ...valid,
            evidenceIds: [...new Set([...prior.evidenceIds, ...valid.evidenceIds])],
            extractionIds: [...new Set([...prior.extractionIds, ...valid.extractionIds])],
          }
        : valid,
    );
  }
  const name = (id: string) => {
    const e = input.entities.find((x) => x.id === id)!;
    return `${e.entityType}:${e.canonicalValue}`;
  };
  return [...edges.values()]
    .map((e) => ({
      type: e.relationType,
      from: name(e.fromEntityId),
      to: name(e.toEntityId),
      evidence: input.evidence
        .filter((x) => e.evidenceIds.includes(x.id))
        .map((x) => x.evidenceRef),
      supportCount: supportCount(e.evidenceIds),
    }))
    .sort((a, b) => `${a.type}${a.from}${a.to}`.localeCompare(`${b.type}${b.from}${b.to}`));
}

describe('13 §16–§19 oracle on the frozen AD-03 text (Phase 7 exit gate)', () => {
  const input = correlationFixture(AD03);
  const URL = 'https://kyc-update-verify.example/kyc';

  it('§16–§17: canonical entities merge exactly as expected, with nothing fuzzy', () => {
    const expected: [EntityType, string, string[]][] = [
      ['PHONE', '+919000000001', ['E01', 'E02', 'E06']],
      ['URL', URL, ['E01', 'E02', 'E03']],
      ['DOMAIN', 'kyc-update-verify.example', ['E01', 'E02', 'E03']],
      ['UPI_ID', 'kyc.refund.desk@demoupi', ['E02', 'E04', 'E05']],
      ['TRANSACTION', '627000418532', ['E04', 'E05']],
      ['AMOUNT', 'INR 8500.00', ['E02', 'E04', 'E05', 'E06']],
      ['ACCOUNT_HINT', '4821', ['E04', 'E05']],
      ['SMS_SENDER_HEADER', 'VX-KYCUPD', ['E01']],
      ['SMS_SENDER_HEADER', 'VX-ALERTS', ['E05']],
      ['PERSON', 'KYC Refund Desk', ['E04']],
      ['PERSON', 'Asha Verma', ['E04']],
    ];
    for (const [type, canonical, refs] of expected) {
      expect([type, canonical, refsOf(input, entity(input, type, canonical).id)]).toEqual([
        type,
        canonical,
        refs,
      ]);
    }
    // "Rohan" is a free-text claimed name: a model candidate (06 §5), never a rule match.
    // Overview counts PHONE 1 · URL 1 · UPI 1 · UTR 1; no bank, OTP or card entity.
    const byType = (t: EntityType) => input.entities.filter((e) => e.entityType === t).length;
    expect([byType('PHONE'), byType('URL'), byType('UPI_ID'), byType('TRANSACTION')]).toEqual([
      1, 1, 1, 1,
    ]);
    expect(byType('BANK_OR_WALLET')).toBe(0);
    expect(input.entities).toHaveLength(expected.length);
  });

  it('§16 masked displays', () => {
    expect(maskedValue('PHONE', '+919000000001')).toBe('+91 90XXX XX001');
    expect(maskedValue('UPI_ID', 'kyc.refund.desk@demoupi')).toBe('kyc.r***@demoupi');
    expect(maskedValue('TRANSACTION', '627000418532')).toBe('6270…8532');
    expect(maskedValue('ACCOUNT_HINT', '4821', '****4821')).toBe('****4821');
    expect(maskedValue('URL', URL)).toBe(URL);
  });

  it('§18: D1–D5 give R1, R4–R7 and the permitted VX-ALERTS edge — nothing else', () => {
    const expected: [RelationType, string, string, string[]][] = [
      ['AMOUNT_OF', 'AMOUNT:INR 8500.00', 'TRANSACTION:627000418532', ['E04', 'E05']], // R5
      ['DEBITED_FROM', 'TRANSACTION:627000418532', 'ACCOUNT_HINT:4821', ['E04', 'E05']], // R6
      ['HOSTED_ON', `URL:${URL}`, 'DOMAIN:kyc-update-verify.example', ['E01', 'E02', 'E03']], // R1
      [
        'MESSAGE_CONTAINED',
        'SMS_SENDER_HEADER:VX-ALERTS',
        'UPI_ID:kyc.refund.desk@demoupi',
        ['E05'],
      ], // X-3a
      ['MESSAGE_CONTAINED', 'SMS_SENDER_HEADER:VX-KYCUPD', 'PHONE:+919000000001', ['E01']], // R7a
      ['MESSAGE_CONTAINED', 'SMS_SENDER_HEADER:VX-KYCUPD', `URL:${URL}`, ['E01']], // R7b
      ['PAID_TO', 'TRANSACTION:627000418532', 'UPI_ID:kyc.refund.desk@demoupi', ['E04', 'E05']], // R4
    ];
    expect(correlate(input).map((e) => [e.type, e.from, e.to, e.evidence])).toEqual(expected);
  });

  it('§18: R2 and R3 come only from validated proposals; PAID_TO keeps supportCount 2', () => {
    const edges = correlate(input, [
      proposal(input, 'SENT_LINK', 'PHONE', 'URL', ['E02']),
      proposal(input, 'REQUESTED_PAYMENT_TO', 'PHONE', 'UPI_ID', ['E02']),
      // Hallucinated support: E03 has no phone, so this proposal is discarded whole.
      proposal(input, 'SENT_LINK', 'PHONE', 'URL', ['E02', 'E03']),
      // A ninth type and a disallowed pair are rejected.
      { ...proposal(input, 'SENT_LINK', 'PHONE', 'URL', ['E02']), relationType: 'OWNS' },
      proposal(input, 'PAID_TO', 'PHONE', 'UPI_ID', ['E02']),
    ]);
    const find = (type: RelationType) => edges.filter((e) => e.type === type);
    expect(find('SENT_LINK').map((e) => [e.from, e.to, e.evidence])).toEqual([
      ['PHONE:+919000000001', `URL:${URL}`, ['E02']],
    ]);
    expect(find('REQUESTED_PAYMENT_TO').map((e) => [e.from, e.to, e.evidence])).toEqual([
      ['PHONE:+919000000001', 'UPI_ID:kyc.refund.desk@demoupi', ['E02']],
    ]);
    expect(find('PAID_TO').map((e) => e.supportCount)).toEqual([2]);
    expect(find('AMOUNT_OF').map((e) => e.supportCount)).toEqual([2]);
    expect(find('DEBITED_FROM').map((e) => e.supportCount)).toEqual([2]);
    expect(find('HOSTED_ON').map((e) => e.supportCount)).toEqual([3]);
    expect(edges).toHaveLength(9);
  });
});
