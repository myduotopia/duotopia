/**
 * ReadingPreview — 派發 sheet 內的 reading 即時預覽
 *
 * 直接重用既有的 demo 路徑：抓 /api/demo/config 拿 demo_reading_assignment_id，
 * 再用 demoApi.getPreview() 拿 activities，最後渲染 StudentActivityPageContent
 * （isDemoMode + isPreviewMode 開），與 https://duotopia.co/demo/<id> 同等體驗。
 *
 * 取捨：設定（play_audio、time_limit 等）來自 demo assignment 自己存的值，
 * 不是老師當下調整的 formData。reading 模式 score_category 固定為 speaking，
 * 影響不大。
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

export default function ReadingPreview() {
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
        const idStr = config.demo_reading_assignment_id;
        if (!idStr) {
          throw new Error("Demo reading assignment ID not configured");
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
  );
}
