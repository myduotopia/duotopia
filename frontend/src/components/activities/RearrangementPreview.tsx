/**
 * RearrangementPreview — 派發 sheet 內的 rearrangement 即時預覽
 *
 * 從指定的 EXAMPLE_SENTENCES content 抓例句，前端把每句切成單字並洗牌，
 * 餵給 RearrangementActivity 的 previewQuestions 路徑，不打 student/preview/demo
 * 任何 API。
 */
import { useEffect, useMemo, useState } from "react";
import RearrangementActivity, {
  type RearrangementQuestion,
} from "./RearrangementActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface RearrangementPreviewProps {
  contentId: number;
  settings: {
    play_audio?: boolean;
    show_answer?: boolean;
    time_limit_per_question?: number;
    shuffle_questions?: boolean;
  };
}

interface ContentItem {
  id: number;
  text: string;
  translation?: string;
  audio_url?: string;
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function RearrangementPreview({
  contentId,
  settings,
}: RearrangementPreviewProps) {
  const { token } = useTeacherAuthStore();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchContent() {
      setLoading(true);
      setError(null);
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const resp = await fetch(`${apiUrl}/api/teachers/contents/${contentId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!cancelled) {
          setItems(data.items || []);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load preview");
          setLoading(false);
        }
      }
    }
    if (token) fetchContent();
    return () => {
      cancelled = true;
    };
  }, [contentId, token]);

  const previewQuestions = useMemo<RearrangementQuestion[]>(() => {
    const timeLimit = settings.time_limit_per_question ?? 30;
    return items
      .filter((item) => item.text)
      .map((item) => {
        // 去除話者前綴（如「Jamie:」）讓單字數比較合理
        const cleanText = item.text.replace(/^[A-Za-z]+:\s*/, "");
        const words = cleanText.split(/\s+/).filter(Boolean);
        return {
          content_item_id: item.id,
          shuffled_words: shuffleArray(words),
          word_count: words.length,
          max_errors: 3,
          time_limit: timeLimit > 0 ? timeLimit : 30,
          play_audio: settings.play_audio ?? false,
          audio_url: item.audio_url,
          translation: item.translation,
          original_text: cleanText,
        };
      });
  }, [items, settings.time_limit_per_question, settings.play_audio]);

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
  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">Preview error: {error}</div>
    );
  }
  if (previewQuestions.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        此教材沒有可用的例句，無法產生重組預覽
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {settings.shuffle_questions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <RearrangementActivity
        studentAssignmentId={0}
        previewQuestions={previewQuestions}
        showAnswer={settings.show_answer}
      />
    </div>
  );
}
