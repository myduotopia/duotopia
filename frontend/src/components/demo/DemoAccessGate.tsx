/**
 * DemoAccessGate (#989)
 *
 * Shown instead of the activity when a public demo assignment is outside the
 * schedule its teacher set: either it has not opened yet, or it has expired.
 *
 * Both states carry the same offer — register, log in, and the resource pack
 * behind this demo is copied into your own library so you can keep practising
 * for free. The copy target is passed along in the post-login redirect path
 * (`?demoCopyProgram=<id>`) and executed once the visitor lands on their
 * materials page. When the backend could not resolve a copyable pack
 * (`resourceProgramId == null`) the copy promise is dropped and only the plain
 * register/login invitation remains, so we never advertise an action that would
 * fail.
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarClock, Hourglass, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveRedirectTarget } from "@/utils/redirectAfterLogin";
import { DEMO_COPY_PROGRAM_PARAM } from "@/hooks/useDemoMaterialCopy";
import type { DemoAccessStatus } from "@/lib/demoApi";

interface DemoAccessGateProps {
  status: Exclude<DemoAccessStatus, "active">;
  startDate?: string | null;
  resourceProgramId?: number | null;
  resourceProgramName?: string | null;
}

/** Format an ISO timestamp in the visitor's language, or "" when absent. */
function formatDateTime(
  iso: string | null | undefined,
  locale: string,
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DemoAccessGate({
  status,
  startDate,
  resourceProgramId,
  resourceProgramName,
}: DemoAccessGateProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const canCopy = typeof resourceProgramId === "number";

  const goToAuth = (page: "login" | "register") => {
    // The materials page performs the copy once the visitor arrives there.
    saveRedirectTarget(
      canCopy
        ? `/teacher/programs?${DEMO_COPY_PROGRAM_PARAM}=${resourceProgramId}`
        : "/teacher/programs",
    );
    navigate(`/teacher/${page}`);
  };

  const isExpired = status === "expired";
  const Icon = isExpired ? Hourglass : CalendarClock;

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-2xl shadow-sm border dark:border-gray-700 p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
          <Icon className="h-7 w-7 text-amber-600 dark:text-amber-400" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {isExpired
            ? t("demo.access.expired.title")
            : t("demo.access.notStarted.title")}
        </h1>

        {/* Only the "not open yet" state shows a time — a visitor who arrives
            too late has no reason to care exactly when it closed, but one who
            arrives early needs to know when to come back. */}
        {!isExpired && startDate && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            {t("demo.access.notStarted.availableFrom", {
              datetime: formatDateTime(startDate, i18n.language),
            })}
          </p>
        )}

        <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
          {t(
            `demo.access.${isExpired ? "expired" : "notStarted"}.${
              canCopy ? "invitation" : "invitationNoCopy"
            }`,
          )}
        </p>

        {canCopy && resourceProgramName && (
          <div className="mb-6 inline-flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
            <Sparkles className="h-4 w-4 flex-shrink-0" />
            <span>
              {t("demo.access.materialName", { name: resourceProgramName })}
            </span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            className="btn-amber-shine"
            onClick={() => goToAuth("register")}
          >
            {t("demo.access.registerCta")}
          </Button>
          <Button variant="outline" onClick={() => goToAuth("login")}>
            {t("demo.access.loginCta")}
          </Button>
        </div>
      </div>
    </div>
  );
}
