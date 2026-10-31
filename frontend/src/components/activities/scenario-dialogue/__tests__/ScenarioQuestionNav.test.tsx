/**
 * 情境對話題號方格（#1158 E-1 修正）：
 * - scenarioNavCell 的鎖定規則（未到／已答但未到／可跳）；
 * - 綠色但對話還沒走到：不跳，提示「已作答，對話到這題後可查看」，aria-label 同義；
 * - 連點鎖住的方格，提示計時器重新計算。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { ScenarioQuestionNav, scenarioNavCell } from "../ScenarioQuestionNav";
import type { ScenarioChatNav } from "../ScenarioChatActivity";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { no?: number }) =>
      opts?.no !== undefined ? `${key}#${opts.no}` : key,
    i18n: { language: "zh-TW" },
  }),
}));

const NOT_STARTED: ScenarioChatNav = {
  started: false,
  revealedCount: 0,
  current: null,
  canJump: false,
};
const STUDENT_AT_2: ScenarioChatNav = {
  started: true,
  revealedCount: 2,
  current: 1,
  canJump: false,
};
const PREVIEW_STARTED: ScenarioChatNav = {
  started: true,
  revealedCount: 1,
  current: 0,
  canJump: true,
};

describe("scenarioNavCell", () => {
  it("開始前全部鎖住；答過的鎖住原因是 answeredLater", () => {
    expect(scenarioNavCell(NOT_STARTED, 0, false)).toEqual({
      locked: true,
      lockReason: "notYet",
      isCurrent: false,
    });
    expect(scenarioNavCell(NOT_STARTED, 0, true).lockReason).toBe(
      "answeredLater",
    );
    expect(scenarioNavCell(null, 0, false).locked).toBe(true);
  });

  it("學生：已出現的可點、目前題標示；未到的鎖住", () => {
    expect(scenarioNavCell(STUDENT_AT_2, 0, true).locked).toBe(false);
    expect(scenarioNavCell(STUDENT_AT_2, 1, false)).toEqual({
      locked: false,
      lockReason: null,
      isCurrent: true,
    });
    expect(scenarioNavCell(STUDENT_AT_2, 2, true).lockReason).toBe(
      "answeredLater",
    );
  });

  it("老師預覽開始後：任一題都能點", () => {
    expect(scenarioNavCell(PREVIEW_STARTED, 4, false).locked).toBe(false);
  });
});

function Harness({
  nav,
  answered,
  onNavigate,
}: {
  nav: ScenarioChatNav | null;
  answered: boolean[];
  onNavigate: (i: number) => void;
}) {
  const ref = useRef<((i: number) => void) | null>(onNavigate);
  ref.current = onNavigate;
  return (
    <ScenarioQuestionNav
      count={3}
      nav={nav}
      answered={answered}
      navigateRef={ref}
    />
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ScenarioQuestionNav", () => {
  it("綠色但對話還沒走到：不跳，提示「已作答，對話到這題後可查看」", () => {
    const onNavigate = vi.fn();
    render(
      <Harness
        nav={STUDENT_AT_2}
        answered={[true, false, true]}
        onNavigate={onNavigate}
      />,
    );
    const btn = screen.getByTestId("scenario-nav-3");
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAttribute(
      "aria-label",
      "scenarioDialogue.chat.dotAnsweredLocked#3",
    );
    expect(btn.className).toMatch(/bg-green-100/);
    fireEvent.click(btn);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(
      screen.getByText("scenarioDialogue.chat.answeredNotReached"),
    ).toBeInTheDocument();
  });

  it("已出現的題目可點；目前題藍框＋aria-current", () => {
    const onNavigate = vi.fn();
    render(
      <Harness
        nav={STUDENT_AT_2}
        answered={[true, false, false]}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("scenario-nav-1"));
    expect(onNavigate).toHaveBeenCalledWith(0);
    const cur = screen.getByTestId("scenario-nav-2");
    expect(cur).toHaveAttribute("aria-current", "step");
    expect(cur.className).toMatch(/border-blue-600/);
  });

  it("連點鎖住的方格：提示計時器重算", () => {
    vi.useFakeTimers();
    render(<Harness nav={NOT_STARTED} answered={[]} onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId("scenario-nav-2"));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByTestId("scenario-nav-2"));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // 第一次點後已過 3 秒，但第二次點重算，提示還在
    expect(
      screen.getByText("scenarioDialogue.chat.notYet"),
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByText("scenarioDialogue.chat.notYet")).toBeNull();
  });
});
