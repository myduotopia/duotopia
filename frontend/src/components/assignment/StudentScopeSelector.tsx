/**
 * 派發作業時挑選學生的選擇器（issue #1046）。
 *
 * 三種選法互斥，一次只有一種在作用：指派全班 / 依組別 / 依組員序位。
 * 作用中的那個高亮，另外兩個變淡，老師隨時看得出人是怎麼被選進來的。
 *
 * 這個元件只表達「選擇意圖」（StudentScope），實際被選到的學生由
 * `resolveStudentScope` 推導。之所以不讓它直接吐一串學生 id：兩個組別可能有
 * 重疊成員，扁平的 id 陣列一旦形成就分不出某人是誰帶進來的，取消其中一組時
 * 會把重疊的人一起誤刪（#1046 實測回報的 bug）。
 *
 * 切換任一種選法都會清掉另外兩者以及個別微調，確保畫面上的人數永遠跟選擇器
 * 的內容對得起來。
 */

import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Users } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  buildOrderOptions,
  createScope,
  GROUP_COLOR_DOT,
  type StudentGroup,
  type StudentScope,
} from "@/lib/studentGroup";

interface StudentScopeSelectorProps {
  scope: StudentScope;
  onScopeChange: (next: StudentScope) => void;
  groups: StudentGroup[];
  /** 目前實際選到的人數與全班人數，顯示在標題列。 */
  selectedCount: number;
  totalCount: number;
  /** 跨班派發時塞在班級卡片裡，尺寸縮一號。 */
  compact?: boolean;
}

export function StudentScopeSelector({
  scope,
  onScopeChange,
  groups,
  selectedCount,
  totalCount,
  compact = false,
}: StudentScopeSelectorProps) {
  const { t } = useTranslation();
  const orderOptions = buildOrderOptions(groups);
  const hasGroups = groups.length > 0;

  const toggleAll = () => {
    // 再點一次「指派全班」就退回 manual（空選取），與改版前取消全選的行為一致。
    onScopeChange(createScope(scope.mode === "all" ? "manual" : "all"));
  };

  const toggleGroup = (groupId: number) => {
    // 從別種選法切過來時要整個重來，不能沿用舊的 included / excluded。
    const base = scope.mode === "groups" ? scope.groupIds : [];
    const groupIds = base.includes(groupId)
      ? base.filter((id) => id !== groupId)
      : [...base, groupId];
    onScopeChange(
      groupIds.length === 0
        ? createScope("manual")
        : { ...createScope("groups"), groupIds },
    );
  };

  const toggleOrder = (order: number) => {
    const base = scope.mode === "orders" ? scope.orders : [];
    const orders = base.includes(order)
      ? base.filter((n) => n !== order)
      : [...base, order];
    onScopeChange(
      orders.length === 0
        ? createScope("manual")
        : { ...createScope("orders"), orders },
    );
  };

  const groupsActive = scope.mode === "groups";
  const ordersActive = scope.mode === "orders";
  const allActive = scope.mode === "all";

  const triggerClass = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-md border px-2.5 transition-colors",
      compact ? "h-8 text-xs" : "h-9 text-sm",
      active
        ? "bg-blue-50 border-blue-300 text-blue-700 font-medium"
        : "bg-white border-gray-200 text-gray-500 hover:border-gray-300",
    );

  return (
    <div className={cn("space-y-1.5", compact ? "mb-2" : "mb-3")}>
      <div className="flex items-center gap-2 flex-wrap">
        {/* 指派全班 */}
        <button
          type="button"
          onClick={toggleAll}
          className={triggerClass(allActive)}
        >
          <Checkbox
            checked={allActive}
            className="pointer-events-none h-4 w-4 data-[state=checked]:bg-blue-600"
          />
          {t("dialogs.assignmentDialog.selectStudents.assignAll")}
        </button>

        {/* 依組別（沒有任何分組的班級就不顯示） */}
        {hasGroups && (
          <DropdownMenu>
            <DropdownMenuTrigger className={triggerClass(groupsActive)}>
              <Users className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
              {groupsActive
                ? t("dialogs.assignmentDialog.selectStudents.byGroupCount", {
                    count: scope.groupIds.length,
                  })
                : t("dialogs.assignmentDialog.selectStudents.byGroup")}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-72 overflow-y-auto"
            >
              {groups.map((group) => (
                <DropdownMenuCheckboxItem
                  key={group.id}
                  checked={groupsActive && scope.groupIds.includes(group.id)}
                  // 選單維持開啟，老師可以連續勾好幾組
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleGroup(group.id)}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        group.color
                          ? GROUP_COLOR_DOT[group.color]
                          : "bg-gray-300",
                      )}
                    />
                    <span className="truncate max-w-[10rem]">{group.name}</span>
                    <span className="text-xs text-gray-400 tabular-nums">
                      {t("dialogs.assignmentDialog.selectStudents.groupSize", {
                        count: group.members.length,
                      })}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 依組員序位（跨組別） */}
        {hasGroups && orderOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className={triggerClass(ordersActive)}>
              <Check className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
              {ordersActive
                ? t("dialogs.assignmentDialog.selectStudents.byOrderCount", {
                    count: scope.orders.length,
                  })
                : t("dialogs.assignmentDialog.selectStudents.byOrder")}
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-72 overflow-y-auto"
            >
              {orderOptions.map(({ order, count }) => (
                <DropdownMenuCheckboxItem
                  key={order}
                  checked={ordersActive && scope.orders.includes(order)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => toggleOrder(order)}
                >
                  <span className="flex items-center gap-2">
                    <span>
                      {t(
                        "dialogs.assignmentDialog.selectStudents.orderOption",
                        {
                          number: order,
                        },
                      )}
                    </span>
                    <span className="text-xs text-gray-400 tabular-nums">
                      {t("dialogs.assignmentDialog.selectStudents.groupSize", {
                        count,
                      })}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <span
          className={cn(
            "ml-auto text-gray-500 tabular-nums",
            compact ? "text-[11px]" : "text-xs",
          )}
        >
          {t("dialogs.assignmentDialog.selectStudents.selected", {
            selected: selectedCount,
            total: totalCount,
          })}
        </span>
      </div>
    </div>
  );
}
