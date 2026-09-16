/**
 * 學生列表裡的組別徽章（issue #1046）。
 *
 * 一位學生可能同時屬於多組，所以這裡渲染的是一串徽章而不是單一值。
 * 每個徽章顯示「組別名稱 #組內序號」，是該組組長的話再補一顆實心黃星。
 */

import { Star } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  GROUP_COLOR_BADGE,
  GROUP_COLOR_BADGE_NEUTRAL,
  type StudentGroupMembership,
} from "@/lib/studentGroup";

interface StudentGroupBadgesProps {
  memberships: StudentGroupMembership[];
  /** 沒有任何組別時顯示的字，預設是一個破折號。 */
  emptyText?: string;
  leaderLabel?: string;
}

export function StudentGroupBadges({
  memberships,
  emptyText = "-",
  leaderLabel,
}: StudentGroupBadgesProps) {
  if (memberships.length === 0) {
    return <span className="text-sm text-gray-400">{emptyText}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {memberships.map((m) => (
        <span
          key={m.groupId}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] whitespace-nowrap",
            m.color ? GROUP_COLOR_BADGE[m.color] : GROUP_COLOR_BADGE_NEUTRAL,
          )}
        >
          <span className="truncate max-w-[8rem]">{m.groupName}</span>
          <span className="tabular-nums opacity-70">#{m.order}</span>
          {m.isLeader && (
            <Star
              className="h-3 w-3 text-yellow-500 fill-yellow-400 shrink-0"
              aria-label={leaderLabel}
            />
          )}
        </span>
      ))}
    </div>
  );
}
