/**
 * WordClozeQuizPreview — 派發 sheet 內的 word_cloze_quiz 即時預覽
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import WordClozeQuizActivity from "./WordClozeQuizActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface Props {
  // #861 D: assignmentId（合併全部單字集、後端依 shuffle_questions 打亂）優先；
  // contentId（單一 content）為 AssignmentDialog 建立流程即時預覽的 fallback。
  assignmentId?: number;
  contentId?: number;
  settings: {
    show_translation?: boolean;
    show_image?: boolean;
    play_audio?: boolean;
    show_answer?: boolean;
    time_limit_per_question?: number;
    shuffle_questions?: boolean;
  };
  // #830: 老師預覽時注入每張卡底部「該題班級表現」%條（派發 sheet 不傳）。
  renderCardFooter?: (contentItemId: number) => ReactNode;
}

interface ApiItem {
  id: number;
  text: string;
  translation?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_audio_url?: string;
  cloze_answer?: string;
  audio_url?: string;
  image_url?: string;
}

interface QuizWord {
  content_item_id: number;
  text: string;
  translation: string;
  example_sentence: string;
  example_sentence_translation: string;
  example_sentence_audio_url?: string | null;
  cloze_answer: string;
  image_url?: string | null;
  audio_url?: string | null;
  question_number: number;
}

// 後端 /preview/cloze-quiz-start 回傳的題目形狀（#861 D）
interface ServerQuizWord {
  content_item_id: number;
  text: string;
  translation?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_audio_url?: string | null;
  cloze_answer: string;
  image_url?: string | null;
  audio_url?: string | null;
  question_number?: number;
}

export default function WordClozeQuizPreview({
  assignmentId,
  contentId,
  settings,
  renderCardFooter,
}: Props) {
  const { token } = useTeacherAuthStore();
  const [items, setItems] = useState<ApiItem[]>([]);
  const [serverWords, setServerWords] = useState<ServerQuizWord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // assignmentId 路徑：後端跨所有單字集收題、依設定打亂（#861 D）。
  const useAssignment = assignmentId != null;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const url = useAssignment
          ? `${apiUrl}/api/teachers/assignments/${assignmentId}/preview/cloze-quiz-start`
          : `${apiUrl}/api/teachers/contents/${contentId}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!cancelled) {
          if (useAssignment) {
            setServerWords(data.words || []);
          } else {
            setItems(data.items || []);
          }
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
  }, [useAssignment, assignmentId, contentId, token]);

  const previewWords = useMemo<QuizWord[]>(() => {
    if (useAssignment) {
      return (serverWords || []).map((w, idx) => ({
        content_item_id: w.content_item_id,
        text: w.text,
        translation: w.translation || "",
        example_sentence: w.example_sentence || "",
        example_sentence_translation: w.example_sentence_translation || "",
        example_sentence_audio_url: w.example_sentence_audio_url,
        cloze_answer: w.cloze_answer || w.text,
        image_url: w.image_url,
        audio_url: w.audio_url,
        question_number: w.question_number ?? idx + 1,
      }));
    }
    return items.map((item, idx) => ({
      content_item_id: item.id,
      text: item.text,
      translation: item.translation || "",
      example_sentence: item.example_sentence || "",
      example_sentence_translation: item.example_sentence_translation || "",
      example_sentence_audio_url: item.example_sentence_audio_url,
      cloze_answer: item.cloze_answer || item.text,
      image_url: item.image_url,
      audio_url: item.audio_url,
      question_number: idx + 1,
    }));
  }, [useAssignment, serverWords, items]);

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
      {/* assignmentId 路徑後端已實際打亂，不需提示橫幅；contentId 路徑維持原提示 */}
      {!useAssignment && settings.shuffle_questions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <WordClozeQuizActivity
        assignmentId={assignmentId ?? 0}
        previewWords={previewWords}
        previewSettings={previewSettings}
        renderCardFooter={renderCardFooter}
      />
    </div>
  );
}
