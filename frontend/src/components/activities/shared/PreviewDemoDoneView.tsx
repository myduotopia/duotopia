/**
 * PreviewDemoDoneView — 老師預覽小考「考前說明」模式的提交後畫面（#1045 階段 4）
 *
 * 考前說明是投影給全班看怎麼作答，提交後不得出現分數、✓/✗ 或正解，
 * 只顯示「示範結束」與「重新示範」。
 *
 * 另匯出 RestartDemoButton：「考後檢討」模式放在 QuizReviewView 下方。
 * 兩者只在老師預覽頁（TeacherAssignmentPreviewPage）出現；學生作答、demo、
 * 派發 dialog 即時預覽都不會渲染。
 */
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface RestartProps {
  onRestart?: () => void;
}

export function RestartDemoButton({ onRestart }: RestartProps) {
  const { t } = useTranslation();
  if (!onRestart) return null;
  return (
    <div className="flex justify-center pt-2">
      <Button
        type="button"
        data-testid="preview-restart-demo"
        onClick={onRestart}
        className="gap-2"
      >
        <RotateCcw className="h-4 w-4" />
        {t("previewPage.quizMode.restart") || "重新示範"}
      </Button>
    </div>
  );
}

export default function PreviewDemoDoneView({ onRestart }: RestartProps) {
  const { t } = useTranslation();
  return (
    <Card className="p-6 text-center" data-testid="preview-demo-done">
      <CardContent className="p-0 space-y-3">
        <div className="text-2xl font-bold text-gray-800">
          {t("previewPage.quizMode.demoDone") || "示範結束"}
        </div>
        <p className="text-sm text-gray-500">
          {t("previewPage.quizMode.demoDoneDesc") ||
            "考前說明模式不顯示分數與正解"}
        </p>
        <RestartDemoButton onRestart={onRestart} />
      </CardContent>
    </Card>
  );
}
