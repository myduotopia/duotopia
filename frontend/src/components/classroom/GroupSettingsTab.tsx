/**
 * 班級「分組設定」tab（issue #1046）。
 *
 * 三欄版面：組別清單（可拖曳排序）∣ 選中組別的編輯區 ∣ 班級學生名冊。
 * 所有編輯都即時儲存，沒有「儲存」按鈕。
 *
 * 儲存採序列化且會合併的佇列（pending + drain）：老師連點五個學生時，五個
 * 請求不可以並行競爭，否則後端整包取代的語意會讓較早送出的那包蓋掉較新的。
 * 佇列以 group id 為 key，同一組在輪到它之前又被改，就直接覆寫排隊中的草稿；
 * 切換到別組時前一組尚未送出的寫入仍會被沖出去，不會被丟掉。最後寫入者勝是
 * 正確的，因為 API 每次都整包取代這一組。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import {
  GROUP_COLORS,
  GROUP_COLOR_DOT,
  GROUP_COLOR_RING,
  type GroupColor,
  type StudentGroup,
  type StudentGroupPayload,
} from "@/lib/studentGroup";
import { sortStudentsBySeat } from "@/lib/studentSort";

import { SortableGroupRow } from "./SortableGroupRow";
import { SortableMemberRow } from "./SortableMemberRow";

export interface GroupSettingsStudent {
  id: number;
  name: string;
  student_number?: string | null;
}

interface GroupSettingsTabProps {
  classroomId: number;
  students: GroupSettingsStudent[];
  /** 分組變動後通知外層，讓學生列表那邊的組別欄位跟著更新。 */
  onGroupsChange?: (groups: StudentGroup[]) => void;
}

interface Draft {
  name: string;
  color: GroupColor | null;
  memberIds: number[];
  leaderId: number | null;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

function draftFromGroup(group: StudentGroup): Draft {
  return {
    name: group.name,
    color: group.color,
    memberIds: group.members.map((m) => m.student_id),
    leaderId: group.leader_student_id,
  };
}

function toPayload(draft: Draft): StudentGroupPayload {
  return {
    name: draft.name.trim(),
    color: draft.color,
    member_student_ids: draft.memberIds,
    leader_student_id: draft.leaderId,
  };
}

export function GroupSettingsTab({
  classroomId,
  students,
  onGroupsChange,
}: GroupSettingsTabProps) {
  const { t } = useTranslation();

  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [creating, setCreating] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const roster = useMemo(() => sortStudentsBySeat(students), [students]);
  const studentById = useMemo(() => {
    const map = new Map<number, GroupSettingsStudent>();
    roster.forEach((s) => map.set(s.id, s));
    return map;
  }, [roster]);

  // 存檔迴圈裡要讀的值，不能閉包住過期的 render。
  const groupsRef = useRef<StudentGroup[]>([]);
  groupsRef.current = groups;
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedId;

  const applyGroups = useCallback(
    (next: StudentGroup[]) => {
      setGroups(next);
      onGroupsChange?.(next);
    },
    [onGroupsChange],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient
      .getClassroomGroups(classroomId)
      .then((data) => {
        if (cancelled) return;
        setGroups(data);
        onGroupsChange?.(data);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("classroomDetail.groups.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onGroupsChange 由外層每次 render 產生新 reference 的話會造成重抓，
    // 所以只跟著 classroomId 走。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId]);

  // ---- 序列化合併的存檔佇列 ----
  const pending = useRef(new Map<number, Draft>());
  const draining = useRef(false);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    setSaveState("saving");
    try {
      while (pending.current.size > 0) {
        const entry = pending.current.entries().next().value as [number, Draft];
        const [id, d] = entry;
        pending.current.delete(id);
        try {
          const saved = await apiClient.updateClassroomGroup(id, toPayload(d));
          applyGroups(
            groupsRef.current.map((g) => (g.id === saved.id ? saved : g)),
          );
        } catch (err) {
          const status = (err as { status?: number })?.status;
          if (status === 409) {
            // 保留老師打的字讓他就地改，回滾會把他的輸入默默丟掉。
            toast.error(t("classroomDetail.groups.duplicateName"));
          } else {
            toast.error(t("classroomDetail.groups.saveFailed"));
            // 其他錯誤才把畫面拉回伺服器的版本。
            const server = groupsRef.current.find((g) => g.id === id);
            if (server && id === selectedRef.current) {
              const restored = draftFromGroup(server);
              setDraft(restored);
              setNameInput(restored.name);
            }
          }
          setSaveState("failed");
          return;
        }
      }
      setSaveState("saved");
    } finally {
      draining.current = false;
    }
  }, [applyGroups, t]);

  /** 更新草稿並排進存檔佇列。 */
  const commit = useCallback(
    (next: Draft) => {
      const id = selectedRef.current;
      if (id === null) return;
      setDraft(next);
      pending.current.set(id, next);
      void drain();
    },
    [drain],
  );

  const select = (group: StudentGroup) => {
    setSelectedId(group.id);
    const d = draftFromGroup(group);
    setDraft(d);
    setNameInput(d.name);
  };

  const addGroup = async () => {
    setCreating(true);
    try {
      // 用現有組數 +1 找出還沒被用掉的編號：刪掉中間某組之後，單純的
      // length + 1 會撞到既有名稱，而組別是按下按鈕當下就建立的，老師沒有
      // 機會先改名避開 409。
      const taken = new Set(groups.map((g) => g.name));
      let n = 1;
      let name = t("classroomDetail.groups.defaultName", { number: n });
      // 上限是保命用的：萬一某個語系的 defaultName 漏了 {{number}} 佔位符，
      // 名稱就永遠不會變，沒有上限的話這裡會無限迴圈把分頁卡死。撞到上限時
      // 照樣送出去，讓後端的 409 去說「名稱重複」。
      const maxAttempts = groups.length + 2;
      while (taken.has(name) && n <= maxAttempts) {
        n += 1;
        name = t("classroomDetail.groups.defaultName", { number: n });
      }

      const created = await apiClient.createClassroomGroup(classroomId, {
        name,
        color: GROUP_COLORS[(groups.length % GROUP_COLORS.length) as number],
        member_student_ids: [],
        leader_student_id: null,
      });
      applyGroups([...groups, created]);
      select(created);
    } catch {
      toast.error(t("classroomDetail.groups.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const removeGroup = async (group: StudentGroup) => {
    if (
      !window.confirm(
        t("classroomDetail.groups.confirmDelete", { name: group.name }),
      )
    ) {
      return;
    }
    try {
      // 刪掉的組別若還有排隊中的寫入，送出去只會拿到 404。
      pending.current.delete(group.id);
      await apiClient.deleteClassroomGroup(group.id);
      applyGroups(groups.filter((g) => g.id !== group.id));
      if (selectedId === group.id) {
        setSelectedId(null);
        setDraft(null);
        setNameInput("");
      }
    } catch {
      toast.error(t("classroomDetail.groups.deleteFailed"));
    }
  };

  const commitName = () => {
    if (!draft) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      // 空白名稱後端會擋，直接還原比送出去吃 422 好。
      setNameInput(draft.name);
      return;
    }
    if (trimmed === draft.name) return;
    commit({ ...draft, name: trimmed });
  };

  const toggleMember = (studentId: number) => {
    if (!draft) return;
    const isMember = draft.memberIds.includes(studentId);
    const memberIds = isMember
      ? draft.memberIds.filter((id) => id !== studentId)
      : [...draft.memberIds, studentId];
    // 移除的剛好是組長時要一併清掉，否則後端會回 422（組長必須是成員）。
    const leaderId =
      isMember && draft.leaderId === studentId ? null : draft.leaderId;
    commit({ ...draft, memberIds, leaderId });
  };

  const toggleLeader = (studentId: number) => {
    if (!draft) return;
    commit({
      ...draft,
      leaderId: draft.leaderId === studentId ? null : studentId,
    });
  };

  const onGroupDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groups.findIndex((g) => g.id === active.id);
    const newIndex = groups.findIndex((g) => g.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(groups, oldIndex, newIndex);
    applyGroups(reordered); // 樂觀更新，失敗再拉回伺服器版本
    try {
      const saved = await apiClient.reorderClassroomGroups(
        classroomId,
        reordered.map((g) => g.id),
      );
      applyGroups(saved);
    } catch {
      toast.error(t("classroomDetail.groups.saveFailed"));
      applyGroups(groups);
    }
  };

  const onMemberDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!draft || !over || active.id === over.id) return;
    const oldIndex = draft.memberIds.indexOf(active.id as number);
    const newIndex = draft.memberIds.indexOf(over.id as number);
    if (oldIndex < 0 || newIndex < 0) return;
    commit({
      ...draft,
      memberIds: arrayMove(draft.memberIds, oldIndex, newIndex),
    });
  };

  const saveLabel: Record<SaveState, string> = {
    idle: "",
    saving: t("classroomDetail.groups.saving"),
    saved: t("classroomDetail.groups.saved"),
    failed: t("classroomDetail.groups.saveFailedShort"),
  };

  if (loading) {
    return (
      <p className="text-sm text-gray-500 py-8 text-center">
        {t("classroomDetail.groups.loading")}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* ---- 第 1 欄：組別清單 ---- */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-semibold text-gray-900 mb-3">
          {t("classroomDetail.groups.listHeading")}
        </h3>

        {groups.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onGroupDragEnd}
          >
            <SortableContext
              items={groups.map((g) => g.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="mb-3 space-y-1">
                {groups.map((g) => (
                  <SortableGroupRow
                    key={g.id}
                    group={g}
                    active={g.id === selectedId}
                    handleTitle={t("classroomDetail.groups.dragToReorder")}
                    deleteLabel={t("classroomDetail.groups.deleteGroup", {
                      name: g.name,
                    })}
                    onSelect={() => select(g)}
                    onDelete={() => removeGroup(g)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={addGroup}
          disabled={creating}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t("classroomDetail.groups.addGroup")}
        </Button>
      </section>

      {/* ---- 第 2 欄：選中組別的編輯區 ---- */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        {!draft ? (
          <p className="text-sm text-gray-500 py-8 text-center">
            {groups.length === 0
              ? t("classroomDetail.groups.emptyHint")
              : t("classroomDetail.groups.selectHint")}
          </p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-gray-900 truncate">
                {draft.name}
              </h3>
              <span
                className={cn(
                  "text-xs shrink-0",
                  saveState === "failed" ? "text-red-600" : "text-gray-400",
                )}
              >
                {saveLabel[saveState]}
              </span>
            </div>

            <div>
              <label
                htmlFor="group-name"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                {t("classroomDetail.groups.fieldName")}
              </label>
              <Input
                id="group-name"
                value={nameInput}
                maxLength={100}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setNameInput(draft.name);
                  }
                }}
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("classroomDetail.groups.fieldColor")}
              </span>
              <div className="flex flex-wrap gap-2">
                {GROUP_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={draft.color === c}
                    aria-label={t(`classroomDetail.groups.color.${c}`)}
                    title={t(`classroomDetail.groups.color.${c}`)}
                    onClick={() => commit({ ...draft, color: c })}
                    className={cn(
                      "h-9 w-9 rounded-full transition-shadow",
                      GROUP_COLOR_DOT[c],
                      draft.color === c &&
                        `ring-2 ring-offset-2 ${GROUP_COLOR_RING[c]}`,
                    )}
                  />
                ))}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-gray-900 mb-1">
                {t("classroomDetail.groups.membersHeading", {
                  count: draft.memberIds.length,
                })}
              </h4>
              <p className="text-xs text-gray-500 mb-2">
                {t("classroomDetail.groups.membersHint")}
              </p>

              {draft.memberIds.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">
                  {t("classroomDetail.groups.noMembers")}
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onMemberDragEnd}
                >
                  {/* 欄寬與 SortableMemberRow 一一對應，改動時兩邊要同步 */}
                  <div
                    aria-hidden="true"
                    className="flex items-center gap-3 px-2 pb-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wide border-b"
                  >
                    <span className="w-6" />
                    <span className="w-5">
                      {t("classroomDetail.groups.colOrder")}
                    </span>
                    <span className="w-10">
                      {t("classroomDetail.groups.colSeat")}
                    </span>
                    <span className="flex-1">
                      {t("classroomDetail.groups.colName")}
                    </span>
                    <span className="w-9 text-center">
                      {t("classroomDetail.groups.colLeader")}
                    </span>
                    <span className="w-8" />
                  </div>
                  <SortableContext
                    items={draft.memberIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-1 pt-1 max-h-96 overflow-y-auto">
                      {draft.memberIds.map((id, index) => {
                        const s = studentById.get(id);
                        if (!s) return null;
                        return (
                          <SortableMemberRow
                            key={id}
                            index={index}
                            member={{
                              student_id: s.id,
                              name: s.name,
                              student_number: s.student_number,
                              sort_order: index,
                            }}
                            isLeader={draft.leaderId === id}
                            handleTitle={t(
                              "classroomDetail.groups.dragToReorder",
                            )}
                            leaderLabel={t("classroomDetail.groups.setLeader", {
                              name: s.name,
                            })}
                            removeLabel={t(
                              "classroomDetail.groups.removeMember",
                              { name: s.name },
                            )}
                            onToggleLeader={() => toggleLeader(id)}
                            onRemove={() => toggleMember(id)}
                          />
                        );
                      })}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ---- 第 3 欄：班級學生名冊 ---- */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="font-semibold text-gray-900 mb-1">
          {t("classroomDetail.groups.rosterHeading")}
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          {t("classroomDetail.groups.rosterHint")}
        </p>

        {roster.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">
            {t("classroomDetail.groups.noStudents")}
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="space-y-1 pr-2">
              {roster.map((s) => {
                const checked = draft?.memberIds.includes(s.id) ?? false;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={!draft}
                      onClick={() => toggleMember(s.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-2 py-2 rounded-lg border text-left transition-colors",
                        checked
                          ? "bg-blue-50 border-blue-300"
                          : "bg-white border-gray-200 hover:border-gray-300",
                        !draft && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        className="pointer-events-none"
                      />
                      <span className="w-10 text-xs text-gray-500 truncate">
                        {s.student_number || "-"}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-sm text-gray-900">
                        {s.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </section>
    </div>
  );
}
