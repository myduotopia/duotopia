/**
 * 引導式對話共用 UI 元件（Issue #1158 C 段 commit 3）：
 * - 已選項目列：點標籤跳 Popover，原地修改（選項、文字），改完關掉
 * - 同頁外框：依外框寬度切並列／分頁；切分頁、跨門檻時兩邊狀態都保留
 * - 底部對話框：灰字、停用（灰字＝原因）、送出
 * - 泡泡與選項卡、CEFR 小方塊的基本行為
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotBubble, TeacherBubble } from "../ChatBubbles";
import { ChoiceCards } from "../ChoiceCards";
import { CefrChips } from "../CefrChips";
import { ChatComposer } from "../ChatComposer";
import { GuidedChatLayout } from "../GuidedChatLayout";
import {
  ChipOptionList,
  ChipTextEditor,
  SelectedChipsBar,
} from "../SelectedChipsBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && "count" in values ? `${key}:${values.count}` : key,
  }),
}));

// ============================================================ ResizeObserver 假件

type RoCallback = (entries: { contentRect: { width: number } }[]) => void;
let roCallbacks: RoCallback[] = [];

class FakeResizeObserver {
  private cb: RoCallback;
  constructor(cb: RoCallback) {
    this.cb = cb;
    roCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    roCallbacks = roCallbacks.filter((c) => c !== this.cb);
  }
}

const resizeTo = (width: number) =>
  act(() => {
    roCallbacks.forEach((cb) => cb([{ contentRect: { width } }]));
  });

beforeEach(() => {
  roCallbacks = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================ 已選項目列

describe("SelectedChipsBar：Popover 原地修改", () => {
  function OptionHarness() {
    const [mode, setMode] = useState("none");
    return (
      <SelectedChipsBar
        collapsible={false}
        chips={[{ id: "mode", label: "情境", value: mode }]}
        renderContent={(_id, close) => (
          <ChipOptionList
            options={[
              { value: "none", label: "不需要" },
              { value: "ai", label: "AI 生成" },
            ]}
            current={mode}
            onChoose={(v) => {
              setMode(v);
              close();
            }}
          />
        )}
      />
    );
  }

  it("點標籤打開 Popover，選了新值後標籤更新、Popover 關掉", async () => {
    const user = userEvent.setup();
    render(<OptionHarness />);
    const chip = screen.getByRole("button", { name: /情境/ });
    expect(chip).toHaveTextContent("none");

    await user.click(chip);
    expect(screen.getByRole("button", { name: "不需要" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "AI 生成" }));

    expect(screen.getByRole("button", { name: /情境/ })).toHaveTextContent(
      "ai",
    );
    expect(screen.queryByRole("button", { name: "不需要" })).toBeNull();
  });

  it("文字型：改字後按確定才送出；空白不能送", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SelectedChipsBar
        collapsible={false}
        chips={[{ id: "direction", label: "方向", value: "" }]}
        renderContent={() => (
          <ChipTextEditor
            initialValue=""
            ariaLabel="方向"
            onSubmit={onSubmit}
          />
        )}
      />,
    );
    await user.click(screen.getByRole("button", { name: "方向" }));
    const apply = screen.getByRole("button", {
      name: "guidedChat.chips.apply",
    });
    expect(apply).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "方向" }), " 週末 ");
    await user.click(apply);
    expect(onSubmit).toHaveBeenCalledWith("週末");
  });

  it("選項不能改時全部停用，並顯示原因", async () => {
    const user = userEvent.setup();
    render(
      <SelectedChipsBar
        collapsible={false}
        chips={[{ id: "source", label: "來源", value: "AI 出題" }]}
        renderContent={() => (
          <ChipOptionList
            options={[{ value: "manual", label: "自己輸入" }]}
            onChoose={vi.fn()}
            disabledReason="已有題目，不能改"
          />
        )}
      />,
    );
    await user.click(screen.getByRole("button", { name: /來源/ }));
    expect(screen.getByRole("button", { name: "自己輸入" })).toBeDisabled();
    expect(screen.getByText("已有題目，不能改")).toBeInTheDocument();
  });

  it("沒有標籤時不畫；窄版可收合成一行", async () => {
    const { container, rerender } = render(
      <SelectedChipsBar chips={[]} renderContent={() => null} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <SelectedChipsBar
        collapsible
        chips={[{ id: "a", label: "A" }]}
        renderContent={() => null}
      />,
    );
    const toggle = screen.getByRole("button", {
      name: "guidedChat.chips.collapse",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: "guidedChat.chips.expand" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});

// ============================================================ 同頁外框

describe("GuidedChatLayout：寬度決定版面，狀態保留", () => {
  const renderLayout = () =>
    render(
      <GuidedChatLayout
        chat={<input aria-label="chat-draft" defaultValue="" />}
        side={<input aria-label="side-draft" defaultValue="" />}
        sideCount={3}
      />,
    );
  const layout = () => screen.getByTestId("guided-chat-layout");
  const chatCol = () => screen.getByTestId("guided-chat-column-chat");
  const sideCol = () => screen.getByTestId("guided-chat-column-side");

  it("≥920px 並列、沒有分頁；<920px 出現「對話／題目（N）」分頁", () => {
    renderLayout();
    resizeTo(1000);
    expect(layout()).toHaveAttribute("data-layout", "wide");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(chatCol()).not.toHaveClass("hidden");
    expect(sideCol()).not.toHaveClass("hidden");

    resizeTo(800);
    expect(layout()).toHaveAttribute("data-layout", "narrow");
    expect(
      screen.getByRole("tab", { name: "guidedChat.tabs.side:3" }),
    ).toBeInTheDocument();
    expect(chatCol()).not.toHaveClass("hidden");
    expect(sideCol()).toHaveClass("hidden");
  });

  it("切分頁、跨過門檻時，兩邊打到一半的字都還在", async () => {
    const user = userEvent.setup();
    renderLayout();
    resizeTo(800);

    await user.type(screen.getByLabelText("chat-draft"), "hello");
    await user.click(
      screen.getByRole("tab", { name: "guidedChat.tabs.side:3" }),
    );
    expect(chatCol()).toHaveClass("hidden");
    expect(sideCol()).not.toHaveClass("hidden");
    await user.type(screen.getByLabelText("side-draft"), "Q1");

    await user.click(screen.getByRole("tab", { name: "guidedChat.tabs.chat" }));
    expect(screen.getByLabelText("chat-draft")).toHaveValue("hello");

    resizeTo(1200);
    expect(screen.getByLabelText("chat-draft")).toHaveValue("hello");
    expect(screen.getByLabelText("side-draft")).toHaveValue("Q1");

    resizeTo(700);
    expect(screen.getByLabelText("chat-draft")).toHaveValue("hello");
    expect(screen.getByLabelText("side-draft")).toHaveValue("Q1");
  });

  it("受控分頁：呼叫端可以切到題目分頁", () => {
    const { rerender } = render(
      <GuidedChatLayout chat={<p>chat</p>} side={<p>side</p>} tab="chat" />,
    );
    resizeTo(600);
    expect(sideCol()).toHaveClass("hidden");
    rerender(
      <GuidedChatLayout chat={<p>chat</p>} side={<p>side</p>} tab="side" />,
    );
    expect(sideCol()).not.toHaveClass("hidden");
    expect(chatCol()).toHaveClass("hidden");
  });
});

// ============================================================ 底部對話框

describe("ChatComposer：灰字與停用", () => {
  it("顯示灰字；有字才能送出", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Harness() {
      const [v, setV] = useState("");
      return (
        <ChatComposer
          value={v}
          onChange={setV}
          onSubmit={onSubmit}
          placeholder="請點選上面的選項"
        />
      );
    }
    render(<Harness />);
    const box = screen.getByRole("textbox");
    const send = screen.getByRole("button", {
      name: "guidedChat.composer.send",
    });
    expect(box).toHaveAttribute("placeholder", "請點選上面的選項");
    expect(send).toBeDisabled();
    await user.type(box, "hi");
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("停用時灰字就是原因（也掛在 title），送出鈕不能按", () => {
    render(
      <ChatComposer
        value="已打的字"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        placeholder="請先完成上面的卡片"
        disabled
      />,
    );
    const box = screen.getByRole("textbox");
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("placeholder", "請先完成上面的卡片");
    expect(box).toHaveAttribute("title", "請先完成上面的卡片");
    expect(
      screen.getByRole("button", { name: "guidedChat.composer.send" }),
    ).toBeDisabled();
  });

  it("產生中：送出鈕停用", () => {
    render(
      <ChatComposer
        value="x"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        placeholder="產生中"
        busy
      />,
    );
    expect(
      screen.getByRole("button", { name: "guidedChat.composer.send" }),
    ).toBeDisabled();
  });

  it("Enter 預設換行；submitOnEnter 時 Enter 送出、Shift+Enter 不送", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ChatComposer
        value="x"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        placeholder=""
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <ChatComposer
        value="x"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        placeholder=""
        submitOnEnter
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      shiftKey: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

// ============================================================ 泡泡、選項卡、CEFR

describe("泡泡、選項卡、CEFR 小方塊", () => {
  it("TeacherBubble 有 onChange 才有「改選」", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TeacherBubble>答案</TeacherBubble>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<TeacherBubble onChange={onChange}>答案</TeacherBubble>);
    fireEvent.click(screen.getByRole("button", { name: "guidedChat.change" }));
    expect(onChange).toHaveBeenCalled();
    render(<BotBubble>問句</BotBubble>);
    expect(screen.getByText("問句")).toBeInTheDocument();
  });

  it("ChoiceCards：按鈕名稱是主句，說明行掛在 aria-describedby", () => {
    const onChoose = vi.fn();
    render(
      <ChoiceCards
        options={[
          { value: "a", label: "選項 A", hint: "說明 A" },
          { value: "b", label: "選項 B" },
        ]}
        onChoose={onChoose}
      />,
    );
    const a = screen.getByRole("button", { name: "選項 A" });
    expect(a).toHaveAccessibleDescription("說明 A");
    fireEvent.click(screen.getByRole("button", { name: "選項 B" }));
    expect(onChoose).toHaveBeenCalledWith("b");
  });

  it("CefrChips：目前值 aria-pressed，點了回傳新程度", () => {
    const onChange = vi.fn();
    render(<CefrChips value="A2" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "A2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "B1" }));
    expect(onChange).toHaveBeenCalledWith("B1");
  });
});
