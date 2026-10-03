import { spawn } from 'node:child_process';
import {
  MIN_READABLE_CHARS,
  PageInfo,
  ParsedEvidence,
  ProcessingFailure,
  RawLine,
  nonWhitespaceLength,
} from '../parsed-evidence';

const ENGINE = { engine: 'pdf2json', engineVersion: '4.1.0' };
/** pdf2json positions are in "page units" of 16 points; text widths are in points. */
const POINTS_PER_UNIT = 16;
const SAME_LINE_TOLERANCE = 0.25;
const WORD_GAP = 0.1;

type PdfText = { x: number; y: number; w: number; R: { T: string; TS?: number[] }[] };
type PdfPage = { Width: number; Height: number; Texts: PdfText[] };

type Item = { x: number; endX: number; y: number; size: number; text: string };

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Hard limits for the isolated parser [IMPL] (07 §29: timeouts and memory caps). */
const PARSE_LIMIT_MS = 30_000;
const PARSE_HEAP_MB = 512;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * pdf2json runs in a short-lived child process: a hostile or huge PDF can be killed on timeout
 * without affecting the API, its heap is capped, and it gets an empty environment, so no
 * secrets reach it. Bytes go in on stdin; positioned text comes back as JSON. Nothing is
 * rendered or executed. (pdf2json's embedded pdf.js does not work inside worker threads.)
 */
const CHILD_SOURCE = `
const PDFParser = require(${JSON.stringify(require.resolve('pdf2json'))});
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const parser = new PDFParser();
  parser.on('pdfParser_dataReady', (data) => {
    process.stdout.write(JSON.stringify(data.Pages.map((p) => ({
      Width: p.Width, Height: p.Height,
      Texts: p.Texts.map((t) => ({ x: t.x, y: t.y, w: t.w, R: t.R.map((r) => ({ T: r.T, TS: r.TS })) })),
    }))));
  });
  parser.on('pdfParser_dataError', () => process.exit(3));
  parser.parseBuffer(Buffer.concat(chunks));
});
`;

function readPdf(bytes: Buffer): Promise<PdfPage[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${PARSE_HEAP_MB}`, '-e', CHILD_SOURCE],
      {
        env: { PDF2JSON_DISABLE_LOGS: '1' },
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    const out: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), PARSE_LIMIT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) child.kill('SIGKILL');
      else out.push(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('pdf parser unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('pdf parse failed'));
      try {
        resolve(JSON.parse(Buffer.concat(out).toString('utf8')) as PdfPage[]);
      } catch {
        reject(new Error('pdf parse output invalid'));
      }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(bytes);
  });
}

/** Groups positioned text items into lines: same baseline, sorted by x, spaced on gaps (07 §10). */
function toLines(items: Item[], page: PdfPage, pageNumber: number): RawLine[] {
  const rows: Item[][] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0]!.y - item.y) <= SAME_LINE_TOLERANCE);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows
    .sort((a, b) => a[0]!.y - b[0]!.y)
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      let text = '';
      let lastEnd: number | null = null;
      for (const item of row) {
        if (lastEnd !== null && item.x - lastEnd > WORD_GAP && !text.endsWith(' ')) text += ' ';
        text += item.text;
        lastEnd = item.endX;
      }
      const x0 = Math.min(...row.map((i) => i.x));
      const x1 = Math.max(...row.map((i) => i.endX));
      const y0 = Math.min(...row.map((i) => i.y));
      const h = Math.max(...row.map((i) => i.size)) / POINTS_PER_UNIT;
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      return {
        pageNumber,
        text: text.trim(),
        locationKind: 'TEXT_LINE' as const,
        bbox: {
          x: clamp(x0 / page.Width),
          y: clamp(y0 / page.Height),
          w: clamp((x1 - x0) / page.Width),
          h: clamp(h / page.Height),
        },
      };
    })
    .filter((line) => line.text !== '');
}

/**
 * Text-layer PDFs only (OD-03; 07 §10). Nothing is rendered or executed. If **any** page has
 * fewer than 10 non-whitespace characters the whole item fails with PDF_NO_TEXT_LAYER (not
 * retryable) and no lines are kept. There is no OCR fallback for PDF pages.
 */
export async function parsePdf(bytes: Buffer): Promise<ParsedEvidence> {
  let pdfPages: PdfPage[];
  try {
    pdfPages = await readPdf(bytes);
  } catch {
    throw new ProcessingFailure('EXTRACTION_FAILED', true);
  }

  const pages: PageInfo[] = [];
  const lines: RawLine[] = [];
  const failing: number[] = [];
  pdfPages.forEach((page, index) => {
    const pageNumber = index + 1;
    const items: Item[] = page.Texts.map((t) => ({
      x: t.x,
      y: t.y,
      endX: t.x + t.w / POINTS_PER_UNIT,
      size: t.R[0]?.TS?.[1] ?? 12,
      text: decode(t.R.map((r) => r.T).join('')),
    }));
    const count = items.reduce((sum, item) => sum + nonWhitespaceLength(item.text), 0);
    pages.push({
      pageNumber,
      width: Math.round(page.Width * POINTS_PER_UNIT),
      height: Math.round(page.Height * POINTS_PER_UNIT),
      nonWhitespaceCharCount: count,
    });
    if (count < MIN_READABLE_CHARS) failing.push(pageNumber);
    else lines.push(...toLines(items, page, pageNumber));
  });

  const parse = { parserKind: 'PDF_TEXT_LAYER' as const, ...ENGINE, pages };
  if (pages.length === 0) throw new ProcessingFailure('EXTRACTION_FAILED', true);
  if (failing.length > 0) {
    throw new ProcessingFailure('PDF_NO_TEXT_LAYER', false, { pages_without_text: failing }, parse);
  }
  return { ...parse, lines };
}
