import { OnApplicationShutdown } from '@nestjs/common';
import type { Worker } from 'tesseract.js';
import { OcrEngine, OcrLine, OcrResult } from './ocr-engine';

/**
 * tesseract.js with the English model bundled from npm (`@tesseract.js-data/eng`), so OCR never
 * downloads anything (07 §25: no HTTP client in parsers). One worker; calls are serialised.
 */
export class TesseractOcrEngine implements OcrEngine, OnApplicationShutdown {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  async recognize(png: Buffer, width: number, height: number): Promise<OcrResult> {
    const run = this.queue.then(() => this.recognizeNow(png, width, height));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async recognizeNow(png: Buffer, width: number, height: number): Promise<OcrResult> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(png, {}, { blocks: true, text: false });
    const lines: OcrLine[] = [];
    (data.blocks ?? []).forEach((block, blockIndex) => {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const text = line.text.replace(/\s+$/, '');
          if (text.trim() === '') continue;
          const confidences = line.words.map((w) => w.confidence);
          lines.push({
            text,
            block: blockIndex,
            confidence: Math.max(
              0,
              Math.min(1, (confidences.length ? Math.min(...confidences) : line.confidence) / 100),
            ),
            bbox: {
              x: line.bbox.x0 / width,
              y: line.bbox.y0 / height,
              w: (line.bbox.x1 - line.bbox.x0) / width,
              h: (line.bbox.y1 - line.bbox.y0) / height,
            },
          });
        }
      }
    });
    return { engine: 'tesseract.js', engineVersion: '7.0.0+eng-4.0.0', lines };
  }

  private getWorker(): Promise<Worker> {
    if (!this.worker) {
      this.worker = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { createWorker } = require('tesseract.js') as typeof import('tesseract.js');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const eng = require('@tesseract.js-data/eng') as { langPath: string };
        return createWorker('eng', 1, { langPath: eng.langPath, gzip: true, cacheMethod: 'none' });
      })();
      this.worker.catch(() => (this.worker = null));
    }
    return this.worker;
  }

  async reset(): Promise<void> {
    const current = this.worker;
    this.worker = null;
    if (current) await (await current).terminate().catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.reset();
  }
}
