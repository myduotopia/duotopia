/**
 * QuestionNumberNav（#1112 C4）：題號方格導覽。
 *
 * 1. 每格是 button，帶 aria-label／title；點了回呼 key 與位置
 * 2. 狀態色（soft）：warning 琥珀、error 紅、pending 灰虛線、info 藍；需注意的短豎線
 * 3. 目前這題：outline＝粗框＋白格淡底、aria-current；solid＝整格填 accent 色
 * 4. readOnly：點了不回呼；size sm＝h-8（作答頁現有大小）、md＝h-11（44px 觸控）
 * 5. fill solid（批改頁總評）：實心底白字
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  QuestionNumberNav,
  type QuestionNumberNavItem,
} from "../QuestionNumberNav";

const items: QuestionNumberNavItem[] = [
  { key: "a", label: "1", ariaLabel: "第 1 題" },
  { key: "b", label: "2", tone: "warning", marker: true, title: "缺答案" },
  { key: "c", label: "3", tone: "error", marker: true },
  { key: "d", label: "4", tone: "pending" },
  { key: "e", label: "5", tone: "info", title: "你的題庫已有這題" },
];

function cell(key: string) {
  return screen.getByTestId(`question-number-nav-cell-${key}`);
}

describe("QuestionNumberNav", () => {
  it("每格是 button；點了回呼 key 與位置；aria-label 依序取 ariaLabel → title → label", () => {
    const onSelect = vi.fn();
    render(
      <QuestionNumberNav items={items} onSelect={onSelect} ariaLabel="題號" />,
    );
    expect(screen.getByRole("navigation", { name: "題號" })).toBeTruthy();
    expect(cell("a").tagName).toBe("BUTTON");
    expect(cell("a").getAttribute("aria-label")).toBe("第 1 題");
    expect(cell("b").getAttribute("aria-label")).toBe("缺答案");
    expect(cell("b").getAttribute("title")).toBe("缺答案");
    expect(cell("c").getAttribute("aria-label")).toBe("3");
    fireEvent.click(cell("c"));
    expect(onSelect).toHaveBeenCalledWith("c", 2);
  });

  it("狀態色與短豎線", () => {
    render(<QuestionNumberNav items={items} ariaLabel="題號" />);
    expect(cell("b").className).toContain("bg-amber-100");
    expect(cell("c").className).toContain("bg-red-100");
    expect(cell("d").className).toContain("border-dashed");
    expect(cell("e").className).toContain("bg-blue-100");
    expect(cell("a").className).toContain("bg-white");
    expect(
      screen.getByTestId("question-number-nav-marker-b").className,
    ).toContain("bg-amber-500");
    expect(screen.queryByTestId("question-number-nav-marker-a")).toBeNull();
  });

  it("目前這題 outline：粗框＋淡底＋aria-current；彩色格保留狀態色", () => {
    const { rerender } = render(
      <QuestionNumberNav items={items} currentKey="a" ariaLabel="題號" />,
    );
    expect(cell("a").className).toContain("border-2");
    expect(cell("a").className).toContain("border-blue-600");
    expect(cell("a").className).toContain("bg-blue-50");
    expect(cell("a").getAttribute("aria-current")).toBe("step");
    expect(cell("b").getAttribute("aria-current")).toBeNull();

    rerender(
      <QuestionNumberNav items={items} currentKey="b" ariaLabel="題號" />,
    );
    expect(cell("b").className).toContain("border-2");
    expect(cell("b").className).toContain("bg-amber-100");
  });

  it("目前這題 solid＋accent（單字小考）：整格填色", () => {
    render(
      <QuestionNumberNav
        items={items}
        currentKey="a"
        current="solid"
        accent="pink"
        ariaLabel="題號"
      />,
    );
    expect(cell("a").className).toContain("bg-pink-500");
    expect(cell("a").className).toContain("text-white");
  });

  it("readOnly 點了不回呼；size sm／md 高度不同", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <QuestionNumberNav
        items={items}
        onSelect={onSelect}
        readOnly
        size="sm"
        ariaLabel="題號"
      />,
    );
    fireEvent.click(cell("a"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(cell("a").className).toContain("h-8");
    expect(cell("a").className).toContain("cursor-default");

    rerender(
      <QuestionNumberNav items={items} onSelect={onSelect} ariaLabel="題號" />,
    );
    expect(cell("a").className).toContain("h-11");
  });

  it("fill solid（批改頁總評）：實心底白字", () => {
    render(
      <QuestionNumberNav
        items={[
          { key: "p", label: "✓", tone: "success" },
          { key: "n", label: "2", tone: "pending" },
        ]}
        fill="solid"
        ariaLabel="題號"
      />,
    );
    expect(cell("p").className).toContain("bg-green-500");
    expect(cell("p").className).toContain("text-white");
    expect(cell("n").className).toContain("border-dashed");
  });
});
