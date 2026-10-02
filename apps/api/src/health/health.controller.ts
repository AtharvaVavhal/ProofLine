import { Controller, Get } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { Public } from '../common/public.decorator';
import { PrismaService } from '../database/prisma.service';

type HealthResponse = { status: 'ok'; database: 'up' };

/** Deployment health check (04 §31). Public; reveals nothing beyond reachability. */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    if (!(await this.prisma.isReachable())) {
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'The service is temporarily unavailable. Please try again shortly.',
      );
    }
    return { status: 'ok', database: 'up' };
  }
}
