import { Jimp } from 'jimp';
import { inspectUpload } from '../../evidence/evidence-rules';
import type { OcrEngine } from '../ocr/ocr-engine';
import {
  MIN_READABLE_CHARS,
  ParsedEvidence,
  ProcessingFailure,
  nonWhitespaceLength,
} from '../parsed-evidence';

/** Images whose longer side is below this are upscaled for OCR [IMPL] (07 §9). */
const UPSCALE_BELOW = 1500;

/**
 * PNG/JPEG (07 §9): header re-checked (≤ 40 MP) before decoding; EXIF orientation applied in
 * memory only (no EXIF metadata is kept); greyscale and small-image upscaling for OCR; lines
 * sorted by block, then top, then left.
 */
export async function parseImage(
  bytes: Buffer,
  contentType: string,
  ocr: OcrEngine,
): Promise<ParsedEvidence> {
  const header = await inspectUpload(bytes, contentType);
  if (!header.ok) throw new ProcessingFailure('OCR_FAILED', true);

  let png: Buffer;
  let width: number;
  let height: number;
  try {
    const image = await Jimp.fromBuffer(bytes); // applies EXIF orientation
    width = image.bitmap.width;
    height = image.bitmap.height;
    image.greyscale();
    const scale = Math.max(width, height) < UPSCALE_BELOW ? 2 : 1;
    if (scale > 1) image.scale(scale);
    png = await image.getBuffer('image/png');
  } catch {
    throw new ProcessingFailure('OCR_FAILED', true);
  }

  let result;
  try {
    const scaled = png.readUInt32BE(16);
    const scaledHeight = png.readUInt32BE(20);
    result = await ocr.recognize(png, scaled, scaledHeight);
  } catch {
    throw new ProcessingFailure('OCR_FAILED', true);
  }

  const parse = {
    parserKind: 'IMAGE_OCR' as const,
    engine: result.engine,
    engineVersion: result.engineVersion,
    pages: [{ pageNumber: 1, width, height }],
  };
  const total = result.lines.reduce((sum, line) => sum + nonWhitespaceLength(line.text), 0);
  if (total < MIN_READABLE_CHARS)
    throw new ProcessingFailure('NO_READABLE_TEXT', true, undefined, parse);

  const ordered = [...result.lines].sort(
    (a, b) => a.block - b.block || a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x,
  );
  return {
    ...parse,
    lines: ordered.map((line) => ({
      pageNumber: 1,
      text: line.text,
      locationKind: 'TEXT_LINE' as const,
      bbox: line.bbox,
      ocrConfidence: Math.round(line.confidence * 1000) / 1000,
    })),
  };
}
