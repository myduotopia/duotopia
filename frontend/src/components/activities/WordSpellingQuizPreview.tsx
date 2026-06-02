/**
 * WordSpellingQuizPreview — 派發 sheet 內的 word_spelling_quiz 即時預覽
 *
 * 從指定的公開 content_id 抓單字，餵給 WordSpellingQuizActivity 的
 * previewWords / previewSettings 路徑，不打 student/preview/demo 任何 API。
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState } from "react";
import WordSpellingQuizActivity from "./WordSpellingQuizActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface Props {
  contentId: number;
  settings: {
    show_translation?: boolean;
    show_image?: boolean;
    play_audio?: boolean;
    show_answer?: boolean;
    time_limit_per_question?: number;
    shuffle_questions?: boolean;
  };
}

interface ApiItem {
  id: number;
  text: string;
  translation?: string;
  audio_url?: string;
  image_url?: string;
}

interface QuizWord {
  content_item_id: number;
  text: string;
  translation: string;
  audio_url?: string | null;
  image_url?: string | null;
  question_number: number;
}

export default function WordSpellingQuizPreview({
  contentId,
  settings,
}: Props) {
  const { token } = useTeacherAuthStore();
  const [items, setItems] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const resp = await fetch(
          `${apiUrl}/api/teachers/contents/${contentId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
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
    if (token) run();
    return () => {
      cancelled = true;
    };
  }, [contentId, token]);

  const previewWords = useMemo<QuizWord[]>(
    () =>
      items.map((item, idx) => ({
        content_item_id: item.id,
        text: item.text,
        translation: item.translation || "",
        audio_url: item.audio_url,
        image_url: item.image_url,
        question_number: idx + 1,
      })),
    [items],
  );

  const previewSettings = useMemo(
    () => ({
      show_translation: settings.show_translation,
      show_image: settings.show_image,
      play_audio: settings.play_audio,
      show_answer: settings.show_answer,
      time_limit_per_question: settings.time_limit_per_question ?? null,
    }),
    [
      settings.show_translation,
      settings.show_image,
      settings.play_audio,
      settings.show_answer,
      settings.time_limit_per_question,
    ],
  );

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

  return (
    <div className="space-y-2">
      {settings.shuffle_questions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <WordSpellingQuizActivity
        assignmentId={0}
        previewWords={previewWords}
        previewSettings={previewSettings}
      />
    </div>
  );
}
