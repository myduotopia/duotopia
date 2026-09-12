/**
 * 班級學生分組的共用型別與色票（issue #1046）。
 *
 * 色票存的是 key（amber / rose / …）而非 hex：Tailwind 只認得完整字面的
 * class name，沒辦法從樣板字串組出 `bg-${color}-500`，所以每個 key 都要在
 * 下面的靜態 map 裡各自寫死一份完整 class。新增顏色時三張 map 都要補，
 * 後端的 GROUP_COLOR_VALUES（backend/models/student_group.py）也要同步。
 */

export const GROUP_COLORS = [
  "amber",
  "rose",
  "sky",
  "emerald",
  "violet",
  "slate",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

/** 實心色塊，用在色票選擇器與組別列的圓點。 */
export const GROUP_COLOR_DOT: Record<GroupColor, string> = {
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
};

/** 選中狀態的外框。 */
export const GROUP_COLOR_RING: Record<GroupColor, string> = {
  amber: "ring-amber-500",
  rose: "ring-rose-500",
  sky: "ring-sky-500",
  emerald: "ring-emerald-500",
  violet: "ring-violet-500",
  slate: "ring-slate-500",
};

/** 淡底徽章，用在學生列表的組別標籤。 */
export const GROUP_COLOR_BADGE: Record<GroupColor, string> = {
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  slate: "bg-slate-50 text-slate-700 border-slate-200",
};

/** 沒設顏色的組別走這個中性樣式。 */
export const GROUP_COLOR_BADGE_NEUTRAL =
  "bg-gray-50 text-gray-600 border-gray-200";

export function isGroupColor(value: unknown): value is GroupColor {
  return (
    typeof value === "string" && GROUP_COLORS.includes(value as GroupColor)
  );
}

export interface StudentGroupMember {
  student_id: number;
  name: string;
  student_number?: string | null;
  /** 組內序號，從 0 起算；顯示給老師看時 +1。 */
  sort_order: number;
}

export interface StudentGroup {
  id: number;
  classroom_id: number;
  name: string;
  color: GroupColor | null;
  leader_student_id: number | null;
  sort_order: number;
  members: StudentGroupMember[];
}

/**
 * 建立與更新共用的 body。`member_student_ids` 是有序的 —— 陣列索引就是
 * 後端存下來的 sort_order，所以拖曳排序只要送整串 id。
 */
export interface StudentGroupPayload {
  name: string;
  color: GroupColor | null;
  member_student_ids: number[];
  leader_student_id: number | null;
}

/** 一位學生在某一組裡的身分。一個學生可能有好幾筆（可屬多組）。 */
export interface StudentGroupMembership {
  groupId: number;
  groupName: string;
  color: GroupColor | null;
  /** 組內序號，已經是給人看的 1 起算。 */
  order: number;
  isLeader: boolean;
}

/**
 * 把「組別 → 成員」的資料翻轉成「學生 → 他所屬的組別」，給學生列表用。
 *
 * 組別依 sort_order 排，所以同一位學生的多筆組別在每一列的呈現順序是穩定的。
 */
export function buildStudentGroupIndex(
  groups: StudentGroup[],
): Map<number, StudentGroupMembership[]> {
  const index = new Map<number, StudentGroupMembership[]>();
  const ordered = [...groups].sort((a, b) => a.sort_order - b.sort_order);

  ordered.forEach((group) => {
    [...group.members]
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((member, position) => {
        const list = index.get(member.student_id) ?? [];
        list.push({
          groupId: group.id,
          groupName: group.name,
          color: group.color,
          order: position + 1,
          isLeader: group.leader_student_id === member.student_id,
        });
        index.set(member.student_id, list);
      });
  });

  return index;
}
