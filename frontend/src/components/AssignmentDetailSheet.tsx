/**
 * AssignmentDetailSheet — 班級頁「作業設定」sheet（原位修改、改完即存）
 *
 * Issue #1092 驗收回饋：入口「查看詳情」改名「作業設定」，拿掉「編輯」按鈕與檢視／編輯兩套
 * 排版。所有可改的欄位直接在原位修改、改完即存（單一排版，由上到下）：
 *   1. 基本資訊：標題（失焦／Enter 存，空白或沒變不存）、類型 badge、作業說明（失焦存）
 *   2. 批改按鈕列
 *   3. 統計卡：指派對象／開始日期／截止日期／完成狀況／平均分數 —— 兩張日期卡是日期輸入，
 *      失焦／Enter 存；先檢查開始 ≤ 截止（後端不檢查），不合法就提示並退回
 *   4. 進階設定（PracticeModeSettingsPanel）：一改就存；熟練度滑桿放開才存（onCommit）；
 *      live 小考開考中「即時小考」開關 disabled＋提示
 *   5. 評分方式（QuizScoringMethodField，僅打字類小考）：方式／大小寫一改就存、扣分失焦存；
 *      只在「設定完整且有效值有變」時存。已有學生交卷（或進度載入失敗）→ 存之前先跳重算
 *      確認視窗；取消就把評分方式退回最後儲存值；確定才 PATCH，依 recomputed_count 提示並
 *      重抓學生進度
 *   6. 作業單元內容（含內容編輯 overlay，有自己的儲存鈕）
 *   7. 學生名單（StudentStatusPanel）：維持面板內「勾選 → 取消／儲存派發」，不即存
 *   Footer 只剩「關閉」。
 *
 * 儲存走 useAssignmentAutoSave（序列化合併佇列，只送有變的欄位、成功後併進 detailData，
 * 失敗把該欄位退回最後儲存值並 toast；保留 EXAMPLE_AUDIO_REQUIRED／CLOZE_ANSWER_REQUIRED／
 * 評分設定 422 的提示，live 開考中關閉即時小考的 400 另有提示）。各區標題右側顯示儲存狀態。
 * 詳情（GET）載入前所有控制項 disabled。畫面以 detailData／本地值為準（prop 只當開啟瞬間的
 * 佔位）。關閉（Esc／X／點外面／關閉鈕）前先 commit 尚未失焦的輸入並等佇列送完；本次有存過
 * 才在關閉時呼叫一次 onAssignmentUpdated（重算成功也會呼叫），不是每個開關都整頁重抓。
 */
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import ReadingAssessmentPanel, {
  type ReadingAssessmentPanelHandle,
} from "@/components/ReadingAssessmentPanel";
import VocabularySetPanel, {
  type VocabularySetPanelHandle,
} from "@/components/VocabularySetPanel";
import { RefSaveButton } from "@/components/shared/RefSaveButton";
import {
  practiceModeLabelKey,
  practiceModeBadgeClass,
  isAutoScoredMode,
} from "@/lib/practiceMode";
import { PracticeModeSettingsPanel } from "@/components/assignment/PracticeModeSettingsPanel";
import {
  clampPerQuestionTime,
  clampQuizTime,
  type PracticeModeSettings,
} from "@/components/assignment/practiceModeSettings";
import {
  useAssignmentAutoSave,
  type AutoSaveResult,
  type AutoSaveSection,
  type PatchBody,
  type SaveState,
} from "@/components/assignment/useAssignmentAutoSave";
import { apiClient, ApiError } from "@/lib/api";
import { toast } from "sonner";
import {
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  Sparkles,
  BookOpen,
  ChevronRight,
  Edit2,
} from "lucide-react";
import { Assignment } from "@/types";
import StudentStatusPanel, {
  StudentProgress,
} from "@/components/StudentStatusPanel";
import { useSidebar } from "@/contexts/SidebarContext";
import { QuizScoringMethodField } from "@/components/assignment/QuizScoringMethodField";
import { ConfirmDialog } from "@/components/organization/ConfirmDialog";
import {
  EMPTY_QUIZ_SCORING,
  isQuizScoringComplete,
  isTypedQuizMode,
  quizScoringChanged,
  quizScoringErrorCode,
  quizScoringFromDetail,
  quizScoringPayload,
  type QuizScoringSettings,
} from "@/lib/quizScoring";

// Issue #1092: 已交卷（有第一次作答成績）的狀態 —— 改評分方式會被重算的學生
const SUBMITTED_STATUSES = new Set([
  "SUBMITTED",
  "RESUBMITTED",
  "GRADED",
  "RETURNED",
]);

interface AssignmentContent {
  id: number;
  title: string;
  type?: string;
  order_index: number;
}

// #878 Stage 3.5：與派發共用同一設定型別（含 quiz_time_limit_seconds + 時間 literal union），
// 進階設定區用共用 PracticeModeSettingsPanel，與派發 dialog 一致（#846）。
type AdvancedSettings = PracticeModeSettings;

const DEFAULT_ADVANCED: AdvancedSettings = {
  time_limit_per_question: 30,
  quiz_time_limit_seconds: 0,
  is_live_quiz: false,
  shuffle_questions: false,
  show_answer: false,
  play_audio: false,
  target_proficiency: 80,
  show_word: true,
  show_image: true,
  show_translation: true,
  show_option_images: false,
  show_example_sentence: false,
};
const ADVANCED_KEYS = Object.keys(DEFAULT_ADVANCED) as Array<
  keyof AdvancedSettings
>;
const SCORING_KEYS = [
  "quiz_scoring_method",
  "quiz_scoring_points",
  "quiz_case_sensitive",
];

/** PATCH 回應（後端不回作業本身） */
type PatchResponse = { success?: boolean; recomputed_count?: number } | null;

interface ContentDetail {
  id?: number;
  title?: string;
  type?: string;
  items?: Array<{
    id: number;
    text: string;
    translation?: string;
    definition?: string;
    audio_url?: string;
    has_student_progress?: boolean;
    distractors?: string[];
  }>;
}

interface AssignmentDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: Assignment | null;
  classroomId: string;
  canUseAiGrading?: boolean;
  onGradeClick?: (assignmentId: number) => void;
  onBatchGradeClick?: (assignmentId: number) => void;
  onAssignmentUpdated?: () => void;
}

/** 詳情 API 的進階設定 → 畫面值（與派發 dialog 相同的預設／clamp） */
function advancedFromDetail(detail: Record<string, unknown>): AdvancedSettings {
  return {
    time_limit_per_question: clampPerQuestionTime(
      detail.time_limit_per_question,
    ),
    quiz_time_limit_seconds: clampQuizTime(detail.quiz_time_limit_seconds),
    is_live_quiz: (detail.is_live_quiz as boolean) ?? false,
    shuffle_questions: (detail.shuffle_questions as boolean) ?? false,
    show_answer: (detail.show_answer as boolean) ?? false,
    play_audio: (detail.play_audio as boolean) ?? false,
    target_proficiency: (detail.target_proficiency as number) ?? 80,
    show_word: (detail.show_word as boolean) ?? true,
    show_image: (detail.show_image as boolean) ?? true,
    show_translation: (detail.show_translation as boolean) ?? true,
    show_option_images: (detail.show_option_images as boolean) ?? false,
    show_example_sentence: (detail.show_example_sentence as boolean) ?? false,
  };
}

/** ISO 時間字串 → 日期輸入用的 YYYY-MM-DD（沿用原本的 split 寫法） */
function dateOnly(iso: unknown): string {
  return typeof iso === "string" && iso ? iso.split("T")[0] : "";
}
// Taiwan-only product: hardcode TST (+08:00) for TIMESTAMPTZ columns
const dueDateBody = (d: string) => (d ? `${d}T23:59:59+08:00` : null);
const startDateBody = (d: string) => (d ? `${d}T00:00:00+08:00` : null);

/**
 * #1092：自動儲存的「最後儲存值」—— 以畫面格式正規化（說明 null → ""、日期重組成送出格式、
 * 進階設定套預設／clamp、評分設定用 quizScoringPayload），diff 才不會把沒改的欄位當成有改。
 */
function savedFieldsFromDetail(
  detail: Record<string, unknown>,
  typedQuiz: boolean,
): PatchBody {
  return {
    title: (detail.title as string) ?? "",
    description: (detail.description as string | null) ?? "",
    due_date: dueDateBody(dateOnly(detail.due_date)),
    start_date: startDateBody(dateOnly(detail.start_date)),
    ...advancedFromDetail(detail),
    ...(typedQuiz ? quizScoringPayload(quizScoringFromDetail(detail)) : {}),
  };
}

/** /progress 回應 → 學生進度陣列（兼容新舊格式） */
function progressList(response: unknown): StudentProgress[] {
  const data = Array.isArray(response)
    ? response
    : (
        response as {
          students_progress?: unknown[];
          data?: unknown[];
        }
      ).students_progress ||
      (response as { data?: unknown[] }).data ||
      [];
  return data as StudentProgress[];
}

/** #1092：區塊標題右側的小型儲存狀態（儲存中…／已儲存 ✓／儲存失敗） */
function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useTranslation();
  if (state === "idle") return null;
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("assignmentDetail.sheet.saving")}
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600">
        <CheckCircle className="h-3 w-3" />
        {t("assignmentDetail.sheet.saved")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600">
      <AlertCircle className="h-3 w-3" />
      {t("assignmentDetail.sheet.saveFailed")}
    </span>
  );
}

export function AssignmentDetailSheet({
  open,
  onOpenChange,
  assignment,
  classroomId,
  canUseAiGrading = false,
  onGradeClick,
  onBatchGradeClick,
  onAssignmentUpdated,
}: AssignmentDetailSheetProps) {
  const { t } = useTranslation();
  const { sidebarWidth } = useSidebar();
  const [loading, setLoading] = useState(false);
  // #1092: 派發儲存有自己的 saving，與自動儲存狀態分開
  const [savingStudents, setSavingStudents] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  // #1092: 派發有變（關閉時要讓班級頁重抓列表）
  const listDirtyRef = useRef(false);
  const [studentProgress, setStudentProgress] = useState<StudentProgress[]>([]);
  const [isEditingStudents, setIsEditingStudents] = useState(false);
  const [pendingStudentIds, setPendingStudentIds] = useState<number[] | null>(
    null,
  );

  // Content state
  const [assignmentContents, setAssignmentContents] = useState<
    AssignmentContent[]
  >([]);
  const [expandedContentId, setExpandedContentId] = useState<number | null>(
    null,
  );
  const [contentDetails, setContentDetails] = useState<
    Record<number, ContentDetail>
  >({});
  const [editingContentId, setEditingContentId] = useState<number | null>(null);
  const readingPanelRef = useRef<ReadingAssessmentPanelHandle>(null);
  const vocabPanelRef = useRef<VocabularySetPanelHandle>(null);
  const loadingRef = useRef<Set<number>>(new Set());

  // Auto-focus content edit panel so scroll works immediately
  const contentEditPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editingContentId) {
      requestAnimationFrame(() => {
        contentEditPanelRef.current?.focus();
      });
    }
  }, [editingContentId]);

  // Detail data from API（#1092：最後一次儲存成功的值，自動儲存成功後併入）
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(
    null,
  );

  // 畫面上的欄位值（原位修改）
  const [editTitle, setEditTitle] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editAdvanced, setEditAdvanced] =
    useState<AdvancedSettings>(DEFAULT_ADVANCED);
  // Issue #1092: 打字類小考評分設定與重算確認視窗
  const [editScoring, setEditScoring] =
    useState<QuizScoringSettings>(EMPTY_QUIZ_SCORING);
  const editScoringRef = useRef<QuizScoringSettings>(EMPTY_QUIZ_SCORING);
  editScoringRef.current = editScoring;
  const [confirmRecomputeOpen, setConfirmRecomputeOpen] = useState(false);
  // #1092: 等待確認的評分設定；確認視窗關閉時仍有值 ＝ 取消 → 退回最後儲存值
  const pendingScoringRef = useRef<QuizScoringSettings | null>(null);
  // #1092: /progress 是否載入成功；失敗時不知道交卷人數，改評分方式一律跳確認
  const [progressLoaded, setProgressLoaded] = useState(false);

  const assignmentId = assignment?.id;
  const autoSave = useAssignmentAutoSave<PatchResponse>({
    patch: (body) =>
      apiClient.patch<PatchResponse>(
        `/api/teachers/assignments/${assignmentId}`,
        body,
      ),
    // 成功的欄位併進 detailData（最後儲存值）
    onSaved: (body) =>
      setDetailData((prev) => (prev ? { ...prev, ...body } : prev)),
  });
  const { reset: resetAutoSave } = autoSave;

  const fetchAssignmentData = useCallback(async () => {
    if (!assignment) return;
    setLoading(true);
    try {
      // Fetch assignment detail (includes contents) and student progress in parallel
      const [detailResponse, progressResponse] = await Promise.all([
        apiClient.get(`/api/teachers/assignments/${assignment.id}`),
        apiClient
          .get(`/api/teachers/assignments/${assignment.id}/progress`)
          // #1092: 記下進度是否載入成功（失敗時改評分方式仍要跳確認）
          .then((data) => {
            setProgressLoaded(true);
            return data;
          })
          .catch(() => {
            setProgressLoaded(false);
            return [];
          }),
      ]);

      const detail = detailResponse as Record<string, unknown>;
      setDetailData(detail);

      // #1092: 畫面值改以詳情為準（prop 只是開啟瞬間的佔位）
      setEditTitle((detail.title as string) ?? "");
      setEditInstructions((detail.description as string | null) ?? "");
      setEditDueDate(dateOnly(detail.due_date));
      setEditStartDate(dateOnly(detail.start_date));
      setEditAdvanced(advancedFromDetail(detail));
      setEditScoring(quizScoringFromDetail(detail));
      resetAutoSave(
        savedFieldsFromDetail(
          detail,
          isTypedQuizMode(
            (detail.practice_mode as string | null) ?? assignment.practice_mode,
          ),
        ),
      );

      // Extract contents from detail response
      const contents =
        (detail as { contents?: AssignmentContent[] }).contents || [];
      setAssignmentContents(contents);

      setStudentProgress(progressList(progressResponse));
    } catch {
      setStudentProgress([]);
      setAssignmentContents([]);
    } finally {
      setLoading(false);
    }
  }, [assignment, resetAutoSave]);

  // #1092: 只重抓學生進度（重算評分後）
  const fetchProgress = useCallback(async () => {
    if (!assignmentId) return;
    try {
      const data = await apiClient.get(
        `/api/teachers/assignments/${assignmentId}/progress`,
      );
      setProgressLoaded(true);
      setStudentProgress(progressList(data));
    } catch {
      setProgressLoaded(false);
    }
  }, [assignmentId]);

  // Reset state when assignment changes or sheet opens
  useEffect(() => {
    if (assignment && open) {
      // 佔位：detail 到了再覆蓋
      setEditTitle(assignment.title);
      setEditInstructions(
        assignment.instructions || assignment.description || "",
      );
      setEditDueDate(dateOnly(assignment.due_date));
      setEditStartDate(dateOnly(assignment.start_date));
      setDetailData(null);
      setAssignmentContents([]);
      setContentDetails({});
      setExpandedContentId(null);
      pendingScoringRef.current = null;
      listDirtyRef.current = false;
      fetchAssignmentData();
    }
  }, [assignment?.id, open, fetchAssignmentData]);

  const averageScoreDisplay = useMemo(() => {
    const scoredStudents = studentProgress.filter(
      (sp) => sp.score !== undefined && sp.score !== null,
    );
    if (scoredStudents.length === 0) return "-";
    const avg =
      scoredStudents.reduce((sum, sp) => sum + sp.score!, 0) /
      scoredStudents.length;
    return `${avg.toFixed(1)}`;
  }, [studentProgress, assignment?.practice_mode]);

  // 是否有學生已開始作答 — 鎖定影響計分的設定（播放音檔 / 題目呈現方式），避免改動 score_category
  const hasStudentsStarted = useMemo(
    () => studentProgress.some((sp) => sp.status !== "NOT_STARTED"),
    [studentProgress],
  );

  // Issue #1092: 評分設定（只有打字類小考）
  const isTypedQuiz = isTypedQuizMode(assignment?.practice_mode);
  const submittedCount = useMemo(
    () =>
      studentProgress.filter((sp) => SUBMITTED_STATUSES.has(sp.status)).length,
    [studentProgress],
  );
  const ready = !!detailData;
  // #1092: live 小考開考中（已開放、未收卷）—— 不能關閉「即時小考」
  const liveQuizOpen =
    !!detailData?.quiz_opened_at && !detailData?.quiz_closed_at;

  const loadContentDetail = async (contentId: number, forceReload = false) => {
    if (!forceReload && contentDetails[contentId]) return;
    if (loadingRef.current.has(contentId)) return;
    loadingRef.current.add(contentId);
    try {
      const detail = await apiClient.getContentDetail(contentId);
      setContentDetails((prev) => ({
        ...prev,
        [contentId]: detail as ContentDetail,
      }));
    } catch (error) {
      console.error("Failed to load content detail:", error);
    } finally {
      loadingRef.current.delete(contentId);
    }
  };

  // ─── #1092 改完即存 ───

  /** 失敗的欄位退回最後儲存值（含排隊中的較新變動） */
  const revertKeys = (keys: string[]) => {
    const base = autoSave.baseline();
    if (keys.includes("title")) setEditTitle((base.title as string) ?? "");
    if (keys.includes("description"))
      setEditInstructions((base.description as string) ?? "");
    if (keys.includes("due_date")) setEditDueDate(dateOnly(base.due_date));
    if (keys.includes("start_date"))
      setEditStartDate(dateOnly(base.start_date));
    const advancedKeys = ADVANCED_KEYS.filter((k) => keys.includes(k));
    if (advancedKeys.length > 0) {
      setEditAdvanced((prev) => {
        const next = { ...prev } as Record<string, unknown>;
        advancedKeys.forEach((k) => {
          next[k] = base[k];
        });
        return next as unknown as AdvancedSettings;
      });
    }
    if (SCORING_KEYS.some((k) => keys.includes(k))) {
      setEditScoring(quizScoringFromDetail(base));
    }
  };

  /** 儲存失敗提示（保留既有 422 提示；live 開考中關閉的 400 另有提示）。 */
  const toastSaveError = (error: unknown, keys: string[]) => {
    // 同一次合併送出的失敗會 reject 給多個呼叫端 → 用固定 id 避免重複 toast
    const id = "assignment-settings-save-error";
    // Issue #1092: 後端擋下評分設定不完整
    const scoringCode = quizScoringErrorCode(error);
    if (scoringCode) {
      toast.error(
        t(
          scoringCode === "QUIZ_SCORING_POINTS_REQUIRED"
            ? "quizScoring.errors.pointsRequired"
            : "quizScoring.errors.methodRequired",
        ),
        { id },
      );
      return;
    }
    if (error instanceof ApiError && error.status === 422) {
      const detail = error.detail as {
        code?: string;
        content_titles?: string[];
      } | null;
      // Issue #757: play_audio 切到 True 時副本缺例句音檔
      if (detail?.code === "EXAMPLE_AUDIO_REQUIRED") {
        const titles = detail.content_titles?.join("、") || "";
        toast.error(t("dialogs.assignmentDialog.errors.missingAudio"), {
          id,
          description: t("dialogs.assignmentDialog.errors.missingAudioDesc", {
            contents: titles,
          }),
        });
        return;
      }
      // Issue #632 / #860: 副本缺克漏字答案，提示老師回編輯內容補齊
      if (detail?.code === "CLOZE_ANSWER_REQUIRED") {
        const titles = detail.content_titles?.join("、") || "";
        toast.error(t("dialogs.assignmentDialog.errors.missingClozeAnswer"), {
          id,
          description: t(
            "dialogs.assignmentDialog.errors.missingClozeAnswerDesc",
            { contents: titles },
          ),
        });
        return;
      }
    }
    // Issue #835: live 小考開考中不能關閉即時小考（先收卷）
    if (
      error instanceof ApiError &&
      error.status === 400 &&
      keys.includes("is_live_quiz")
    ) {
      toast.error(t("assignmentDetail.sheet.liveQuizOpenHint"), { id });
      return;
    }
    toast.error(t("assignmentDetail.messages.updateError", "儲存失敗"), { id });
  };

  /**
   * 排進自動儲存佇列。成功回結果、沒差異回 null、失敗回 false（已退回欄位並提示）。
   */
  const save = async (
    section: AutoSaveSection,
    next: PatchBody,
  ): Promise<AutoSaveResult<PatchResponse> | null | false> => {
    try {
      return await autoSave.saveFields(section, next);
    } catch (error) {
      const keys = Object.keys(next);
      revertKeys(keys);
      toastSaveError(error, keys);
      return false;
    }
  };

  const commitTitle = () => {
    if (!ready) return;
    const trimmed = editTitle.trim();
    if (!trimmed) {
      // 空白標題不存，退回最後儲存值
      setEditTitle((autoSave.baseline().title as string) ?? "");
      return;
    }
    if (trimmed !== editTitle) setEditTitle(trimmed);
    void save("basic", { title: trimmed });
  };

  const commitInstructions = () => {
    if (!ready) return;
    void save("basic", { description: editInstructions });
  };

  const commitDates = (start: string, due: string) => {
    if (!ready) return;
    if (start && due && start > due) {
      toast.error(
        t(
          "assignmentDetail.messages.startDateAfterDueDate",
          "開始日期不可晚於截止日期",
        ),
      );
      const base = autoSave.baseline();
      setEditStartDate(dateOnly(base.start_date));
      setEditDueDate(dateOnly(base.due_date));
      return;
    }
    void save("basic", {
      start_date: startDateBody(start),
      due_date: dueDateBody(due),
    });
  };

  const commitAdvanced = (next: AdvancedSettings) => {
    if (!ready) return;
    void save("advanced", next as unknown as PatchBody);
  };

  /** 送出評分設定；有重算就提示、重抓進度並讓班級頁更新。 */
  const performScoringSave = async (next: QuizScoringSettings) => {
    const result = await save("scoring", quizScoringPayload(next));
    if (!result) return;
    const recomputed = result.response?.recomputed_count ?? 0;
    void fetchProgress();
    if (recomputed > 0) {
      toast.success(t("quizScoring.recomputed", { count: recomputed }));
      onAssignmentUpdated?.();
    }
  };

  /**
   * 評分設定「可以存了」：設定完整且有效值與最後儲存值不同才存；已有人交卷（或進度不明）
   * 先跳確認。`allowConfirm=false`（關閉 sheet 時）需要確認的就不存。
   */
  const attemptScoringSave = (
    next: QuizScoringSettings,
    allowConfirm = true,
  ) => {
    if (!isTypedQuiz || !ready) return;
    if (!isQuizScoringComplete(next)) return;
    const saved = quizScoringFromDetail(autoSave.baseline());
    if (!quizScoringChanged(saved, next)) return;
    if (!progressLoaded || submittedCount > 0) {
      if (!allowConfirm) return;
      pendingScoringRef.current = next;
      setConfirmRecomputeOpen(true);
      return;
    }
    void performScoringSave(next);
  };

  const handleScoringChange = (next: QuizScoringSettings) => {
    const prev = editScoringRef.current;
    editScoringRef.current = next;
    setEditScoring(next);
    // 扣分打字中不存（等失焦）；換方式／大小寫立即嘗試
    const pointsOnly =
      next.method === prev.method && next.caseSensitive === prev.caseSensitive;
    if (!pointsOnly) attemptScoringSave(next);
  };

  const handleConfirmOpenChange = (nextOpen: boolean) => {
    setConfirmRecomputeOpen(nextOpen);
    if (!nextOpen && pendingScoringRef.current) {
      // 取消：評分方式退回最後儲存值
      pendingScoringRef.current = null;
      setEditScoring(quizScoringFromDetail(autoSave.baseline()));
    }
  };

  /** 關閉前：commit 尚未失焦的輸入、等佇列送完，有存過才通知班級頁重抓。 */
  const requestClose = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    try {
      if (ready) {
        commitTitle();
        commitInstructions();
        commitDates(editStartDate, editDueDate);
        attemptScoringSave(editScoringRef.current, false);
      }
      await autoSave.flush();
    } finally {
      closingRef.current = false;
      setClosing(false);
    }
    if (autoSave.hasSaved() || listDirtyRef.current) {
      listDirtyRef.current = false;
      onAssignmentUpdated?.();
    }
    onOpenChange(false);
  };

  const handleSheetOpenChange = (nextOpen: boolean) => {
    if (nextOpen) onOpenChange(true);
    else void requestClose();
  };

  const handleSaveStudents = async () => {
    if (!assignment || !pendingStudentIds) return;
    setSavingStudents(true);
    try {
      await apiClient.patch(`/api/teachers/assignments/${assignment.id}`, {
        student_ids: pendingStudentIds,
      });
      toast.success(t("assignmentDetail.messages.updateSuccess", "派發已更新"));
      setIsEditingStudents(false);
      setPendingStudentIds(null);
      listDirtyRef.current = true;
    } catch {
      toast.error(t("assignmentDetail.messages.updateError", "更新失敗"));
      setSavingStudents(false);
      return;
    }
    try {
      // #1092: 只更新派發相關資料（學生名單／進度），不覆蓋正在編輯的欄位
      const [detail, progress] = await Promise.all([
        apiClient.get<Record<string, unknown>>(
          `/api/teachers/assignments/${assignment.id}`,
        ),
        apiClient.get(`/api/teachers/assignments/${assignment.id}/progress`),
      ]);
      setDetailData((prev) =>
        prev ? { ...prev, student_ids: detail.student_ids } : prev,
      );
      setProgressLoaded(true);
      setStudentProgress(progressList(progress));
    } catch {
      // 重抓失敗不影響已儲存的派發；下次開啟會重新載入
    } finally {
      setSavingStudents(false);
    }
  };

  const getContentTypeBadge = () => {
    if (!assignment) return { label: "", className: "" };
    const contentType = assignment.content_type?.toUpperCase();
    const practiceMode = assignment.practice_mode;

    if (contentType === "VOCABULARY_SET" || contentType === "SENTENCE_MAKING") {
      // 依 practice_mode 取正確標籤（含三種小考）；未知才退回「單字集」
      const key = practiceModeLabelKey(practiceMode);
      return {
        label: key ? t(key) : t("classroomDetail.contentTypes.VOCABULARY_SET"),
        className: practiceModeBadgeClass(practiceMode),
      };
    }

    if (
      contentType === "EXAMPLE_SENTENCES" ||
      contentType === "READING_ASSESSMENT"
    ) {
      if (practiceMode === "rearrangement") {
        return {
          label: t("practiceMode.rearrangement.label"),
          className:
            "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
        };
      }
      return {
        label: t("practiceMode.reading.label"),
        className:
          "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
      };
    }

    const otherTypeLabels: Record<
      string,
      { label: string; className: string }
    > = {
      SPEAKING_PRACTICE: {
        label: t("classroomDetail.contentTypes.speakingPractice"),
        className:
          "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
      },
      SPEAKING_SCENARIO: {
        label: t("classroomDetail.contentTypes.speakingScenario"),
        className:
          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      },
      LISTENING_CLOZE: {
        label: t("classroomDetail.contentTypes.listeningCloze"),
        className:
          "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
      },
      SPEAKING_QUIZ: {
        label: t("classroomDetail.contentTypes.speakingQuiz"),
        className:
          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
      },
    };

    return (
      otherTypeLabels[contentType || ""] || {
        label: t("classroomDetail.labels.unknownType"),
        className:
          "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
      }
    );
  };

  const getContentTypeLabel = (type: string) => {
    const upper = type.toUpperCase();
    if (upper === "VOCABULARY_SET" || upper === "SENTENCE_MAKING") {
      return t("classroomDetail.contentTypes.VOCABULARY_SET", "單字集");
    }
    if (upper === "READING_ASSESSMENT" || upper === "EXAMPLE_SENTENCES") {
      return t("classroomDetail.contentTypes.SPEAKING", "例句朗讀");
    }
    return type;
  };

  if (!assignment) return null;

  const completionRate = assignment.completion_rate || 0;
  const typeBadge = getContentTypeBadge();
  // 自動計分模式不需手動批改鈕；改用 registry 的 isAutoScoredMode（含三種小考，修舊本地 set 漏列）。
  const showGradingButtons = !isAutoScoredMode(assignment.practice_mode);
  // #1092: 指派人數以詳情的 student_ids 為準（派發儲存後會更新），載入前用 prop 佔位
  const studentCount = Array.isArray(detailData?.student_ids)
    ? (detailData.student_ids as unknown[]).length
    : assignment.student_count;
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg md:max-w-xl lg:max-w-2xl p-0 flex flex-col"
          onEscapeKeyDown={(e) => {
            if (editingContentId) {
              e.preventDefault();
              setEditingContentId(null);
            }
          }}
        >
          {/* Header */}
          <SheetHeader className="px-6 pt-6 pb-4 border-b dark:border-gray-700">
            <SheetTitle className="text-lg">
              {t("assignmentDetail.sheet.viewTitle", "作業設定")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {editTitle || assignment.title}
            </SheetDescription>
          </SheetHeader>

          {/* Content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-5 space-y-5">
            <div className="space-y-5">
              {/* ─── 基本資訊：標題、類型、說明 ─── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="assignment-settings-title"
                    className="text-xs font-medium text-gray-500 dark:text-gray-400"
                  >
                    {t("assignmentDetail.sheet.titleLabel", "作業標題")}
                  </label>
                  <SaveIndicator state={autoSave.saveStates.basic} />
                </div>
                <Input
                  id="assignment-settings-title"
                  value={editTitle}
                  disabled={!ready}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={blurOnEnter}
                  className="text-base font-semibold"
                />
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="secondary" className={typeBadge.className}>
                    {typeBadge.label}
                  </Badge>
                </div>
                <label
                  htmlFor="assignment-settings-instructions"
                  className="block text-xs font-medium text-gray-500 dark:text-gray-400 pt-1"
                >
                  {t("assignmentDetail.sheet.instructionsLabel", "作業說明")}
                </label>
                <Textarea
                  id="assignment-settings-instructions"
                  value={editInstructions}
                  disabled={!ready}
                  onChange={(e) => setEditInstructions(e.target.value)}
                  onBlur={commitInstructions}
                  rows={3}
                />
              </div>

              {/* Grading Buttons */}
              {showGradingButtons && (
                <div className="flex gap-2">
                  <Button
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
                    onClick={() => onGradeClick?.(assignment.id)}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {t("assignmentDetail.buttons.gradeAssignment", "批改作業")}
                  </Button>
                  {canUseAiGrading && (
                    <Button
                      className="flex-1 bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-600 dark:hover:bg-purple-700 dark:text-white"
                      onClick={() => onBatchGradeClick?.(assignment.id)}
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      {t("assignmentDetail.buttons.batchGrade", "AI 批改")}
                    </Button>
                  )}
                </div>
              )}

              {/* Stats grid（#1092：開始／截止日期卡可直接修改） */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 min-w-0">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("classroomDetail.labels.assignedTo")}
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {studentCount
                      ? t("classroomDetail.labels.studentCountWithUnit", {
                          count: studentCount,
                        })
                      : t("classroomDetail.labels.allClass")}
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 min-w-0">
                  <label
                    htmlFor="assignment-settings-start-date"
                    className="block text-xs text-gray-500 dark:text-gray-400"
                  >
                    {t("assignmentDetail.sheet.startDateLabel", "開始日期")}
                  </label>
                  <Input
                    id="assignment-settings-start-date"
                    type="date"
                    value={editStartDate}
                    disabled={!ready}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    onBlur={() => commitDates(editStartDate, editDueDate)}
                    onKeyDown={blurOnEnter}
                    className="mt-1 h-8 w-full min-w-0 px-2 text-sm font-semibold bg-white dark:bg-gray-900"
                  />
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 min-w-0">
                  <label
                    htmlFor="assignment-settings-due-date"
                    className="block text-xs text-gray-500 dark:text-gray-400"
                  >
                    {t("classroomDetail.labels.dueDate")}
                  </label>
                  <Input
                    id="assignment-settings-due-date"
                    type="date"
                    value={editDueDate}
                    disabled={!ready}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    onBlur={() => commitDates(editStartDate, editDueDate)}
                    onKeyDown={blurOnEnter}
                    className="mt-1 h-8 w-full min-w-0 px-2 text-sm font-semibold bg-white dark:bg-gray-900"
                  />
                  {!editDueDate && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t("classroomDetail.labels.noDeadline")}
                    </div>
                  )}
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 min-w-0">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("classroomDetail.labels.completionProgress")}
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {completionRate}%
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 min-w-0">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("assignmentDetail.sheet.averageScore", "平均分數")}
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {averageScoreDisplay}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-500 dark:bg-green-600 h-2 rounded-full transition-all"
                  style={{ width: `${completionRate}%` }}
                />
              </div>

              {/* ─── 進階設定（一改就存；滑桿放開才存） ─── */}
              {assignment.practice_mode && (
                <div className="relative">
                  <div className="absolute top-3 right-3 z-10">
                    <SaveIndicator state={autoSave.saveStates.advanced} />
                  </div>
                  <PracticeModeSettingsPanel
                    mode={assignment.practice_mode}
                    value={editAdvanced}
                    onChange={setEditAdvanced}
                    onCommit={commitAdvanced}
                    disabled={!ready}
                    context={{ locked: hasStudentsStarted, liveQuizOpen }}
                  />
                </div>
              )}

              {/* ─── Issue #1092: 打字類小考評分方式（學生已作答仍可改，改了會重算已交卷者） ─── */}
              {isTypedQuiz &&
                assignment.practice_mode &&
                (ready ? (
                  <div className="relative">
                    <div className="absolute top-3 right-3 z-10">
                      <SaveIndicator state={autoSave.saveStates.scoring} />
                    </div>
                    <QuizScoringMethodField
                      value={editScoring}
                      onChange={handleScoringChange}
                      onPointsBlur={() =>
                        attemptScoringSave(editScoringRef.current)
                      }
                      practiceMode={assignment.practice_mode}
                      contentIds={assignmentContents.map((c) => c.id)}
                      idPrefix="edit-quiz-scoring"
                    />
                  </div>
                ) : (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  </div>
                ))}

              {/* Assignment Contents */}
              {assignmentContents.length > 0 && (
                <div className="border dark:border-gray-700 rounded-lg">
                  <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
                    <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {t("assignmentDetail.sheet.contentTitle", "作業單元內容")}{" "}
                      ({assignmentContents.length})
                    </h4>
                  </div>
                  <div className="p-3 space-y-2">
                    {assignmentContents.map((content, index) => (
                      <div
                        key={content.id}
                        className="border dark:border-gray-700 rounded-lg p-3 hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0 flex-wrap">
                            <span className="text-sm font-bold text-blue-600 flex-shrink-0">
                              #{index + 1}
                            </span>
                            <span className="font-medium text-sm truncate">
                              {content.title}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-xs flex-shrink-0"
                            >
                              {getContentTypeLabel(content.type || "")}
                            </Badge>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (expandedContentId === content.id) {
                                  setExpandedContentId(null);
                                } else {
                                  setExpandedContentId(content.id);
                                  loadContentDetail(content.id);
                                }
                              }}
                              className="text-blue-600 hover:text-blue-700 text-xs px-2"
                            >
                              <ChevronRight
                                className={`h-4 w-4 transition-transform ${
                                  expandedContentId === content.id
                                    ? "rotate-90"
                                    : ""
                                }`}
                              />
                              <span className="ml-1">
                                {t("common.expand", "展開")}
                              </span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingContentId(content.id);
                                loadContentDetail(content.id);
                              }}
                              className="text-orange-600 hover:text-orange-700 border-orange-200 hover:bg-orange-50 text-xs px-2"
                            >
                              <Edit2 className="h-3.5 w-3.5 mr-1" />
                              {t("common.edit", "編輯")}
                            </Button>
                          </div>
                        </div>
                        {/* Expanded content detail */}
                        {expandedContentId === content.id &&
                          contentDetails[content.id] && (
                            <div className="mt-3 space-y-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                              <div className="text-sm">
                                <span className="text-gray-600 dark:text-gray-300">
                                  {t(
                                    "assignmentDetail.sheet.questionCount",
                                    "題目數量：",
                                  )}
                                </span>
                                <span className="font-medium ml-2">
                                  {contentDetails[content.id].items?.length ||
                                    0}{" "}
                                  {t("assignmentDetail.sheet.itemCount", "題")}
                                </span>
                              </div>
                              <div className="space-y-1 max-h-60 overflow-y-auto">
                                {contentDetails[content.id].items?.map(
                                  (item, idx) => (
                                    <div
                                      key={item.id}
                                      className="text-xs p-2 bg-white dark:bg-gray-800 rounded"
                                    >
                                      <span className="text-gray-600 dark:text-gray-400">
                                        {idx + 1}.
                                      </span>{" "}
                                      <span className="font-medium">
                                        {item.text}
                                      </span>
                                      {item.translation && (
                                        <span className="text-gray-500 ml-2">
                                          ({item.translation})
                                        </span>
                                      )}
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Student Status Panel（派發仍需按面板內的「儲存派發」） */}
            <StudentStatusPanel
              students={studentProgress}
              assignmentId={assignment?.id ?? 0}
              classroomId={classroomId}
              practiceMode={assignment?.practice_mode ?? undefined}
              isEditingStudents={isEditingStudents}
              onEditingStudentsChange={setIsEditingStudents}
              onStudentIdsChanged={setPendingStudentIds}
              onSave={handleSaveStudents}
              saving={savingStudents}
              loading={loading}
            />
          </div>

          {/* Footer（#1092：只剩關閉；派發按鈕在學生名單面板內） */}
          <div className="border-t dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => void requestClose()}
              disabled={closing}
            >
              {closing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {t("common.close", "關閉")}
            </Button>
          </div>

          {/* Content Edit Overlay — inside SheetContent to stay within Radix focus trap */}
          {editingContentId &&
            contentDetails[editingContentId] &&
            (() => {
              const editingDetail = contentDetails[editingContentId];
              const isVocabSet = ["VOCABULARY_SET", "SENTENCE_MAKING"].includes(
                editingDetail?.type?.toUpperCase() ?? "",
              );
              const handleEditSave = async () => {
                const savedContentId = editingContentId;
                setEditingContentId(null);
                if (savedContentId) {
                  setContentDetails((prev) => {
                    const updated = { ...prev };
                    delete updated[savedContentId];
                    return updated;
                  });
                  await loadContentDetail(savedContentId, true);
                }
              };

              return (
                <div
                  ref={contentEditPanelRef}
                  tabIndex={-1}
                  className="fixed inset-0 z-[60] flex outline-none"
                >
                  {/* Backdrop — click to cancel */}
                  <div
                    className="absolute inset-0 bg-black/30"
                    onClick={() => setEditingContentId(null)}
                  />
                  {/* Panel */}
                  <div
                    className="absolute top-0 right-0 h-full bg-white dark:bg-gray-950 shadow-xl border-l flex flex-col"
                    style={{ left: `${sidebarWidth}px` }}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 dark:bg-gray-800">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {t(
                            "assignmentDetail.labels.editContent",
                            "編輯作業內容",
                          )}
                        </h2>
                        <p className="text-sm text-amber-600 mt-1">
                          ⚠️{" "}
                          {t(
                            "assignmentDetail.sheet.editContentWarning",
                            "注意：此為作業副本。刪除已有學生進度的題目將被阻止。",
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingContentId(null)}
                        >
                          {t("common.cancel", "取消")}
                        </Button>
                        <RefSaveButton
                          panelRef={
                            isVocabSet ? vocabPanelRef : readingPanelRef
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingContentId(null);
                            void requestClose();
                          }}
                          className="hover:bg-gray-200"
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                      {isVocabSet ? (
                        <VocabularySetPanel
                          ref={vocabPanelRef}
                          content={{
                            id: editingContentId,
                            title: editingDetail.title || "",
                          }}
                          editingContent={editingDetail as never}
                          onUpdateContent={async () => {}}
                          onSave={handleEditSave}
                          lessonId={0}
                          isCreating={false}
                          isAssignmentCopy={true}
                          showOptionImages={editAdvanced.show_option_images}
                        />
                      ) : (
                        <ReadingAssessmentPanel
                          ref={readingPanelRef}
                          content={{
                            id: editingContentId,
                            title: editingDetail.title || "",
                          }}
                          editingContent={editingDetail as never}
                          onUpdateContent={async () => {}}
                          onSave={handleEditSave}
                          lessonId={0}
                          isCreating={false}
                          isAssignmentCopy={true}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
        </SheetContent>
      </Sheet>

      {/* Issue #1092: 改評分方式且已有人交卷 → 確認後才 PATCH 重算；取消退回最後儲存值。
          Radix Dialog 疊在 Sheet 上會接手 focus trap（Esc / 取消只關確認視窗，不關 Sheet）。 */}
      <ConfirmDialog
        open={confirmRecomputeOpen}
        onOpenChange={handleConfirmOpenChange}
        title={t("quizScoring.confirm.title")}
        description={
          progressLoaded
            ? t("quizScoring.confirm.description", { count: submittedCount })
            : // 進度沒載入成功：不知道人數，用不帶數字的說法
              t("quizScoring.confirm.descriptionUnknownCount")
        }
        confirmText={t("quizScoring.confirm.confirm")}
        cancelText={t("quizScoring.confirm.cancel")}
        onConfirm={() => {
          const next = pendingScoringRef.current;
          pendingScoringRef.current = null;
          if (next) void performScoringSave(next);
        }}
      />
    </>
  );
}
