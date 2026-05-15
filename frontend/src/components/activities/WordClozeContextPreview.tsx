/**
 * WordClozeContextPreview — 派發 sheet 內的 word_cloze 即時預覽
 *
 * 從指定的 vocab content 抓單字 + example_sentence，前端把例句中的單字
 * 替換成空格組成 cloze 題，餵給 WordClozeActivity 的 previewQuestions /
 * previewSettings 路徑，不打 student/preview/demo 任何 API。
 */
import { useEffect, useMemo, useState } from "react";
import WordClozeActivity from "./WordClozeActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface WordClozeContextPreviewProps {
  contentId: number;
  settings: {
    show_translation?: boolean;
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
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_audio_url?: string;
  part_of_speech?: string;
}

interface ClozeQuestion {
  content_item_id: number;
  base_word: string;
  translation: string;
  blanked_sentence: string;
  sentence_translation: string;
  audio_url?: string;
  correct_answer: string;
  correct_answer_length: number;
  part_of_speech?: string | null;
  example_sentence?: string | null;
  example_sentence_translation?: string | null;
  example_sentence_audio_url?: string | null;
  word_audio_url?: string | null;
}

function buildBlankedSentence(sentence: string, word: string): string {
  if (!sentence || !word) return sentence;
  // 不分大小寫替換第一次出現的整字（盡量），其餘位置交給 placeholder 顯示
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
  return sentence.replace(re, "_____");
}

export default function WordClozeContextPreview({
  contentId,
  settings,
}: WordClozeContextPreviewProps) {
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

  const previewQuestions = useMemo<ClozeQuestion[]>(
    () =>
      items
        .filter((item) => item.example_sentence) // 沒例句的單字無法做 cloze
        .map((item) => ({
          content_item_id: item.id,
          base_word: item.text,
          translation: item.translation || "",
          blanked_sentence: buildBlankedSentence(
            item.example_sentence || "",
            item.text,
          ),
          sentence_translation: item.example_sentence_translation || "",
          audio_url: item.example_sentence_audio_url,
          correct_answer: item.text,
          correct_answer_length: item.text.length,
          part_of_speech: item.part_of_speech ?? null,
          example_sentence: item.example_sentence ?? null,
          example_sentence_translation: item.example_sentence_translation ?? null,
          example_sentence_audio_url: item.example_sentence_audio_url ?? null,
          word_audio_url: item.audio_url ?? null,
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
  if (previewQuestions.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        此教材沒有可用的例句，無法產生克漏字預覽
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {settings.play_audio && (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
          🔊 預覽無法預聽音檔，正式作業可聽到音檔
        </div>
      )}
      {settings.shuffle_questions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <WordClozeActivity
        assignmentId={0}
        previewQuestions={previewQuestions}
        previewSettings={{
          show_translation: settings.show_translation,
          play_audio: settings.play_audio,
          show_answer: settings.show_answer,
          target_proficiency: settings.target_proficiency,
          time_limit_per_question: settings.time_limit_per_question ?? null,
        }}
      />
    </div>
  );
}
