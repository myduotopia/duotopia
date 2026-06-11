/**
 * WordSelectionQuizPreview — 派發 sheet 內的 word_selection_quiz 即時預覽
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import WordSelectionQuizActivity from "./WordSelectionQuizActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface Props {
  contentId: number;
  settings: {
    show_word?: boolean;
    show_image?: boolean;
    show_option_images?: boolean;
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
}

export default function WordSelectionQuizPreview({
  contentId,
  settings,
  renderCardFooter,
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

  const previewWords = useMemo<QuizWord[]>(() => {
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
      };
    });
  }, [items, settings.show_image]);

  const previewSettings = useMemo(
    () => ({
      show_word: settings.show_word,
      show_image: settings.show_image,
      show_option_images: settings.show_option_images,
      play_audio: settings.play_audio,
      show_answer: settings.show_answer,
      time_limit_per_question: settings.time_limit_per_question ?? null,
    }),
    [
      settings.show_word,
      settings.show_image,
      settings.show_option_images,
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
      <WordSelectionQuizActivity
        assignmentId={0}
        previewWords={previewWords}
        previewSettings={previewSettings}
        renderCardFooter={renderCardFooter}
      />
    </div>
  );
}
