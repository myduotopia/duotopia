/**
 * 上傳題本核對畫面的對話框（#1112 C4b）：
 * - `DuplicateOriginalDialog`：「看原題」——題庫已有這題時，以 id 抓那一題（或那一組）用題庫預覽
 *   元件顯示（QuestionsPreview／GroupPreview，含答案）。抓不到（已刪除、沒權限）顯示說明。
 * - `AddCardDialog`：「手動補一題」——先選題型（選擇題／閱讀題組／克漏字題組），原卷題號選填（A6）；
 *   新增後直接展開編輯。
 * 刪除這一題、略過核對、放棄的確認用標準 ConfirmDialog（在 ExamImportReview／ExamImportSheet）。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api";
import GroupPreview from "../GroupPreview";
import QuestionsPreview from "../QuestionsPreview";
import {
  draftFromQuestion,
  groupDraftFromGroup,
  type UnitDraft,
} from "../questionDraft";
import type { AddCardInput, DuplicateTarget } from "./useExamImportReview";

export function DuplicateOriginalDialog({
  target,
  onClose,
}: {
  target: DuplicateTarget | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<UnitDraft | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUnit(null);
    setFailed(false);
    if (!target) return;
    let cancelled = false;
    const load =
      target.kind === "group"
        ? apiClient.getQuestionGroup(target.id).then(
            (g): UnitDraft => ({
              kind: "group",
              draft: groupDraftFromGroup(g),
            }),
          )
        : apiClient.getQuestion(target.id).then(
            (q): UnitDraft => ({
              kind: "single",
              draft: draftFromQuestion(q),
            }),
          );
    load
      .then((u) => {
        if (!cancelled) setUnit(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[85vh] max-w-2xl overflow-y-auto"
        data-testid="exam-review-duplicate-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {t("questionBank.examImport.review.originalTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("questionBank.examImport.review.issue.duplicate")}
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <p className="text-sm text-gray-500">
            {t("questionBank.examImport.review.originalUnavailable")}
          </p>
        ) : !unit ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : unit.kind === "single" ? (
          <QuestionsPreview
            questions={[unit.draft]}
            showAnswers
            testId="exam-review-original-preview"
          />
        ) : (
          <GroupPreview
            draft={unit.draft}
            showAnswers
            testId="exam-review-original-preview"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AddCardDialog({
  pageNo,
  onClose,
  onSubmit,
}: {
  pageNo: number | null;
  onClose: () => void;
  onSubmit: (input: AddCardInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<AddCardInput["type"] | "">("");
  const [no, setNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (pageNo !== null) {
      setType("");
      setNo("");
    }
  }, [pageNo]);

  const submit = async () => {
    if (pageNo === null || !type) return;
    setSubmitting(true);
    try {
      await onSubmit({ type, pageNo, sourceQuestionNo: no });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={pageNo !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="exam-review-add-dialog">
        <DialogHeader>
          <DialogTitle>
            {t("questionBank.examImport.review.addTitle", { n: pageNo ?? 0 })}
          </DialogTitle>
          <DialogDescription>
            {t("questionBank.examImport.review.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-sm text-gray-700">
              {t("questionBank.examImport.review.addType")}
            </Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as AddCardInput["type"])}
            >
              <SelectTrigger data-testid="exam-review-add-type">
                <SelectValue
                  placeholder={t(
                    "questionBank.examImport.review.addTypePlaceholder",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">
                  {t("questionBank.types.multiple_choice")}
                </SelectItem>
                <SelectItem value="reading">
                  {t("questionBank.groupTypes.reading")}
                </SelectItem>
                <SelectItem value="cloze">
                  {t("questionBank.groupTypes.cloze")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-sm text-gray-700">
              {t("questionBank.examImport.review.addNo")}
            </Label>
            <Input
              value={no}
              onChange={(e) => setNo(e.target.value)}
              maxLength={20}
              placeholder={t("questionBank.examImport.review.addNoPlaceholder")}
              data-testid="exam-review-add-no"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            {t("common.cancel", "取消")}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!type || submitting}
            data-testid="exam-review-add-submit"
          >
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("questionBank.examImport.review.addSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
