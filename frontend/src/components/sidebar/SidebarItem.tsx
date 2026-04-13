/**
 * Sidebar 單個項目組件
 */

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { SidebarItem as SidebarItemType } from "@/types/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarItemProps {
  item: SidebarItemType;
  isActive: boolean;
  isCollapsed: boolean;
  isReadOnly?: boolean;
  onNavigate?: () => void;
}

export const SidebarItem = ({
  item,
  isActive,
  isCollapsed,
  isReadOnly = false,
  onNavigate,
}: SidebarItemProps) => {
  const { t } = useTranslation();
  const Icon = item.icon;

  return (
    <Link to={item.path} className="block" onClick={onNavigate}>
      <Button
        variant={isActive ? "default" : "ghost"}
        className={`w-full h-10 min-h-10 ${isCollapsed ? "justify-center px-0" : "justify-start px-4"}`}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        {!isCollapsed && (
          <>
            <span className="ml-2 text-sm flex-1 text-left">{item.label}</span>
            {isReadOnly && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Eye className="h-3.5 w-3.5 text-slate-400 ml-2" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {t("workspace.permissions.readOnly")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </>
        )}
      </Button>
    </Link>
  );
};
