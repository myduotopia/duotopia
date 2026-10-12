/**
 * useQuizRevision 單元測試（Issue #830）
 *
 * 這些純函式是小考訂正模式「必須改到全對才能交」與「自動跳下一題錯題」的
 * 唯一守門邏輯，因此特別針對 wrap-around、空陣列、-1 等邊界鎖定行為。
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useQuizRevision,
  allCorrect,
  firstUnresolvedIndex,
  nextUnresolvedIndex,
  priorCorrectFromStart,
  priorTypedFromStart,
  isRevisionIncompleteError,
} from "../useQuizRevision";

const words = (...ids: number[]) =>
  ids.map((content_item_id) => ({ content_item_id }));

describe("allCorrect", () => {
  it("空題目陣列回 false（沒有題目不算全對）", () => {
    expect(allCorrect([], {})).toBe(false);
  });

  it("全部 true 才回 true", () => {
    expect(allCorrect(words(1, 2, 3), { 1: true, 2: true, 3: true })).toBe(
      true,
    );
  });

  it("任一題 false / null / 未填皆回 false", () => {
    expect(allCorrect(words(1, 2), { 1: true, 2: false })).toBe(false);
    expect(allCorrect(words(1, 2), { 1: true, 2: null })).toBe(false);
    expect(allCorrect(words(1, 2), { 1: true })).toBe(false);
  });
});

describe("firstUnresolvedIndex", () => {
  it("回第一個非 true 的索引", () => {
    expect(
      firstUnresolvedIndex(words(1, 2, 3), { 1: true, 2: false, 3: true }),
    ).toBe(1);
    expect(
      firstUnresolvedIndex(words(1, 2, 3), { 1: null, 2: true, 3: true }),
    ).toBe(0);
  });

  it("全部答對回 -1", () => {
    expect(firstUnresolvedIndex(words(1, 2), { 1: true, 2: true })).toBe(-1);
  });

  it("未作答（缺 key）視為未解決", () => {
    expect(firstUnresolvedIndex(words(1, 2), {})).toBe(0);
  });
});

describe("nextUnresolvedIndex", () => {
  it("從 from 之後找下一個未解決", () => {
    expect(
      nextUnresolvedIndex(
        words(1, 2, 3, 4),
        { 1: true, 2: true, 3: false, 4: false },
        1,
      ),
    ).toBe(2);
  });

  it("from 之後都解決時，回頭從 0 找（wrap-around）", () => {
    expect(
      nextUnresolvedIndex(words(1, 2, 3), { 1: false, 2: true, 3: true }, 2),
    ).toBe(0);
  });

  it("全部答對回 -1", () => {
    expect(
      nextUnresolvedIndex(words(1, 2, 3), { 1: true, 2: true, 3: true }, 0),
    ).toBe(-1);
  });

  it("只剩 from 自己未解決也回 -1（不會卡回自己）", () => {
    expect(
      nextUnresolvedIndex(words(1, 2, 3), { 1: true, 2: false, 3: true }, 1),
    ).toBe(-1);
  });
});

describe("useQuizRevision hook", () => {
  it("status 非 RETURNED 時 isRevision=false 且 recordResult 為 no-op", () => {
    const { result } = renderHook(() => useQuizRevision("IN_PROGRESS"));
    expect(result.current.isRevision).toBe(false);
    act(() => result.current.recordResult(1, false, "答案"));
    expect(result.current.revealByItem).toEqual({});
  });

  it("RETURNED + 答錯且有正解 → 揭示該題正解", () => {
    const { result } = renderHook(() => useQuizRevision("RETURNED"));
    expect(result.current.isRevision).toBe(true);
    act(() => result.current.recordResult(7, false, "morning"));
    expect(result.current.revealByItem).toEqual({ 7: "morning" });
  });

  it("RETURNED + 同題後來答對 → 移除已揭示的正解", () => {
    const { result } = renderHook(() => useQuizRevision("RETURNED"));
    act(() => result.current.recordResult(7, false, "morning"));
    act(() => result.current.recordResult(7, true));
    expect(result.current.revealByItem).toEqual({});
  });
});

describe("#1092 訂正交卷被擋後重新載入", () => {
  const startWords = [
    {
      content_item_id: 1,
      prior_answer: "look forwerd to",
      prior_is_correct: false,
    },
    { content_item_id: 2, prior_answer: "Apple", prior_is_correct: false },
    { content_item_id: 3, prior_answer: null, prior_is_correct: null },
  ];

  it("priorCorrectFromStart：以後端對錯為準，未判過的題不放", () => {
    expect(priorCorrectFromStart(startWords)).toEqual({ 1: false, 2: false });
  });

  it("priorTypedFromStart：本機已輸入的答案優先，其餘補後端 prior_answer", () => {
    expect(priorTypedFromStart(startWords)).toEqual({
      1: "look forwerd to",
      2: "Apple",
    });
    expect(
      priorTypedFromStart(startWords, { 1: "look forward to", 3: "x" }),
    ).toEqual({ 1: "look forward to", 2: "Apple", 3: "x" });
  });

  it("isRevisionIncompleteError 只認 QUIZ_REVISION_INCOMPLETE", () => {
    expect(
      isRevisionIncompleteError({
        detail: {
          code: "QUIZ_REVISION_INCOMPLETE",
          correct_count: 1,
          total: 2,
        },
      }),
    ).toBe(true);
    expect(isRevisionIncompleteError({ detail: { code: "QUIZ_CLOSED" } })).toBe(
      false,
    );
    expect(isRevisionIncompleteError({ detail: "boom" })).toBe(false);
    expect(isRevisionIncompleteError(new Error("x"))).toBe(false);
    expect(isRevisionIncompleteError(undefined)).toBe(false);
  });
});
