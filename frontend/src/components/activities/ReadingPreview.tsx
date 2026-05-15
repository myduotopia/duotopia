/**
 * ReadingPreview — 派發 sheet 內的 reading 即時預覽
 *
 * 從指定的 EXAMPLE_SENTENCES content 抓第一句，餵給 ReadingAssessmentTemplate
 * （純 presentational）。預覽僅顯示一題，不做題目導覽。
 */
import { useEffect, useState } from "react";
import ReadingAssessmentTemplate from "./ReadingAssessmentTemplate";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface ReadingPreviewProps {
  contentId: number;
  settings: {
    time_limit_per_question?: number;
    shuffle_questions?: boolean;
  };
}

interface ContentItem {
  id: number;
  text: string;
  audio_url?: string;
}

export default function ReadingPreview({
  contentId,
  settings,
}: ReadingPreviewProps) {
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

  const first = items[0];
  if (!first) {
    return (
      <div className="p-4 text-sm text-gray-500">此教材沒有可預覽的例句</div>
    );
  }

  return (
    <div className="space-y-2">
      {settings.shuffle_questions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <div className="text-xs text-gray-500">
        預覽僅顯示第一題；學生實際作答會看到全部 {items.length} 題
      </div>
      <ReadingAssessmentTemplate
        content={first.text}
        targetText={first.text}
        exampleAudioUrl={first.audio_url}
        timeLimit={settings.time_limit_per_question ?? 0}
        canUseAiAnalysis={true}
        isLivePreview={true}
      />
    </div>
  );
}
