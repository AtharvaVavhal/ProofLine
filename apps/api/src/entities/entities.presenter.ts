import type { Entity, UserStatement } from '@prisma/client';
import type { EntityView } from '@proofline/shared';
import { presentExtraction, type ExtractionWithSources } from '../extraction/extraction.presenter';

type EntityWithExtractions = Entity & {
  extractions: ExtractionWithSources[];
  factSources: { userStatement: UserStatement | null }[];
};

/**
 * Presents an entity for the API response (05 §13). Values are masked by default in graph/overview;
 * the entities endpoint returns both canonical and masked values.
 */
export function presentEntity(entity: EntityWithExtractions): EntityView {
  const evidenceRefs = new Set<string>();
  for (const ext of entity.extractions) {
    evidenceRefs.add(ext.evidence.evidenceRef);
  }
  return {
    id: entity.id,
    entityType: entity.entityType,
    canonicalValue: entity.canonicalValue,
    maskedValue: entity.maskedValue,
    isUserStated: entity.isUserStated,
    appearsIn: [...evidenceRefs].sort(),
    extractions: entity.extractions.map(presentExtraction),
    userSources: entity.factSources.flatMap(({ userStatement: statement }) =>
      statement
        ? [
            {
              kind: 'USER_STATEMENT' as const,
              id: statement.id,
              evidenceId: null,
              evidenceRef: null,
              location: null,
              snippet: null,
              statementText: statement.valueText,
            },
          ]
        : [],
    ),
  };
}
