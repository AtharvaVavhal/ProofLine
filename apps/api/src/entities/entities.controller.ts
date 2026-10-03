import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { EntitiesResponse } from '@proofline/shared';
import { CaseAccessService } from '../cases/case-access.service';
import type { AuthenticatedUser } from '../common/app-request';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRateLimitGuard } from '../common/user-rate-limit.guard';
import { PrismaService } from '../database/prisma.service';
import { EXTRACTION_INCLUDE, presentExtraction } from '../extraction/extraction.presenter';
import { presentEntity } from './entities.presenter';

/**
 * GET /cases/:id/entities (05 §13, SPEC-ENDPOINT #5). Case-scoped, owner-only.
 * No pagination: the collection is bounded by the case's evidence (05 §13).
 */
@Controller('cases/:id/entities')
@UseGuards(UserRateLimitGuard)
export class EntitiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CaseAccessService,
  ) {}

  @Get()
  async list(
    @Param('id') caseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EntitiesResponse> {
    const owned = await this.access.assertCaseAccess(user.id, caseId);

    const entities = await this.prisma.entity.findMany({
      where: { caseId: owned.id },
      include: {
        factSources: { include: { userStatement: true } },
        extractions: {
          include: EXTRACTION_INCLUDE,
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ entityType: 'asc' }, { canonicalValue: 'asc' }],
    });

    // Unmerged: NOT_NORMALIZED extractions (excluding DATETIME, which feeds timeline).
    const unmerged = await this.prisma.extraction.findMany({
      where: {
        caseId: owned.id,
        normalizationStatus: 'NOT_NORMALIZED',
        fieldType: { not: 'DATETIME' },
        entityId: null,
      },
      include: EXTRACTION_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    return {
      entities: entities.map(presentEntity),
      unmergedExtractions: unmerged.map(presentExtraction),
    };
  }
}
