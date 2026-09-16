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

// ===== 派發作業的學生選擇（issue #1046）=====

/**
 * 老師目前是用哪一種方式在選學生。三種方式互斥，一次只有一種在作用。
 *
 * `manual` 是取消「指派全班」或把下拉選單清空後的自然狀態：基底為空，
 * 只剩老師逐一勾選的人（等同這個功能出現前的原始行為）。
 */
export type SelectionMode = "all" | "groups" | "orders" | "manual";

/**
 * 老師的**選擇意圖**，而不是選到的結果。
 *
 * 為什麼不直接存一串學生 id：兩個組別可能有重疊成員（第一組 ABCD、第二組
 * DEFG），一旦只留下扁平的 id 陣列，取消第二組時就分不出 D 是誰帶進來的，
 * 只能連 D 一起刪掉。記住意圖、每次重新推導，這個問題就不存在。
 */
export interface StudentScope {
  mode: SelectionMode;
  /** mode === "groups" 時有效。 */
  groupIds: number[];
  /** mode === "orders" 時有效，存的是給人看的 1 起算序位。 */
  orders: number[];
  /** 疊在基底上的個別加入。 */
  included: number[];
  /** 疊在基底上的個別排除。 */
  excluded: number[];
}

export const EMPTY_SCOPE: StudentScope = {
  mode: "manual",
  groupIds: [],
  orders: [],
  included: [],
  excluded: [],
};

export function createScope(mode: SelectionMode): StudentScope {
  return { ...EMPTY_SCOPE, mode };
}

/**
 * 依選擇意圖推導出實際被選到的學生 id。
 *
 * 基底依 mode 決定：all=全班、groups=所勾組別成員的聯集、orders=在任一組別
 * 中序位落在所勾序位的人、manual=空集合。最後再疊上個別的加入與排除。
 *
 * 回傳順序跟著 `allStudentIds` 傳進來的順序，呼叫端先排好就不必再排一次。
 */
export function resolveStudentScope(
  scope: StudentScope,
  allStudentIds: number[],
  groups: StudentGroup[],
): number[] {
  const inClass = new Set(allStudentIds);
  const base = new Set<number>();

  if (scope.mode === "all") {
    allStudentIds.forEach((id) => base.add(id));
  } else if (scope.mode === "groups") {
    const wanted = new Set(scope.groupIds);
    groups
      .filter((g) => wanted.has(g.id))
      .forEach((g) =>
        g.members.forEach((m) => {
          // 組員可能已離班（分組與名冊各自載入），只認名冊裡真的有的人。
          if (inClass.has(m.student_id)) base.add(m.student_id);
        }),
      );
  } else if (scope.mode === "orders") {
    const wanted = new Set(scope.orders);
    buildStudentGroupIndex(groups).forEach((memberships, studentId) => {
      if (!inClass.has(studentId)) return;
      if (memberships.some((m) => wanted.has(m.order))) base.add(studentId);
    });
  }

  scope.included.forEach((id) => {
    if (inClass.has(id)) base.add(id);
  });
  scope.excluded.forEach((id) => base.delete(id));

  return allStudentIds.filter((id) => base.has(id));
}

export interface OrderOption {
  /** 給人看的序位，1 起算。 */
  order: number;
  /** 全班有多少人在某一組裡排這個序位。 */
  count: number;
}

/**
 * 可選的組員序位清單。序位跨組別計算 —— 「第 1 號」指的是各組的第 1 號，
 * 不限定哪一組。
 */
export function buildOrderOptions(groups: StudentGroup[]): OrderOption[] {
  const counts = new Map<number, Set<number>>();

  buildStudentGroupIndex(groups).forEach((memberships, studentId) => {
    memberships.forEach((m) => {
      const bucket = counts.get(m.order) ?? new Set<number>();
      bucket.add(studentId);
      counts.set(m.order, bucket);
    });
  });

  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([order, students]) => ({ order, count: students.size }));
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
