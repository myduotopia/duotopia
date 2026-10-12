/**
 * 題庫編輯面板右欄：依「單元」kind 分流的卡片列表（Issue #1082）。
 *
 * - `single` → `QuestionCard`（選擇題）
 * - `group`  → `GroupCard`（閱讀／克漏字題組：主圖文區塊編輯器 + 小題）
 *
 * 同一個列表、同一個 sheet，不為題型另開路由或複製 sheet（與批改頁「同路由分 Panel」同原則）。
 * DOM id 一律 `question-card-<unitKey>`，讓 sheet 的捲動／定位對單題與題組一致。
 * `showErrors` 為 false（老師還沒按過儲存）時不顯示驗證紅框／紅字：單題卡、題組卡、題組小題都隱藏；
 * 後端回傳的 `serverError` 不受影響。
 */

import { useTranslation } from "react-i18next";

import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import type { Program } from "@/types";
import GroupCard from "./GroupCard";
import QuestionCard from "./QuestionCard";
import {
  errorKeyParts,
  unitKey,
  type GroupDraft,
  type QuestionDraft,
  type UnitDraft,
} from "./questionDraft";

export interface QuestionUnitListProps {
  units: UnitDraft[];
  /** 每個單元的驗證錯誤（i18n key 最後一段）；與 units 同序 */
  errorKeys: (string | null)[];
  /** 是否顯示驗證錯誤（sheet 的 saveAttempted：按過儲存才顯示） */
  showErrors: boolean;
  onChangeQuestion: (key: string, next: QuestionDraft) => void;
  onChangeGroup: (key: string, next: GroupDraft) => void;
  /** 可移除時傳入（單題編輯模式或只剩一個單元時不傳） */
  onRemove?: (key: string) => void;
  ttsSettings: TTSSettingsState;
  programs: Program[];
  readOnly: boolean;
  disabled: boolean;
}

export default function QuestionUnitList({
  units,
  errorKeys,
  showErrors,
  onChangeQuestion,
  onChangeGroup,
  onRemove,
  ttsSettings,
  programs,
  readOnly,
  disabled,
}: QuestionUnitListProps) {
  const { t } = useTranslation();
  return (
    <>
      {units.map((u, i) => {
        const key = showErrors ? errorKeys[i] : null;
        const parts = key ? errorKeyParts(key) : null;
        const errorMessage = parts
          ? t(`questionBank.form.errors.${parts.key}`, parts.params)
          : null;
        return u.kind === "single" ? (
          <QuestionCard
            key={unitKey(u)}
            index={i}
            draft={u.draft}
            onChange={(next) => onChangeQuestion(u.draft.key, next)}
            onRemove={onRemove ? () => onRemove(u.draft.key) : undefined}
            excludeId={u.draft.existingId ?? undefined}
            ttsSettings={ttsSettings}
            programs={programs}
            errorMessage={errorMessage}
            showErrors={showErrors}
            readOnly={readOnly}
            disabled={disabled}
          />
        ) : (
          <GroupCard
            key={unitKey(u)}
            index={i}
            draft={u.draft}
            onChange={(next) => onChangeGroup(u.draft.key, next)}
            onRemove={onRemove ? () => onRemove(u.draft.key) : undefined}
            ttsSettings={ttsSettings}
            programs={programs}
            errorMessage={errorMessage}
            showErrors={showErrors}
            readOnly={readOnly}
            disabled={disabled}
          />
        );
      })}
    </>
  );
}
