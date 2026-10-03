import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { OCR_ENGINE } from './ocr/ocr-engine';
import { TesseractOcrEngine } from './ocr/tesseract-ocr.engine';
import { ProcessingService } from './processing.service';
import { SourceController } from './source.controller';

@Module({
  imports: [CasesModule, EvidenceModule],
  controllers: [SourceController],
  providers: [ProcessingService, { provide: OCR_ENGINE, useClass: TesseractOcrEngine }],
  exports: [ProcessingService],
})
export class ProcessingModule {}
