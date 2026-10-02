import {
  canonicalizePaste,
  charCount,
  checkDeclaredSize,
  checkDeclaredType,
  inspectUpload,
  isPastedUrl,
} from '../src/evidence/evidence-rules';
import { encryptedPdf, eml, jpeg, mbox, msg, pdf, png, txt } from './fixtures';

describe('declared type and extension (07 §4)', () => {
  it.each([
    ['a.png', 'image/png', 'PNG'],
    ['a.JPG', 'image/jpeg', 'JPEG'],
    ['a.jpeg', 'image/jpeg', 'JPEG'],
    ['a.pdf', 'application/pdf', 'PDF'],
    ['a.txt', 'text/plain', 'TXT'],
    ['a.eml', 'message/rfc822', 'EML'],
  ])('accepts %s as %s', (filename, type, evidenceType) => {
    expect(checkDeclaredType(filename, type)).toEqual({
      ok: true,
      type: { evidenceType, contentType: type },
    });
  });

  it.each([
    ['mail.msg', 'application/vnd.ms-outlook', 'EMAIL_FORMAT_NOT_SUPPORTED'],
    ['box.mbox', 'application/mbox', 'EMAIL_FORMAT_NOT_SUPPORTED'],
    ['store.pst', 'application/octet-stream', 'EMAIL_FORMAT_NOT_SUPPORTED'],
    [
      'doc.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'TYPE_NOT_SUPPORTED',
    ],
    ['photo.webp', 'image/webp', 'TYPE_NOT_SUPPORTED'],
    ['page.html', 'text/html', 'TYPE_NOT_SUPPORTED'],
    ['run.exe', 'application/octet-stream', 'TYPE_NOT_SUPPORTED'],
    ['a.png', 'application/pdf', 'TYPE_NOT_SUPPORTED'],
    ['noextension', 'image/png', 'TYPE_NOT_SUPPORTED'],
  ])('rejects %s (%s) with %s', (filename, type, code) => {
    expect(checkDeclaredType(filename, type)).toEqual({ ok: false, code });
  });

  it('checks the declared size boundaries', () => {
    expect(checkDeclaredSize(0)).toBe('EMPTY_FILE');
    expect(checkDeclaredSize(1)).toBeNull();
    expect(checkDeclaredSize(10_485_760)).toBeNull();
    expect(checkDeclaredSize(10_485_761)).toBe('FILE_TOO_LARGE');
  });
});

describe('stored-byte inspection (07 §8)', () => {
  it('reads PNG and JPEG header dimensions at the 40 MP boundary', async () => {
    expect(await inspectUpload(png(8000, 5000), 'image/png')).toMatchObject({
      ok: true,
      imageWidth: 8000,
      imageHeight: 5000,
    });
    expect(await inspectUpload(png(40_000_001, 1), 'image/png')).toEqual({
      ok: false,
      code: 'IMAGE_TOO_LARGE',
    });
    expect(await inspectUpload(jpeg(5000, 8000), 'image/jpeg')).toMatchObject({
      ok: true,
      imageWidth: 5000,
      imageHeight: 8000,
    });
    expect(await inspectUpload(jpeg(5000, 8000, 0xc2), 'image/jpeg')).toMatchObject({ ok: true });
    expect(await inspectUpload(jpeg(8001, 5000), 'image/jpeg')).toEqual({
      ok: false,
      code: 'IMAGE_TOO_LARGE',
    });
    expect(await inspectUpload(png(0, 10), 'image/png')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
  });

  it('rejects garbled image headers', async () => {
    const broken = png(10, 10);
    broken.write('XXXX', 12, 'latin1');
    expect(await inspectUpload(broken, 'image/png')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
    expect(await inspectUpload(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
  });

  it('counts PDF pages and rejects encryption', async () => {
    expect(await inspectUpload(await pdf(20), 'application/pdf')).toMatchObject({
      ok: true,
      pageCount: 20,
    });
    expect(await inspectUpload(await pdf(21), 'application/pdf')).toEqual({
      ok: false,
      code: 'PDF_TOO_MANY_PAGES',
    });
    expect(await inspectUpload(encryptedPdf(), 'application/pdf')).toEqual({
      ok: false,
      code: 'PDF_ENCRYPTED',
    });
    expect(await inspectUpload(Buffer.from('%PDF-1.4 garbage'), 'application/pdf')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
  });

  it('detects spoofed types by magic bytes', async () => {
    expect(await inspectUpload(await pdf(1), 'image/png')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
    expect(await inspectUpload(png(10, 10), 'application/pdf')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
    expect(await inspectUpload(png(10, 10), 'text/plain')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
    expect(await inspectUpload(txt(), 'image/jpeg')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
  });

  it('accepts UTF-8 text (BOM allowed) and rejects other encodings', async () => {
    expect(await inspectUpload(txt(), 'text/plain')).toMatchObject({
      ok: true,
      sourceMetadata: { encoding: 'utf-8', had_bom: false },
    });
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), txt()]);
    expect(await inspectUpload(bom, 'text/plain')).toMatchObject({
      ok: true,
      sourceMetadata: { had_bom: true },
    });
    expect(await inspectUpload(Buffer.from([0x50, 0xe9, 0x6e]), 'text/plain')).toEqual({
      ok: false,
      code: 'TEXT_NOT_UTF8',
    });
    expect(await inspectUpload(Buffer.from('a\0b'), 'text/plain')).toEqual({
      ok: false,
      code: 'TEXT_NOT_UTF8',
    });
  });

  it('accepts single-message .eml and rejects mailbox formats', async () => {
    expect(await inspectUpload(eml(), 'message/rfc822')).toMatchObject({
      ok: true,
      detectedContentType: 'message/rfc822',
    });
    expect(await inspectUpload(mbox(), 'message/rfc822')).toEqual({
      ok: false,
      code: 'EMAIL_FORMAT_NOT_SUPPORTED',
    });
    expect(await inspectUpload(msg(), 'message/rfc822')).toEqual({
      ok: false,
      code: 'EMAIL_FORMAT_NOT_SUPPORTED',
    });
    expect(await inspectUpload(txt('just some words'), 'message/rfc822')).toEqual({
      ok: false,
      code: 'CONTENT_TYPE_MISMATCH',
    });
  });

  it('enforces the actual size boundaries', async () => {
    expect(await inspectUpload(Buffer.alloc(0), 'image/png')).toEqual({
      ok: false,
      code: 'EMPTY_FILE',
    });
    expect(await inspectUpload(png(10, 10, 10_485_760), 'image/png')).toMatchObject({ ok: true });
    expect(await inspectUpload(png(10, 10, 10_485_761), 'image/png')).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
    });
  });
});

describe('pasted text (G-3; 07 §13)', () => {
  it('canonicalises to NFC with LF line endings and changes nothing else', () => {
    expect(canonicalizePaste('Café\r\nline two\rline three  ')).toBe(
      'Café\nline two\nline three  ',
    );
    expect(canonicalizePaste('  keep  spaces \n')).toBe('  keep  spaces \n');
    expect(charCount('😀₹a')).toBe(3);
  });

  it.each([
    ['https://kyc-update-verify.example/kyc?utm_source=sms', true],
    ['http://example.test', true],
    ['kyc-update-verify.example/kyc', true],
    ['bank.co.in', true],
    ['not a link', false],
    [' https://example.test', false],
    ['https://example.test\nsecond line', false],
    ['localhost', false],
    ['files.unknowntld', false],
    ['ftp://example.test', false],
  ])('URL check for %j → %s', (value, expected) => {
    expect(isPastedUrl(value)).toBe(expected);
  });
});
