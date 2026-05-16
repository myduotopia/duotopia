/**
 * RearrangementPreview — 派發 sheet 內的 rearrangement 即時預覽
 *
 * 直接重用既有的 demo 路徑：抓 /api/demo/config 拿
 * demo_rearrangement_assignment_id（=77，Unit 1 Dialogue），用
 * demoApi.getPreview() 拿 activities，渲染 StudentActivityPageContent
 * （isDemoMode + isPreviewMode），與 https://duotopia.co/demo/77 完全
 * 同條 code path。
 *
 * 取捨：預覽顯示的設定來自 demo assignment 自己存的值，不會跟著老師
 * 當下調 toggle 變動。
 *
 * ⚠️ 改動前必讀：docs/design/preview-architecture.md
 */
import { useEffect, useState } from "react";
import { demoApi } from "@/lib/demoApi";
import StudentActivityPageContent, {
  type Activity,
} from "@/pages/student/StudentActivityPageContent";

interface DemoActivityResponse {
  assignment_id: number;
  title: string;
  practice_mode?: string | null;
  show_answer?: boolean;
  time_limit_per_question?: number;
  total_activities: number;
  activities: Activity[];
}

interface RearrangementPreviewProps {
  shuffleQuestions?: boolean;
}

export default function RearrangementPreview({
  shuffleQuestions,
}: RearrangementPreviewProps = {}) {
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
