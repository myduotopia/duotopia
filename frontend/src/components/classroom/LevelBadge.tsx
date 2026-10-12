/**
 * LevelBadge — 班級 CEFR 等級徽章（#1097）
 *
 * 文字與顏色（含深色模式）由 classroomLevel.ts 決定；
 * 「我的班級」與機構後台班級列表共用，取代兩邊各自的 getLevelBadge。
 */
import { getLevelBadgeClass, getLevelLabel } from "./classroomLevel";

interface LevelBadgeProps {
  level?: string | null;
  className?: string;
}

export function LevelBadge({ level, className = "" }: LevelBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getLevelBadgeClass(level)} ${className}`.trim()}
    >
      {getLevelLabel(level)}
    </span>
  );
}
