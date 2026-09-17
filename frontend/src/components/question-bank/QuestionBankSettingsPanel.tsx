/**
 * 左欄・設定／關聯區（Issue #1064）。整批共用：
 * - 教材包／單元關聯（查詢既有教材包、可掛到單元）
 * - 適合年級 K12（min–max）
 * - 考點（ExamPointPicker；AI 考點分析在 #1065 可自動填）
 * - 公開設定
 * 新增時套用到右側所有題目；編輯時由該題預填、儲存套回該題。
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Program } from "@/types";
import type {
  QuestionProgramLink,
  QuestionVisibility,
} from "@/types/questionBank";
import ExamPointPicker from "./ExamPointPicker";
import type { SharedSettings } from "./questionDraft";

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);
const VISIBILITIES: QuestionVisibility[] = [
  "private",
  "public",
  "organization_only",
  "individual_only",
];

export interface QuestionBankSettingsPanelProps {
  value: SharedSettings;
  onChange: (next: SharedSettings) => void;
  programs: Program[];
  readOnly?: boolean;
  /** 驗證訊息（如年級範圍） */
  errorMessage?: string | null;
}

export default function QuestionBankSettingsPanel({
  value,
  onChange,
  programs,
  readOnly = false,
  errorMessage = null,
}: QuestionBankSettingsPanelProps) {
  const { t } = useTranslation();
  const [linkProgramId, setLinkProgramId] = useState("");
  const [linkLessonId, setLinkLessonId] = useState("");

  const patch = (p: Partial<SharedSettings>) => onChange({ ...value, ...p });

  const selectedProgram = programs.find((p) => String(p.id) === linkProgramId);
  const addLink = () => {
    if (!selectedProgram) return;
    const lessonId = linkLessonId ? Number(linkLessonId) : null;
    const exists = value.program_links.some(
      (l) => l.program_id === selectedProgram.id && l.lesson_id === lessonId,
    );
    if (!exists)
      patch({
        program_links: [
          ...value.program_links,
          { program_id: selectedProgram.id, lesson_id: lessonId },
        ],
      });
    setLinkLessonId("");
  };
  const linkLabel = (l: QuestionProgramLink) => {
    const p = programs.find((x) => x.id === l.program_id);
    const lesson = p?.lessons?.find((x) => x.id === l.lesson_id);
    const pName = p?.name ?? `#${l.program_id}`;
    return lesson ? `${pName} › ${lesson.name}` : pName;
  };

  const gradeSelect = (
    v: number | null,
    set: (n: number | null) => void,
    testId: string,
  ) => (
    <Select
      value={v === null ? "none" : String(v)}
      onValueChange={(s) => set(s === "none" ? null : Number(s))}
      disabled={readOnly}
    >
      <SelectTrigger className="h-9" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t("questionBank.form.gradeAny")}</SelectItem>
        {GRADES.map((g) => (
          <SelectItem key={g} value={String(g)}>
            {t("questionBank.gradeSingle", { grade: g })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4" data-testid="qb-settings">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">
          {t("questionBank.form.settings.title")}
        </h3>
        <p className="text-xs text-gray-500">
          {t("questionBank.form.settings.hint")}
        </p>
      </div>

      {/* 教材包／單元 */}
      <div className="space-y-1.5">
        <Label>{t("questionBank.form.programLinks")}</Label>
        {value.program_links.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.program_links.map((l) => (
              <span
                key={`${l.program_id}-${l.lesson_id ?? "p"}`}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                data-testid="qb-program-link"
              >
                {linkLabel(l)}
                {!readOnly && (
                  <button
                    type="button"
                    className="rounded-full hover:bg-gray-300/60 p-0.5"
                    onClick={() =>
                      patch({
                        program_links: value.program_links.filter(
                          (x) => x !== l,
                        ),
                      })
                    }
                    aria-label={t("questionBank.form.removeLink")}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {!readOnly && (
          <div className="space-y-2">
            <Select
              value={linkProgramId}
              onValueChange={(v) => {
                setLinkProgramId(v);
                setLinkLessonId("");
              }}
            >
              <SelectTrigger className="h-9" data-testid="qb-link-program">
                <SelectValue placeholder={t("questionBank.form.pickProgram")} />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Select
                value={linkLessonId}
                onValueChange={setLinkLessonId}
                disabled={!selectedProgram?.lessons?.length}
              >
                <SelectTrigger
                  className="h-9 flex-1"
                  data-testid="qb-link-lesson"
                >
                  <SelectValue
                    placeholder={t("questionBank.form.pickLessonOptional")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(selectedProgram?.lessons ?? []).map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1"
                disabled={!selectedProgram}
                onClick={addLink}
                data-testid="qb-link-add"
              >
                <Plus size={14} />
                {t("questionBank.form.addLink")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 年級 */}
      <div className="space-y-1.5">
        <Label>{t("questionBank.form.grade")}</Label>
        <div className="flex items-center gap-2">
          {gradeSelect(
            value.grade_min,
            (n) => patch({ grade_min: n }),
            "qb-grade-min",
          )}
          <span className="text-gray-400">–</span>
          {gradeSelect(
            value.grade_max,
            (n) => patch({ grade_max: n }),
            "qb-grade-max",
          )}
        </div>
      </div>

      {/* 考點 */}
      <div className="space-y-1.5">
        <Label>{t("questionBank.form.examPoints")}</Label>
        <ExamPointPicker
          value={value.exam_points}
          onChange={(exam_points) => patch({ exam_points })}
          disabled={readOnly}
        />
      </div>

      {/* 公開設定 */}
      <div className="space-y-1.5">
        <Label>{t("questionBank.form.visibility")}</Label>
        <Select
          value={value.visibility}
          onValueChange={(v) => patch({ visibility: v as QuestionVisibility })}
          disabled={readOnly}
        >
          <SelectTrigger className="h-9" data-testid="qb-visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VISIBILITIES.map((v) => (
              <SelectItem key={v} value={v}>
                {t(`questionBank.visibility.${v}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {errorMessage && (
        <p className="text-xs text-red-600" data-testid="qb-settings-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
