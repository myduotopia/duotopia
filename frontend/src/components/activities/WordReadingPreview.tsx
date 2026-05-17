/**
 * WordReadingPreview — 派發 sheet 內的 word_reading 即時預覽
 *
 * 用途：在 AssignmentDialog 設定區下方掛載，老師調整設定時可看見
 * 學生畫面樣貌。資料來自指定的公開 content（content_id），設定來自
 * 老師當下調整的 formData。
 *
 * 不會打 student/preview/demo 任何路徑——透過 WordReadingActivity 的
 * `previewItems` + `previewSettings` 走完全離線渲染。
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState } from "react";
import WordReadingActivity from "./WordReadingActivity";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface WordReadingPreviewProps {
  contentId: number;
  settings: {
    time_limit_per_question?: number;
    show_image?: boolean;
    show_translation?: boolean;
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
}

export default function WordReadingPreview({
  contentId,
  settings,
}: WordReadingPreviewProps) {
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
    if (token) fetchContent();
    return () => {
      cancelled = true;
    };
  }, [contentId, token]);

  // 穩定的 previewSettings reference — 否則 WordReadingActivity 的 useEffect
  // 會在 AssignmentDialog 每次表單按鍵時重觸發，把預覽 reset 回第 1 題。
  // can_use_ai_analysis 在預覽強制 false，避免老師預覽時被扣 AI 分析點數。
  const previewSettings = useMemo(
    () => ({
      time_limit_per_question: settings.time_limit_per_question,
      show_image: settings.show_image,
      show_translation: settings.show_translation,
      can_use_ai_analysis: false,
    }),
    [
      settings.time_limit_per_question,
      settings.show_image,
      settings.show_translation,
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
      <WordReadingActivity
        assignmentId={0}
        previewItems={items}
        previewSettings={previewSettings}
      />
    </div>
  );
}
