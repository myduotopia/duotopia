import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe, Lock, Building2, User } from "lucide-react";
import { toast } from "sonner";

export type ProgramVisibility =
  | "private"
  | "public"
  | "organization_only"
  | "individual_only";

const VISIBILITY_OPTIONS: {
  value: ProgramVisibility;
  label: string;
  icon: typeof Globe;
  color: string;
}[] = [
  {
    value: "private",
    label: "不公開",
    icon: Lock,
    color: "bg-gray-100 text-gray-600",
  },
  {
    value: "public",
    label: "全公開",
    icon: Globe,
    color: "bg-green-100 text-green-700",
  },
  {
    value: "organization_only",
    label: "限組織",
    icon: Building2,
    color: "bg-blue-100 text-blue-700",
  },
  {
    value: "individual_only",
    label: "限個人",
    icon: User,
    color: "bg-orange-100 text-orange-700",
  },
];

interface ProgramVisibilitySelectorProps {
  programId: number;
  currentVisibility: ProgramVisibility;
  onVisibilityChange: (
    programId: number,
    visibility: ProgramVisibility,
  ) => Promise<void>;
}

export function ProgramVisibilitySelector({
  programId,
  currentVisibility,
  onVisibilityChange,
}: ProgramVisibilitySelectorProps) {
  const [updating, setUpdating] = useState(false);

  const current =
    VISIBILITY_OPTIONS.find((o) => o.value === currentVisibility) ??
    VISIBILITY_OPTIONS[0];
  const Icon = current.icon;

  const handleSelect = async (visibility: ProgramVisibility) => {
    if (visibility === currentVisibility) return;
    setUpdating(true);
    try {
      await onVisibilityChange(programId, visibility);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新公開設定失敗");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-opacity ${current.color} ${updating ? "opacity-50" : "hover:opacity-80"}`}
          onClick={(e) => e.stopPropagation()}
          disabled={updating}
        >
          <Icon className="w-3 h-3" />
          {current.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {VISIBILITY_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          const isSelected = option.value === currentVisibility;
          return (
            <DropdownMenuItem
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className={isSelected ? "font-semibold bg-gray-100" : ""}
            >
              <OptionIcon
                className={`w-4 h-4 mr-2 ${isSelected ? "text-primary" : ""}`}
              />
              {option.label}
              {isSelected && (
                <span className="ml-auto text-primary text-xs">&#10003;</span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
