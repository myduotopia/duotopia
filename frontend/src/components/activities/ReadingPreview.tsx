/**
 * ReadingPreview — 派發 sheet 內的 reading 即時預覽
 *
 * 從派發目標教材 (contentId) 抓 /api/teachers/contents/{contentId}，
 * 依 content.type 自行組成單一 Activity (items[]) 餵給 StudentActivityPageContent
 * 走 isDemoMode + isPreviewMode 路徑，內部 GroupedQuestionsTemplate 會用 items
 * 渲染朗讀題目，不會打任何後端 preview 路徑。
 *
 * 取材規則（與 backend ensure_example_sentence_audio / student preview 一致）：
 * - VOCABULARY_SET（單字集）→ 取 item.example_sentence + example_sentence_audio_url
 * - EXAMPLE_SENTENCES（例句集）→ 取 item.text + item.audio_url
 *
 * 已知限制：單字集若缺 example_sentence_audio_url，預覽該題暫無音檔，
 * 實際派發時 backend 會 lazy 生成 TTS（issue #797 phase 2 不在此範圍）。
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState } from "react";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import StudentActivityPageContent, {
  type Activity,
} from "@/pages/student/StudentActivityPageContent";

interface ReadingPreviewProps {
  contentId: number;
  shuffleQuestions?: boolean;
  timeLimitPerQuestion?: number;
}

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

export default function ReadingPreview({
  contentId,
  shuffleQuestions,
  timeLimitPerQuestion,
}: ReadingPreviewProps) {
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
          audio_url: isVocab
            ? item.example_sentence_audio_url
            : item.audio_url,
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
