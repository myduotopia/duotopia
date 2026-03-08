import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronDown, GraduationCap, Check } from "lucide-react";
import {
  useStudentAuthStore,
  type ClassroomInfo,
} from "@/stores/studentAuthStore";

export function ClassroomSwitcher() {
  const { t } = useTranslation();
  const { user, switchClassroom } = useStudentAuthStore();

  const classrooms = user?.classrooms || [];

  // Don't render if only one or no classrooms
  if (classrooms.length <= 1) {
    return null;
  }

  const handleSwitch = (classroom: ClassroomInfo) => {
    if (classroom.id === user?.classroom_id) return;
    switchClassroom(classroom);
    // Reload page to refresh data for new classroom
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs text-emerald-600 hover:bg-emerald-50 mt-1 px-3 py-1.5 h-auto"
        >
          <div className="flex items-center gap-1.5">
            <GraduationCap className="h-3.5 w-3.5" />
            <span>
              {t("classroomSwitcher.switchClassroom")} ({classrooms.length})
            </span>
          </div>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-gray-500">
          {t("classroomSwitcher.currentClassroom")}
        </DropdownMenuLabel>

        {/* Current classroom */}
        <DropdownMenuItem disabled className="opacity-100">
          <div className="flex items-center gap-2 w-full">
            <div className="w-7 h-7 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              <GraduationCap className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user?.classroom_name}
              </p>
              <p className="text-xs text-gray-500 truncate">
                {user?.teacher_name}
              </p>
            </div>
            <Check className="h-4 w-4 text-emerald-500 flex-shrink-0" />
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-gray-500">
          {t("classroomSwitcher.otherClassrooms")}
        </DropdownMenuLabel>

        {/* Other classrooms */}
        {classrooms
          .filter((cr) => cr.id !== user?.classroom_id)
          .map((classroom) => (
            <DropdownMenuItem
              key={classroom.id}
              onClick={() => handleSwitch(classroom)}
              className="cursor-pointer"
            >
              <div className="flex items-center gap-2 w-full">
                <div className="w-7 h-7 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  <GraduationCap className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {classroom.name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {classroom.teacher_name}
                  </p>
                </div>
              </div>
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
