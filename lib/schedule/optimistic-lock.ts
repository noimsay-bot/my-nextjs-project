const ASSEMBLY_SYNC_MAX_ATTEMPTS = 3;

export type AssemblySyncRetryState = {
  attempt: number;
  readUpdatedAt: string;
  exhausted: boolean;
  delayMs: (baseDelayMs: number) => number;
};

/**
 * Detects whether a Supabase UPDATE response indicates an optimistic-lock conflict.
 * A conflict occurs when the update affected 0 rows (stale updated_at condition).
 * null data is an error path, not a conflict.
 */
export function detectScheduleMonthConflict(updatedRows: unknown[] | null): boolean {
  return Array.isArray(updatedRows) && updatedRows.length === 0;
}

/**
 * Builds immutable retry state for the assembly-sync W1 writer.
 * When attempt >= ASSEMBLY_SYNC_MAX_ATTEMPTS, exhausted is true and the
 * caller should stop retrying and log (hub wins — webhook yields).
 */
export function buildAssemblySyncRetryState(
  readUpdatedAt: string,
  attempt = 0,
): AssemblySyncRetryState {
  return {
    attempt,
    readUpdatedAt,
    exhausted: attempt >= ASSEMBLY_SYNC_MAX_ATTEMPTS,
    delayMs: (baseDelayMs: number) => (attempt === 0 ? 0 : baseDelayMs * Math.pow(3, attempt - 1)),
  };
}
