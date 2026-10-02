import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuditLogResponse,
  CaseListResponse,
  CaseResponse,
  auditLogQuerySchema,
  createCaseSchema,
  deleteCaseQuerySchema,
  listCasesQuerySchema,
  updateCaseSchema,
} from '@proofline/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AppRequest, AuthenticatedUser } from '../common/app-request';
import { UserRateLimitGuard } from '../common/user-rate-limit.guard';
import { parseInput } from '../common/validation';
import { CasesService } from './cases.service';

/** 05 #1, #2, #15, #16, #17, #37. Every route needs a session (global AuthGuard). */
@Controller('cases')
@UseGuards(UserRateLimitGuard)
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Post()
  @HttpCode(201)
  create(
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<CaseResponse> {
    return this.cases.create(parseInput(createCaseSchema, body), actor(user, req));
  }

  @Get()
  list(
    @Query() query: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<CaseListResponse> {
    return this.cases.list(actor(user, req), parseInput(listCasesQuerySchema, query));
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<CaseResponse> {
    return this.cases.get(id, actor(user, req));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<CaseResponse> {
    return this.cases.update(id, parseInput(updateCaseSchema, body), actor(user, req));
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Param('id') id: string,
    @Query() query: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<void> {
    const { confirm } = parseInput(deleteCaseQuerySchema, query);
    await this.cases.delete(id, confirm, actor(user, req));
  }

  @Get(':id/audit-log')
  auditLog(
    @Param('id') id: string,
    @Query() query: unknown,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<AuditLogResponse> {
    return this.cases.auditLog(id, actor(user, req), parseInput(auditLogQuerySchema, query));
  }
}

const actor = (user: AuthenticatedUser, req: AppRequest) => ({
  userId: user.id,
  requestId: req.requestId,
});
