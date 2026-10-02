import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  RequestCodeResponse,
  VerifyCodeResponse,
  requestCodeSchema,
  verifyCodeSchema,
} from '@proofline/shared';
import type { Response } from 'express';
import type { AppRequest, AuthenticatedUser } from '../common/app-request';
import { Public } from '../common/public.decorator';
import { parseBody } from '../common/validation';
import { AuthService, REQUEST_CODE_MESSAGE } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { clearSessionCookie, setSessionCookie } from './session-cookie';

/** 05 #12–#14. No other auth endpoints exist (no passwords, refresh, profile or SSO). */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('request-code')
  @HttpCode(202)
  async requestCode(@Body() body: unknown, @Req() req: AppRequest): Promise<RequestCodeResponse> {
    const { email } = parseBody(requestCodeSchema, body);
    await this.auth.requestCode(email, { ip: req.ip ?? '', requestId: req.requestId });
    return { message: REQUEST_CODE_MESSAGE };
  }

  @Public()
  @Post('verify-code')
  @HttpCode(200)
  async verifyCode(
    @Body() body: unknown,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VerifyCodeResponse> {
    const { email, code } = parseBody(verifyCodeSchema, body);
    const result = await this.auth.verifyCode(email, code, {
      ip: req.ip ?? '',
      requestId: req.requestId,
    });
    setSessionCookie(res, result.token);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.id, user.sessionId, req.requestId);
    clearSessionCookie(res);
  }
}
