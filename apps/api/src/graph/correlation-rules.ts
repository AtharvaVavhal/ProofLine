import { domainToUnicode } from 'node:url';
import type { EntityType, RelationType } from '@prisma/client';
import { z } from 'zod';

/** Internal handoff (07 §20), never a public API or a source of new facts. */
export type CorrelationExtraction = {
  id: string;
  entityId: string;
  rawValue: string;
  lineIds: string[];
};
export type CorrelationEvidence = {
  id: string;
  evidenceRef: string;
  evidenceType: string;
  sha256: string;
  lines: { id: string; text: string; headerName: string | null; locationKind: string }[];
  extractions: CorrelationExtraction[];
};
export type CorrelationEntity = {
  id: string;
  entityType: EntityType;
  canonicalValue: string;
  maskedValue: string;
};
export type CorrelationInput = {
  caseId: string;
  evidence: CorrelationEvidence[];
  entities: CorrelationEntity[];
};

export const RELATION_TYPES = [
  'HOSTED_ON',
  'SENT_LINK',
  'REQUESTED_PAYMENT_TO',
  'PAID_TO',
  'AMOUNT_OF',
  'DEBITED_FROM',
  'MESSAGE_CONTAINED',
  'CONTACTED_FROM',
] as const satisfies readonly RelationType[];

export const proposalSchema = z.strictObject({
  fromEntityId: z.uuid(),
  relationType: z.enum(RELATION_TYPES),
  toEntityId: z.uuid(),
  evidenceIds: z.array(z.uuid()).min(1).max(20),
  extractionIds: z.array(z.uuid()).min(2).max(200),
});
export type RelationshipProposal = z.infer<typeof proposalSchema>;

/** Exactly the eight pairs in 03 §11.4. */
export function allowedPair(type: RelationType, from: EntityType, to: EntityType): boolean {
  switch (type) {
    case 'HOSTED_ON':
      return from === 'URL' && to === 'DOMAIN';
    case 'SENT_LINK':
      return (
        ['PHONE', 'MESSAGING_HANDLE', 'EMAIL', 'SMS_SENDER_HEADER'].includes(from) && to === 'URL'
      );
    case 'REQUESTED_PAYMENT_TO':
      return ['PHONE', 'MESSAGING_HANDLE', 'EMAIL'].includes(from) && to === 'UPI_ID';
    case 'PAID_TO':
      return from === 'TRANSACTION' && to === 'UPI_ID';
    case 'AMOUNT_OF':
      return from === 'AMOUNT' && to === 'TRANSACTION';
    case 'DEBITED_FROM':
      return from === 'TRANSACTION' && to === 'ACCOUNT_HINT';
    case 'MESSAGE_CONTAINED':
      return (
        ['SMS_SENDER_HEADER', 'EMAIL'].includes(from) && ['PHONE', 'URL', 'UPI_ID'].includes(to)
      );
    case 'CONTACTED_FROM':
      return from === 'PHONE' && to === 'PERSON';
  }
}

const entitiesIn = (input: CorrelationInput, item: CorrelationEvidence, type: EntityType) =>
  input.entities.filter(
    (e) => e.entityType === type && item.extractions.some((x) => x.entityId === e.id),
  );

function payeeCue(item: CorrelationEvidence): boolean {
  const text = item.lines.map((l) => l.text).join('\n');
  return (
    /\bpaid\s+to\b|\bto\s+VPA\b/i.test(text) ||
    (/\bUPI\s+ID\s*:/i.test(text) && /\b(?:receipt|payment\s+successful)\b/i.test(text))
  );
}
function debitCue(item: CorrelationEvidence): boolean {
  const text = item.lines.map((l) => l.text).join('\n');
  return /\bdebited\s+from\b|\bfrom\s+account\b|\bA\/c\b[^\n]*\bdebited\b/i.test(text);
}

/** D1: the domain must occur inside this URL's own source span, not elsewhere in the item. */
function hostedOn(item: CorrelationEvidence, from: CorrelationEntity, to: CorrelationEntity) {
  let host: string;
  try {
    host = domainToUnicode(new URL(from.canonicalValue).hostname).toLowerCase();
  } catch {
    return false;
  }
  if (host !== to.canonicalValue) return false;
  return item.extractions
    .filter((x) => x.entityId === from.id)
    .some((url) =>
      item.extractions
        .filter((x) => x.entityId === to.id)
        .some((domain) =>
          url.lineIds.some(
            (id) =>
              domain.lineIds.includes(id) &&
              item.lines.some((line) => {
                if (line.id !== id) return false;
                const at = line.text.indexOf(url.rawValue);
                const offset = /^(?:https?:\/\/)?([^/?#:\s]+)/i.exec(url.rawValue);
                if (at < 0 || !offset) return false;
                return offset[1]!.toLowerCase() === domain.rawValue.toLowerCase();
              }),
          ),
        ),
    );
}

/** D5: one actual sender, not an email address mentioned in the body or a multi-message dump. */
function messageSender(
  input: CorrelationInput,
  item: CorrelationEvidence,
): CorrelationEntity | null {
  const sms = entitiesIn(input, item, 'SMS_SENDER_HEADER');
  const headers = item.extractions.filter((x) => sms.some((e) => e.id === x.entityId));
  if (item.evidenceType !== 'EML' && headers.length === 1 && sms.length === 1) return sms[0]!;
  if (item.evidenceType !== 'EML') return null;
  const fromLines = item.lines.filter(
    (l) => l.locationKind === 'EMAIL_HEADER' && l.headerName?.toLowerCase() === 'from',
  );
  const senders = entitiesIn(input, item, 'EMAIL').filter((e) =>
    item.extractions.some(
      (x) => x.entityId === e.id && x.lineIds.some((id) => fromLines.some((l) => l.id === id)),
    ),
  );
  return fromLines.length === 1 && senders.length === 1 ? senders[0]! : null;
}

export function deterministicRelationships(input: CorrelationInput): RelationshipProposal[] {
  const out: RelationshipProposal[] = [];
  for (const item of input.evidence) {
    const add = (type: RelationType, from: CorrelationEntity, to: CorrelationEntity) =>
      out.push({
        fromEntityId: from.id,
        relationType: type,
        toEntityId: to.id,
        evidenceIds: [item.id],
        extractionIds: item.extractions
          .filter((x) => x.entityId === from.id || x.entityId === to.id)
          .map((x) => x.id),
      });
    for (const url of entitiesIn(input, item, 'URL')) {
      for (const domain of entitiesIn(input, item, 'DOMAIN')) {
        if (hostedOn(item, url, domain)) add('HOSTED_ON', url, domain);
      }
    }
    const transactions = entitiesIn(input, item, 'TRANSACTION');
    const amounts = entitiesIn(input, item, 'AMOUNT');
    const payees = entitiesIn(input, item, 'UPI_ID');
    const accounts = entitiesIn(input, item, 'ACCOUNT_HINT');
    if (transactions.length === 1) {
      if (amounts.length === 1) add('AMOUNT_OF', amounts[0]!, transactions[0]!);
      if (payees.length === 1 && payeeCue(item)) add('PAID_TO', transactions[0]!, payees[0]!);
      if (accounts.length === 1 && debitCue(item))
        add('DEBITED_FROM', transactions[0]!, accounts[0]!);
    }
    const sender = messageSender(input, item);
    if (sender) {
      for (const type of ['PHONE', 'URL', 'UPI_ID'] as const) {
        for (const target of entitiesIn(input, item, type))
          add('MESSAGE_CONTAINED', sender, target);
      }
    }
  }
  return out;
}

export type ValidRelationship = RelationshipProposal & { extractionIds: string[] };

/**
 * 08 §9.2 / 06 §7: every cited item supports BOTH endpoints; every supplied extraction ID
 * exists in that item and belongs to an endpoint. Never resolve foreign IDs from the database.
 * Proposals cannot bypass hosting, sender or payment/debit cues. D2–D4 ambiguity may be
 * resolved by a supported model proposal, as explicitly allowed by 08 §9.1–§9.2.
 */
export function validateRelationship(
  input: CorrelationInput,
  raw: unknown,
): ValidRelationship | null {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const from = input.entities.find((e) => e.id === p.fromEntityId);
  const to = input.entities.find((e) => e.id === p.toEntityId);
  if (
    !from ||
    !to ||
    from.id === to.id ||
    !allowedPair(p.relationType, from.entityType, to.entityType)
  )
    return null;
  const evidenceIds = [...new Set(p.evidenceIds)];
  const support: CorrelationExtraction[] = [];
  for (const evidenceId of evidenceIds) {
    const item = input.evidence.find((e) => e.id === evidenceId);
    if (!item) return null;
    const sources = item.extractions.filter((x) => x.entityId === from.id || x.entityId === to.id);
    if (
      ![from.id, to.id].every((id) =>
        sources.some((x) => x.entityId === id && p.extractionIds.includes(x.id)),
      )
    )
      return null;
    if (p.relationType === 'HOSTED_ON' && !hostedOn(item, from, to)) return null;
    if (p.relationType === 'PAID_TO' && !payeeCue(item)) return null;
    if (p.relationType === 'DEBITED_FROM' && !debitCue(item)) return null;
    if (p.relationType === 'MESSAGE_CONTAINED' && messageSender(input, item)?.id !== from.id)
      return null;
    support.push(...sources);
  }
  if (p.extractionIds.some((id) => !support.some((x) => x.id === id))) return null;
  return { ...p, evidenceIds, extractionIds: [...new Set(support.map((x) => x.id))].sort() };
}

/** 08 §10: distinct artifacts, never the number of supporting extraction rows. */
export const supportCount = (evidenceIds: string[]) => new Set(evidenceIds).size;
