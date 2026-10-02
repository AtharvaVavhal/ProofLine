import { Logger } from '@nestjs/common';
import type { ObjectStorage } from './object-storage';

const logger = new Logger('ObjectCleanup');

/**
 * Deletes objects after the transaction that removed their rows has committed (03 §24, 04 §9).
 * A failure is logged by key only (opaque UUID paths) and left for reconciliation.
 */
export async function removeObjectsAfterCommit(
  storage: ObjectStorage,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.deleteObject(key);
    } catch {
      logger.warn(`Object deletion failed; left for reconciliation: ${key}`);
    }
  }
}
