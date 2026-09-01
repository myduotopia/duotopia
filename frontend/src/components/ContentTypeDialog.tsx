import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { X, Send, MessageSquare } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";

interface ContentType {
  type: string;
  name: string;
  description: string;
  icon: string;
  image?: string;
  recommended?: boolean;
  isNew?: boolean;
  disabled?: boolean;
}

// Note: Content types are now defined inside the component to access t()

interface ContentTypeDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (selection: {
    type: string;
    lessonId: number;
    // Issue #587: programId is set (and lessonId is 0) when creating program-direct content
    programId?: number;
    programName: string;
    lessonName: string;
  }) => void;
  lessonInfo: {
    programName: string;
    lessonName: string;
    lessonId: number;
    // Issue #587: when set, creating content directly under this program (no lesson)
    programId?: number;
  };
  /**
   * 是否開放「情境對話」（#944）。
   *
   * 這個 dialog 被五個頁面共用，但目前只有「我的教材」接了
   * ScenarioDialoguePanel；其他頁面沒有對應的 selection.type 分支，點下去會
   * 靜靜地什麼都不發生。所以預設關閉（顯示為 Soon），由已經接好面板的頁面
   * 自己打開。等其他頁面也接上、或後端串好之後再拿掉這個開關。
   */
  enableScenarioDialogue?: boolean;
}

export default function ContentTypeDialog({
  open,
  onClose,
  onSelect,
  lessonInfo,
  enableScenarioDialogue = false,
}: ContentTypeDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const { sidebarWidth } = useSidebar();

  const contentTypes: ContentType[] = [
    // ===== Phase 1 - 啟用 =====
    {
      type: "example_sentences",
      name: t("dialogs.contentTypeDialog.types.example_sentences.name"),
      description: t(
        "dialogs.contentTypeDialog.types.example_sentences.description",
      ),
      icon: "📝",
      image:
        "https://storage.googleapis.com/duotopia-social-media-videos/website/add2-sentencepattern.png",
      disabled: false,
    },
    // ===== Phase 2 - 啟用 =====
    {
      type: "vocabulary_set",
      name: t("dialogs.contentTypeDialog.types.vocabulary_set.name"),
      description: t(
        "dialogs.contentTypeDialog.types.vocabulary_set.description",
      ),
      icon: "📚",
      image:
        "https://storage.googleapis.com/duotopia-social-media-videos/website/add1-vocabularyset.png",
      isNew: true,
      disabled: false,
    },
    {
      type: "scenario_dialogue",
      name: t("dialogs.contentTypeDialog.types.scenario_dialogue.name"),
      description: t(
        "dialogs.contentTypeDialog.types.scenario_dialogue.description",
      ),
      icon: "💬",
      image:
        "https://storage.googleapis.com/duotopia-social-media-videos/website/add3-output.png",
      isNew: true,
      disabled: !enableScenarioDialogue,
    },
  ];

  const handleSelect = (contentType: ContentType) => {
    if (contentType.disabled) return;

    setLoading(true);
    onSelect({
      type: contentType.type,
      lessonId: lessonInfo.lessonId,
      programId: lessonInfo.programId,
      programName: lessonInfo.programName,
      lessonName: lessonInfo.lessonName,
    });
    handleClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent, contentType: ContentType) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(contentType);
    }
  };

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 300);
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${
          isClosing ? "opacity-0" : "opacity-100"
        }`}
        onClick={handleClose}
      />

      {/* Slide-in Panel */}
      <div
        className={`fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col ${
          isClosing
            ? "animate-out slide-out-to-right duration-300"
            : "animate-in slide-in-from-right duration-300"
        }`}
        style={{
          left: `${sidebarWidth}px`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold">
              {t("dialogs.contentTypeDialog.title")}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {t("dialogs.contentTypeDialog.description", {
                lessonName: lessonInfo.lessonName,
              })}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            disabled={loading}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <span className="text-gray-500">
                {t("dialogs.contentTypeDialog.processing")}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {contentTypes.map((contentType) => (
                <div
                  key={contentType.type}
                  data-testid={`content-type-card-${contentType.type}`}
                  role="button"
                  aria-label={`選擇${contentType.name}`}
                  aria-disabled={contentType.disabled}
                  tabIndex={contentType.disabled ? -1 : 0}
                  onClick={() => handleSelect(contentType)}
                  onKeyDown={(e) => handleKeyDown(e, contentType)}
                  className={`relative overflow-hidden border rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                    contentType.disabled
                      ? "opacity-60 cursor-not-allowed bg-gray-50"
                      : "cursor-pointer hover:shadow-lg hover:border-blue-400"
                  }`}
                >
                  {/* Corner Badge */}
                  {contentType.isNew && !contentType.disabled && (
                    <div className="absolute top-0 right-0 w-[45px] h-[45px]">
                      <div className="absolute top-0 right-0 w-[45px] h-[45px] bg-red-500 rounded-bl-full" />
                      <span className="absolute top-1.5 right-1.5 text-[10px] font-bold text-white uppercase">
                        New
                      </span>
                    </div>
                  )}
                  {contentType.disabled && (
                    <div className="absolute top-0 right-0 w-[45px] h-[45px]">
                      <div className="absolute top-0 right-0 w-[45px] h-[45px] bg-amber-400 rounded-bl-full" />
                      <span className="absolute top-1.5 right-1 text-[10px] font-bold text-amber-900 uppercase">
                        Soon
                      </span>
                    </div>
                  )}

                  <div className="flex items-center p-4 gap-4">
                    {/* Image or Emoji fallback */}
                    <div className="shrink-0 w-24 h-24 flex items-center justify-center rounded-lg bg-gray-100">
                      {contentType.image ? (
                        <img
                          src={contentType.image}
                          alt={contentType.name}
                          className="w-[88px] h-[88px] object-contain"
                        />
                      ) : (
                        <span className="text-5xl">{contentType.icon}</span>
                      )}
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base">
                        {contentType.name}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                        {contentType.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Future Feature: Chat Area */}
        <div className="border-t border-gray-200 px-6 py-4 min-h-[200px] flex flex-col">
          <div className="flex items-center gap-2 opacity-50">
            <MessageSquare className="h-4 w-4 text-gray-400 shrink-0" />
            <span className="text-xs text-gray-400">
              {t("dialogs.contentTypeDialog.comingSoon")}
            </span>
          </div>
          <div className="flex items-end gap-2 mt-3 flex-1">
            <textarea
              disabled
              placeholder={t("dialogs.contentTypeDialog.chatPlaceholder", {
                defaultValue: "Ask a question...",
              })}
              className="flex-1 px-3 py-3 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-400 cursor-not-allowed resize-none min-h-[120px]"
            />
            <Button variant="ghost" size="icon" disabled className="mb-1">
              <Send className="h-4 w-4 text-gray-300" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
