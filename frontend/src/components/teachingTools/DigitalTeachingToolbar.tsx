import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Timer,
  Dice5,
  GripHorizontal,
  Share2,
  HelpCircle,
  ExternalLink,
  BookOpen,
  Users,
  Hand,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import StudentLoginQRShare from "@/components/teacher/StudentLoginQRShare";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import TimerTool from "./TimerTool";
import DiceTool from "./DiceTool";
import RpsTool from "./RpsTool";

// Main Toolbar Component
const HELP_DISMISSED_KEY = "duotopia_help_dismissed";
const TEACHER_MANUAL_URL =
  "https://www.canva.com/design/DAHDIN6lTPU/RZTs5TqZoyJRKob2f1-f6Q/view?utm_content=DAHDIN6lTPU&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h10dd0c0854";
const STUDENT_GUIDE_URL =
  "https://www.canva.com/design/DAHDJKkPn6Q/DZqIgDN_g7ZTVwpZbDd6kw/view?utm_content=DAHDJKkPn6Q&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h4500142b17";

const DigitalTeachingToolbar: React.FC = () => {
  const { t } = useTranslation();
  const user = useTeacherAuthStore((state) => state.user);
  const [showTimer, setShowTimer] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showRps, setShowRps] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [toolbarY, setToolbarY] = useState<number | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [helpDismissed, setHelpDismissed] = useState(
    () => localStorage.getItem(HELP_DISMISSED_KEY) === "true",
  );
  const [showHelp, setShowHelp] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem("duotopia-toolbar-collapsed") === "true",
  );
  const zCounterRef = useRef(200);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("duotopia-toolbar-collapsed", String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (toolbarY === null) {
      setToolbarY(window.innerHeight / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, intentionally runs once to set initial toolbar position
  }, []);

  useEffect(() => {
    if (!helpDismissed) {
      setShowHelp(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, intentionally runs once to check persisted help dismissal
  }, []);

  const handleDismissChange = useCallback((checked: boolean) => {
    setHelpDismissed(checked);
    if (checked) {
      localStorage.setItem(HELP_DISMISSED_KEY, "true");
    } else {
      localStorage.removeItem(HELP_DISMISSED_KEY);
    }
  }, []);

  const handleToolbarDrag = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const currentY = toolbarY ?? window.innerHeight / 2;
      const clientY = (e as React.TouchEvent).touches
        ? (e as React.TouchEvent).touches[0].clientY
        : (e as React.MouseEvent).clientY;
      const startOffset = clientY - currentY;
      let frameId: number | null = null;

      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent | TouchEvent) => {
        const moveY = (moveEvent as TouchEvent).touches
          ? (moveEvent as TouchEvent).touches[0].clientY
          : (moveEvent as MouseEvent).clientY;
        if (frameId) cancelAnimationFrame(frameId);
        frameId = requestAnimationFrame(() => {
          const halfH = (toolbarRef.current?.offsetHeight ?? 180) / 2;
          setToolbarY(
            Math.max(
              halfH,
              Math.min(window.innerHeight - halfH, moveY - startOffset),
            ),
          );
        });
        if ((moveEvent as TouchEvent).touches) moveEvent.preventDefault();
      };

      const onEnd = () => {
        if (frameId) cancelAnimationFrame(frameId);
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onEnd);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onEnd);
    },
    [toolbarY],
  );

  const handleToggleTimer = useCallback(() => {
    setShowTimer((prev) => {
      if (!prev) {
        setShowShareDialog(false);
        setShowHelp(false);
      }
      return !prev;
    });
  }, []);

  const handleToggleDice = useCallback(() => {
    setShowDice((prev) => {
      if (!prev) {
        setShowShareDialog(false);
        setShowHelp(false);
      }
      return !prev;
    });
  }, []);

  const handleToggleRps = useCallback(() => {
    setShowRps((prev) => {
      if (!prev) {
        setShowShareDialog(false);
        setShowHelp(false);
      }
      return !prev;
    });
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-[140]">
      {/* Share to Students Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-md pointer-events-auto">
          <DialogHeader>
            <DialogTitle>{t("teacherDashboard.share.title")}</DialogTitle>
            <DialogDescription>
              {t("teacherDashboard.share.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* #793：QR 含視圖選擇器，分享指定機構/學校/個人視圖 */}
            <StudentLoginQRShare email={user?.email || ""} />
            <div className="text-sm text-gray-600 space-y-2">
              <p>{t("teacherDashboard.share.instructions")}</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>{t("teacherDashboard.share.instruction1")}</li>
                <li>{t("teacherDashboard.share.instruction2")}</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Help Dialog */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-md pointer-events-auto">
          <DialogHeader>
            <DialogTitle>{t("teacherToolbar.help.title")}</DialogTitle>
            <DialogDescription>
              {t("teacherToolbar.help.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <a
              href={TEACHER_MANUAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="relative flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors min-h-[160px]"
            >
              <BookOpen className="h-20 w-20 text-blue-500" />
              <span className="text-sm font-semibold text-gray-800 leading-tight text-center">
                {t("teacherToolbar.help.teacherManual")}
              </span>
              <ExternalLink className="absolute bottom-3 right-3 h-4 w-4 text-blue-400" />
            </a>
            <a
              href={STUDENT_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="relative flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors min-h-[160px]"
            >
              <Users className="h-20 w-20 text-blue-500" />
              <span className="text-sm font-semibold text-gray-800 leading-tight text-center">
                {t("teacherToolbar.help.studentGuide")}
              </span>
              <ExternalLink className="absolute bottom-3 right-3 h-4 w-4 text-blue-400" />
            </a>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Checkbox
              id="help-dismiss"
              checked={helpDismissed}
              onCheckedChange={(checked) =>
                handleDismissChange(checked as boolean)
              }
            />
            <label
              htmlFor="help-dismiss"
              className="text-sm text-gray-600 cursor-pointer"
            >
              {t("teacherToolbar.help.dontShowAgain")}
            </label>
          </div>
          <Button onClick={() => setShowHelp(false)} className="w-full">
            {t("teacherToolbar.help.start")}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Side toolbar */}
      <div
        ref={toolbarRef}
        className={`fixed right-0 flex flex-col gap-1 bg-white/90 backdrop-blur-md shadow-2xl border border-gray-200 border-r-0 rounded-l-xl p-1.5 z-[150] transition-transform duration-300 ${isCollapsed ? "pointer-events-none" : "pointer-events-auto"}`}
        style={{
          top: `${toolbarY ?? window.innerHeight / 2}px`,
          transform: `translateY(-50%)${isCollapsed ? " translateX(100%)" : ""}`,
        }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center py-0.5 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors"
          onMouseDown={handleToolbarDrag}
          onTouchStart={handleToolbarDrag}
          title="拖曳上下移動"
        >
          <GripHorizontal size={18} />
        </div>
        <button
          onClick={handleToggleTimer}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showTimer
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label="Timer"
        >
          <Timer size={24} />
        </button>

        <button
          onClick={handleToggleDice}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showDice
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label="Dice"
        >
          <Dice5 size={24} />
        </button>

        <button
          onClick={handleToggleRps}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showRps
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label="Rock Paper Scissors"
        >
          <Hand size={24} />
        </button>

        <div className="mx-1 border-t border-gray-200" />

        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setShowShareDialog((prev) => {
              if (!prev) {
                setShowTimer(false);
                setShowDice(false);
                setShowRps(false);
                setShowHelp(false);
              }
              return !prev;
            });
          }}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showShareDialog
              ? "bg-blue-500 text-white shadow-md"
              : "hover:bg-gray-100 text-blue-500"
          }`}
          aria-label={t("teacherDashboard.share.button")}
        >
          <Share2 size={24} />
        </button>

        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setShowHelp((prev) => {
              if (!prev) {
                setShowShareDialog(false);
                setShowTimer(false);
                setShowDice(false);
                setShowRps(false);
              }
              return !prev;
            });
          }}
          className={`p-2 rounded-lg transition-all duration-300 ${
            showHelp
              ? "bg-red-500 text-white shadow-md"
              : helpDismissed
                ? "hover:bg-gray-100 text-blue-500"
                : "hover:bg-red-50 text-red-500"
          }`}
          aria-label="Help"
        >
          <HelpCircle size={24} />
        </button>

        <div className="mx-1 border-t border-gray-200" />
        <button
          onClick={toggleCollapse}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-all duration-300"
          aria-label="Collapse toolbar"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Expand tab (visible only when collapsed) */}
      {isCollapsed && (
        <button
          className="fixed right-0 z-[150] pointer-events-auto bg-white/90 backdrop-blur-md shadow-lg border border-gray-200 border-r-0 rounded-l-lg px-1 py-3 hover:bg-blue-50 text-blue-500 transition-all duration-300"
          style={{
            top: `${toolbarY ?? window.innerHeight / 2}px`,
            transform: "translateY(-50%)",
          }}
          onClick={toggleCollapse}
          aria-label="Expand toolbar"
        >
          <ChevronLeft size={18} />
        </button>
      )}

      {/* Tools */}
      <div className="pointer-events-auto">
        <TimerTool
          show={showTimer}
          onClose={() => setShowTimer(false)}
          zCounterRef={zCounterRef}
        />
      </div>
      <div className="pointer-events-auto">
        <DiceTool
          show={showDice}
          onClose={() => setShowDice(false)}
          zCounterRef={zCounterRef}
        />
      </div>
      <div className="pointer-events-auto">
        <RpsTool
          show={showRps}
          onClose={() => setShowRps(false)}
          zCounterRef={zCounterRef}
        />
      </div>
    </div>
  );
};

export default DigitalTeachingToolbar;
