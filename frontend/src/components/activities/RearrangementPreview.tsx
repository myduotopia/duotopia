/**
 * RearrangementPreview — 派發 sheet 內的 rearrangement 即時預覽
 *
 * 兩條路徑：
 * 1. 已知教材（內容卡派發）：傳入 contentId → 走 ByContent 子元件，
 *    打 /api/teachers/contents/{contentId} 並 tokenize 成 RearrangementQuestion[]，
 *    餵 RearrangementActivity.previewQuestions（Issue #752）。
 * 2. 未知教材（Assign New Homework 未選 cart）：contentId 為 undefined →
 *    走 ByDemo 子元件，沿用 demoApi.getConfig + getPreview 路徑。
 *
 * 取材規則（ByContent，與 backend / student 端一致）：
 * - VOCABULARY_SET → 取 item.example_sentence + example_sentence_audio_url
 * - EXAMPLE_SENTENCES → 取 item.text + item.audio_url
 *
 * Tokenize：以空白切詞並 shuffle；單字數 < 2 的句子會被過濾掉。
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useMemo, useState } from "react";
import { demoApi } from "@/lib/demoApi";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import RearrangementActivity, {
  type RearrangementQuestion,
} from "./RearrangementActivity";
import StudentActivityPageContent, {
  type Activity,
} from "@/pages/student/StudentActivityPageContent";

interface RearrangementPreviewProps {
  /** 已知教材時傳入；未傳則走 demo 預覽 */
  contentId?: number;
  shuffleQuestions?: boolean;
  timeLimitPerQuestion?: number;
  playAudio?: boolean;
}

export default function RearrangementPreview(props: RearrangementPreviewProps) {
  if (props.contentId == null) {
    return (
      <RearrangementPreviewByDemo
        shuffleQuestions={props.shuffleQuestions}
      />
    );
  }
  return (
    <RearrangementPreviewByContent
      contentId={props.contentId}
      shuffleQuestions={props.shuffleQuestions}
      timeLimitPerQuestion={props.timeLimitPerQuestion}
      playAudio={props.playAudio}
    />
  );
}

// ---------------------------------------------------------------------------
// ByContent — 已知教材路徑（Phase 2）
// ---------------------------------------------------------------------------

interface RawContentItem {
  id: number;
  text?: string;
  translation?: string;
  audio_url?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_audio_url?: string;
}

interface ContentResponse {
  id: number;
  type: string;
  title: string;
  items: RawContentItem[];
}

const VOCAB_TYPES = new Set(["VOCABULARY_SET", "SENTENCE_MAKING"]);

function tokenize(sentence: string): string[] {
  return sentence
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function RearrangementPreviewByContent({
  contentId,
  shuffleQuestions,
  timeLimitPerQuestion,
  playAudio,
}: {
  contentId: number;
  shuffleQuestions?: boolean;
  timeLimitPerQuestion?: number;
  playAudio?: boolean;
}) {
  const { token } = useTeacherAuthStore();
  const [data, setData] = useState<ContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        const resp = await fetch(
          `${apiUrl}/api/teachers/contents/${contentId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = (await resp.json()) as ContentResponse;
        if (!cancelled) {
          setData(body);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load preview");
          setLoading(false);
        }
      }
    }
    if (token) load();
    return () => {
      cancelled = true;
    };
  }, [contentId, token]);

  const previewQuestions = useMemo<RearrangementQuestion[]>(() => {
    if (!data) return [];
    const isVocab = VOCAB_TYPES.has(data.type?.toUpperCase());
    const limit = timeLimitPerQuestion ?? 0;
    const out: RearrangementQuestion[] = [];
    for (const item of data.items || []) {
      const sentence = isVocab ? item.example_sentence : item.text;
      if (!sentence) continue;
      const words = tokenize(sentence);
      if (words.length < 2) continue;
      out.push({
        content_item_id: item.id,
        shuffled_words: shuffle(words),
        word_count: words.length,
        max_errors: Math.max(1, Math.floor(words.length / 2)),
        time_limit: limit,
        play_audio: !!playAudio,
        audio_url: isVocab
          ? item.example_sentence_audio_url
          : item.audio_url,
        translation: isVocab
          ? item.example_sentence_translation
          : item.translation,
        original_text: sentence,
      });
    }
    return out;
  }, [data, timeLimitPerQuestion, playAudio]);

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
  if (error || !data) {
    return (
      <div className="p-4 text-sm text-red-600">
        Preview error: {error || "no data"}
      </div>
    );
  }
  if (previewQuestions.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 border border-dashed border-gray-200 rounded">
        此教材沒有可預覽的句子（需至少 2 個單字才能重組）
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {shuffleQuestions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <RearrangementActivity
        studentAssignmentId={0}
        isPreviewMode={true}
        previewQuestions={previewQuestions}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ByDemo — 未知教材路徑（Phase 2 之前的程式碼）
// ---------------------------------------------------------------------------

interface DemoActivityResponse {
  assignment_id: number;
  title: string;
  practice_mode?: string | null;
  show_answer?: boolean;
  time_limit_per_question?: number;
  total_activities: number;
  activities: Activity[];
}

function RearrangementPreviewByDemo({
  shuffleQuestions,
}: {
  shuffleQuestions?: boolean;
}) {
  const [data, setData] = useState<DemoActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const config = await demoApi.getConfig();
        const idStr = config.demo_rearrangement_assignment_id;
        if (!idStr) {
          throw new Error("Demo rearrangement assignment ID not configured");
        }
        const resp = (await demoApi.getPreview(
          parseInt(idStr, 10),
        )) as DemoActivityResponse;
        if (!cancelled) {
          setData(resp);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load preview");
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading preview…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-4 text-sm text-red-600">
        Preview error: {error || "no data"}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {shuffleQuestions && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
          🔀 學生實際作答時題目順序會被打亂（預覽固定按原順序顯示）
        </div>
      )}
      <StudentActivityPageContent
        activities={data.activities}
        assignmentTitle={data.title}
        assignmentId={data.assignment_id}
        practiceMode={data.practice_mode || null}
        showAnswer={data.show_answer || false}
        timeLimitPerQuestion={data.time_limit_per_question ?? 0}
        isDemoMode={true}
        isPreviewMode={true}
        onBack={() => {}}
        onSubmit={async () => {}}
      />
    </div>
  );
}
