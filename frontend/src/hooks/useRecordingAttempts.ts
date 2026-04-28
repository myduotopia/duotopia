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
  /**
   * Reconcile against the server-authoritative count returned by the
   * speech analysis API. The hook keeps the higher of the local and
   * server counts so a stale localStorage can never grant more
   * attempts than the server has accounted for.
   */
  syncServerCount: (serverCount: number | null | undefined) => void;
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
    teacherReviewedAt,
    existingRecordingUrl,
  } = params;

  const key = storageKey(studentAssignmentId, itemId);

  const initialEntry = useMemo<StoredEntry>(() => {
    const currentMarker = teacherReviewedAt ?? returnedAt ?? null;
    const stored = safeRead(key);

    // Issue #689 後續：只要進入 RETURNED（待訂正）狀態，所有題目都補滿次數，
    // 不再侷限於 teacher_passed === false 的題目。學生可重錄任何一題，是否
    // 該重錄由「方框顏色 / 老師回饋」呈現，不在前端閘門限制。
    // marker 仍然防止無限重置（同一輪退回只發一次配額）。
    // RESUBMITTED 不在此分支：第二輪退回時 status 會先變回 RETURNED 且 marker
    // (teacher_reviewed_at / returned_at) 會更新，自然會觸發此 reset 一次。
    const shouldResetForNewReturnCycle =
      assignmentStatus === "RETURNED" &&
      currentMarker !== null &&
      (!stored || stored.lastReviewMarker !== currentMarker);

    if (shouldResetForNewReturnCycle) {
      const next: StoredEntry = { count: 0, lastReviewMarker: currentMarker };
      safeWrite(key, next);
      return next;
    }

    if (stored) return stored;

    // First time we see this (assignmentId, itemId): write the entry NOW so
    // future renders read `stored` and never re-trigger seeding. Without this,
    // the moment a fresh student records (URL flips null → blob → GCS) the
    // seed branch below would fire and steal a heart before they pressed
    // Analyze. Backwards-compat seed only counts when the URL is a real
    // server-stored recording (non-blob) at first hook init — i.e. the student
    // truly recorded before this feature shipped.
    const isPriorServerRecording =
      !!existingRecordingUrl && !existingRecordingUrl.startsWith("blob:");
    const initial: StoredEntry = {
      count: isPriorServerRecording ? 1 : 0,
      lastReviewMarker: currentMarker,
    };
    safeWrite(key, initial);
    return initial;
  }, [
    key,
    assignmentStatus,
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

  const syncServerCount = useCallback(
    (serverCount: number | null | undefined) => {
      if (typeof serverCount !== "number" || Number.isNaN(serverCount)) return;
      const clamped = Math.max(
        0,
        Math.min(MAX_RECORDING_ATTEMPTS, Math.floor(serverCount)),
      );
      setEntry((prev) => {
        if (clamped <= prev.count) return prev;
        const next: StoredEntry = {
          count: clamped,
          lastReviewMarker: prev.lastReviewMarker,
        };
        safeWrite(key, next);
        return next;
      });
    },
    [key],
  );

  return {
    attemptsUsed: entry.count,
    canRecord: entry.count < MAX_RECORDING_ATTEMPTS,
    recordAttempt,
    syncServerCount,
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
