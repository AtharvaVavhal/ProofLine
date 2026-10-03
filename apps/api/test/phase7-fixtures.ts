import type { EntityType } from '@prisma/client';
import { selectExtractions } from '../src/extraction/extraction.service';
import { ruleCandidates } from '../src/extraction/rules';
import type { SourceLineRecord } from '../src/extraction/candidates';
import type { CorrelationInput, RelationshipProposal } from '../src/graph/correlation-rules';

/** Small synthetic correlation oracle; no Phase 17 artifact generation or fallback cache. */
export const PHASE7_TEXT = [
  'VX-KYCUPD\nKYC update: https://kyc-update-verify.example/kyc?utm_source=sms\nCall 9000000001',
  '+91 90000 00001 ~ KYC Support\nName: Rohan\nOpen this link: https://kyc-update-verify.example/kyc\nPay refundable deposit ₹8,500 to kyc.refund.desk@demoupi',
  'https://kyc-update-verify.example/kyc',
  'UPI Payment Receipt\nPayment Successful\nAmount: INR 8,500.00\nPaid to: KYC Refund Desk\nUPI ID: kyc.refund.desk@demoupi\nPaid by: Asha Verma\nFrom account: ****4821\nUPI Ref No: 627000418532',
  'VX-ALERTS\nA/c XX4821 debited for Rs.8500.00 to VPA kyc.refund.desk@demoupi Ref no 627000418532',
  'I called +919000000001.\nName: Rohan\nI paid Rs 8,500 around 12:40 PM.',
];

export function correlationFixture(texts = PHASE7_TEXT): CorrelationInput {
  let next = 1;
  const id = () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
  const caseId = id();
  const input: CorrelationInput = { caseId, evidence: [], entities: [] };
  for (const [index, text] of texts.entries()) {
    const evidenceId = id();
    const parseResultId = id();
    const lines: SourceLineRecord[] = text.split('\n').map((text, i) => ({
      id: id(),
      caseId,
      evidenceId,
      parseResultId,
      pageNumber: 1,
      lineNumber: i + 1,
      text,
      locationKind: 'TEXT_LINE',
      headerName: null,
      bbox: null,
      ocrConfidence: null,
    }));
    const result = selectExtractions(ruleCandidates(lines), {
      caseId,
      evidenceId,
      lines: new Map(lines.map((l) => [l.id, l])),
    });
    const item: CorrelationInput['evidence'][number] = {
      id: evidenceId,
      evidenceRef: `E${String(index + 1).padStart(2, '0')}`,
      evidenceType: 'TEXT',
      sha256: 'a'.repeat(64),
      lines,
      extractions: [],
    };
    for (const x of result.kept) {
      if (x.normalized.status !== 'NORMALIZED' || x.fieldType === 'DATETIME') continue;
      let entity = input.entities.find(
        (e) => e.entityType === x.fieldType && e.canonicalValue === x.normalized.value,
      );
      if (!entity) {
        entity = {
          id: id(),
          entityType: x.fieldType,
          canonicalValue: x.normalized.value!,
          maskedValue: x.normalized.value!,
        };
        input.entities.push(entity);
      }
      item.extractions.push({
        id: id(),
        entityId: entity.id,
        rawValue: x.rawValue,
        lineIds: x.lineIds,
      });
    }
    input.evidence.push(item);
  }
  return input;
}

export function proposal(
  input: CorrelationInput,
  type: RelationshipProposal['relationType'],
  fromType: EntityType,
  toType: EntityType,
  refs: string[],
): RelationshipProposal {
  const items = input.evidence.filter((e) => refs.includes(e.evidenceRef));
  const supported = (type: EntityType) =>
    input.entities.find(
      (e) =>
        e.entityType === type &&
        items.every((item) => item.extractions.some((x) => x.entityId === e.id)),
    ) ?? input.entities.find((e) => e.entityType === type)!;
  const from = supported(fromType);
  const to = supported(toType);
  return {
    fromEntityId: from.id,
    toEntityId: to.id,
    relationType: type,
    evidenceIds: items.map((e) => e.id),
    extractionIds: items.flatMap((e) =>
      e.extractions.filter((x) => x.entityId === from.id || x.entityId === to.id).map((x) => x.id),
    ),
  };
}

/**
 * Phase 7 exit gate (14 Phase 7; 13 §16–§19) on the frozen AD-03 visible text (DECISIONS
 * §7.2.3, OCR'd lines as rendered one per visual line; E02's OTP already redacted). The real
 * artifacts are Phase 17; this checks the rules on their frozen content.
 */
export const AD03 = [
  // E01 — SMS
  [
    'VX-KYCUPD',
    'Thursday, 24 Sep 2026',
    'Dear Customer, your bank KYC has expired. Your account will be BLOCKED today.',
    'Update KYC now: https://kyc-update-verify.example/kyc?utm_source=sms',
    'or call KYC desk +91 90000 00001',
    '12:03 PM',
  ],
  // E02 — chat
  [
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
  ],
  // E03 — phishing page
  [
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
  ],
  // E04 — receipt PDF, L1–L10
  [
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
  ],
  // E05 — bank debit SMS
  [
    'VX-ALERTS',
    'Thursday, 24 Sep 2026',
    'Rs.8500.00 debited from A/c XX4821 on 24-09-26 12:21 via UPI to VPA',
    'kyc.refund.desk@demoupi. Ref no 627000418532. If not done by you, report to your',
    'bank immediately.',
    '12:21 PM',
  ],
  // E06 — pasted note (single line)
  [
    'On 24 Sep 2026 I got an SMS saying my bank KYC had expired. Around 12:05 PM I called the number in the SMS, 9000000001. A man who said his name was Rohan from the KYC team told me to open a link he would send on chat. I entered my customer ID, password and the OTP. He then asked me to pay a refundable deposit, and I paid Rs 8,500 at around 12:40 PM. After that I got a debit SMS.',
  ],
].map((lines) => lines.join('\n'));
