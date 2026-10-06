/**
 * ClassroomTableRow — 「我的班級」桌機表格的一列（#1097）
 *
 * 欄序：[勾選] 年級 → 班級名稱 → 等級 → 學生數 → 建立時間 → 狀態 → 操作。
 *
 * 顯示模式：班級名稱為連結，下方小字顯示課程數與描述；狀態欄在 canToggleStatus 時
 * 顯示文字在軌道內的 LabeledSwitch（tone="brand"，軌道寫「撥下去會變成的狀態」：
 * 啟用中 → 開、寫「停用」；停用中 → 關、寫「啟用」），單筆切換不需確認；
 * 不可切換的列（機構／學校班）只顯示啟用／停用徽章。操作欄為派作業、編輯、刪除。
 * 停用（is_active === false）的班級派作業按鈕停用並提示原因，其餘操作照常。
 * 點列切換展開（勾選框、連結、狀態、操作欄的點擊不會觸發）。
 *
 * 編輯模式（editing）：年級 GradeSelect、名稱與描述 Input、等級 LevelSelect，
 * 操作欄變成「儲存／取消」；Enter 儲存、Esc 取消（輸入法選字中的 Enter 不算）。
 * 編輯中點列不會展開，勾選框由頁面以 selectDisabled 停用。草稿由頁面持有（draft／onDraftChange），本元件不保存狀態；
 * 草稿工具 makeClassroomDraft／isClassroomDraftDirty 與手機版用的 ClassroomDraftForm 也在本檔。
 */
import type { KeyboardEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Edit,
  GraduationCap,
  Trash2,
  X,
} from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { LabeledSwitch } from "@/components/shared/LabeledSwitch";
import { formatGradeLabel, isValidGrade } from "./classroomGrade";
import {
  DEFAULT_LEVEL,
  normalizeLevel,
  type ClassroomLevel,
} from "./classroomLevel";
import { GradeSelect } from "./GradeSelect";
import { LevelBadge } from "./LevelBadge";
import { LevelSelect } from "./LevelSelect";

export interface ClassroomRowData {
  id: number;
  name: string;
  description?: string;
  level?: string;
  grade?: number | null;
  is_active?: boolean;
  student_count: number;
  program_count?: number;
}

export interface ClassroomDraft {
  name: string;
  description: string;
  level: ClassroomLevel;
  grade: number | null;
}

/** 由班級目前的值建立編輯草稿（等級正規化；無效年級視為未設定） */
export function makeClassroomDraft(c: ClassroomRowData): ClassroomDraft {
  return {
    name: c.name,
    description: c.description ?? "",
    level: normalizeLevel(c.level) ?? DEFAULT_LEVEL,
    grade: isValidGrade(c.grade) ? c.grade : null,
  };
}

/** 草稿是否和班級目前的值不同（比較基準同 makeClassroomDraft） */
export function isClassroomDraftDirty(
  draft: ClassroomDraft,
  c: ClassroomRowData,
): boolean {
  const original = makeClassroomDraft(c);
  return (
    draft.name !== original.name ||
    draft.description !== original.description ||
    draft.level !== original.level ||
    draft.grade !== original.grade
  );
}

export const isClassroomInactive = (c: { is_active?: boolean }) =>
  c.is_active === false;

/** Enter 儲存、Esc 取消；輸入法選字中與按鈕上的 Enter 不處理 */
function draftKeyDownHandler(onSave: () => void, onCancel: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      onSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
}

export function ClassroomStatusBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        active
          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
          : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
      }`}
    >
      {active
        ? t("classroomGrade.status.active")
        : t("classroomGrade.status.inactive")}
    </span>
  );
}

interface DraftFieldsProps {
  draft: ClassroomDraft;
  onDraftChange: (draft: ClassroomDraft) => void;
  disabled?: boolean;
}

const FIELD_CLASS =
  "w-full px-2 py-1.5 border dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md text-sm";

function DraftGradeField({ draft, onDraftChange, disabled }: DraftFieldsProps) {
  const { t } = useTranslation();
  return (
    <GradeSelect
      aria-label={t("teacherClassrooms.labels.grade")}
      value={draft.grade}
      disabled={disabled}
      onChange={(grade) => onDraftChange({ ...draft, grade })}
      className={FIELD_CLASS}
    />
  );
}

function DraftLevelField({ draft, onDraftChange, disabled }: DraftFieldsProps) {
  const { t } = useTranslation();
  return (
    <LevelSelect
      aria-label={t("teacherClassrooms.labels.level")}
      value={draft.level}
      disabled={disabled}
      onChange={(level) => onDraftChange({ ...draft, level })}
      className={FIELD_CLASS}
    />
  );
}

function DraftTextFields({ draft, onDraftChange, disabled }: DraftFieldsProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <Input
        aria-label={t("teacherClassrooms.labels.classroomName")}
        value={draft.name}
        disabled={disabled}
        autoFocus
        onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
        className="h-8 text-sm"
      />
      <Input
        aria-label={t("teacherClassrooms.labels.description")}
        placeholder={t("teacherClassrooms.labels.description")}
        value={draft.description}
        disabled={disabled}
        onChange={(e) =>
          onDraftChange({ ...draft, description: e.target.value })
        }
        className="h-8 text-xs"
      />
    </div>
  );
}

function SaveCancelButtons({
  onSave,
  onCancel,
  saving,
  className,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={className ?? "flex items-center gap-1"}>
      <Button size="sm" onClick={onSave} disabled={saving}>
        <Check className="h-4 w-4 mr-1" />
        {t("common.save")}
      </Button>
      <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
        <X className="h-4 w-4 mr-1" />
        {t("common.cancel")}
      </Button>
    </div>
  );
}

/** 手機卡片用的直排編輯表單（欄位與桌機列相同） */
export function ClassroomDraftForm({
  draft,
  onDraftChange,
  onSave,
  onCancel,
  saving,
}: DraftFieldsProps & {
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  return (
    <div
      className="space-y-2"
      onKeyDown={draftKeyDownHandler(onSave, onCancel)}
    >
      <div className="grid grid-cols-[auto_1fr] gap-2 items-start">
        <DraftGradeField
          draft={draft}
          onDraftChange={onDraftChange}
          disabled={saving}
        />
        <DraftTextFields
          draft={draft}
          onDraftChange={onDraftChange}
          disabled={saving}
        />
      </div>
      <DraftLevelField
        draft={draft}
        onDraftChange={onDraftChange}
        disabled={saving}
      />
      <SaveCancelButtons
        onSave={onSave}
        onCancel={onCancel}
        saving={saving}
        className="flex justify-end gap-2"
      />
    </div>
  );
}

export interface ClassroomTableRowProps {
  classroom: ClassroomRowData;
  /** 表格有勾選欄（可編輯的工作區）時為 true，即使本列不可勾選也要留空格 */
  showSelectColumn: boolean;
  selectable: boolean;
  /** 勾選框停用（例如本列正在行內編輯） */
  selectDisabled?: boolean;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  createdAtText: string;
  /** 機構／學校工作區：編輯、刪除停用 */
  readOnly: boolean;
  onDispatch: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canToggleStatus: boolean;
  statusBusy?: boolean;
  onToggleActive: (active: boolean) => void;
  editing: boolean;
  draft: ClassroomDraft | null;
  onDraftChange: (draft: ClassroomDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

export function ClassroomTableRow({
  classroom,
  showSelectColumn,
  selectable,
  selectDisabled,
  selected,
  onSelectedChange,
  expanded,
  onToggleExpanded,
  createdAtText,
  readOnly,
  onDispatch,
  onEdit,
  onDelete,
  canToggleStatus,
  statusBusy,
  onToggleActive,
  editing,
  draft,
  onDraftChange,
  onSave,
  onCancel,
  saving,
}: ClassroomTableRowProps) {
  const { t } = useTranslation();
  const inactive = isClassroomInactive(classroom);
  const isEditing = editing && draft !== null;
  const fieldProps = draft ? { draft, onDraftChange, disabled: saving } : null;

  let gradeCell: ReactNode;
  let nameCell: ReactNode;
  let levelCell: ReactNode;
  let actionsCell: ReactNode;

  if (isEditing && fieldProps) {
    gradeCell = <DraftGradeField {...fieldProps} />;
    nameCell = <DraftTextFields {...fieldProps} />;
    levelCell = <DraftLevelField {...fieldProps} />;
    actionsCell = (
      <SaveCancelButtons onSave={onSave} onCancel={onCancel} saving={saving} />
    );
  } else {
    gradeCell = (
      <span
        className={
          isValidGrade(classroom.grade)
            ? "dark:text-gray-200"
            : "text-gray-400 dark:text-gray-500"
        }
      >
        {formatGradeLabel(t, classroom.grade)}
      </span>
    );
    nameCell = (
      <div className="flex items-center space-x-2">
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
        )}
        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
          <GraduationCap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0">
          <Link
            to={`/teacher/classroom/${classroom.id}`}
            className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline text-sm"
            onClick={stop}
          >
            {classroom.name}
          </Link>
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              {classroom.program_count || 0}
            </span>
            {classroom.description && (
              <span className="truncate max-w-[200px]">
                {classroom.description}
              </span>
            )}
          </div>
        </div>
      </div>
    );
    levelCell = <LevelBadge level={classroom.level} />;
    const dispatchTitle = inactive
      ? t("classroomGrade.status.dispatchDisabled")
      : t("teacherClassrooms.buttons.dispatchAssignment");
    actionsCell = (
      <div className="flex items-center space-x-1">
        <Button
          variant="ghost"
          size="sm"
          title={dispatchTitle}
          aria-label={dispatchTitle}
          onClick={onDispatch}
          className="p-1 sm:p-2"
          disabled={classroom.student_count === 0 || inactive}
        >
          <ClipboardList className="h-3 w-3 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline ml-1 text-xs">
            {t("teacherClassrooms.buttons.dispatchAssignment")}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={t("common.edit")}
          onClick={onEdit}
          className="p-1 sm:p-2"
          disabled={readOnly}
        >
          <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={t("common.delete")}
          onClick={onDelete}
          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 p-1 sm:p-2"
          disabled={readOnly}
        >
          <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
        </Button>
      </div>
    );
  }

  return (
    <TableRow
      data-testid={`classroom-row-${classroom.id}`}
      className={
        isEditing
          ? "bg-blue-50/60 dark:bg-blue-900/10"
          : `hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer ${
              inactive ? "text-gray-500" : ""
            }`
      }
      onClick={isEditing ? undefined : onToggleExpanded}
      onKeyDown={isEditing ? draftKeyDownHandler(onSave, onCancel) : undefined}
    >
      {showSelectColumn && (
        <TableCell onClick={stop}>
          {selectable && (
            <Checkbox
              disabled={selectDisabled}
              checked={selected}
              onCheckedChange={(checked) => onSelectedChange(checked === true)}
              aria-label={t("classroomGrade.selection.selectRow", {
                name: classroom.name,
              })}
            />
          )}
        </TableCell>
      )}
      <TableCell className="text-xs sm:text-sm">{gradeCell}</TableCell>
      <TableCell>{nameCell}</TableCell>
      <TableCell>{levelCell}</TableCell>
      <TableCell className="text-xs sm:text-sm dark:text-gray-200">
        {classroom.student_count}
      </TableCell>
      <TableCell className="text-xs sm:text-sm dark:text-gray-200">
        {createdAtText}
      </TableCell>
      <TableCell onClick={stop}>
        <div className="flex items-center gap-2">
          {canToggleStatus ? (
            <LabeledSwitch
              tone="brand"
              checked={!inactive}
              disabled={statusBusy || isEditing}
              onCheckedChange={onToggleActive}
              label={
                inactive
                  ? t("classroomGrade.status.switchEnable")
                  : t("classroomGrade.status.switchDisable")
              }
              ariaLabel={
                inactive
                  ? t("classroomGrade.status.switchEnableAria")
                  : t("classroomGrade.status.switchDisableAria")
              }
            />
          ) : (
            <ClassroomStatusBadge active={!inactive} />
          )}
        </div>
      </TableCell>
      <TableCell onClick={stop}>{actionsCell}</TableCell>
    </TableRow>
  );
}

export default ClassroomTableRow;
