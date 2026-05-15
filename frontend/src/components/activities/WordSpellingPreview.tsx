/**
 * WordSpellingPreview — 派發 sheet 內的 word_spelling 即時預覽
 *
 * 從指定的公開 content_id 抓單字，餵給 WordSpellingActivity 的
 * previewWords / previewSettings 路徑，不打 student/preview/demo 任何 API。
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState } from "react";
import WordSpellingActivity from "./WordSpellingActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface WordSpellingPreviewProps {
  contentId: number;
  settings: {
    show_translation?: boolean;
    show_image?: boolean;
    play_audio?: boolean;
    show_answer?: boolean;
    target_proficiency?: number;
    time_limit_per_question?: number;
    shuffle_questions?: boolean;
  };
}

interface ContentItem {
  id: number;
  text: string;
  translation?: string;
  audio_url?: string;
  image_url?: string;
  part_of_speech?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_audio_url?: string;
}

interface SpellingWord {
  content_item_id: number;
  text: string;
  translation: string;
  audio_url?: string;
  image_url?: string;
  memory_strength: number;
  part_of_speech?: string | null;
  example_sentence?: string | null;
  example_sentence_translation?: string | null;
  example_sentence_audio_url?: string | null;
}

export default function WordSpellingPreview({
  contentId,
  settings,
}: WordSpellingPreviewProps) {
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

  const previewWords = useMemo<SpellingWord[]>(
    () =>
      items.map((item) => ({
        content_item_id: item.id,
        text: item.text,
        translation: item.translation || "",
        audio_url: item.audio_url,
        image_url: item.image_url,
        memory_strength: 0,
        part_of_speech: item.part_of_speech ?? null,
        example_sentence: item.example_sentence ?? null,
        example_sentence_translation: item.example_sentence_translation ?? null,
        example_sentence_audio_url: item.example_sentence_audio_url ?? null,
      })),
    [items],
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
      <WordSpellingActivity
        assignmentId={0}
        previewWords={previewWords}
        previewSettings={{
          show_translation: settings.show_translation,
          show_image: settings.show_image,
          play_audio: settings.play_audio,
          show_answer: settings.show_answer,
          target_proficiency: settings.target_proficiency,
          time_limit_per_question: settings.time_limit_per_question ?? null,
        }}
      />
    </div>
  );
}
