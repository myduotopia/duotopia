import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, Building2, School, Users, Check } from "lucide-react";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import {
  authService,
  type LinkedAccount,
} from "@/services/authService";

export function AccountSwitcher() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, login } = useStudentAuthStore();
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);

  const fetchLinkedAccounts = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await authService.getLinkedAccounts(user.id);
      setLinkedAccounts(data.linked_accounts);
    } catch {
      // Silently fail - user may not have linked accounts
      setLinkedAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.has_linked_accounts) {
      fetchLinkedAccounts();
    }
  }, [user?.has_linked_accounts, fetchLinkedAccounts]);

  const handleSwitch = async (account: LinkedAccount) => {
    setSwitching(true);
    try {
      const result = await authService.switchAccount(account.student_id);

      // Update auth store with new token and user info
      const studentInfo = result.student;
      login(result.access_token, {
        id: studentInfo.student_id,
        name: studentInfo.name,
        email: user?.email || "",
        student_number: studentInfo.student_number || "",
        classroom_id: studentInfo.classroom?.id || 0,
        classroom_name: studentInfo.classroom?.name,
        teacher_name: studentInfo.classroom?.teacher_name || undefined,
        school_id: studentInfo.school?.id,
        school_name: studentInfo.school?.name,
        organization_id: studentInfo.organization?.id,
        organization_name: studentInfo.organization?.name,
        has_linked_accounts: true,
        linked_accounts_count: linkedAccounts.length,
      });

      toast.success(
        t("accountSwitcher.switchSuccess", {
          name: studentInfo.name,
          org:
            studentInfo.organization?.name ||
            studentInfo.school?.name ||
            studentInfo.classroom?.name ||
            "",
        }),
      );

      navigate("/student/dashboard");
    } catch {
      toast.error(t("accountSwitcher.switchError"));
    } finally {
      setSwitching(false);
    }
  };

  // Don't render if no linked accounts
  if (!user?.has_linked_accounts || linkedAccounts.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs text-blue-600 hover:bg-blue-50 mt-1 px-3 py-1.5 h-auto"
          disabled={switching}
        >
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span>
              {t("accountSwitcher.switchAccount")} ({linkedAccounts.length})
            </span>
          </div>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-gray-500">
          {t("accountSwitcher.currentAccount")}
        </DropdownMenuLabel>

        {/* Current account */}
        <DropdownMenuItem disabled className="opacity-100">
          <div className="flex items-center gap-2 w-full">
            <div className="w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {user?.name?.charAt(0).toUpperCase() || "S"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-gray-500 truncate">
                {user?.organization_name ||
                  user?.school_name ||
                  user?.classroom_name}
              </p>
            </div>
            <Check className="h-4 w-4 text-blue-500 flex-shrink-0" />
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-gray-500">
          {t("accountSwitcher.linkedAccounts")}
        </DropdownMenuLabel>

        {/* Linked accounts */}
        {loading ? (
          <DropdownMenuItem disabled>
            <span className="text-xs text-gray-400">
              {t("accountSwitcher.loading")}
            </span>
          </DropdownMenuItem>
        ) : (
          linkedAccounts.map((account) => (
            <DropdownMenuItem
              key={account.student_id}
              onClick={() => handleSwitch(account)}
              disabled={switching}
              className="cursor-pointer"
            >
              <div className="flex items-center gap-2 w-full">
                <div className="w-7 h-7 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {account.name?.charAt(0).toUpperCase() || "S"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {account.name}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    {account.organization && (
                      <>
                        <Building2 className="h-3 w-3" />
                        <span className="truncate">
                          {account.organization.name}
                        </span>
                      </>
                    )}
                    {!account.organization && account.school && (
                      <>
                        <School className="h-3 w-3" />
                        <span className="truncate">{account.school.name}</span>
                      </>
                    )}
                    {!account.organization &&
                      !account.school &&
                      account.classroom && (
                        <span className="truncate">
                          {account.classroom.name}
                        </span>
                      )}
                  </div>
                </div>
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
