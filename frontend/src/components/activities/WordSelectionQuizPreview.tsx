/**
 * WordSelectionQuizPreview — 派發 sheet 內的 word_selection_quiz 即時預覽
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import WordSelectionQuizActivity from "./WordSelectionQuizActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface Props {
  // #861 D: 兩擇一——assignmentId（合併全部單字集、後端依 shuffle_questions 打亂）
  // 優先；contentId（單一 content）為 AssignmentDialog 建立流程即時預覽的 fallback。
  assignmentId?: number;
  contentId?: number;
  settings: {
    show_word?: boolean;
    show_image?: boolean;
    show_option_images?: boolean;
    show_example_sentence?: boolean;
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
  audio_url?: string;
  image_url?: string;
  // Issue #860: 顯示例句（答案挖空）預覽用
  example_sentence?: string | null;
  example_sentence_audio_url?: string | null; // Issue #967
  cloze_answer?: string | null;
  blanked_sentence?: string | null;
}

// Deterministic PRNG seeded per item, mirroring the backend's
// random.Random(item.id) — keeps preview options stable across re-renders
// instead of reshuffling on every render with Math.random() (#828 review).
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let state = (seed || 1) >>> 0;
  const next = () => {
    // mulberry32
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildOptions(
  current: ApiItem,
  pool: ApiItem[],
  showImage: boolean,
): QuizOption[] {
  // 與 WordSelectionPreview / backend distractors.py 對齊：
  // showImage=true → 題目顯示圖+翻譯、選項用英文；反之選項用翻譯
  const correctText = showImage ? current.text : current.translation || "";
  const distractorPool = pool
    .filter((p) => p.id !== current.id)
    .map((p) => ({
      text: showImage ? p.text : p.translation || "",
      image_url: p.image_url ?? null,
    }))
    .filter((o) => o.text);
  const distractors = seededShuffle(distractorPool, current.id).slice(0, 3);
  const all: QuizOption[] = [
    { text: correctText, image_url: current.image_url ?? null },
    ...distractors,
  ];
  return seededShuffle(all, current.id + 1);
}

interface QuizOption {
  text: string;
  image_url?: string | null;
}

interface QuizWord {
  content_item_id: number;
  text: string;
  translation: string;
  correct_text: string;
  audio_url?: string | null;
  image_url?: string | null;
  options: QuizOption[];
  question_number: number;
  // Issue #860
  example_sentence?: string | null;
  example_sentence_audio_url?: string | null; // Issue #967
  cloze_answer?: string | null;
  blanked_sentence?: string | null;
}

// 後端 /preview/selection-quiz-start 回傳的題目形狀（#861 D）：已含全單字集、
// 打亂後的順序、每題選項與正解，前端直接映射即可。
interface ServerQuizWord {
  content_item_id: number;
  text: string;
  translation?: string;
  correct_text: string;
  audio_url?: string | null;
  image_url?: string | null;
  options: QuizOption[];
  question_number?: number;
  // Issue #860
  example_sentence?: string | null;
  example_sentence_audio_url?: string | null; // Issue #967
  cloze_answer?: string | null;
  blanked_sentence?: string | null;
}

export default function WordSelectionQuizPreview({
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

  // assignmentId 路徑：後端跨所有單字集收題、依設定打亂、組好選項與正解（#861 D）。
  // contentId 路徑：單一 content + 前端組選項（AssignmentDialog 建立流程）。
  const useAssignment = assignmentId != null;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const url = useAssignment
          ? `${apiUrl}/api/teachers/assignments/${assignmentId}/preview/selection-quiz-start`
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
    // assignmentId 路徑：後端已給好全單字集、打亂順序、選項與正解，直接映射
    if (useAssignment) {
      return (serverWords || []).map((w, idx) => ({
        content_item_id: w.content_item_id,
        text: w.text,
        translation: w.translation || "",
        correct_text: w.correct_text,
        audio_url: w.audio_url,
        image_url: w.image_url,
        options: w.options,
        question_number: w.question_number ?? idx + 1,
        example_sentence: w.example_sentence,
        example_sentence_audio_url: w.example_sentence_audio_url,
        cloze_answer: w.cloze_answer,
        blanked_sentence: w.blanked_sentence,
      }));
    }
    // contentId 路徑：前端組選項。選項語言由 show_image 決定，不受例句影響。
    const showImage = settings.show_image !== false;
    return items.map((item, idx) => {
      const correctText = showImage ? item.text : item.translation || "";
      return {
        content_item_id: item.id,
        text: item.text,
        translation: item.translation || "",
        correct_text: correctText,
        audio_url: item.audio_url,
        image_url: item.image_url,
        options: buildOptions(item, items, showImage),
        question_number: idx + 1,
        example_sentence: item.example_sentence,
        example_sentence_audio_url: item.example_sentence_audio_url,
        cloze_answer: item.cloze_answer,
        blanked_sentence: item.blanked_sentence,
      };
    });
  }, [useAssignment, serverWords, items, settings.show_image]);

  const previewSettings = useMemo(
    () => ({
      show_word: settings.show_word,
      show_image: settings.show_image,
      show_option_images: settings.show_option_images,
      show_example_sentence: settings.show_example_sentence,
      play_audio: settings.play_audio,
      show_answer: settings.show_answer,
      time_limit_per_question: settings.time_limit_per_question ?? null,
    }),
    [
      settings.show_word,
      settings.show_image,
      settings.show_option_images,
      settings.show_example_sentence,
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
      {/* assignmentId 路徑後端已實際打亂全單字集題目，不需提示橫幅；
          contentId（建立流程）路徑維持原本「實際作答會打亂」提示。 */}
      {!useAssignment && settings.shuffle_questions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <WordSelectionQuizActivity
        assignmentId={assignmentId ?? 0}
        previewWords={previewWords}
        previewSettings={previewSettings}
        renderCardFooter={renderCardFooter}
      />
    </div>
  );
}
