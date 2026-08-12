/**
 * ReadingPreview — 派發 sheet 內的 reading 即時預覽
 *
 * 兩條路徑：
 * 1. 已知教材（內容卡派發）：傳入 contentId → 走 ByContent 子元件，
 *    打 /api/teachers/contents/{contentId} 並依 content.type 自組 Activity items。
 * 2. 未知教材（Assign New Homework 未選 cart）：contentId 為 undefined →
 *    走 ByDemo 子元件，沿用既有 demoApi.getConfig + getPreview 路徑（保證有句子可預覽）。
 *
 * 取材規則（ByContent 分支，與 backend / student 端一致）：
 * - VOCABULARY_SET → 取 item.example_sentence + example_sentence_audio_url
 * - EXAMPLE_SENTENCES → 取 item.text + item.audio_url
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState } from "react";
import { demoApi, type DemoAccessStatus } from "@/lib/demoApi";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import StudentActivityPageContent, {
  type Activity,
} from "@/pages/student/StudentActivityPageContent";

interface ReadingPreviewProps {
  /** 已知教材時傳入；未傳則走 demo 預覽 */
  contentId?: number;
  shuffleQuestions?: boolean;
  timeLimitPerQuestion?: number;
  /** #880: 顯示句子中文翻譯（預設顯示，與學生端一致） */
  showTranslation?: boolean;
}

export default function ReadingPreview(props: ReadingPreviewProps) {
  if (props.contentId == null) {
    return (
      <ReadingPreviewByDemo
        shuffleQuestions={props.shuffleQuestions}
        showTranslation={props.showTranslation}
      />
    );
  }
  return (
    <ReadingPreviewByContent
      contentId={props.contentId}
      shuffleQuestions={props.shuffleQuestions}
      timeLimitPerQuestion={props.timeLimitPerQuestion}
      showTranslation={props.showTranslation}
    />
  );
}

// ---------------------------------------------------------------------------
// ByContent — 已知教材路徑（Phase 2）
// ---------------------------------------------------------------------------

interface RawContentItem {
  id: number;
  text?: string;
  translation?: string;
  audio_url?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_audio_url?: string;
}

interface ContentResponse {
  id: number;
  type: string;
  title: string;
  items: RawContentItem[];
}

const VOCAB_TYPES = new Set(["VOCABULARY_SET", "SENTENCE_MAKING"]);

function ReadingPreviewByContent({
  contentId,
  shuffleQuestions,
  timeLimitPerQuestion,
  showTranslation,
}: {
  contentId: number;
  shuffleQuestions?: boolean;
  timeLimitPerQuestion?: number;
  showTranslation?: boolean;
}) {
  const { token } = useTeacherAuthStore();
  const [data, setData] = useState<ContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const resp = await fetch(
          `${apiUrl}/api/teachers/contents/${contentId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = (await resp.json()) as ContentResponse;
        if (!cancelled) {
          setData(body);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load preview");
          setLoading(false);
        }
      }
    }
    if (token) load();
    return () => {
      cancelled = true;
    };
  }, [contentId, token]);

  const activities = useMemo<Activity[]>(() => {
    if (!data) return [];
    const isVocab = VOCAB_TYPES.has(data.type?.toUpperCase());
    const items = (data.items || [])
      .map((item) => {
        const text = isVocab ? item.example_sentence : item.text;
        if (!text) return null;
        return {
          id: item.id,
          text,
          translation: isVocab
            ? item.example_sentence_translation
            : item.translation,
          audio_url: isVocab ? item.example_sentence_audio_url : item.audio_url,
        };
      })
      .filter((i): i is NonNullable<typeof i> => i !== null);

    return [
      {
        id: 0,
        content_id: data.id,
        order: 1,
        type: isVocab ? "VOCABULARY_SET" : "EXAMPLE_SENTENCES",
        title: data.title,
        content: "",
        target_text: "",
        duration: 0,
        points: 100,
        status: "NOT_STARTED",
        score: null,
        completed_at: null,
        items,
      },
    ];
  }, [data]);

  if (!token) {
    return (
      <div className="p-4 text-sm text-gray-500">
        Preview unavailable (no teacher token)
      </div>
    );
  }
  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading preview…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-4 text-sm text-red-600">
        Preview error: {error || "no data"}
      </div>
    );
  }
  if (activities[0]?.items?.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 border border-dashed border-gray-200 rounded">
        此教材沒有可預覽的例句
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {shuffleQuestions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <StudentActivityPageContent
        activities={activities}
        assignmentTitle={data.title}
        assignmentId={0}
        practiceMode="reading"
        showAnswer={false}
        showTranslation={showTranslation ?? true}
        timeLimitPerQuestion={timeLimitPerQuestion ?? 0}
        isDemoMode={true}
        isPreviewMode={true}
        canUseAiAnalysis={false}
        onBack={() => {}}
        onSubmit={async () => {}}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ByDemo — 未知教材路徑（Phase 2 之前的程式碼）
// ---------------------------------------------------------------------------

interface DemoActivityResponse {
  assignment_id: number;
  title: string;
  practice_mode?: string | null;
  show_answer?: boolean;
  time_limit_per_question?: number;
  // #989: demo_config 指向的作業若被設了 start_date / due_date，preview 會回
  // access_status !== "active" 且不帶 activities。這裡是老師端的教材預覽，
  // 沒有引導畫面可走，所以直接報錯，避免顯示成「此作業尚無題目」。
  access_status?: DemoAccessStatus;
  total_activities: number;
  activities: Activity[];
}

function ReadingPreviewByDemo({
  shuffleQuestions,
  showTranslation,
}: {
  shuffleQuestions?: boolean;
  showTranslation?: boolean;
}) {
  const [data, setData] = useState<DemoActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const config = await demoApi.getConfig();
        const idStr = config.demo_reading_assignment_id;
        if (!idStr) {
          throw new Error("Demo reading assignment ID not configured");
        }
        const resp = (await demoApi.getPreview(
          parseInt(idStr, 10),
        )) as DemoActivityResponse;
        if (resp.access_status && resp.access_status !== "active") {
          throw new Error(
            `Demo reading assignment is outside its access window (${resp.access_status})`,
          );
        }
        if (!cancelled) {
          setData(resp);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load preview");
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading preview…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-4 text-sm text-red-600">
        Preview error: {error || "no data"}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {shuffleQuestions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <StudentActivityPageContent
        activities={data.activities}
        assignmentTitle={data.title}
        assignmentId={data.assignment_id}
        practiceMode={data.practice_mode || null}
        showAnswer={data.show_answer || false}
        // #880: 派發面板的開關優先於 demo 資料，預覽才會跟著 toggle 即時變化
        showTranslation={showTranslation ?? true}
        timeLimitPerQuestion={data.time_limit_per_question ?? 0}
        isDemoMode={true}
        isPreviewMode={true}
        onBack={() => {}}
        onSubmit={async () => {}}
      />
    </div>
  );
}
