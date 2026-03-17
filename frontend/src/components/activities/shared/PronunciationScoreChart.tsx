/**
 * PronunciationScoreChart - 發音分析動畫圖表元件
 *
 * 雷達圖：顯示維度分數（Overall, Accuracy, Fluency, Completeness 等），各維度彩色圓點 + 圖例
 * 長條圖：顯示逐字/逐音素分數
 *
 * 桌面版左右並排：雷達圖 | 長條圖
 * 手機版上下排列：雷達圖 → 長條圖
 *
 * 適用於例句朗讀（per-word）和單字朗讀（per-phoneme）。
 */

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  LabelList,
} from "recharts";

export interface ScoreDimension {
  label: string;
  score: number;
}

export interface ScoreDetail {
  label: string;
  score: number;
  errorType?: string;
}

export interface PronunciationScoreChartProps {
  /** 總分 (0-100) */
  overallScore: number;
  /** 維度分數 → 雷達圖 */
  dimensions: ScoreDimension[];
  /** 逐項分數 → 長條圖（單字或音素） */
  details: ScoreDetail[];
  /** 長條圖標題（覆蓋預設） */
  detailsTitle?: string;
}

/** 各維度的彩色圓點顏色 */
const DIMENSION_COLORS = [
  "#6366f1", // indigo — Overall
  "#22c55e", // green  — Accuracy
  "#f59e0b", // amber  — Fluency
  "#8b5cf6", // violet — Completeness
  "#ec4899", // pink   — Prosody (if present)
];

/** 依分數取得長條圖顏色 */
function getBarColor(score: number): string {
  if (score >= 70) return "#22c55e"; // green-500
  if (score >= 40) return "#eab308"; // yellow-500
  return "#ef4444"; // red-500
}

/** 依分數取得文字色 class */
function getScoreTextClass(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-yellow-600";
  return "text-red-600";
}

/** 自訂雷達圖 dot：各維度不同顏色圓點 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderRadarDot(props: any) {
  const { cx, cy, index } = props as { cx: number; cy: number; index: number };
  const color = DIMENSION_COLORS[index % DIMENSION_COLORS.length];
  return (
    <circle
      key={`dot-${index}`}
      cx={cx}
      cy={cy}
      r={5}
      fill={color}
      stroke="white"
      strokeWidth={2}
    />
  );
}

const PronunciationScoreChart: React.FC<PronunciationScoreChartProps> = ({
  overallScore,
  dimensions,
  details,
  detailsTitle,
}) => {
  const { t } = useTranslation();

  const showRadar = dimensions.length >= 3;
  const showBar = details.length > 0;

  // 雷達圖資料
  const radarData = dimensions.map((d) => ({
    dimension: d.label,
    score: d.score,
    fullMark: 100,
  }));

  // 長條圖資料：去重（同名取最高分），保持句子順序
  const barData: Array<{ name: string; score: number; errorType?: string }> =
    [];
  const seen = new Set<string>();
  for (const d of details) {
    const key = d.label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      barData.push({ name: d.label, score: d.score, errorType: d.errorType });
    } else {
      const existing = barData.find((b) => b.name.toLowerCase() === key);
      if (existing && d.score > existing.score) {
        existing.score = d.score;
        existing.errorType = d.errorType;
      }
    }
  }

  const barHeight = Math.max(barData.length * 36, 120);

  // 雷達圖區塊（比長條圖窄）
  const radarSection = showRadar ? (
    <div className="p-2 max-w-[280px] mx-auto md:mx-0">
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="65%">
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="dimension" tick={false} />
            <Radar
              dataKey="score"
              stroke="#6366f1"
              fill="#6366f1"
              fillOpacity={0.15}
              isAnimationActive={true}
              animationDuration={300}
              animationEasing="ease-out"
              dot={renderRadarDot}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {/* 圖例：彩色圓點 + 維度名(分數)，每排兩個 */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-1 justify-items-center">
        {dimensions.map((d, i) => (
          <div key={d.label} className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{
                backgroundColor: DIMENSION_COLORS[i % DIMENSION_COLORS.length],
              }}
            />
            <span className="text-xs text-gray-600">
              {d.label}
              <span
                className={cn(
                  "ml-0.5 font-semibold",
                  getScoreTextClass(d.score),
                )}
              >
                {Math.round(d.score)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  // 維度列表（少於 3 個維度時 fallback）
  const dimensionListSection =
    !showRadar && dimensions.length > 0 ? (
      <div className="p-2">
        <div className="space-y-2">
          {dimensions.map((d) => (
            <div
              key={d.label}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50"
            >
              <span className="text-sm text-gray-600">{d.label}</span>
              <span
                className={cn("text-lg font-bold", getScoreTextClass(d.score))}
              >
                {Math.round(d.score)}
              </span>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  // 長條圖區塊
  const barSection = showBar ? (
    <div className="p-2">
      <h4 className="text-sm font-semibold text-gray-700 mb-2 text-center">
        {detailsTitle || t("pronunciationChart.wordDetails")}
      </h4>
      <div style={{ height: barHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={barData}
            layout="vertical"
            margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
          >
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={80}
              tick={{ fontSize: 13, fill: "#374151" }}
              axisLine={false}
              tickLine={false}
            />
            <Bar
              dataKey="score"
              radius={[0, 6, 6, 0]}
              isAnimationActive={true}
              animationDuration={300}
              animationEasing="ease-out"
              barSize={20}
            >
              {barData.map((entry, index) => (
                <Cell
                  key={index}
                  fill={getBarColor(entry.score)}
                  fillOpacity={0.8}
                />
              ))}
              <LabelList
                dataKey="score"
                position="right"
                formatter={(value) => Math.round(Number(value))}
                style={{ fontSize: 12, fill: "#6b7280", fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 錯誤標記說明 */}
      {details.some((d) => d.errorType && d.errorType !== "None") && (
        <p className="text-xs text-gray-400 mt-2">
          ⚠️{" "}
          {details
            .filter((d) => d.errorType && d.errorType !== "None")
            .map((d) => d.label)
            .join(", ")}
        </p>
      )}
    </div>
  ) : null;

  // 左右並排（桌面）或上下（手機）
  const hasBothSections = (showRadar || dimensionListSection) && showBar;

  return hasBothSections ? (
    <div className="flex flex-col md:flex-row md:items-start gap-3">
      <div className="md:w-2/5">{radarSection || dimensionListSection}</div>
      <div className="md:w-3/5">{barSection}</div>
    </div>
  ) : (
    <div className="space-y-3">
      {radarSection}
      {dimensionListSection}
      {barSection}
    </div>
  );
};

export default PronunciationScoreChart;
