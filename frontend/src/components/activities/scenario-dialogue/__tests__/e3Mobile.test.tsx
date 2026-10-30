/**
 * #1158 E-3 手機作答頁：
 * - 作答要求倒數：按「開始對話」後熊熊請學生先看作答要求＋倒數（不能跳過），倒數中麥克風停用、
 *   小字寫原因；倒數完才出第 1 題並自動朗讀。沒有作答要求就直接出題。秒數依字數 5～12 秒。
 * - 手機橫放：蓋提示、停止朗讀、倒數暫停；轉回直立提示消失、狀態保留。
 * - 錄音中橫放：ReplyComposer 叫 AudioRecorder 丟掉錄音（discardSignal）；沒在錄音不丟。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ScenarioChatActivity } from "../ScenarioChatActivity";
import { ReplyComposer } from "../ReplyComposer";
import {
  RUBRIC_MAX_SECONDS,
  RUBRIC_MIN_SECONDS,
  rubricCountdownSeconds,
} from "../RubricCountdown";
import { PHONE_LANDSCAPE_QUERY } from "../PhoneLandscapeOverlay";
import { TYPING_MS } from "../useScenarioChat";
import type { ScenarioChatContext, ScenarioChatItem } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "count" in opts ? `${key}:${opts.count}` : key,
    i18n: { language: "zh-TW" },
  }),
}));

// 只記錄 ReplyComposer 傳給錄音元件的 props，不靠 MediaRecorder
const recorderProps: Array<Record<string, unknown>> = [];
vi.mock("@/components/shared/AudioRecorder", () => ({
  default: (props: {
    disabled?: boolean;
    disabledReason?: string;
    discardSignal?: number;
    onRecordingStart?: () => void;
  }) => {
    recorderProps.push(props);
    return (
      <div data-testid="recorder-stub">
        <button
          type="button"
          disabled={props.disabled}
          aria-label={props.disabledReason ?? "mic"}
          onClick={props.onRecordingStart}
        >
          stub-start
        </button>
        <span data-testid="discard-signal">{props.discardSignal ?? 0}</span>
      </div>
    );
  },
}));

// ── matchMedia：可切換的「手機橫放」 ──
let landscape = false;
const listeners = new Set<() => void>();
function setLandscape(v: boolean) {
  landscape = v;
  act(() => listeners.forEach((l) => l()));
}

beforeEach(() => {
  landscape = false;
  listeners.clear();
  recorderProps.length = 0;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query === PHONE_LANDSCAPE_QUERY && landscape;
    },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener: (l: () => void) => listeners.add(l),
    removeListener: (l: () => void) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

const CONTEXT: ScenarioChatContext = {
  title: "週末去夜市",
  content: "Amy went to the night market.",
  images: [],
  rubric: "請用完整句子回答。",
};

const ITEMS: ScenarioChatItem[] = [
  { id: 1, text: "What did Amy eat?", keywords: [], images: [] },
  { id: 2, text: "Who did Amy go with?", keywords: [], images: [] },
];

const SETTINGS = {
  replyMode: "voice" as const,
  textDefaultHidden: false,
  showTranslation: false,
  isPreviewMode: false,
  maxAttempts: 3,
};

function makeAdapters() {
  return {
    getFeedback: vi.fn(),
    speak: vi.fn(),
    primeSpeech: vi.fn(),
    stopSpeech: vi.fn(),
  };
}

function renderChat(
  context: ScenarioChatContext = CONTEXT,
  adapters = makeAdapters(),
) {
  render(
    <ScenarioChatActivity
      context={context}
      items={ITEMS}
      settings={SETTINGS}
      adapters={adapters}
      onSubmit={() => {}}
      layout="compact"
    />,
  );
  return adapters;
}

const start = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "scenarioDialogue.chat.start" }),
  );
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const firstQuestion = () => screen.queryAllByText(/What did Amy eat\?/);

describe("作答要求倒數秒數", () => {
  it("基本 5 秒，字多拉長，最多 12 秒", () => {
    expect(rubricCountdownSeconds("請用完整句子回答。")).toBe(
      RUBRIC_MIN_SECONDS,
    );
    expect(rubricCountdownSeconds("字".repeat(64))).toBe(8);
    expect(rubricCountdownSeconds("字".repeat(500))).toBe(RUBRIC_MAX_SECONDS);
  });
});

describe("作答要求倒數（#1158 E-3）", () => {
  it("按開始：先看作答要求＋倒數，麥克風停用；倒數完才出第 1 題並朗讀", () => {
    vi.useFakeTimers();
    const adapters = renderChat();
    start();
    // 朗讀解鎖仍在點擊當下
    expect(adapters.primeSpeech).toHaveBeenCalledTimes(1);

    const intro = screen.getByTestId("scenario-rubric-intro");
    expect(intro.textContent).toContain("scenarioDialogue.chat.rubricIntro");
    expect(intro.textContent).toContain("請用完整句子回答。");
    expect(
      screen.getByText("scenarioDialogue.chat.rubricCountdown:5"),
    ).toBeInTheDocument();
    // 麥克風停用，原因寫在小字與 aria-label
    const mic = screen.getByRole("button", {
      name: "scenarioDialogue.chat.waitRubric",
    });
    expect(mic).toBeDisabled();
    expect(screen.getByRole("status").textContent).toBe(
      "scenarioDialogue.chat.waitRubric",
    );
    // 開始前的「開始對話」不見了（不能跳過）
    expect(
      screen.queryByRole("button", { name: "scenarioDialogue.chat.start" }),
    ).toBeNull();

    advance(3000);
    expect(
      screen.getByText("scenarioDialogue.chat.rubricCountdown:2"),
    ).toBeInTheDocument();
    advance(1900);
    expect(firstQuestion()).toHaveLength(0);
    expect(adapters.speak).not.toHaveBeenCalled();

    advance(100);
    advance(TYPING_MS);
    expect(firstQuestion().length).toBeGreaterThan(0);
    expect(adapters.speak).toHaveBeenCalledWith(
      "What did Amy eat?",
      expect.anything(),
    );
    // 倒數完：作答要求留在對話裡當紀錄，沒有倒數；麥克風可以用
    expect(screen.getByTestId("scenario-rubric-intro")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("button", { name: "mic" })).not.toBeDisabled();
  });

  it("沒有作答要求：直接出第 1 題，不倒數", () => {
    vi.useFakeTimers();
    renderChat({ ...CONTEXT, rubric: "" });
    start();
    expect(screen.queryByTestId("scenario-rubric-intro")).toBeNull();
    advance(TYPING_MS);
    expect(firstQuestion().length).toBeGreaterThan(0);
  });
});

describe("手機橫放（#1158 E-3）", () => {
  it("橫放蓋提示並停止朗讀；轉回直立提示消失、狀態保留", () => {
    vi.useFakeTimers();
    const adapters = renderChat({ ...CONTEXT, rubric: "" });
    start();
    advance(TYPING_MS);
    expect(firstQuestion().length).toBeGreaterThan(0);
    expect(screen.queryByTestId("scenario-landscape-overlay")).toBeNull();

    setLandscape(true);
    const overlay = screen.getByTestId("scenario-landscape-overlay");
    expect(overlay.textContent).toContain(
      "scenarioDialogue.chat.landscapeTitle",
    );
    expect(overlay.textContent).toContain(
      "scenarioDialogue.chat.landscapeHint",
    );
    expect(adapters.stopSpeech).toHaveBeenCalled();

    setLandscape(false);
    expect(screen.queryByTestId("scenario-landscape-overlay")).toBeNull();
    expect(firstQuestion().length).toBeGreaterThan(0);
  });

  it("倒數中橫放：倒數暫停，轉回直立接著倒數", () => {
    vi.useFakeTimers();
    renderChat();
    start();
    advance(2000);
    setLandscape(true);
    advance(10000);
    expect(
      screen.getByText("scenarioDialogue.chat.rubricCountdown:3"),
    ).toBeInTheDocument();
    expect(firstQuestion()).toHaveLength(0);
    setLandscape(false);
    advance(3000);
    advance(TYPING_MS);
    expect(firstQuestion().length).toBeGreaterThan(0);
  });
});

describe("錄音中橫放：丟掉錄音（#1158 E-3）", () => {
  const composerProps = {
    state: "answer" as const,
    replyMode: "voice" as const,
    waitingHint: "",
    retryNo: null,
    canCancelRetry: false,
    onStart: vi.fn(),
    onSubmitAnswer: vi.fn(),
    onCancelRetry: vi.fn(),
    onSubmitAssignment: vi.fn(),
  };

  it("錄音中變成中斷：叫錄音元件丟掉這段錄音", () => {
    const { rerender } = render(<ReplyComposer {...composerProps} />);
    fireEvent.click(screen.getByText("stub-start"));
    expect(screen.getByTestId("discard-signal").textContent).toBe("0");
    rerender(<ReplyComposer {...composerProps} interrupted />);
    expect(screen.getByTestId("discard-signal").textContent).toBe("1");
  });

  it("沒在錄音時中斷：不丟（已錄完未送出的保留）", () => {
    const { rerender } = render(<ReplyComposer {...composerProps} />);
    rerender(<ReplyComposer {...composerProps} interrupted />);
    expect(screen.getByTestId("discard-signal").textContent).toBe("0");
  });
});
