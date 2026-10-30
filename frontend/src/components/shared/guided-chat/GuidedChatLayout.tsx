/**
 * 引導式對話的同頁外框（Issue #1158 C 段 commit 3）：左邊對話、右邊一個 slot（情境對話
 * 放題目清單）。
 *
 * ## 版面依「外框實際寬度」決定，不看 viewport
 * 用 `ResizeObserver` 量這個外框自己的寬度（面板左緣會讓開側邊欄，viewport 寬不等於
 * 面板寬）：
 * - 寬度 ≥ `breakpoint`（預設 920px）：左右並列。左欄約 420px（最窄 360px），右欄佔其餘
 *   （至少約 500px）。
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
 * `useGuidedChatLayout()` 回 `{ wide }`，例如題目卡用它決定 `compact`（依所在欄寬度，
 * 不看 viewport 的 `sm`）、已選項目列在窄版提供收合。外框以外呼叫時回 `{ wide: true }`。
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

export const GUIDED_CHAT_BREAKPOINT = 920;

/** 右側浮動工具列的留白（見檔頭） */
export const TOOLBAR_GUTTER_CLASS = "pr-8 sm:pr-16";

export type GuidedChatTab = "chat" | "side";

interface LayoutInfo {
  wide: boolean;
}

const LayoutContext = createContext<LayoutInfo>({ wide: true });

/** 目前外框是寬版（並列）還是窄版（分頁） */
export function useGuidedChatLayout(): LayoutInfo {
  return useContext(LayoutContext);
}

export interface GuidedChatLayoutProps {
  chat: ReactNode;
  side: ReactNode;
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

  const wide = width === null || width >= breakpoint;
  const showChat = wide || tab === "chat";
  const showSide = wide || tab === "side";

  return (
    <LayoutContext.Provider value={{ wide }}>
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
            data-testid="guided-chat-column-side"
            aria-hidden={!showSide || undefined}
            className={cn(
              "min-h-0 min-w-0 flex-1 flex-col",
              showSide ? "flex" : "hidden",
              wide && "min-w-[500px]",
              TOOLBAR_GUTTER_CLASS,
            )}
          >
            {side}
          </section>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}
