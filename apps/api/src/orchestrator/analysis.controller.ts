import { Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActivityResponse, StartAnalysisResponse } from '@proofline/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AppRequest, AuthenticatedUser } from '../common/app-request';
import { ANALYZE_LIMIT, RateLimit } from '../common/rate-limit.decorator';
import { UserRateLimitGuard } from '../common/user-rate-limit.guard';
import { OrchestratorService } from './orchestrator.service';

const actor = (user: AuthenticatedUser, req: AppRequest) => ({
  userId: user.id,
  requestId: req.requestId,
});

/** 05 #4 and #23. Progress is polled (OD-10): no SSE or WebSocket. */
@Controller('cases/:id')
@UseGuards(UserRateLimitGuard)
export class AnalysisController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post('analyze')
  @RateLimit(ANALYZE_LIMIT)
  async analyze(
    @Param('id') caseId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StartAnalysisResponse> {
    const { created, body } = await this.orchestrator.start(caseId, actor(user, req));
    res.status(created ? 202 : 200);
    return body;
  }

  @Get('activity')
  activity(
    @Param('id') caseId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<ActivityResponse> {
    return this.orchestrator.activity(caseId, actor(user, req));
  }
}
