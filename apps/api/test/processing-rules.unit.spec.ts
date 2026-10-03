import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ProcessingFailure } from '../src/processing/parsed-evidence';
import { parseEml } from '../src/processing/parsers/eml.parser';
import { parseImage } from '../src/processing/parsers/image.parser';
import { parsePdf } from '../src/processing/parsers/pdf.parser';
import { parseText } from '../src/processing/parsers/text.parser';
import { findSensitiveSpans, redactLine } from '../src/processing/redaction';
import { splitLines } from '../src/processing/text-lines';
import { Jimp } from 'jimp';
import { png } from './fixtures';
import { FakeOcr, ocrLine } from './processing-app';

async function failureOf(promise: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    if (error instanceof ProcessingFailure) return error;
    throw error;
  }
  throw new Error('expected a ProcessingFailure');
}

async function textPdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([400, 400]);
    lines.forEach((line, i) => {
      if (line) page.drawText(line, { x: 20, y: 360 - i * 20, size: 12, font });
    });
  }
  return Buffer.from(await doc.save());
}

describe('redaction (07 §18)', () => {
  it.each([
    ['Your OTP is 731904', 'Your OTP is [REDACTED:OTP]'],
    ['OTP is 731 904 do not share', 'OTP is [REDACTED:OTP] do not share'],
    ['731904 is your verification code', '[REDACTED:OTP] is your verification code'],
    ['Security code: 4821-77', 'Security code: [REDACTED:OTP]'],
    ['Card 4111 1111 1111 1111 used', 'Card [REDACTED:CARD] used'],
    ['A/c no 123456789012 debited', 'A/c no [REDACTED:CARD] debited'],
  ])('masks %j', (input, expected) => {
    expect(redactLine(input).text).toBe(expected);
  });

  it.each([
    'UPI Ref No: 627000418532',
    'Paid ₹8,500.00 at 12:19 PM',
    'OTP sent at 24-09-26 12:21 for Rs 8500',
    'Call +91 90000 00001 about your OTP',
    'Your OTP 9000000001 is a phone number',
    'Debited from XX4821',
    'Card 4111 1111 1111 1112 fails Luhn',
    'Order 731904 shipped',
    'otp is coming, reference 123',
  ])('leaves %j unchanged', (input) => {
    expect(redactLine(input).text).toBe(input);
  });

  it('uses fixed tokens and reports their offsets, never the value', () => {
    const { text, detections } = redactLine('OTP is 12345678 and card 4111-1111-1111-1111');
    expect(text).toBe('OTP is [REDACTED:OTP] and card [REDACTED:CARD]');
    expect(detections).toEqual([
      { kind: 'OTP', charStart: 7, charEnd: 21 },
      { kind: 'CARD_NUMBER', charStart: 31, charEnd: 46 },
    ]);
    for (const d of detections)
      expect(text.slice(d.charStart, d.charEnd)).toMatch(/^\[REDACTED:(OTP|CARD)\]$/);
    expect(JSON.stringify(detections)).not.toMatch(/12345678|4111/);
    expect(findSensitiveSpans('code is 1234')).toHaveLength(1);
  });
});

describe('line building (07 §11)', () => {
  it('normalises, drops empty lines and segments long lines at whitespace', () => {
    expect(splitLines('Café\r\n\r\n  \nsecond\rthird')).toEqual(['Café', 'second', 'third']);
    const long = `${'word '.repeat(250)}tail`;
    const parts = splitLines(long);
    expect(parts.every((p) => [...p].length <= 1000)).toBe(true);
    expect(parts.join(' ')).toBe(long);
    expect(splitLines('x'.repeat(2500)).map((p) => p.length)).toEqual([1000, 1000, 500]);
  });

  it('parses TXT and pasted text, and keeps a URL paste as one line', () => {
    const bom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Paid to desk@demoupi\nline two\n'),
    ]);
    const parsed = parseText(bom, 'TXT');
    expect(parsed).toMatchObject({ parserKind: 'PLAIN_TEXT', pages: [{ pageNumber: 1 }] });
    expect(parsed.lines.map((l) => l.text)).toEqual(['Paid to desk@demoupi', 'line two']);
    expect(parseText(Buffer.from('https://kyc-update-verify.example/kyc'), 'URL')).toMatchObject({
      parserKind: 'URL_STRING',
      lines: [{ text: 'https://kyc-update-verify.example/kyc', pageNumber: 1 }],
    });
  });

  it('fails unreadable text (< 10 non-whitespace characters) as retryable', async () => {
    const failure = await failureOf(() => parseText(Buffer.from('  a b c  \n'), 'TEXT'));
    expect([failure.code, failure.retryable]).toEqual(['NO_READABLE_TEXT', true]);
  });
});

describe('PDF text layer (OD-03; 07 §10)', () => {
  it('reads lines per page in reading order, joining items on one baseline', async () => {
    const bytes = await textPdf([
      ['Paid to: KYC Refund Desk', 'UPI Ref No: 627000418532'],
      ['Second page has enough text'],
    ]);
    const parsed = await parsePdf(bytes);
    expect(parsed.parserKind).toBe('PDF_TEXT_LAYER');
    expect(parsed.lines.map((l) => [l.pageNumber, l.text])).toEqual([
      [1, 'Paid to: KYC Refund Desk'],
      [1, 'UPI Ref No: 627000418532'],
      [2, 'Second page has enough text'],
    ]);
    expect(parsed.pages.map((p) => p.nonWhitespaceCharCount)).toEqual([41, 23]);
    for (const line of parsed.lines) {
      expect(Object.values(line.bbox!).every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it('joins separately drawn items on the same baseline with a space', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 400]);
    page.drawText('Amount', { x: 20, y: 300, size: 12, font });
    page.drawText('Rs 8,500.00', { x: 200, y: 300, size: 12, font });
    const parsed = await parsePdf(Buffer.from(await doc.save()));
    expect(parsed.lines.map((l) => l.text)).toEqual(['Amount Rs 8,500.00']);
  });

  it('fails scanned and mixed PDFs as PDF_NO_TEXT_LAYER, listing pages, with no lines', async () => {
    const scanned = await failureOf(parsePdf(await textPdf([[''], ['']])));
    expect([scanned.code, scanned.retryable, scanned.detail]).toEqual([
      'PDF_NO_TEXT_LAYER',
      false,
      { pages_without_text: [1, 2] },
    ]);
    const mixed = await failureOf(
      parsePdf(await textPdf([['Enough text on this page'], ['short'], ['More enough text here']])),
    );
    expect(mixed.detail).toEqual({ pages_without_text: [2] });
    expect(mixed.parse?.pages.map((p) => p.nonWhitespaceCharCount)).toEqual([20, 5, 18]);
  });

  it('treats an unreadable PDF structure as a retryable parser failure', async () => {
    const failure = await failureOf(parsePdf(Buffer.from('%PDF-1.4 broken')));
    expect([failure.code, failure.retryable]).toEqual(['EXTRACTION_FAILED', true]);
  });
});

describe('EML (G-4; 07 §12)', () => {
  const headers = [
    'From: =?UTF-8?Q?KYC_Desk?= <desk@kyc-update-verify.example>',
    'To: someone@example.test',
    'Subject: =?UTF-8?B?S1lDIGV4cGlyZWQ=?=',
    'Date: Thu, 24 Sep 2026 12:03:00 +0530',
    'Message-ID: <m1@example.test>',
    'MIME-Version: 1.0',
  ];

  it('turns headers and a text/plain body into lines and lists attachments', async () => {
    const eml = [
      ...headers,
      'Content-Type: multipart/mixed; boundary=b1',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Update your KYC at https://kyc-update-verify.example/kyc',
      '',
      'Thanks',
      '--b1',
      'Content-Type: application/pdf; name=invoice.pdf',
      'Content-Disposition: attachment; filename=invoice.pdf',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--b1--',
      '',
    ].join('\r\n');
    const parsed = await parseEml(Buffer.from(eml));
    expect(parsed.lines).toEqual([
      {
        pageNumber: 1,
        text: '"KYC Desk" <desk@kyc-update-verify.example>',
        locationKind: 'EMAIL_HEADER',
        headerName: 'From',
      },
      {
        pageNumber: 1,
        text: 'someone@example.test',
        locationKind: 'EMAIL_HEADER',
        headerName: 'To',
      },
      { pageNumber: 1, text: 'KYC expired', locationKind: 'EMAIL_HEADER', headerName: 'Subject' },
      {
        pageNumber: 1,
        text: 'Thu, 24 Sep 2026 12:03:00 +0530',
        locationKind: 'EMAIL_HEADER',
        headerName: 'Date',
      },
      {
        pageNumber: 1,
        text: '<m1@example.test>',
        locationKind: 'EMAIL_HEADER',
        headerName: 'Message-ID',
      },
      {
        pageNumber: 1,
        text: 'Update your KYC at https://kyc-update-verify.example/kyc',
        locationKind: 'EMAIL_BODY_LINE',
      },
      { pageNumber: 1, text: 'Thanks', locationKind: 'EMAIL_BODY_LINE' },
    ]);
    expect(parsed.sourceMetadata).toEqual({
      attachments: [{ filename: 'invoice.pdf', content_type: 'application/pdf', size_bytes: 9 }],
      body_part_used: 'TEXT_PLAIN',
    });
  });

  it('converts HTML-only bodies with links as "text (URL)" and drops scripts and images', async () => {
    const eml = [
      ...headers,
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Verify <a href="https://kyc-update-verify.example/kyc">here</a> now<img src="https://tracker.example/p.gif"></p><script>steal()</script>',
    ].join('\r\n');
    const parsed = await parseEml(Buffer.from(eml));
    const body = parsed.lines
      .filter((l) => l.locationKind === 'EMAIL_BODY_LINE')
      .map((l) => l.text);
    expect(body).toEqual(['Verify here (https://kyc-update-verify.example/kyc) now']);
    expect(parsed.sourceMetadata).toMatchObject({ body_part_used: 'TEXT_HTML_CONVERTED' });
  });

  it('fails encrypted mail and mail without From/Date/Subject, without retry', async () => {
    const encrypted = await failureOf(
      parseEml(
        Buffer.from(
          [
            ...headers,
            'Content-Type: application/pkcs7-mime; smime-type=enveloped-data',
            '',
            'MIAG',
          ].join('\r\n'),
        ),
      ),
    );
    expect([encrypted.code, encrypted.retryable]).toEqual(['EMAIL_ENCRYPTED', false]);
    const multipartEncrypted = await failureOf(
      parseEml(
        Buffer.from(
          [...headers, 'Content-Type: multipart/encrypted; boundary=x', '', '--x--'].join('\r\n'),
        ),
      ),
    );
    expect(multipartEncrypted.code).toBe('EMAIL_ENCRYPTED');
    const noHeaders = await failureOf(
      parseEml(Buffer.from('X-Thing: one\r\nX-Other: two\r\n\r\nbody\r\n')),
    );
    expect([noHeaders.code, noHeaders.retryable]).toEqual(['EMAIL_UNPARSEABLE', false]);
  });
});

/** A decodable image (the header-only fixtures are enough for upload checks, not for OCR). */
const image = (width: number, height: number, mime: 'image/png' | 'image/jpeg' = 'image/png') =>
  new Jimp({ width, height, color: 0xffffffff }).getBuffer(mime);

describe('image OCR (07 §9) with recorded OCR output', () => {
  it('orders lines by block, then top, then left, with bbox and confidence', async () => {
    const ocr = new FakeOcr();
    ocr.lines = [
      ocrLine('second block', 1, 0.1),
      ocrLine('first block lower line', 0, 0.5),
      ocrLine('first block top right', 0, 0.2, 0.6),
      ocrLine('first block top left', 0, 0.2, 0.1, 0.42),
    ];
    const parsed = await parseImage(await image(800, 600), 'image/png', ocr);
    expect(parsed).toMatchObject({
      parserKind: 'IMAGE_OCR',
      engine: 'fake-ocr',
      pages: [{ pageNumber: 1, width: 800, height: 600 }],
    });
    expect(parsed.lines.map((l) => l.text)).toEqual([
      'first block top left',
      'first block top right',
      'first block lower line',
      'second block',
    ]);
    expect(parsed.lines[0]).toMatchObject({
      ocrConfidence: 0.42,
      bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.04 },
    });
  });

  it('fails with NO_READABLE_TEXT or OCR_FAILED, both retryable', async () => {
    const ocr = new FakeOcr();
    ocr.lines = [ocrLine('a b', 0, 0.1)];
    const unreadable = await failureOf(
      parseImage(await image(100, 100, 'image/jpeg'), 'image/jpeg', ocr),
    );
    expect([unreadable.code, unreadable.retryable]).toEqual(['NO_READABLE_TEXT', true]);
    ocr.error = new Error('engine crashed');
    const crashed = await failureOf(parseImage(await image(100, 100), 'image/png', ocr));
    expect([crashed.code, crashed.retryable]).toEqual(['OCR_FAILED', true]);
  });

  it('re-checks the image header before decoding', async () => {
    const ocr = new FakeOcr();
    const failure = await failureOf(parseImage(png(40_000_001, 1), 'image/png', ocr));
    expect(failure.code).toBe('OCR_FAILED');
    expect(ocr.calls).toBe(0);
  });
});
