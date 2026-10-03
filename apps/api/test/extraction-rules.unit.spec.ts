import { randomUUID } from 'node:crypto';
import type { EntityType, LineLocationKind } from '@prisma/client';
import { ExtractionCandidate, SourceLineRecord } from '../src/extraction/candidates';
import { selectExtractions } from '../src/extraction/extraction.service';
import {
  ValidatedCandidate,
  confidenceBand,
  validateCandidate,
} from '../src/extraction/literal-validator';
import { isValidFormat, normalize } from '../src/extraction/normalize';
import { ruleCandidates } from '../src/extraction/rules';
import { normalizeTemporal, parseTemporal } from '../src/extraction/temporal';

const CASE = randomUUID();
const PARSE = randomUUID();

type LineSpec = string | { text: string; header?: string; page?: number; ocr?: number };

function item(specs: LineSpec[], options: { ocr?: number } = {}) {
  const evidenceId = randomUUID();
  const counters = new Map<number, number>();
  const lines: SourceLineRecord[] = specs.map((spec) => {
    const s = typeof spec === 'string' ? { text: spec } : spec;
    const page = s.page ?? 1;
    const lineNumber = (counters.get(page) ?? 0) + 1;
    counters.set(page, lineNumber);
    return {
      id: randomUUID(),
      caseId: CASE,
      evidenceId,
      parseResultId: PARSE,
      pageNumber: page,
      lineNumber,
      locationKind: (s.header ? 'EMAIL_HEADER' : 'TEXT_LINE') as LineLocationKind,
      headerName: s.header ?? null,
      text: s.text,
      bbox: null,
      ocrConfidence: s.ocr ?? options.ocr ?? null,
    };
  });
  const context = { caseId: CASE, evidenceId, lines: new Map(lines.map((l) => [l.id, l])) };
  return { evidenceId, lines, context };
}

/** Rule extraction over an item: what EXTRACT would persist (without the model). */
function extract(specs: LineSpec[], options: { ocr?: number } = {}) {
  const it = item(specs, options);
  const result = selectExtractions(ruleCandidates(it.lines), it.context);
  return { ...it, ...result, rows: result.kept.map(view) };
}

const view = (v: ValidatedCandidate) => ({
  type: v.fieldType,
  raw: v.rawValue,
  normalized: v.normalized.value,
});

const has = (rows: ReturnType<typeof view>[], type: EntityType, raw: string, normalized?: string) =>
  rows.some(
    (r) =>
      r.type === type && r.raw === raw && (normalized === undefined || r.normalized === normalized),
  );

/** The six artifacts' visible text, verbatim from DECISIONS §7.2.3 (13 §13). */
const E01 = [
  'VX-KYCUPD',
  'Thursday, 24 Sep 2026',
  'Dear Customer, your bank KYC has expired. Your account will be BLOCKED today.',
  'Update KYC now: https://kyc-update-verify.example/kyc?utm_source=sms',
  'or call KYC desk +91 90000 00001',
  '12:03 PM',
];
const E02 = [
  '+91 90000 00001 ~ KYC Support',
  '24 September 2026',
  '12:09 PM C: Hello, this is Rohan from KYC verification team as discussed on call. Open this link',
  'and complete KYC: https://kyc-update-verify.example/kyc',
  '12:11 PM U: Opened the link. It is asking for customer ID and password.',
  '12:15 PM C: Enter all details. You will get an OTP, share it here to complete verification.',
  '12:17 PM U: OTP is [REDACTED:OTP]',
  '12:18 PM C: Final step: pay refundable KYC security deposit ₹8,500 to UPI ID',
  'kyc.refund.desk@demoupi. It will be refunded in 2 hours.',
  '12:18 PM U: Ok paying now',
];
const E03 = [
  '12:16',
  'https://kyc-update-verify.example/kyc',
  'KYC Verification Centre',
  'Your KYC has expired. Complete verification within 24 hours to avoid account',
  'suspension.',
  'Customer ID',
  'Password',
  'Registered Mobile Number',
  'Enter OTP sent to your mobile',
  'Verify KYC',
];
const E04 = [
  'UPI Payment Receipt',
  'Payment Successful',
  'Amount: ₹8,500.00',
  'Paid to: KYC Refund Desk',
  'UPI ID: kyc.refund.desk@demoupi',
  'Paid by: Asha Verma',
  'From account: ****4821',
  'Date & time: 24 Sep 2026, 12:19 PM',
  'UPI Ref No: 627000418532',
  'Note: KYC deposit',
];
const E05 = [
  'VX-ALERTS',
  'Thursday, 24 Sep 2026',
  'Rs.8500.00 debited from A/c XX4821 on 24-09-26 12:21 via UPI to VPA',
  'kyc.refund.desk@demoupi. Ref no 627000418532. If not done by you, report to your',
  'bank immediately.',
  '12:21 PM',
];
const E06 = [
  'On 24 Sep 2026 I got an SMS saying my bank KYC had expired. Around 12:05 PM I called the number in the SMS, 9000000001. A man who said his name was Rohan from the KYC team told me to open a link he would send on chat. I entered my customer ID, password and the OTP. He then asked me to pay a refundable deposit, and I paid Rs 8,500 at around 12:40 PM. After that I got a debit SMS.',
];

describe('13 §15 benchmark: rule extraction on the AD-03 artifact text (EXT-12)', () => {
  const URL_CANONICAL = 'https://kyc-update-verify.example/kyc';
  /** K fields of 13 §15 that come from rules (PERSON/claimed names come from the model). */
  const K: [string, LineSpec[], EntityType, string, string][] = [
    ['E01', E01, 'URL', 'https://kyc-update-verify.example/kyc?utm_source=sms', URL_CANONICAL],
    ['E01', E01, 'PHONE', '+91 90000 00001', '+919000000001'],
    ['E01', E01, 'DATETIME', 'Thursday, 24 Sep 2026', '2026-09-24'],
    ['E01', E01, 'DATETIME', '12:03 PM', 'T12:03'],
    ['E02', E02, 'PHONE', '+91 90000 00001', '+919000000001'],
    ['E02', E02, 'URL', URL_CANONICAL, URL_CANONICAL],
    ['E02', E02, 'DOMAIN', 'kyc-update-verify.example', 'kyc-update-verify.example'],
    ['E02', E02, 'AMOUNT', '₹8,500', 'INR 8500.00'],
    ['E02', E02, 'UPI_ID', 'kyc.refund.desk@demoupi', 'kyc.refund.desk@demoupi'],
    ['E02', E02, 'DATETIME', '24 September 2026', '2026-09-24'],
    ['E02', E02, 'DATETIME', '12:09 PM', 'T12:09'],
    ['E02', E02, 'DATETIME', '12:11 PM', 'T12:11'],
    ['E02', E02, 'DATETIME', '12:15 PM', 'T12:15'],
    ['E02', E02, 'DATETIME', '12:17 PM', 'T12:17'],
    ['E02', E02, 'DATETIME', '12:18 PM', 'T12:18'],
    ['E03', E03, 'URL', URL_CANONICAL, URL_CANONICAL],
    ['E03', E03, 'DOMAIN', 'kyc-update-verify.example', 'kyc-update-verify.example'],
    ['E04', E04, 'AMOUNT', '₹8,500.00', 'INR 8500.00'],
    ['E04', E04, 'UPI_ID', 'kyc.refund.desk@demoupi', 'kyc.refund.desk@demoupi'],
    ['E04', E04, 'DATETIME', '24 Sep 2026, 12:19 PM', '2026-09-24T12:19+05:30'],
    ['E04', E04, 'TRANSACTION', '627000418532', '627000418532'],
    ['E05', E05, 'AMOUNT', 'Rs.8500.00', 'INR 8500.00'],
    ['E05', E05, 'DATETIME', '24-09-26 12:21', '2026-09-24T12:21+05:30'],
    ['E05', E05, 'UPI_ID', 'kyc.refund.desk@demoupi', 'kyc.refund.desk@demoupi'],
    ['E05', E05, 'TRANSACTION', '627000418532', '627000418532'],
    ['E06', E06, 'PHONE', '9000000001', '+919000000001'],
  ];

  it('extracts every rule-sourced K field with its expected normalised value (> 95 %)', () => {
    const missed = K.filter(
      ([, lines, type, raw, normalized]) => !has(extract(lines).rows, type, raw, normalized),
    );
    expect(missed.map(([ev, , type, raw]) => `${ev} ${type} ${raw}`)).toEqual([]);
  });

  it('finds the non-K fields of 13 §15 that rules can see', () => {
    expect(has(extract(E01).rows, 'SMS_SENDER_HEADER', 'VX-KYCUPD')).toBe(true);
    expect(has(extract(E01).rows, 'DOMAIN', 'kyc-update-verify.example')).toBe(true);
    expect(has(extract(E03).rows, 'DATETIME', '12:16', 'T12:16')).toBe(true);
    const e04 = extract(E04).rows;
    expect(has(e04, 'PERSON', 'KYC Refund Desk')).toBe(true);
    expect(has(e04, 'PERSON', 'Asha Verma')).toBe(true);
    expect(has(e04, 'ACCOUNT_HINT', '****4821', '4821')).toBe(true);
    const e05 = extract(E05).rows;
    expect(has(e05, 'SMS_SENDER_HEADER', 'VX-ALERTS')).toBe(true);
    expect(has(e05, 'ACCOUNT_HINT', 'XX4821', '4821')).toBe(true);
    const e06 = extract(E06).rows;
    expect(has(e06, 'AMOUNT', 'Rs 8,500', 'INR 8500.00')).toBe(true);
    expect(has(e06, 'DATETIME', '24 Sep 2026', '2026-09-24')).toBe(true);
    expect(has(e06, 'DATETIME', 'Around 12:05 PM', 'T12:05')).toBe(true);
    expect(has(e06, 'DATETIME', 'around 12:40 PM', 'T12:40')).toBe(true);
  });

  it('keeps the intentional gaps: no bank or wallet, no OTP, no unlabelled transaction', () => {
    for (const lines of [E01, E02, E03, E04, E05, E06]) {
      const rows = extract(lines).rows;
      expect(rows.filter((r) => r.type === 'BANK_OR_WALLET')).toEqual([]);
      expect(rows.some((r) => r.raw.includes('731904') || r.raw.includes('REDACTED'))).toBe(false);
      expect(rows.filter((r) => r.type === 'EMAIL')).toEqual([]); // 13 §30: no email-like value
    }
    // Only the labelled UTRs: E02/E06 have no transaction at all.
    expect(extract(E02).rows.filter((r) => r.type === 'TRANSACTION')).toEqual([]);
    expect(extract(E06).rows.filter((r) => r.type === 'TRANSACTION')).toEqual([]);
  });

  it('records precision, typed values, labels and date context hints', () => {
    const e04 = extract(E04);
    const dt = e04.kept.find((v) => v.fieldType === 'DATETIME')!;
    expect(dt.normalized.datetime?.toISOString()).toBe('2026-09-24T06:49:00.000Z');
    expect(dt.normalized.precision).toBe('EXACT');
    const amount = e04.kept.find((v) => v.fieldType === 'AMOUNT')!;
    expect(amount.normalized).toMatchObject({ amountMinor: 850000n, currency: 'INR' });
    expect(e04.kept.find((v) => v.fieldType === 'TRANSACTION')!.sourceLabel).toBe('UPI Ref No');
    expect(extract(E05).kept.find((v) => v.fieldType === 'TRANSACTION')!.sourceLabel).toBe(
      'Ref no',
    );
    const e05dt = extract(E05).kept.find((v) => v.rawValue === '24-09-26 12:21')!;
    expect(e05dt.normalized.datetime?.toISOString()).toBe('2026-09-24T06:51:00.000Z');
    const approx = extract(E06).kept.find((v) => v.rawValue === 'Around 12:05 PM')!;
    expect(approx.attributes).toMatchObject({ fragment: 'TIME', precision: 'APPROXIMATE' });
    expect(approx.normalized.datetime).toBeUndefined(); // never a manufactured timestamp
    const person = e04.kept.find((v) => v.rawValue === 'Asha Verma')!;
    expect(person.attributes).toMatchObject({ context: 'payer' });
    expect(e04.kept.find((v) => v.rawValue === 'KYC Refund Desk')!.attributes).toMatchObject({
      context: 'payee_display_name',
    });
  });

  it('is deterministic: the same lines give the same extractions', () => {
    const lines = item(E05.map((t) => t)).lines;
    const run = () =>
      selectExtractions(ruleCandidates(lines), {
        caseId: CASE,
        evidenceId: lines[0]!.evidenceId,
        lines: new Map(lines.map((l) => [l.id, l])),
      }).kept.map((v) => ({ ...v }));
    expect(run()).toEqual(run());
  });
});

describe('deterministic patterns and normalisation (07 §15–§16; EXT-01–EXT-11)', () => {
  it('EXT-01: phone forms → one canonical; invalid phones are not phones', () => {
    for (const form of [
      '+91 90000 00001',
      '9000000001',
      '+919000000001',
      '09000000001',
      '91 90000 00001',
      '90000-00001',
    ]) {
      expect(extract([`Call ${form} now`]).rows.filter((r) => r.type === 'PHONE')).toEqual([
        { type: 'PHONE', raw: form, normalized: '+919000000001' },
      ]);
    }
    expect(
      extract(['Call +44 2071234567 or +442071234567']).rows.filter((r) => r.type === 'PHONE'),
    ).toEqual([{ type: 'PHONE', raw: '+442071234567', normalized: '+442071234567' }]);
    for (const bad of ['900000001', '5000000001', '1234567890', 'UTR 627000418532']) {
      expect(extract([bad]).rows.filter((r) => r.type === 'PHONE')).toEqual([]);
    }
  });

  it('EXT-02: URL canonical form drops tracking parameters, fragment and default port', () => {
    const n = (raw: string) => normalize('URL', raw).value;
    expect(n('https://kyc-update-verify.example/kyc?utm_source=sms')).toBe(
      'https://kyc-update-verify.example/kyc',
    );
    expect(n('HTTPS://KYC-Update-Verify.example:443/KYC/?fbclid=1&x=2#top')).toBe(
      'https://kyc-update-verify.example/KYC?x=2',
    );
    expect(n('kyc-update-verify.example')).toBe('https://kyc-update-verify.example/');
    expect(n('kyc-update-verify.example/')).toBe('https://kyc-update-verify.example/');
    const rows = extract(['Visit kyc-update-verify.example/kyc, then reply.']).rows;
    expect(
      has(rows, 'URL', 'kyc-update-verify.example/kyc', 'https://kyc-update-verify.example/kyc'),
    ).toBe(true);
    expect(has(rows, 'DOMAIN', 'kyc-update-verify.example')).toBe(true);
    expect(extract(['(see https://a.example/x).']).rows.find((r) => r.type === 'URL')!.raw).toBe(
      'https://a.example/x',
    );
  });

  it('EXT-03: UPI IDs have no TLD; emails do', () => {
    const rows = extract([
      'Pay kyc.refund.desk@demoupi or mail desk@kyc-update-verify.example',
    ]).rows;
    expect(rows.filter((r) => r.type === 'UPI_ID').map((r) => r.raw)).toEqual([
      'kyc.refund.desk@demoupi',
    ]);
    expect(rows.filter((r) => r.type === 'EMAIL').map((r) => r.raw)).toEqual([
      'desk@kyc-update-verify.example',
    ]);
    expect(rows.filter((r) => r.type === 'MESSAGING_HANDLE')).toEqual([]);
  });

  it('EXT-04: only labelled transaction references are transactions', () => {
    expect(
      extract(['Reference 627000418532 was used']).rows.filter((r) => r.type === 'TRANSACTION'),
    ).toEqual([]);
    for (const label of [
      'UTR',
      'UPI Ref No:',
      'Ref no',
      'Reference No.',
      'RRN#',
      'Transaction ID:',
      'Txn ID',
    ]) {
      const rows = extract([`${label} 627000418532`]).rows.filter((r) => r.type === 'TRANSACTION');
      expect(rows).toEqual([
        { type: 'TRANSACTION', raw: '627000418532', normalized: '627000418532' },
      ]);
    }
  });

  it('EXT-07: the four amount forms are 850000 paise INR', () => {
    for (const raw of ['₹8,500', '₹8,500.00', 'Rs.8500.00', 'Rs 8,500', 'INR 8,500', 'rs. 8500']) {
      const n = normalize('AMOUNT', raw);
      expect([raw, n.value, n.amountMinor]).toEqual([raw, 'INR 8500.00', 850000n]);
    }
    expect(normalize('AMOUNT', '₹1,00,000').amountMinor).toBe(10000000n);
  });

  it('EXT-08: date and time forms, precision and the DD-MM-YY rule', () => {
    const t = (raw: string) => {
      const f = parseTemporal(raw);
      return f ? normalizeTemporal(f) : null;
    };
    expect(t('24 Sep 2026')?.text).toBe('2026-09-24');
    expect(t('Thursday, 24 Sep 2026')?.text).toBe('2026-09-24');
    expect(t('24 September 2026')?.text).toBe('2026-09-24');
    expect(t('24-09-26')?.text).toBe('2026-09-24');
    expect(t('24/09/2026')?.text).toBe('2026-09-24');
    expect(t('2026-09-24')?.text).toBe('2026-09-24');
    expect(t('24-09-75')?.text).toBe('1975-09-24');
    expect(t('12:16')).toEqual({ text: 'T12:16', utc: null, precision: 'EXACT' });
    expect(t('12:03 AM')?.text).toBe('T00:03');
    expect(t('Around 12:05 PM')).toEqual({ text: 'T12:05', utc: null, precision: 'APPROXIMATE' });
    expect(t('~ 9:30 pm')?.precision).toBe('APPROXIMATE');
    expect(t('9:30 p.m.')?.text).toBe('T21:30');
    expect(
      extract(['I paid at around 12:40 PM. Then left.']).rows.find((r) => r.type === 'DATETIME')!
        .raw,
    ).toBe('around 12:40 PM');
    expect(t('24 Sep 2026, 12:19 PM')?.utc?.toISOString()).toBe('2026-09-24T06:49:00.000Z');
    expect(t('31-02-26')).toBeNull();
    expect(t('25:10')).toBeNull();
    expect(t('13:10 PM')).toBeNull();
  });

  it('EXT-11: bank names need a bank label; the payee is never a bank (GR-05)', () => {
    expect(
      extract(['Paid to: KYC Refund Desk', 'Example Bank sent this']).rows.filter(
        (r) => r.type === 'BANK_OR_WALLET',
      ),
    ).toEqual([]);
    expect(has(extract(['Bank: Example Bank']).rows, 'BANK_OR_WALLET', 'Example Bank')).toBe(true);
    expect(has(extract(['Wallet: Demo Wallet']).rows, 'BANK_OR_WALLET', 'Demo Wallet')).toBe(true);
    expect(
      has(
        extract(['Rs.100 debited from Example Bank today']).rows,
        'BANK_OR_WALLET',
        'Example Bank',
      ),
    ).toBe(true);
    expect(
      extract(['Rs.100 debited from your bank account']).rows.filter(
        (r) => r.type === 'BANK_OR_WALLET',
      ),
    ).toEqual([]);
  });

  it('reads other identifier types', () => {
    const rows = extract([
      'Message @kyc_helpdesk or t.me/kyc_desk',
      'Card ending 4821 and Acct no. XX123',
      'From: KYC Desk <desk@kyc-update-verify.example>',
    ]).rows;
    expect(has(rows, 'MESSAGING_HANDLE', '@kyc_helpdesk', 'kyc_helpdesk')).toBe(true);
    expect(has(rows, 'MESSAGING_HANDLE', 't.me/kyc_desk', 'kyc_desk')).toBe(true);
    expect(has(rows, 'ACCOUNT_HINT', 'ending 4821', '4821')).toBe(true);
    expect(has(rows, 'ACCOUNT_HINT', 'XX123', '123')).toBe(true);
    const eml = extract([
      { text: 'KYC Desk <desk@kyc-update-verify.example>', header: 'From' },
    ]).rows;
    expect(has(eml, 'PERSON', 'KYC Desk')).toBe(true);
    expect(has(eml, 'EMAIL', 'desk@kyc-update-verify.example')).toBe(true);
  });

  it('format checks reject malformed values of each type', () => {
    expect(isValidFormat('PHONE', '12345')).toBe(false);
    expect(isValidFormat('URL', 'not a url')).toBe(false);
    expect(isValidFormat('URL', 'javascript:alert(1)')).toBe(false);
    expect(isValidFormat('UPI_ID', 'a@b.com')).toBe(false);
    expect(isValidFormat('TRANSACTION', 'ABCDEFGHIJ')).toBe(false);
    expect(isValidFormat('AMOUNT', '8500')).toBe(false);
    expect(isValidFormat('PERSON', 'R0han')).toBe(false);
    expect(isValidFormat('SMS_SENDER_HEADER', 'vx-alerts')).toBe(false);
    expect(isValidFormat('DATETIME', '99:99')).toBe(false);
  });
});

describe('literal validation — the trust boundary (07 §17; 06 §6.3)', () => {
  const candidate = (
    it: ReturnType<typeof item>,
    fieldType: EntityType,
    value: string,
    lineIndexes: number[] = [0],
    origin: 'RULE' | 'LLM' = 'LLM',
  ): ExtractionCandidate => ({
    origin,
    evidenceId: it.evidenceId,
    fieldType,
    value,
    lineIds: lineIndexes.map((i) => it.lines[i]!.id),
  });

  it('EXT-09: accepts a literal value and stores the matched span, not the model string', () => {
    const it = item(['UPI ID: Kyc.Refund.Desk@DemoUPI', 'Call +91  90000   00001']);
    const upi = validateCandidate(candidate(it, 'UPI_ID', 'kyc.refund.desk@demoupi'), it.context);
    expect(upi.ok && upi.value.rawValue).toBe('Kyc.Refund.Desk@DemoUPI');
    expect(upi.ok && upi.value.normalized.value).toBe('kyc.refund.desk@demoupi');
    const phone = validateCandidate(candidate(it, 'PHONE', '+91 90000 00001', [1]), it.context);
    expect(phone.ok && phone.value.rawValue).toBe('+91  90000   00001');
    expect(phone.ok && phone.value.normalized.value).toBe('+919000000001');
  });

  it('EXT-05/AI-07: fabricated identifiers are NOT_LITERAL; case matters outside URL/DOMAIN/EMAIL/UPI', () => {
    const it = item([
      'Call +91 90000 00001',
      'Paid by: Asha Verma',
      'UPI Ref No: 627000418532',
      'Amount: ₹8,500',
    ]);
    const reject = (type: EntityType, value: string, lines: number[]) => {
      const r = validateCandidate(candidate(it, type, value, lines), it.context);
      return r.ok ? 'ACCEPTED' : r.reason;
    };
    expect(reject('PHONE', '+91 90000 00002', [0])).toBe('NOT_LITERAL');
    expect(reject('TRANSACTION', '627000418533', [2])).toBe('NOT_LITERAL');
    expect(reject('AMOUNT', '₹85,000', [3])).toBe('NOT_LITERAL');
    expect(reject('PERSON', 'asha verma', [1])).toBe('NOT_LITERAL');
    expect(reject('BANK_OR_WALLET', 'Example Bank', [1])).toBe('NOT_LITERAL');
    // Literal but in the wrong line: the cited line decides.
    expect(reject('PHONE', '+91 90000 00001', [1])).toBe('NOT_LITERAL');
  });

  it('EXT-06/PROV-04/PROV-07: lines of another item or case, or unknown lines, are FOREIGN_LINE', () => {
    const it = item(['Call +91 90000 00001']);
    const other = item(['Call +91 90000 00001']);
    const foreign = { ...candidate(it, 'PHONE', '+91 90000 00001'), lineIds: [other.lines[0]!.id] };
    const merged = { ...it.context, lines: new Map([...it.context.lines, ...other.context.lines]) };
    expect(validateCandidate(foreign, merged)).toEqual({ ok: false, reason: 'FOREIGN_LINE' });
    const otherCase = new Map(it.context.lines);
    otherCase.set(it.lines[0]!.id, { ...it.lines[0]!, caseId: randomUUID() });
    expect(
      validateCandidate(candidate(it, 'PHONE', '+91 90000 00001'), {
        ...it.context,
        lines: otherCase,
      }),
    ).toEqual({
      ok: false,
      reason: 'FOREIGN_LINE',
    });
    expect(
      validateCandidate(
        { ...candidate(it, 'PHONE', '+91 90000 00001'), lineIds: [randomUUID()] },
        it.context,
      ),
    ).toEqual({
      ok: false,
      reason: 'FOREIGN_LINE',
    });
    expect(
      validateCandidate({ ...candidate(it, 'PHONE', '+91 90000 00001'), lineIds: [] }, it.context),
    ).toEqual({
      ok: false,
      reason: 'FOREIGN_LINE',
    });
    expect(
      validateCandidate(
        { ...candidate(it, 'PHONE', '+91 90000 00001'), evidenceId: other.evidenceId },
        it.context,
      ),
    ).toEqual({ ok: false, reason: 'FOREIGN_LINE' });
  });

  it('RED-08: a value touching a redaction token is REDACTED_SPAN — an OTP is never extractable', () => {
    const it = item(['You: OTP is [REDACTED:OTP]', 'Card [REDACTED:CARD] used']);
    for (const [type, value, line] of [
      ['TRANSACTION', '[REDACTED:OTP]', 0],
      ['PERSON', 'OTP is [REDACTED', 0],
      ['ACCOUNT_HINT', 'REDACTED:CARD', 1],
    ] as const) {
      expect(validateCandidate(candidate(it, type, value, [line]), it.context)).toEqual({
        ok: false,
        reason: 'REDACTED_SPAN',
      });
    }
    expect(validateCandidate(candidate(it, 'TRANSACTION', '731904'), it.context)).toEqual({
      ok: false,
      reason: 'NOT_LITERAL',
    });
  });

  it('FORMAT: literal but malformed values, unlabelled references and unlabelled banks', () => {
    const it = item(['Call 12345 or ref 627000418532', 'Paid to: KYC Refund Desk']);
    const reason = (type: EntityType, value: string, lines = [0]) => {
      const r = validateCandidate(candidate(it, type, value, lines), it.context);
      return r.ok ? 'ACCEPTED' : r.reason;
    };
    expect(reason('PHONE', '12345')).toBe('FORMAT');
    expect(reason('TRANSACTION', '627000418532')).toBe('FORMAT'); // "ref" is not a label
    expect(reason('BANK_OR_WALLET', 'KYC Refund Desk', [1])).toBe('FORMAT');
    expect(reason('PERSON', 'KYC Refund Desk', [1])).toBe('ACCEPTED');
  });

  it('spans joined lines, keeps only the lines the value lies on, in reading order', () => {
    const it = item(['Paid by: Asha', 'Verma on Thursday', 'unrelated']);
    const r = validateCandidate(candidate(it, 'PERSON', 'Asha Verma', [2, 1, 0]), it.context);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rawValue).toBe('Asha Verma');
    expect(r.value.lineIds).toEqual([it.lines[0]!.id, it.lines[1]!.id]);
    expect(r.value.matchOffsets).toEqual([
      { lineId: it.lines[0]!.id, start: 9, end: 13 },
      { lineId: it.lines[1]!.id, start: 0, end: 5 },
    ]);
    // An identifier broken by a line wrap is not one identifier.
    const wrapped = item(['pay to kyc.refund.', 'desk@demoupi now']);
    expect(
      validateCandidate(
        candidate(wrapped, 'UPI_ID', 'kyc.refund. desk@demoupi', [0, 1]),
        wrapped.context,
      ),
    ).toEqual({ ok: false, reason: 'FORMAT' });
  });

  it('EXT-10: normalisation is a function of the raw value only and adds nothing', () => {
    for (const [type, raw] of [
      ['PHONE', '+91 90000 00001'],
      ['TRANSACTION', '627000418532'],
      ['UPI_ID', 'Kyc.Refund@DemoUPI'],
    ] as const) {
      const digits = (s: string) => s.replace(/\D/g, '');
      const n = normalize(type, raw).value!;
      expect(digits(n).endsWith(digits(raw).slice(-10))).toBe(true);
      expect(normalize(type, raw)).toEqual(normalize(type, raw));
    }
  });

  it('confidence: OCR line minimum for identifiers; capped model judgement for names (06 §21)', () => {
    const it = item([
      { text: 'Rohan called from +91 90000 00001', ocr: 0.72 },
      { text: 'Rohan again', ocr: 0.95 },
    ]);
    const phone = validateCandidate(candidate(it, 'PHONE', '+91 90000 00001', [0]), it.context);
    expect(
      phone.ok && [phone.value.confidence, phone.value.confidenceBasis, phone.value.confidenceBand],
    ).toEqual([0.72, 'SOURCE_VALIDATION', 'MEDIUM']);
    const person = validateCandidate(
      {
        ...candidate(it, 'PERSON', 'Rohan', [1]),
        judgementConfidence: 0.99,
        attributes: { context: 'claimed_name' },
      },
      it.context,
    );
    expect(
      person.ok && [person.value.confidence, person.value.confidenceBasis, person.value.attributes],
    ).toEqual([0.84, 'MODEL_JUDGEMENT', { context: 'claimed_name' }]);
    expect([
      confidenceBand(0.85),
      confidenceBand(0.849),
      confidenceBand(0.6),
      confidenceBand(0.59),
    ]).toEqual(['HIGH', 'MEDIUM', 'MEDIUM', 'LOW']);
  });

  it('snippets are ≤ 200 characters of the redacted line around the match', () => {
    const long = `${'a'.repeat(300)} call +91 90000 00001 ${'b'.repeat(300)}`;
    const it = item([long]);
    const r = validateCandidate(candidate(it, 'PHONE', '+91 90000 00001'), it.context);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.snippet.length).toBe(200);
    expect(long.includes(r.value.snippet)).toBe(true);
    expect(r.value.snippet).toContain('+91 90000 00001');
  });

  it('dedupes overlapping values of one type: the longest span wins, rules before the model', () => {
    const it = item(['Visit https://a.example/kyc today']);
    const { kept, duplicates } = selectExtractions(
      [
        candidate(it, 'URL', 'https://a.example/kyc', [0], 'RULE'),
        candidate(it, 'URL', 'https://a.example', [0], 'LLM'),
        candidate(it, 'URL', 'https://a.example/kyc', [0], 'LLM'),
        candidate(it, 'DOMAIN', 'a.example', [0], 'RULE'),
      ],
      it.context,
    );
    expect(kept.map((v) => [v.fieldType, v.rawValue, v.method])).toEqual([
      ['URL', 'https://a.example/kyc', 'RULE'],
      ['DOMAIN', 'a.example', 'RULE'],
    ]);
    expect(duplicates).toBe(2);
  });

  it('a ValidatedCandidate cannot be built outside the validator', () => {
    // @ts-expect-error the constructor needs the validator's private key
    expect(() => new ValidatedCandidate(Symbol('forged'), {})).toThrow(/literal validator/);
  });
});
