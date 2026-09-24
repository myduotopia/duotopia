/**
 * 題庫編輯面板右欄：依「單元」kind 分流的卡片列表（Issue #1082 骨架）。
 *
 * - `single` → 既有 `QuestionCard`（選擇題）
 * - `group`  → `GroupCardPlaceholder`：閱讀題組編輯器在 #1082 下一段接上，本段只佔位
 *
 * 同一個列表、同一個 sheet，不為題型另開路由或複製 sheet（與批改頁「同路由分 Panel」同原則）。
 * DOM id 一律 `question-card-<unitKey>`，讓 sheet 的捲動／定位對單題與題組一致。
 */

import { useTranslation } from "react-i18next";

import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import type { Program } from "@/types";
import QuestionCard from "./QuestionCard";
import { unitKey, type GroupDraft, type QuestionDraft, type UnitDraft } from "./questionDraft";

export interface QuestionUnitListProps {
  units: UnitDraft[];
  /** 每個單元的驗證錯誤（i18n key 最後一段）；與 units 同序 */
  errorKeys: (string | null)[];
  onChangeQuestion: (key: string, next: QuestionDraft) => void;
  onChangeGroup: (key: string, next: GroupDraft) => void;
  /** 可移除時傳入（單題編輯模式或只剩一個單元時不傳） */
  onRemove?: (key: string) => void;
  ttsSettings: TTSSettingsState;
  programs: Program[];
  readOnly: boolean;
  disabled: boolean;
}

function GroupCardPlaceholder({
  index,
  draft,
}: {
  index: number;
  draft: GroupDraft;
}) {
  const { t } = useTranslation();
  return (
    <div
      id={`question-card-${draft.key}`}
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500"
      data-testid={`qb-group-card-${draft.key}`}
    >
      <span className="font-medium text-gray-700">
        {index + 1}. {t(`questionBank.types.${draft.question_type}`)}
      </span>
      <span className="ml-2">{t("questionBank.comingSoon")}</span>
    </div>
  );
}

export default function QuestionUnitList({
  units,
  errorKeys,
  onChangeQuestion,
  onChangeGroup: _onChangeGroup,
  onRemove,
  ttsSettings,
  programs,
  readOnly,
  disabled,
}: QuestionUnitListProps) {
  const { t } = useTranslation();
  return (
    <>
      {units.map((u, i) =>
        u.kind === "single" ? (
          <QuestionCard
            key={unitKey(u)}
            index={i}
            draft={u.draft}
            onChange={(next) => onChangeQuestion(u.draft.key, next)}
            onRemove={onRemove ? () => onRemove(u.draft.key) : undefined}
            excludeId={u.draft.existingId ?? undefined}
            ttsSettings={ttsSettings}
            programs={programs}
            errorMessage={
              errorKeys[i]
                ? t(`questionBank.form.errors.${errorKeys[i]}`)
                : null
            }
            readOnly={readOnly}
            disabled={disabled}
          />
        ) : (
          <GroupCardPlaceholder key={unitKey(u)} index={i} draft={u.draft} />
        ),
      )}
    </>
  );
}
