/** OCR adapter (04 §11.1; 07 §9). The LLM is never used as OCR (OD-03). */
export type OcrLine = {
  text: string;
  /** Normalised 0–1 region on the recognised image. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Minimum word confidence of the line, 0–1. */
  confidence: number;
  /** Layout block index, for reading order. */
  block: number;
};

export type OcrResult = { engine: string; engineVersion: string; lines: OcrLine[] };

export interface OcrEngine {
  recognize(png: Buffer, width: number, height: number): Promise<OcrResult>;
  /** Discards the current worker, e.g. after a timeout. */
  reset(): Promise<void>;
}

export const OCR_ENGINE = Symbol('OCR_ENGINE');
