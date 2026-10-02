import { PDFDocument } from 'pdf-lib';

/** Test-only file fixtures. Validation reads headers/structure only, so pixel data is omitted. */

/** PNG signature + IHDR (width, height) + IEND, optionally padded to an exact byte size. */
export function png(width: number, height: number, padToBytes?: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.set([8, 2, 0, 0, 0], 16);
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const file = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    iend,
  ]);
  return padToBytes ? Buffer.concat([file, Buffer.alloc(padToBytes - file.length)]) : file;
}

/** JPEG SOI + APP0 + SOF0 (or SOF2) with the given size + EOI. */
export function jpeg(width: number, height: number, sof: 0xc0 | 0xc1 | 0xc2 = 0xc0): Buffer {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ]);
  const sofSegment = Buffer.alloc(19);
  sofSegment.set([0xff, sof, 0x00, 0x11, 0x08]);
  sofSegment.writeUInt16BE(height, 5);
  sofSegment.writeUInt16BE(width, 7);
  sofSegment.set([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sofSegment, Buffer.from([0xff, 0xd9])]);
}

export async function pdf(pages: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) document.addPage([200, 200]).drawText(`Page ${i + 1}`);
  return Buffer.from(await document.save());
}

/** A PDF whose trailer references a standard security handler (password-protected). */
export function encryptedPdf(): Buffer {
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >> endobj',
      '4 0 obj << /Filter /Standard /V 1 /R 2 /O (owner) /U (user) /P -4 >> endobj',
      'trailer << /Root 1 0 R /Size 5 /Encrypt 4 0 R >>',
      '%%EOF',
    ].join('\n'),
    'latin1',
  );
}

export const eml = (): Buffer =>
  Buffer.from(
    [
      'From: KYC Desk <desk@kyc-update-verify.example>',
      'To: someone@example.test',
      'Subject: Your KYC has expired',
      'Date: Thu, 24 Sep 2026 12:03:00 +0530',
      'Message-ID: <fixture@example.test>',
      '',
      'Update your KYC at https://kyc-update-verify.example/kyc',
      '',
    ].join('\r\n'),
  );

export const mbox = (): Buffer =>
  Buffer.from('From desk@example.test Thu Sep 24 12:03:00 2026\nFrom: desk@example.test\n\nHi\n');

/** OLE compound document signature, as used by Outlook .msg files. */
export const msg = (): Buffer =>
  Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);

export const txt = (text = 'Paid ₹8,500 to kyc.refund.desk@demoupi\n'): Buffer =>
  Buffer.from(text, 'utf8');
