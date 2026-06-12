/**
 * StudentLoginQRShare (Issue #793)
 *
 * 教師分享「學生登入 QR」共用元件。提供視圖選擇器（個人 / 機構 / 學校），
 * 依選擇的 scope 透過 buildStudentLoginUrl 產生連結，渲染 QR code、唯讀連結與複製按鈕。
 *
 * Provider 安全：本元件可能被渲染在 WorkspaceProvider 之外（如未掛 Provider 的
 * 舊版 Dashboard）。透過 useWorkspaceSafe() 取得 context，缺少 Provider 時回傳 null，
 * 此時僅顯示「個人」選項並仍渲染可用的 QR，不會 crash。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildStudentLoginUrl,
  StudentLoginScope,
} from "@/services/teacherService";
import { useWorkspaceSafe } from "@/contexts/WorkspaceContext";

interface StudentLoginQRShareProps {
  email: string;
}

/** 選擇器的扁平選項（value 為穩定字串鍵，label 已含層級前綴） */
interface ScopeOption {
  value: string;
  label: string;
  scope: StudentLoginScope;
}

const PERSONAL_VALUE = "personal";

export default function StudentLoginQRShare({
  email,
}: StudentLoginQRShareProps) {
  const { t } = useTranslation();
  const workspace = useWorkspaceSafe();
  const [copied, setCopied] = useState(false);

  // 組出扁平選項：個人 → 各機構 → 機構底下各學校
  const options = useMemo<ScopeOption[]>(() => {
    const list: ScopeOption[] = [
      {
        value: PERSONAL_VALUE,
        label: t("studentLoginQR.personal"),
        scope: { type: "personal" },
      },
    ];

    const organizations = workspace?.organizations ?? [];
    for (const org of organizations) {
      list.push({
        value: `org:${org.id}`,
        label: `${t("studentLoginQR.orgPrefix")}${org.name}`,
        scope: { type: "org", orgId: org.id },
      });
      for (const school of org.schools ?? []) {
        list.push({
          value: `school:${school.id}`,
          label: `${t("studentLoginQR.schoolPrefix")}${school.name}`,
          scope: { type: "school", schoolId: school.id },
        });
      }
    }

    return list;
  }, [workspace?.organizations, t]);

  // 預設值：current workspace selection（school → org → personal）
  const defaultValue = useMemo<string>(() => {
    if (workspace?.selectedSchool) {
      return `school:${workspace.selectedSchool.id}`;
    }
    if (workspace?.selectedOrganization) {
      return `org:${workspace.selectedOrganization.id}`;
    }
    return PERSONAL_VALUE;
  }, [workspace?.selectedSchool, workspace?.selectedOrganization]);

  const [selectedValue, setSelectedValue] = useState<string>(defaultValue);

  // 若選到的選項已不存在（如 workspace 變動），退回個人
  const selectedScope = useMemo<StudentLoginScope>(() => {
    const match = options.find((o) => o.value === selectedValue);
    return match ? match.scope : { type: "personal" };
  }, [options, selectedValue]);

  const url = useMemo(
    () => buildStudentLoginUrl(email, selectedScope),
    [email, selectedScope],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  // 只有「個人」一個選項時不顯示選擇器（沒有 Provider / 沒有機構）
  const showPicker = options.length > 1;

  return (
    <div className="space-y-4">
      {showPicker && (
        <div className="space-y-1">
          <label className="text-sm font-medium text-gray-700">
            {t("studentLoginQR.viewLabel")}
          </label>
          <Select value={selectedValue} onValueChange={setSelectedValue}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex justify-center p-4 bg-white border rounded-lg">
        <QRCodeSVG value={url} size={200} />
      </div>

      <div className="flex items-center space-x-2">
        <Input value={url} readOnly className="flex-1" />
        <Button size="sm" onClick={handleCopy} className="flex-shrink-0">
          {copied ? (
            <>
              <Check className="h-4 w-4 mr-2" />
              {t("teacherDashboard.share.copied")}
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 mr-2" />
              {t("teacherDashboard.share.copy")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
