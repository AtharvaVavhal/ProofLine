import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { EvidenceSourceResponse } from '@proofline/shared';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { CaseAccessService } from '../cases/case-access.service';
import { ApiError } from '../common/api-error';
import type { AppRequest, AuthenticatedUser } from '../common/app-request';
import { UserRateLimitGuard } from '../common/user-rate-limit.guard';
import { PrismaService } from '../database/prisma.service';

/** GET /evidence/:id/source (05 #20): parsed, redacted text with locations. Audited. */
@Controller('evidence/:id/source')
@UseGuards(UserRateLimitGuard)
export class SourceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CaseAccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async source(
    @Param('id') evidenceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: AppRequest,
  ): Promise<EvidenceSourceResponse> {
    const owned = await this.access.assertEvidenceAccess(user.id, evidenceId);
    const parse = await this.prisma.parseResult.findUnique({
      where: { evidenceId },
      include: {
        evidence: { select: { evidenceRef: true } },
        pages: { orderBy: { pageNumber: 'asc' } },
        lines: { orderBy: [{ pageNumber: 'asc' }, { lineNumber: 'asc' }] },
      },
    });
    if (!parse) {
      throw new ApiError(
        409,
        'EVIDENCE_NOT_UPLOADED',
        "This item hasn't been read yet. Run the analysis first.",
      );
    }
    await this.audit.record(this.prisma, {
      action: 'EVIDENCE_VIEWED',
      outcome: 'SUCCEEDED',
      actorUserId: user.id,
      caseId: owned.caseId,
      targetType: 'evidence',
      targetId: evidenceId,
      requestId: req.requestId,
      metadata: { evidenceRef: parse.evidence.evidenceRef },
    });
    return {
      evidenceId,
      evidenceRef: parse.evidence.evidenceRef,
      parserKind: parse.parserKind,
      engine: parse.engine,
      pages: parse.pages.map((page) => ({
        pageNumber: page.pageNumber,
        hasUsableTextLayer: page.hasUsableTextLayer,
        nonWhitespaceCharCount: page.nonWhitespaceCharCount,
      })),
      lines: parse.lines.map((line) => ({
        id: line.id,
        pageNumber: line.pageNumber,
        lineNumber: line.lineNumber,
        locationKind: line.locationKind,
        headerName: line.headerName,
        text: line.text,
        bbox: (line.bbox as EvidenceSourceResponse['lines'][number]['bbox']) ?? null,
      })),
    };
  }
}
