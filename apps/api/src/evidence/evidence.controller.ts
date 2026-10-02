import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  DeleteEvidenceResponse,
  EvidenceDownloadResponse,
  EvidenceListResponse,
  EvidenceResponse,
  RegisterEvidenceResponse,
  deleteEvidenceQuerySchema,
  registerEvidenceSchema,
} from '@proofline/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AppRequest, AuthenticatedUser } from '../common/app-request';
import { EVIDENCE_UPLOAD_LIMIT, RateLimit } from '../common/rate-limit.decorator';
import { UserRateLimitGuard } from '../common/user-rate-limit.guard';
import { parseInput } from '../common/validation';
import { EvidenceService } from './evidence.service';

const actor = (user: AuthenticatedUser, req: AppRequest) => ({
  userId: user.id,
  requestId: req.requestId,
});

/** 05 #3, #18, #19, #21, #22. Every route needs a session (global AuthGuard). */
@Controller()
@UseGuards(UserRateLimitGuard)
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post('cases/:id/evidence')
  @HttpCode(201)
  @RateLimit(EVIDENCE_UPLOAD_LIMIT)
  register(
    @Param('id') caseId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<RegisterEvidenceResponse> {
    return this.evidence.register(
      caseId,
      parseInput(registerEvidenceSchema, body),
      actor(user, req),
    );
  }

  @Get('cases/:id/evidence')
  list(
    @Param('id') caseId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<EvidenceListResponse> {
    return this.evidence.list(caseId, actor(user, req));
  }

  @Post('evidence/:id/complete')
  @HttpCode(200)
  @RateLimit(EVIDENCE_UPLOAD_LIMIT)
  complete(
    @Param('id') evidenceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<EvidenceResponse> {
    return this.evidence.complete(evidenceId, actor(user, req));
  }

  @Get('evidence/:id/download')
  download(
    @Param('id') evidenceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<EvidenceDownloadResponse> {
    return this.evidence.download(evidenceId, actor(user, req));
  }

  @Delete('evidence/:id')
  @HttpCode(200)
  remove(
    @Param('id') evidenceId: string,
    @Query() query: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<DeleteEvidenceResponse> {
    const { confirm } = parseInput(deleteEvidenceQuerySchema, query);
    return this.evidence.remove(evidenceId, confirm, actor(user, req));
  }
}
