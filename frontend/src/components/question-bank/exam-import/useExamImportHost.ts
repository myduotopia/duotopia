/**
 * 宿主頁面（我的教材 TeacherTemplatePrograms、機構教材 OrgMaterialsPage）建立上傳題本狀態的入口
 * （#1112 C4）：`useExamImport` ＋「打開那次匯入」跨題庫的切換。
 *
 * - 上傳時 409「這個題本已經匯入過」而那次在別的題庫：切到那個題庫的「題庫」分頁，網址帶
 *   `examImport=<id>`（機構另帶 `org=<機構 id>`）；我的題庫 → `/teacher/programs`，機構題庫 →
 *   `/teacher/org-materials`。學校題庫還沒開放上傳 → 只提示。
 * - 頁面載入時看到 `examImport` 參數就打開那一份（機構頁要目前工作區就是那個機構，否則提示先切換），
 *   打開後把參數從網址拿掉。
 */
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MATERIALS_TAB_PARAM } from "@/components/shared/MaterialsPageTabs";
import { useExamImport, type ExistingImportTarget } from "./useExamImport";

export const EXAM_IMPORT_PARAM = "examImport";
export const EXAM_IMPORT_ORG_PARAM = "org";

export function useExamImportHost({
  enabled = true,
  organizationId = null,
}: {
  enabled?: boolean;
  organizationId?: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const onOpenOtherBank = (target: ExistingImportTarget) => {
    if (target.schoolId) {
      toast.info(t("questionBank.examImport.openOtherSchool"));
      return;
    }
    const params = new URLSearchParams({
      [MATERIALS_TAB_PARAM]: "questions",
      [EXAM_IMPORT_PARAM]: String(target.id),
    });
    if (target.organizationId) {
      params.set(EXAM_IMPORT_ORG_PARAM, target.organizationId);
      navigate(`/teacher/org-materials?${params.toString()}`);
    } else {
      navigate(`/teacher/programs?${params.toString()}`);
    }
  };

  const controller = useExamImport(enabled, {
    organizationId,
    onOpenOtherBank,
  });

  const pending = searchParams.get(EXAM_IMPORT_PARAM);
  const pendingOrg = searchParams.get(EXAM_IMPORT_ORG_PARAM);
  const openRef = useRef(controller.openImport);
  openRef.current = controller.openImport;
  useEffect(() => {
    if (!pending || !enabled) return;
    const next = new URLSearchParams(searchParams);
    next.delete(EXAM_IMPORT_PARAM);
    next.delete(EXAM_IMPORT_ORG_PARAM);
    setSearchParams(next, { replace: true });
    if ((pendingOrg ?? null) !== (organizationId ?? null)) {
      toast.info(t("questionBank.examImport.openOtherOrg"));
      return;
    }
    const id = Number(pending);
    if (Number.isInteger(id) && id > 0) void openRef.current(id);
    // 只在網址參數出現時處理一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, pendingOrg, enabled, organizationId]);

  return controller;
}
