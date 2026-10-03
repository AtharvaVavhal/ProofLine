import { htmlToText } from 'html-to-text';
import { AddressObject, simpleParser } from 'mailparser';
import { ParsedEvidence, ProcessingFailure, RawLine } from '../parsed-evidence';
import { splitLines } from '../text-lines';

const ENGINE = { engine: 'mailparser', engineVersion: '3.9.33' };

/** Headers kept as lines, in this order (G-4; 03 §7.4 allowed list). */
const HEADERS = [
  'From',
  'To',
  'Cc',
  'Reply-To',
  'Return-Path',
  'Subject',
  'Date',
  'Message-ID',
] as const;
const REQUIRED_ANY = ['From', 'Date', 'Subject'];

const addressText = (value: unknown) => {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  return list.map((a: AddressObject) => a.text).join(', ');
};

/**
 * Single-message `.eml` (07 §12). Headers and body become lines; links stay text ("anchor
 * (URL)") and are never fetched; remote resources are never loaded; attachments are listed
 * only. Encrypted mail and unparseable mail fail without retry.
 */
export async function parseEml(bytes: Buffer): Promise<ParsedEvidence> {
  const failure = (code: 'EMAIL_UNPARSEABLE' | 'EMAIL_ENCRYPTED') =>
    new ProcessingFailure(code, false, undefined, {
      parserKind: 'EMAIL_MIME',
      ...ENGINE,
      pages: [{ pageNumber: 1 }],
    });

  let mail;
  try {
    mail = await simpleParser(bytes, {
      skipHtmlToText: true,
      skipImageLinks: true,
      skipTextLinks: true,
      skipTextToHtml: true,
    });
  } catch {
    throw failure('EMAIL_UNPARSEABLE');
  }

  const contentType = (
    mail.headers.get('content-type') as { value?: string } | undefined
  )?.value?.toLowerCase();
  if (contentType === 'multipart/encrypted' || contentType?.endsWith('pkcs7-mime')) {
    throw failure('EMAIL_ENCRYPTED');
  }

  const raw = (name: string) =>
    mail.headerLines
      .find((h) => h.key === name.toLowerCase())
      ?.line.slice(name.length + 1)
      .trim();
  const values: Record<(typeof HEADERS)[number], string | undefined> = {
    From: addressText(mail.from),
    To: addressText(mail.to),
    Cc: addressText(mail.cc),
    'Reply-To': addressText(mail.replyTo),
    'Return-Path': addressText(mail.headers.get('return-path')) ?? raw('Return-Path'),
    Subject: mail.subject,
    Date: raw('Date'),
    'Message-ID': mail.messageId,
  };
  if (!REQUIRED_ANY.some((name) => values[name as keyof typeof values]))
    throw failure('EMAIL_UNPARSEABLE');

  const lines: RawLine[] = [];
  for (const name of HEADERS) {
    const value = values[name]?.replace(/\s+/g, ' ').trim();
    if (value)
      lines.push({ pageNumber: 1, text: value, locationKind: 'EMAIL_HEADER', headerName: name });
  }

  let body = '';
  let bodyPartUsed: 'TEXT_PLAIN' | 'TEXT_HTML_CONVERTED' | null = null;
  if (typeof mail.text === 'string' && mail.text.trim() !== '') {
    body = mail.text;
    bodyPartUsed = 'TEXT_PLAIN';
  } else if (typeof mail.html === 'string') {
    body = htmlToText(mail.html, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { linkBrackets: ['(', ')'], hideLinkIfSameAsText: false } },
        { selector: 'img', format: 'skip' },
      ],
    });
    bodyPartUsed = 'TEXT_HTML_CONVERTED';
  }
  for (const line of splitLines(body)) {
    lines.push({ pageNumber: 1, text: line, locationKind: 'EMAIL_BODY_LINE' });
  }

  return {
    parserKind: 'EMAIL_MIME',
    ...ENGINE,
    pages: [{ pageNumber: 1 }],
    lines,
    sourceMetadata: {
      attachments: mail.attachments.map((a) => ({
        filename: a.filename ?? 'unnamed',
        content_type: a.contentType,
        size_bytes: a.size,
      })),
      ...(bodyPartUsed ? { body_part_used: bodyPartUsed } : {}),
    },
  };
}
