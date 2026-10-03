import type { ExtractionView, SourceRef } from './extraction';

/** Entity object returned by GET /cases/:id/entities (05 §13). */
export type EntityView = {
  id: string;
  entityType: string;
  canonicalValue: string;
  maskedValue: string;
  isUserStated: boolean;
  appearsIn: string[];
  extractions: ExtractionView[];
  userSources: SourceRef[];
};

/** Response of GET /cases/:id/entities (05 §13). */
export type EntitiesResponse = {
  entities: EntityView[];
  unmergedExtractions: ExtractionView[];
};
