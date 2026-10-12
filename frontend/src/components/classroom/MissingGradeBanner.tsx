/**
 * MissingGradeBanner — 「有 N 個班級尚未設定年級」提醒（#1097）
 *
 * 樣式比照 workspace/PermissionBanner。刻意不提供永久關閉：
 * 只要還有未設定年級的班級（count > 0）就顯示，補完即消失。
 * hideAction：暫時隱藏「立即設定」（例如「我的班級」有列正在行內編輯時），提醒文字照常顯示。
 */
import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface MissingGradeBannerProps {
  /** 尚未設定年級的班級數；<= 0 時不渲染 */
  count: number;
  /** 點「立即設定」 */
  onAction: () => void;
  /** 暫時隱藏「立即設定」按鈕 */
  hideAction?: boolean;
  className?: string;
}

export function MissingGradeBanner({
  count,
  onAction,
  hideAction = false,
  className,
}: MissingGradeBannerProps) {
  const { t } = useTranslation();

  if (count <= 0) return null;

  return (
    <Alert
      className={`mb-4 border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/20 ${className ?? ""}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-3 flex-1">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <AlertDescription className="text-sm text-amber-800 dark:text-amber-300">
            {t("classroomGrade.banner.message", { count })}
          </AlertDescription>
        </div>
        {!hideAction && (
          <Button
            size="sm"
            variant="outline"
            onClick={onAction}
            className="border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
          >
            {t("classroomGrade.banner.action")}
          </Button>
        )}
      </div>
    </Alert>
  );
}

export default MissingGradeBanner;
