/**
 * 引導式對話的同頁外框（Issue #1158 C 段 commit 3）：左邊對話、右邊一個 slot（情境對話
 * 放題目清單）。
 *
 * ## 版面依「外框實際寬度」決定，不看 viewport
 * 用 `ResizeObserver` 量這個外框自己的寬度（面板左緣會讓開側邊欄，viewport 寬不等於
 * 面板寬）：
 * - 寬度 ≥ `breakpoint`（預設 925px＝左欄最窄＋分隔線＋右欄最窄）：左右並列。左欄約
 *   420px（最窄 360px），右欄佔其餘（內容至少 500px，再加工具列留白，共 564px）。
 * - 寬度 < `breakpoint`：頂端 Tabs 切換「對話／題目（N）」，兩邊都佔滿寬度。
 *
 * 跨過門檻時即時切換，**兩邊的狀態都保留**：兩欄永遠都掛在同一個位置，窄版只是把沒選中
 * 的那一欄藏起來（`hidden`），不會卸載 —— 打到一半的字、捲動位置、展開的卡片都還在。
 * 所以這裡不用 `TabsContent`（它預設會卸載沒選中的內容）。
 *
 * ## 右側浮動工具列的留白
 * 老師後台右緣有固定的數位教學工具列（約 54px 寬）疊在面板上。貼著外框右緣的那一欄
 * （寬版＝右欄；窄版＝兩欄）由這裡加上留白 `pr-8 sm:pr-16`，slot 內容自己不必再留。
 *
 * ## 分頁
 * 可受控（`tab` + `onTabChange`，例如「從對話加入題目後自動切到題目分頁」由呼叫端切），
 * 不給就自己記。寬版時分頁值仍保留，切回窄版回到原本那一頁。
 *
 * ## 讓 slot 知道目前版面
 * `useGuidedChatLayout()` 回 `{ wide, sideWidth }`（`sideWidth`＝右欄內容寬，ResizeObserver
 * 量的，量不到是 null），例如已選項目列在窄版提供收合。`side` 也可以傳函式
 * `(info) => ReactNode`，呼叫端不必多包一層元件就拿得到 `sideWidth`（情境對話的題目卡用它
 * 決定 `compact`，依所在欄寬度、不看 viewport 的 `sm`）。外框以外呼叫時回
 * `{ wide: true, sideWidth: null }`。
 *
 * 用法：
 * ```tsx
 * <GuidedChatLayout
 *   chat={<>…已選項目列、對話捲動區、底部對話框…</>}
 *   side={<QuestionList />}
 *   sideCount={rows.length}
 *   tab={tab}
 *   onTabChange={setTab}
 * />
 * ```
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** 左欄（對話）最窄寬度 */
const CHAT_MIN_WIDTH = 360;
/**
 * 右欄最窄寬度＝內容約 500px ＋ 右側工具列留白 64px（`sm:pr-16`）。`min-w` 量的是含
 * padding 的寬度，只寫 500 的話內容實際只剩約 436px（C commit 3 review 低 3）。
 */
const SIDE_MIN_WIDTH = 564;

/**
 * 並列的門檻＝左欄最窄＋分隔線 1px＋右欄最窄（925px）。規格寫「約 920px」；用 920 的話
 * 920～924px 之間兩欄的最小寬度加起來放不下，會橫向溢出幾 px，所以由最小寬度推出來。
 */
export const GUIDED_CHAT_BREAKPOINT = CHAT_MIN_WIDTH + 1 + SIDE_MIN_WIDTH;

/** 右側浮動工具列的留白（見檔頭） */
export const TOOLBAR_GUTTER_CLASS = "pr-8 sm:pr-16";

export type GuidedChatTab = "chat" | "side";

export interface LayoutInfo {
  wide: boolean;
  /**
   * 右欄內容寬度（px，不含右欄自己的 padding）。還沒量到（例如測試環境沒有
   * ResizeObserver）時為 null。題目卡等依「所在欄寬」決定窄版排法時用它，不看 viewport。
   */
  sideWidth: number | null;
}

const LayoutContext = createContext<LayoutInfo>({
  wide: true,
  sideWidth: null,
});

/** 目前外框是寬版（並列）還是窄版（分頁） */
export function useGuidedChatLayout(): LayoutInfo {
  return useContext(LayoutContext);
}

export interface GuidedChatLayoutProps {
  chat: ReactNode;
  /** 右欄內容；給函式時拿得到目前版面（例如依 `sideWidth` 決定題目卡要不要窄版排法） */
  side: ReactNode | ((info: LayoutInfo) => ReactNode);
  /** 右欄項目數，顯示在窄版分頁標籤（例如「題目（3）」） */
  sideCount?: number;
  /** 右欄分頁標籤（預設 `guidedChat.tabs.side`，帶 `count`） */
  sideLabel?: string;
  /** 對話分頁標籤（預設 `guidedChat.tabs.chat`） */
  chatLabel?: string;
  tab?: GuidedChatTab;
  onTabChange?: (tab: GuidedChatTab) => void;
  /** 並列的最小寬度（px），預設 920 */
  breakpoint?: number;
  className?: string;
}

export function GuidedChatLayout({
  chat,
  side,
  sideCount = 0,
  sideLabel,
  chatLabel,
  tab: tabProp,
  onTabChange,
  breakpoint = GUIDED_CHAT_BREAKPOINT,
  className,
}: GuidedChatLayoutProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  /** 量到的外框寬度；還沒量到（或量到 0，例如還沒排版）時當寬版 */
  const [width, setWidth] = useState<number | null>(null);
  const [innerTab, setInnerTab] = useState<GuidedChatTab>("chat");
  const tab = tabProp ?? innerTab;
  const setTab = (next: GuidedChatTab) => {
    if (tabProp === undefined) setInnerTab(next);
    onTabChange?.(next);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (w: number) => {
      if (w > 0) setWidth(w);
    };
    update(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) update(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 右欄內容寬度：只靠 ResizeObserver（contentRect 不含 padding），量不到就是 null */
  const sideRef = useRef<HTMLElement>(null);
  const [sideWidth, setSideWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = sideRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? 0;
      // 窄版藏起來的那一欄量到 0：保留上一次的值，切回來時不會先閃一次窄版排法
      if (w > 0) setSideWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wide = width === null || width >= breakpoint;
  const showChat = wide || tab === "chat";
  const showSide = wide || tab === "side";
  const info: LayoutInfo = { wide, sideWidth };

  return (
    <LayoutContext.Provider value={info}>
      <div
        ref={ref}
        data-testid="guided-chat-layout"
        data-layout={wide ? "wide" : "narrow"}
        className={cn("flex min-h-0 flex-1 flex-col", className)}
      >
        {!wide && (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as GuidedChatTab)}
            className={cn("shrink-0 px-4 pt-3", TOOLBAR_GUTTER_CLASS)}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="chat">
                {chatLabel ?? t("guidedChat.tabs.chat")}
              </TabsTrigger>
              <TabsTrigger value="side">
                {sideLabel ?? t("guidedChat.tabs.side", { count: sideCount })}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <div className="flex min-h-0 flex-1">
          <section
            data-testid="guided-chat-column-chat"
            aria-hidden={!showChat || undefined}
            className={cn(
              "min-h-0 flex-col",
              showChat ? "flex" : "hidden",
              wide
                ? "w-[420px] min-w-[360px] shrink border-r border-gray-200"
                : cn("min-w-0 flex-1", TOOLBAR_GUTTER_CLASS),
            )}
          >
            {chat}
          </section>
          <section
            ref={sideRef}
            data-testid="guided-chat-column-side"
            aria-hidden={!showSide || undefined}
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col",
              showSide ? "flex" : "hidden",
              // = SIDE_MIN_WIDTH（Tailwind 要寫死字面值才產得出 class）
              wide && "min-w-[564px]",
              TOOLBAR_GUTTER_CLASS,
            )}
          >
            {typeof side === "function" ? side(info) : side}
          </section>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}
