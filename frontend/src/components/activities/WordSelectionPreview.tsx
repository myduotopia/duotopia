/**
 * WordSelectionPreview — 派發 sheet 內的 word_selection 即時預覽
 *
 * 從指定的公開 content_id 抓單字，前端組成 4 選項（正解 + 3 干擾項），
 * 餵給 WordSelectionActivity 的 previewWords / previewSettings 路徑，
 * 不打 student/preview/demo 任何 API。
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState } from "react";
import WordSelectionActivity from "./WordSelectionActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface WordSelectionPreviewProps {
  contentId: number;
  settings: {
    show_image?: boolean;
    show_option_images?: boolean;
    play_audio?: boolean;
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
}

interface OptionEntry {
  text: string;
  image_url?: string | null;
}

interface WordOption {
  content_item_id: number;
  text: string;
  translation: string;
  correct_text?: string;
  audio_url?: string;
  image_url?: string;
  memory_strength: number;
  options: OptionEntry[];
}

function buildOptions(
  current: ContentItem,
  pool: ContentItem[],
  showImage: boolean,
): OptionEntry[] {
  // showImage=true 時，題目顯示英文，選項是翻譯；反之亦然
  const correctText = showImage ? current.translation || "" : current.text;
  const distractorPool = pool
    .filter((p) => p.id !== current.id)
    .map((p) => ({
      text: showImage ? p.translation || "" : p.text,
      image_url: p.image_url ?? null,
    }))
    .filter((o) => o.text);

  // 隨機抽 3 個干擾項
  const shuffled = [...distractorPool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const distractors = shuffled.slice(0, 3);

  // 正解 + 干擾項一起再洗一次
  const allOptions: OptionEntry[] = [
    { text: correctText, image_url: current.image_url ?? null },
    ...distractors,
  ];
  for (let i = allOptions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allOptions[i], allOptions[j]] = [allOptions[j], allOptions[i]];
  }
  return allOptions;
}

export default function WordSelectionPreview({
  contentId,
  settings,
}: WordSelectionPreviewProps) {
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

  // 組成 WordOption[]（含選項）— 只在 items 或 show_image 變動時重組
  const previewWords = useMemo<WordOption[]>(() => {
    const showImage = settings.show_image ?? true;
    return items.map((item) => ({
      content_item_id: item.id,
      text: item.text,
      translation: item.translation || "",
      correct_text: showImage ? item.translation || "" : item.text,
      audio_url: item.audio_url,
      image_url: item.image_url,
      memory_strength: 0,
      options: buildOptions(item, items, showImage),
    }));
  }, [items, settings.show_image]);

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
      <WordSelectionActivity
        assignmentId={0}
        previewWords={previewWords}
        previewSettings={{
          show_image: settings.show_image,
          show_option_images: settings.show_option_images,
          play_audio: settings.play_audio,
          target_proficiency: settings.target_proficiency,
          time_limit_per_question: settings.time_limit_per_question ?? null,
        }}
      />
    </div>
  );
}
