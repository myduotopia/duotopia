/**
 * ClassroomRenameAssistantPanel — 批次編輯視窗的 AI 助手面板（#1139 第二階段）
 *
 * 放在 BatchEditClassroomsDialog 的右側面板插槽（renderSidePanel）。只有平台管理員看得到（D3）：
 * 頁面用 useClassroomRenameAssistantSlot() 取得插槽，非管理員拿到 undefined、視窗不顯示面板。
 *
 * AI 不是能自由操作的 agent（D4、D5）：送出時把表格「當下」那幾班的 {id, name, grade}、
 * 最近 10 輪對話與本次指示交給 POST /api/classrooms/batch-edit/ai-suggest，拿回建議後
 * 只經 ctx.applyChanges(…, "ai") 填進表格（只改名稱與年級，AI 改過的格子是琥珀色標記），
 * 寫入資料庫仍只能靠人按「儲存」。
 *
 * 流程（D7）：
 * - 等待時顯示「AI 思考中…」，可按「停止」＝取消請求、表格不動。
 * - 回來後逐列套用（每列間隔 applyIntervalMs），顯示 k/n，對話裡列出「原 → 新」（含年級變化）。
 *   套用中按「停止」：已套用的保留、剩下的捨棄。
 * - 失敗（逾時、502、網路錯誤）：顯示「AI 暫時無法回應，請重試」，表格不動。
 * 復原（D8）：每次 AI 開始套用前存整張表格快照，「復原上一次 AI 修改」回到該次之前
 * （之後的手動修改也會一起還原，按鈕旁小字提醒）；可連續復原多次。
 * 對話紀錄（D10）：只存在這次開著的視窗（面板隨視窗關閉而卸載就清空），不存資料庫。
 * 版面（D11）：寬螢幕在表格右側；窄螢幕在表格上方、可收合（收合鈕只在窄螢幕出現）。
 * 視窗層級高於全站右側浮動工具列，所以面板內不用會 portal 出去的 Tooltip／Popover，停用原因用 title。
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  Sparkles,
  Square,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  apiClient,
  type ClassroomBatchEditAiRequest,
  type ClassroomBatchEditAiResponse,
} from "@/lib/api";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import type { BatchEditSidePanelContext } from "./BatchEditClassroomsDialog";
import type { BatchEditChange, BatchEditRow } from "./batchEditClassrooms";
import {
  buildAiHistory,
  describeAiChange,
  mapAiChanges,
  toAiRequestClassrooms,
  type AiChangeDescription,
  type AssistantHistoryMessage,
} from "./classroomRenameAssistant";

export type RequestClassroomSuggestion = (
  payload: ClassroomBatchEditAiRequest,
  signal: AbortSignal,
) => Promise<ClassroomBatchEditAiResponse>;

export interface ClassroomRenameAssistantPanelProps<
  Id,
> extends BatchEditSidePanelContext<Id> {
  /** 呼叫 AI 端點（預設 apiClient.suggestClassroomBatchEdit；測試可替換） */
  requestSuggestion?: RequestClassroomSuggestion;
  /** 逐列套用的間隔（毫秒） */
  applyIntervalMs?: number;
}

interface ChatMessage extends AssistantHistoryMessage {
  key: number;
  /** 已套用的「原 → 新」清單 */
  lines?: AiChangeDescription[];
  /** 結果附註（已套用 N 班／已停止／沒有修改／已復原） */
  note?: string;
}

type Phase = "idle" | "thinking" | "applying";

interface ApplyJob<Id> {
  messageKey: number;
  queue: { change: BatchEditChange<Id>; line: AiChangeDescription }[];
  index: number;
}

const DEFAULT_APPLY_INTERVAL_MS = 150;

const defaultRequest: RequestClassroomSuggestion = (payload, signal) =>
  apiClient.suggestClassroomBatchEdit(payload, signal);

export function ClassroomRenameAssistantPanel<Id>({
  rows,
  setRows,
  applyChanges,
  saving,
  requestSuggestion = defaultRequest,
  applyIntervalMs = DEFAULT_APPLY_INTERVAL_MS,
}: ClassroomRenameAssistantPanelProps<Id>) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [undoStack, setUndoStack] = useState<BatchEditRow<Id>[][]>([]);
  const [collapsed, setCollapsed] = useState(false);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const applyChangesRef = useRef(applyChanges);
  applyChangesRef.current = applyChanges;
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobRef = useRef<ApplyJob<Id> | null>(null);
  const keyRef = useRef(0);

  // 視窗關閉（面板卸載）時取消請求與剩下的套用
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const nextKey = () => {
    keyRef.current += 1;
    return keyRef.current;
  };

  const addMessage = (message: Omit<ChatMessage, "key">) => {
    const key = nextKey();
    setMessages((prev) => [...prev, { ...message, key }]);
    return key;
  };

  const updateMessage = (key: number, patch: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => prev.map((m) => (m.key === key ? patch(m) : m)));

  const finishJob = (stopped: boolean) => {
    const job = jobRef.current;
    if (!job) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    jobRef.current = null;
    const total = job.queue.length;
    const applied = job.index;
    updateMessage(job.messageKey, (m) => ({
      ...m,
      note: stopped
        ? t("classroomGrade.batchEdit.ai.stopped", {
            current: applied,
            total,
          })
        : t("classroomGrade.batchEdit.ai.applied", { count: applied }),
    }));
    setPhase("idle");
  };

  const applyNext = () => {
    const job = jobRef.current;
    if (!job) return;
    const item = job.queue[job.index];
    applyChangesRef.current([item.change], "ai");
    job.index += 1;
    const applied = job.index;
    setProgress({ current: applied, total: job.queue.length });
    updateMessage(job.messageKey, (m) => ({
      ...m,
      lines: [...(m.lines ?? []), item.line],
    }));
    if (applied >= job.queue.length) {
      finishJob(false);
    } else {
      timerRef.current = setTimeout(applyNext, applyIntervalMs);
    }
  };

  const handleResponse = (res: ClassroomBatchEditAiResponse) => {
    const current = rowsRef.current;
    const byKey = new Map(current.map((r) => [String(r.id), r]));
    const queue = mapAiChanges(current, res.changes ?? [])
      .map((change) => {
        const before = byKey.get(String(change.id));
        return before
          ? { change, line: describeAiChange(before, change) }
          : null;
      })
      .filter(
        (
          item,
        ): item is { change: BatchEditChange<Id>; line: AiChangeDescription } =>
          item !== null && (item.line.nameChanged || item.line.gradeChanged),
      );

    const reply = (res.reply ?? "").trim();
    if (queue.length === 0) {
      addMessage({
        role: "assistant",
        content: reply,
        note: t("classroomGrade.batchEdit.ai.noChanges"),
      });
      setPhase("idle");
      return;
    }

    // 套用前存整張表格快照（復原用，D8）
    setUndoStack((prev) => [...prev, current.map((r) => ({ ...r }))]);
    const messageKey = addMessage({
      role: "assistant",
      content: reply,
      lines: [],
    });
    jobRef.current = { messageKey, queue, index: 0 };
    setProgress({ current: 0, total: queue.length });
    setPhase("applying");
    applyNext();
  };

  const send = async () => {
    const instruction = input.trim();
    if (!instruction || phase !== "idle" || saving) return;
    const history = buildAiHistory(messages);
    addMessage({ role: "user", content: instruction });
    setInput("");
    setPhase("thinking");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await requestSuggestion(
        {
          classrooms: toAiRequestClassrooms(rowsRef.current),
          history,
          instruction,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      abortRef.current = null;
      handleResponse(res);
    } catch {
      if (controller.signal.aborted) return;
      abortRef.current = null;
      addMessage({
        role: "assistant",
        content: t("classroomGrade.batchEdit.ai.error"),
        error: true,
      });
      setPhase("idle");
    }
  };

  const stop = () => {
    if (phase === "thinking") {
      abortRef.current?.abort();
      abortRef.current = null;
      addMessage({
        role: "assistant",
        content: "",
        note: t("classroomGrade.batchEdit.ai.cancelled"),
        error: true,
      });
      setPhase("idle");
    } else if (phase === "applying") {
      finishJob(true);
    }
  };

  const undo = () => {
    if (phase !== "idle" || saving || undoStack.length === 0) return;
    const snapshot = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRows(snapshot.map((r) => ({ ...r })));
    addMessage({
      role: "assistant",
      content: "",
      note: t("classroomGrade.batchEdit.ai.undone"),
      error: true,
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 送出、Shift+Enter 換行；輸入法選字中的 Enter 不算
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const gradeText = (grade: number | null) =>
    grade === null
      ? t("classroomGrade.unset")
      : t("classroomGrade.gradeLabel", { grade });

  const renderLine = (line: AiChangeDescription, index: number): ReactNode => (
    <li key={index} className="break-words">
      {line.nameChanged
        ? t("classroomGrade.batchEdit.ai.changeLine", {
            from: line.fromName,
            to: line.toName,
          })
        : line.fromName}
      {line.gradeChanged &&
        t("classroomGrade.batchEdit.ai.gradeChange", {
          from: gradeText(line.fromGrade),
          to: gradeText(line.toGrade),
        })}
    </li>
  );

  const busy = phase !== "idle";
  const title = t("classroomGrade.batchEdit.ai.title");

  return (
    <section
      aria-label={title}
      className="flex h-full min-h-0 flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
    >
      <div className="flex items-center gap-2">
        <Sparkles
          className="h-4 w-4 flex-shrink-0 text-amber-500"
          aria-hidden
        />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("classroomGrade.batchEdit.ai.adminOnly")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 lg:hidden"
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t("classroomGrade.batchEdit.ai.expand")
              : t("classroomGrade.batchEdit.ai.collapse")
          }
          title={
            collapsed
              ? t("classroomGrade.batchEdit.ai.expand")
              : t("classroomGrade.batchEdit.ai.collapse")
          }
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div
        data-testid="batch-edit-ai-body"
        className={cn(
          "min-h-0 flex-1 flex-col gap-2",
          collapsed ? "hidden lg:flex" : "flex",
        )}
      >
        <div className="max-h-48 min-h-0 overflow-y-auto lg:max-h-none lg:flex-1">
          {messages.length === 0 ? (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t("classroomGrade.batchEdit.ai.intro")}
            </p>
          ) : (
            <ul className="space-y-2" aria-label={title}>
              {messages.map((m) => (
                <li
                  key={m.key}
                  data-testid={`batch-edit-ai-message-${m.role}`}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm",
                    m.role === "user"
                      ? "ml-6 bg-blue-50 text-gray-900 dark:bg-blue-900/30 dark:text-gray-100"
                      : "mr-6 bg-white text-gray-800 dark:bg-gray-800 dark:text-gray-200",
                  )}
                >
                  {m.content && (
                    <p
                      className={cn(
                        "whitespace-pre-wrap break-words",
                        m.error &&
                          m.role === "assistant" &&
                          "text-red-600 dark:text-red-400",
                      )}
                    >
                      {m.content}
                    </p>
                  )}
                  {m.lines && m.lines.length > 0 && (
                    <ul
                      data-testid="batch-edit-ai-change-lines"
                      className="mt-1 space-y-0.5 text-xs text-gray-700 dark:text-gray-300"
                    >
                      {m.lines.map(renderLine)}
                    </ul>
                  )}
                  {m.note && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {m.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p
          aria-live="polite"
          className="flex min-h-[1rem] items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {phase === "thinking" && t("classroomGrade.batchEdit.ai.thinking")}
          {phase === "applying" &&
            t("classroomGrade.batchEdit.ai.applying", {
              current: progress.current,
              total: progress.total,
            })}
        </p>

        <Textarea
          value={input}
          maxLength={1000}
          rows={2}
          disabled={busy || saving}
          aria-label={t("classroomGrade.batchEdit.ai.inputLabel")}
          placeholder={t("classroomGrade.batchEdit.ai.placeholder")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-[60px] resize-none"
        />

        <div className="flex flex-wrap items-center gap-2">
          {busy ? (
            <Button type="button" variant="outline" size="sm" onClick={stop}>
              <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("classroomGrade.batchEdit.ai.stop")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void send()}
              disabled={!input.trim() || saving}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("classroomGrade.batchEdit.ai.send")}
            </Button>
          )}
          {undoStack.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={undo}
              disabled={busy || saving}
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {t("classroomGrade.batchEdit.ai.undo")}
            </Button>
          )}
        </div>
        {undoStack.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("classroomGrade.batchEdit.ai.undoHint")}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * 頁面用：平台管理員（useTeacherAuthStore 的 user.is_admin）拿到 AI 面板插槽，
 * 其他人拿到 undefined（批次編輯視窗就不顯示面板，D3）。
 */
export function useClassroomRenameAssistantSlot<Id>():
  | ((ctx: BatchEditSidePanelContext<Id>) => ReactNode)
  | undefined {
  const isAdmin = useTeacherAuthStore((state) => state.user?.is_admin === true);
  if (!isAdmin) return undefined;
  return (ctx) => <ClassroomRenameAssistantPanel<Id> {...ctx} />;
}

export default ClassroomRenameAssistantPanel;
