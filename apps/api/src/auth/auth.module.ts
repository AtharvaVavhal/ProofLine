import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';
import { OriginGuard } from '../common/origin.guard';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ConsoleEmailTransport } from './email/console-email.transport';
import { EMAIL_TRANSPORT, EmailTransport } from './email/email-transport';
import { SessionService } from './session.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    {
      provide: EMAIL_TRANSPORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailTransport => {
        switch (config.emailTransport) {
          case 'console':
            return new ConsoleEmailTransport();
        }
      },
    },
    // Order matters: the Origin check runs before the session check.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [SessionService],
})
export class AuthModule {}
