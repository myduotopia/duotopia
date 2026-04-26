/**
 * useRecordingAttempts — Phase 1 frontend gate for issue #689.
 *
 * Limits per-question AI analysis to MAX_RECORDING_ATTEMPTS. State is persisted
 * in localStorage; counter increments at analysis success (not upload). The
 * counter resets to 0 only when the assignment is RETURNED, the item's
 * teacher_passed === false, AND the review marker (teacher_reviewed_at, falling
 * back to returned_at) differs from what we stored — so each "returned + failed"
 * cycle yields exactly one fresh allotment.
 *
 * Phase 1 is a UX guard, not a security boundary: DevTools can clear the entry.
 */
import { useCallback, useMemo, useRef, useState } from "react";

export const MAX_RECORDING_ATTEMPTS = 3;

const STORAGE_PREFIX = "duotopia:recording_attempts";

export const storageKey = (
  studentAssignmentId: number | string,
  itemId: number | string,
): string => `${STORAGE_PREFIX}:${studentAssignmentId}:${itemId}`;

interface StoredEntry {
  count: number;
  lastReviewMarker: string | null;
}

export type AssignmentStatusLike =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "GRADED"
  | "RETURNED"
  | "RESUBMITTED"
  | string;

export interface UseRecordingAttemptsParams {
  studentAssignmentId: number | string;
  itemId: number | string;
  assignmentStatus: AssignmentStatusLike | null | undefined;
  returnedAt: string | null | undefined;
  teacherPassed: boolean | null | undefined;
  teacherReviewedAt: string | null | undefined;
  existingRecordingUrl?: string | null;
}

export interface UseRecordingAttemptsResult {
  attemptsUsed: number;
  canRecord: boolean;
  recordAttempt: () => void;
}

const safeRead = (key: string): StoredEntry | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredEntry>;
    if (typeof parsed?.count !== "number") return null;
    return {
      count: parsed.count,
      lastReviewMarker:
        typeof parsed.lastReviewMarker === "string"
          ? parsed.lastReviewMarker
          : null,
    };
  } catch {
    return null;
  }
};

const safeWrite = (key: string, entry: StoredEntry): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota exceeded or private-mode writes throwing — degrade to no-op.
    // Recording itself must never break because of persistence failure.
  }
};

export const useRecordingAttempts = (
  params: UseRecordingAttemptsParams,
): UseRecordingAttemptsResult => {
  const {
    studentAssignmentId,
    itemId,
    assignmentStatus,
    returnedAt,
    teacherPassed,
    teacherReviewedAt,
    existingRecordingUrl,
  } = params;

  const key = storageKey(studentAssignmentId, itemId);

  const initialEntry = useMemo<StoredEntry>(() => {
    const currentMarker = teacherReviewedAt ?? returnedAt ?? null;
    const stored = safeRead(key);

    const shouldResetForNewReturnCycle =
      assignmentStatus === "RETURNED" &&
      teacherPassed === false &&
      currentMarker !== null &&
      (!stored || stored.lastReviewMarker !== currentMarker);

    if (shouldResetForNewReturnCycle) {
      const next: StoredEntry = { count: 0, lastReviewMarker: currentMarker };
      safeWrite(key, next);
      return next;
    }

    if (stored) return stored;

    if (existingRecordingUrl) {
      const seeded: StoredEntry = { count: 1, lastReviewMarker: currentMarker };
      safeWrite(key, seeded);
      return seeded;
    }

    return { count: 0, lastReviewMarker: currentMarker };
  }, [
    key,
    assignmentStatus,
    teacherPassed,
    teacherReviewedAt,
    returnedAt,
    existingRecordingUrl,
  ]);

  const [entry, setEntry] = useState<StoredEntry>(initialEntry);
  const lastInitialEntryRef = useRef(initialEntry);
  if (lastInitialEntryRef.current !== initialEntry) {
    lastInitialEntryRef.current = initialEntry;
    setEntry(initialEntry);
  }

  const recordAttempt = useCallback(() => {
    setEntry((prev) => {
      if (prev.count >= MAX_RECORDING_ATTEMPTS) return prev;
      const next: StoredEntry = {
        count: prev.count + 1,
        lastReviewMarker: prev.lastReviewMarker,
      };
      safeWrite(key, next);
      return next;
    });
  }, [key]);

  return {
    attemptsUsed: entry.count,
    canRecord: entry.count < MAX_RECORDING_ATTEMPTS,
    recordAttempt,
  };
};

/**
 * Standalone increment for items not currently rendered (e.g. background
 * analysis fired during navigation or submit). Writes directly to localStorage;
 * the next mount of the hook for that item will read the updated count.
 * Idempotent — never exceeds MAX_RECORDING_ATTEMPTS.
 */
export const incrementRecordingAttemptForItem = (
  studentAssignmentId: number | string,
  itemId: number | string,
): void => {
  const key = storageKey(studentAssignmentId, itemId);
  const stored = safeRead(key) ?? { count: 0, lastReviewMarker: null };
  if (stored.count >= MAX_RECORDING_ATTEMPTS) return;
  safeWrite(key, {
    count: stored.count + 1,
    lastReviewMarker: stored.lastReviewMarker,
  });
};
