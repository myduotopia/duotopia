/**
 * SchoolList - Organization + School List (Phase 1)
 *
 * Displays organizations as headers and schools as clickable items.
 * Two-phase navigation: select school first, then show switcher + menu.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Building2, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useWorkspace,
  Organization,
  School,
} from "@/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";

export const SchoolList: React.FC = () => {
  const { t } = useTranslation();
  const { organizations, selectedSchool, selectSchool, loading } =
    useWorkspace();

  if (loading) {
    return (
      <div className="space-y-3 px-3">
        {/* Skeleton loading */}
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("workspace.organization.noOrganizations")}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-280px)]">
      <div className="space-y-4 pb-4">
        {organizations.map((org) => (
          <div key={org.id} className="space-y-1">
            {/* Organization Header */}
            <div className="px-3 py-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {org.name}
              </h3>
            </div>

            {/* Schools List */}
            <div className="space-y-0.5">
              {org.schools.map((school) => (
                <SchoolItem
                  key={school.id}
                  school={school}
                  organization={org}
                  isSelected={selectedSchool?.id === school.id}
                  onSelect={() => selectSchool(school, org)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};

// ============================================
// School Item Component
// ============================================

interface SchoolItemProps {
  school: School;
  organization: Organization;
  isSelected: boolean;
  onSelect: () => void;
}

const SchoolItem: React.FC<SchoolItemProps> = ({
  school,
  isSelected,
  onSelect,
}) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "w-full px-3 py-2.5 rounded-md text-left flex items-center gap-3 transition-all duration-150",
        isSelected
          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-l-4 border-blue-600"
          : isHovered
            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
            : "text-slate-700 dark:text-slate-300",
      )}
    >
      {/* Icon */}
      <Building2
        className={cn(
          "h-4 w-4 flex-shrink-0 transition-colors",
          isSelected
            ? "text-blue-600 dark:text-blue-400"
            : isHovered
              ? "text-blue-600 dark:text-blue-400"
              : "text-slate-500 dark:text-slate-400",
        )}
      />

      {/* School Name */}
      <span className="text-sm font-medium flex-1">{school.name}</span>

      {/* Chevron (on hover) */}
      {isHovered && (
        <ChevronRight
          className="h-4 w-4 text-blue-600 dark:text-blue-400 transition-transform duration-150"
          style={{ transform: "translateX(0)" }}
        />
      )}
    </button>
  );
};

export default SchoolList;
