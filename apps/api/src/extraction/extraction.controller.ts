import { Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CorrectExtractionResponse, correctExtractionSchema } from '@proofline/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AppRequest, AuthenticatedUser } from '../common/app-request';
import { UserRateLimitGuard } from '../common/user-rate-limit.guard';
import { parseInput } from '../common/validation';
import { ExtractionCorrectionService } from './extraction-correction.service';

/** 05 #24. Extractions themselves are read through the entities endpoint (#5, Phase 7). */
@Controller('cases/:id/extractions/:extractionId')
@UseGuards(UserRateLimitGuard)
export class ExtractionController {
  constructor(private readonly corrections: ExtractionCorrectionService) {}

  @Post('correction')
  @HttpCode(202)
  correct(
    @Param('id') caseId: string,
    @Param('extractionId') extractionId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<CorrectExtractionResponse> {
    return this.corrections.correct(
      caseId,
      extractionId,
      parseInput(correctExtractionSchema, body),
      { userId: user.id, requestId: req.requestId },
    );
  }
}
