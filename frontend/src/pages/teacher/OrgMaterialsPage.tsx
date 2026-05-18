import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RecursiveTreeAccordion } from "@/components/shared/RecursiveTreeAccordion";
import { programTreeConfig } from "@/components/shared/programTreeConfig";
import MaterialsToolbar from "@/components/shared/MaterialsToolbar";
import type { ViewMode } from "@/components/shared/MaterialsToolbar";
import ProgramFolderView from "@/components/shared/ProgramFolderView";
import { ProgramDialog } from "@/components/ProgramDialog";
import { LessonDialog } from "@/components/LessonDialog";
import ContentTypeDialog from "@/components/ContentTypeDialog";
import ReadingAssessmentPanel, {
  type ReadingAssessmentPanelHandle,
} from "@/components/ReadingAssessmentPanel";
import ContentDownloadSheet from "@/components/ContentDownloadSheet";
import VocabularySetPanel, {
  type VocabularySetPanelHandle,
} from "@/components/VocabularySetPanel";
import ContentCopyDialog from "@/components/ContentCopyDialog";
import { InstantPracticeDialog } from "@/components/InstantPracticeDialog";
import { AssignmentDialog, CartItem } from "@/components/AssignmentDialog";
import { RefSaveButton } from "@/components/shared/RefSaveButton";
import { Button } from "@/components/ui/button";
import { X, AlertCircle } from "lucide-react";
import { apiClient } from "@/lib/api";
import { toast } from "sonner";
import { Program, Lesson, Content } from "@/types";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSidebar } from "@/contexts/SidebarContext";

export default function OrgMaterialsPage() {
  const { t } = useTranslation();
  const { selectedOrganization } = useWorkspace();
  const { sidebarWidth, setSidebarDisabled, editorBusy } = useSidebar();
  const readingPanelRef = useRef<ReadingAssessmentPanelHandle>(null);
  const vocabPanelRef = useRef<VocabularySetPanelHandle>(null);
  // UI gate: show manage controls whenever an org is selected.
  // Authoritative permission check (active org member) happens on the backend;
  // any unauthorized request returns 403 and is surfaced as a toast.
  const canManage = !!selectedOrganization;

  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [isReordering, setIsReordering] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("folder");
  const [searchQuery, setSearchQuery] = useState("");

  // Program dialog states
  const [programDialogType, setProgramDialogType] = useState<
    "create" | "edit" | "delete" | null
  >(null);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);

  // Lesson dialog states
  const [lessonDialogType, setLessonDialogType] = useState<
    "create" | "edit" | "delete" | null
  >(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [lessonProgramId, setLessonProgramId] = useState<number | undefined>(
    undefined,
  );

  // Content dialog states
  const [showContentTypeDialog, setShowContentTypeDialog] = useState(false);
  const [contentLessonInfo, setContentLessonInfo] = useState<{
    programName: string;
    lessonName: string;
    lessonId: number;
  } | null>(null);

  // Reading assessment modal
  const [showReadingEditor, setShowReadingEditor] = useState(false);
  const [editorLessonId, setEditorLessonId] = useState<number | null>(null);
  const [editorContentId, setEditorContentId] = useState<number | null>(null);
  const [selectedContent, setSelectedContent] = useState<Content | null>(null);

  // Sentence Making Editor state
  const [showVocabularySetEditor, setShowVocabularySetEditor] = useState(false);

  // Disable sidebar when editor panels are open
  useEffect(() => {
    setSidebarDisabled(showReadingEditor || showVocabularySetEditor);
    return () => setSidebarDisabled(false);
  }, [showReadingEditor, showVocabularySetEditor, setSidebarDisabled]);
  const [vocabularySetLessonId, setVocabularySetLessonId] = useState<
    number | null
  >(null);
  const [vocabularySetContentId, setVocabularySetContentId] = useState<
    number | null
  >(null);

  // Content copy dialog state
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copyContentInfo, setCopyContentInfo] = useState<{
    id: number;
    title: string;
  } | null>(null);

  // Content download sheet state
  const [downloadSheetOpen, setDownloadSheetOpen] = useState(false);
  const [downloadContentInfo, setDownloadContentInfo] = useState<{
    id: number;
    title: string;
  } | null>(null);

  // Instant practice dialog state
  const [showInstantPractice, setShowInstantPractice] = useState(false);
  const [instantPracticeContent, setInstantPracticeContent] = useState<{
    id: number;
    title: string;
    type?: string;
  } | null>(null);

  // Assignment dialog state
  const [showAssignmentDialog, setShowAssignmentDialog] = useState(false);
  const [assignContents, setAssignContents] = useState<CartItem[]>([]);

  useEffect(() => {
    fetchOrgPrograms();
  }, [selectedOrganization]);

  const fetchOrgPrograms = async () => {
    if (!selectedOrganization) {
      setPrograms([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = await apiClient.get<Program[]>(
        `/api/organizations/${selectedOrganization.id}/programs`,
      );
      setPrograms(response as Program[]);
    } catch (err) {
      console.error("Failed to fetch organization programs:", err);
      toast.error(t("teacherTemplatePrograms.messages.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  // Program handlers
  const handleCreateProgram = () => {
    setSelectedProgram(null);
    setProgramDialogType("create");
  };

  const handleEditProgram = (programId: number) => {
    const program = programs.find((p) => p.id === programId);
    if (program) {
      setSelectedProgram(program);
      setProgramDialogType("edit");
    }
  };

  const handleDeleteProgram = (programId: number) => {
    const program = programs.find((p) => p.id === programId);
    if (program) {
      setSelectedProgram(program);
      setProgramDialogType("delete");
    }
  };

  const handleSaveProgram = (program: Program) => {
    setPrograms(programs.map((p) => (p.id === program.id ? program : p)));
    fetchOrgPrograms();
  };

  const handleDeleteProgramConfirm = (programId: number) => {
    // 只更新 UI - 實際刪除由 ProgramDialog 處理
    setPrograms(programs.filter((p) => p.id !== programId));
    toast.success(t("teacherTemplatePrograms.messages.programDeleted"));
  };

  // Lesson handlers
  const handleCreateLesson = (programId: number) => {
    setSelectedLesson(null);
    setLessonProgramId(programId);
    setLessonDialogType("create");
  };

  const handleEditLesson = (programId: number, lessonId: number) => {
    const program = programs.find((p) => p.id === programId);
    const lesson = program?.lessons?.find((l) => l.id === lessonId);
    if (lesson && program) {
      setSelectedLesson(lesson);
      setLessonProgramId(program.id);
      setLessonDialogType("edit");
    }
  };

  const handleDeleteLesson = (programId: number, lessonId: number) => {
    const program = programs.find((p) => p.id === programId);
    const lesson = program?.lessons?.find((l) => l.id === lessonId);
    if (lesson && program) {
      setSelectedLesson(lesson);
      setLessonProgramId(program.id);
      setLessonDialogType("delete");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSaveLesson = (lesson: any) => {
    if (lessonDialogType === "create" && lessonProgramId) {
      setPrograms((prevPrograms) =>
        prevPrograms.map((program) => {
          if (program.id === lessonProgramId) {
            return {
              ...program,
              lessons: [...(program.lessons || []), lesson],
            };
          }
          return program;
        }),
      );
      toast.success(
        `${t("teacherTemplatePrograms.messages.lessonAdded", { name: lesson.name })}`,
      );
    } else if (lessonDialogType === "edit") {
      setPrograms((prevPrograms) =>
        prevPrograms.map((program) => ({
          ...program,
          lessons:
            program.lessons?.map((l) => (l.id === lesson.id ? lesson : l)) ||
            [],
        })),
      );
      toast.success(
        `${t("teacherTemplatePrograms.messages.lessonUpdated", { name: lesson.name })}`,
      );
    }
  };

  const handleDeleteLessonConfirm = async (lessonId: number) => {
    try {
      await apiClient.deleteLesson(lessonId);
      const updatedPrograms = programs.map((program) => {
        if (program.lessons) {
          return {
            ...program,
            lessons: program.lessons.filter((l) => l.id !== lessonId),
          };
        }
        return program;
      });
      setPrograms(updatedPrograms);
      toast.success(t("teacherTemplatePrograms.messages.lessonDeleted"));
    } catch (err) {
      console.error("Failed to delete lesson:", err);
      toast.error(t("teacherTemplatePrograms.messages.lessonDeleteFailed"));
    }
  };

  // Content handlers
  const handleCreateContent = (programId: number, lessonId: number) => {
    const program = programs.find((p) => p.id === programId);
    const lesson = program?.lessons?.find((l) => l.id === lessonId);
    if (lesson && program) {
      setContentLessonInfo({
        programName: program.name,
        lessonName: lesson.name,
        lessonId: lesson.id,
      });
      setShowContentTypeDialog(true);
    }
  };

  const handleContentClick = (
    content: Content & {
      lessonName?: string;
      programName?: string;
      lesson_id?: number;
    },
  ) => {
    // 統一轉成小寫比對
    const contentType = content.type?.toLowerCase();

    // EXAMPLE_SENTENCES uses the same ReadingAssessmentPanel as READING_ASSESSMENT
    if (
      contentType === "reading_assessment" ||
      contentType === "example_sentences"
    ) {
      setSelectedContent(content);
      setEditorLessonId(content.lesson_id || null);
      setEditorContentId(content.id);
      setShowReadingEditor(true);
    } else if (
      contentType === "sentence_making" ||
      contentType === "vocabulary_set"
    ) {
      // 編輯單字集內容
      setVocabularySetLessonId(content.lesson_id || null);
      setVocabularySetContentId(content.id);
      setShowVocabularySetEditor(true);
    }
  };

  const handleDeleteContent = async (
    lessonId: number,
    contentId: number,
    contentTitle: string,
  ) => {
    if (
      !confirm(
        t("teacherTemplatePrograms.messages.confirmDeleteContent", {
          title: contentTitle,
        }),
      )
    ) {
      return;
    }

    try {
      await apiClient.deleteContent(contentId);
      const updatedPrograms = programs.map((program) => ({
        ...program,
        lessons: program.lessons?.map((lesson) => {
          if (lesson.id === lessonId) {
            return {
              ...lesson,
              contents: lesson.contents?.filter((c) => c.id !== contentId),
            };
          }
          return lesson;
        }),
      }));
      setPrograms(updatedPrograms);
      toast.success(t("teacherTemplatePrograms.messages.contentDeleted"));
    } catch (err) {
      console.error("Failed to delete content:", err);
      toast.error(t("teacherTemplatePrograms.messages.contentDeleteFailed"));
    }
  };

  // Reorder handlers
  const handleReorderPrograms = async (fromIndex: number, toIndex: number) => {
    if (isReordering) {
      toast.warning(t("teacherTemplatePrograms.messages.reordering"));
      return;
    }

    setIsReordering(true);
    const originalPrograms = [...programs];

    // Immediate UI update
    const newPrograms = [...programs];
    const [movedItem] = newPrograms.splice(fromIndex, 1);
    newPrograms.splice(toIndex, 0, movedItem);
    setPrograms(newPrograms);

    try {
      // Prepare order data
      const orderData = newPrograms.map((program, index) => ({
        id: program.id,
        order_index: index,
      }));

      await apiClient.reorderPrograms(orderData, selectedOrganization?.id);

      toast.success(t("teacherTemplatePrograms.messages.reorderSuccess"));
      setIsReordering(false);
    } catch (err) {
      console.error("[Programs Reorder] Failed to reorder programs:", err);
      toast.error(t("teacherTemplatePrograms.messages.reorderFailed"));
      // Revert on error
      setPrograms(originalPrograms);
      setIsReordering(false);
    }
  };

  const handleReorderLessons = async (
    programId: number,
    fromIndex: number,
    toIndex: number,
  ) => {
    if (isReordering) {
      toast.warning(t("teacherTemplatePrograms.messages.reordering"));
      return;
    }

    // Find the program
    const program = programs.find((p) => p.id === programId);
    if (!program || !program.lessons) return;

    setIsReordering(true);
    const originalPrograms = [...programs];

    // Immediate UI update
    const newLessons = [...program.lessons];
    const [movedItem] = newLessons.splice(fromIndex, 1);
    newLessons.splice(toIndex, 0, movedItem);

    setPrograms((prevPrograms) =>
      prevPrograms.map((p) =>
        p.id === programId ? { ...p, lessons: newLessons } : p,
      ),
    );

    try {
      // Prepare order data
      const orderData = newLessons.map((lesson, index) => ({
        id: lesson.id,
        order_index: index,
      }));

      await apiClient.reorderLessons(
        programId,
        orderData,
        selectedOrganization?.id,
      );

      toast.success(t("teacherTemplatePrograms.messages.reorderSuccess"));
      setIsReordering(false);
    } catch (err) {
      console.error(`[Lessons Reorder] Failed to reorder lessons:`, err);
      toast.error(t("teacherTemplatePrograms.messages.reorderFailed"));
      // Revert on error
      setPrograms(originalPrograms);
      setIsReordering(false);
    }
  };

  const handleReorderContents = async (
    lessonId: number,
    fromIndex: number,
    toIndex: number,
  ) => {
    if (isReordering) {
      toast.warning(t("teacherTemplatePrograms.messages.reordering"));
      return;
    }

    // Find the lesson
    let targetLesson: Lesson | undefined;
    let targetProgram: Program | undefined;

    for (const program of programs) {
      const lesson = program.lessons?.find((l) => l.id === lessonId);
      if (lesson) {
        targetLesson = lesson;
        targetProgram = program;
        break;
      }
    }

    if (!targetLesson || !targetLesson.contents || !targetProgram) return;

    setIsReordering(true);
    const originalPrograms = [...programs];

    // Immediate UI update
    const newContents = [...targetLesson.contents];
    const [movedItem] = newContents.splice(fromIndex, 1);
    newContents.splice(toIndex, 0, movedItem);

    setPrograms((prevPrograms) =>
      prevPrograms.map((p) => {
        if (p.id === targetProgram!.id) {
          return {
            ...p,
            lessons: p.lessons?.map((l) =>
              l.id === lessonId ? { ...l, contents: newContents } : l,
            ),
          };
        }
        return p;
      }),
    );

    try {
      // Prepare order data
      const orderData = newContents.map((content, index) => ({
        id: content.id,
        order_index: index,
      }));

      await apiClient.reorderContents(
        lessonId,
        orderData,
        selectedOrganization?.id,
      );

      toast.success(t("teacherTemplatePrograms.messages.reorderSuccess"));
      setIsReordering(false);
    } catch (err) {
      console.error(`[Contents Reorder] Failed to reorder contents:`, err);
      toast.error(t("teacherTemplatePrograms.messages.reorderFailed"));
      // Revert on error
      setPrograms(originalPrograms);
      setIsReordering(false);
    }
  };

  const filteredPrograms = useMemo(() => {
    if (!searchQuery.trim()) return programs;
    const q = searchQuery.toLowerCase();
    return programs.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.lessons?.some(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            l.contents?.some((c) => c.title?.toLowerCase().includes(q)),
        ),
    );
  }, [programs, searchQuery]);

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">{t("common.loading")}</p>
          </div>
        </div>
      </>
    );
  }

  // Show prompt if no organization is selected
  if (!selectedOrganization) {
    return (
      <>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center max-w-md">
            <AlertCircle className="h-16 w-16 text-amber-500 mx-auto mb-4" />
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              請先選擇機構
            </h2>
            <p className="text-gray-600">
              請使用右上角的工作區切換器選擇要查看的機構
            </p>
          </div>
        </div>
      </>
    );
  }

  // Display workspace context
  const workspaceInfo = selectedOrganization?.name || "";

  return (
    <>
      <div
        className="relative h-full overflow-y-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        <div
          className={`p-5 space-y-4 transition-all duration-300 ${
            showReadingEditor && editorContentId !== null
              ? "pr-[calc(50%+2rem)]"
              : ""
          }`}
        >
          {/* Workspace indicator */}
          {workspaceInfo && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
              <p className="text-sm text-blue-700">
                <span className="font-medium">目前工作區：</span>{" "}
                {workspaceInfo}
              </p>
            </div>
          )}

          <MaterialsToolbar
            title="機構教材"
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="搜尋機構教材..."
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onAdd={canManage ? handleCreateProgram : undefined}
            addButtonText={t("teacherTemplatePrograms.buttons.addProgram")}
          />

          {viewMode === "tree" ? (
            <RecursiveTreeAccordion
              data={filteredPrograms}
              config={programTreeConfig}
              showCreateButton={false}
              disableActions={!canManage}
              disableReason="僅機構管理員可編輯機構教材"
              onEdit={(item, level, parentId) => {
                if (level === 0) handleEditProgram(item.id);
                else if (level === 1)
                  handleEditLesson(parentId as number, item.id);
              }}
              onDelete={(item, level, parentId) => {
                if (level === 0) handleDeleteProgram(item.id);
                else if (level === 1)
                  handleDeleteLesson(parentId as number, item.id);
                else if (level === 2)
                  handleDeleteContent(parentId as number, item.id, item.title);
              }}
              onClick={(item, level, parentId) => {
                if (level === 2) {
                  const program = programs.find((p) =>
                    p.lessons?.some((l) => l.id === parentId),
                  );
                  const lesson = program?.lessons?.find(
                    (l) => l.id === parentId,
                  );
                  handleContentClick({
                    ...item,
                    lesson_id: parentId as number,
                    lessonName: lesson?.name,
                    programName: program?.name,
                  });
                }
              }}
              onCreate={(level, parentId) => {
                if (level === 1) {
                  handleCreateLesson(parentId as number);
                } else if (level === 2) {
                  const program = programs.find((p) =>
                    p.lessons?.some((l) => l.id === parentId),
                  );
                  if (program) {
                    handleCreateContent(program.id, parentId as number);
                  }
                }
              }}
              onReorder={(fromIndex, toIndex, level, parentId) => {
                if (level === 0) handleReorderPrograms(fromIndex, toIndex);
                else if (level === 1)
                  handleReorderLessons(parentId as number, fromIndex, toIndex);
                else if (level === 2)
                  handleReorderContents(parentId as number, fromIndex, toIndex);
              }}
              onCopy={(item, level) => {
                if (level === 2) {
                  setCopyContentInfo({
                    id: item.id as number,
                    title: (item.title || item.name || "") as string,
                  });
                  setShowCopyDialog(true);
                }
              }}
              onDownload={(item, level) => {
                if (
                  level === 2 &&
                  typeof item.type === "string" &&
                  item.type.toLowerCase() === "vocabulary_set"
                ) {
                  setDownloadContentInfo({
                    id: item.id as number,
                    title: (item.title || item.name || "") as string,
                  });
                  setDownloadSheetOpen(true);
                }
              }}
            />
          ) : (
            <ProgramFolderView
              programs={filteredPrograms}
              onEditProgram={canManage ? handleEditProgram : () => {}}
              onDeleteProgram={canManage ? handleDeleteProgram : () => {}}
              onEditLesson={(programId, lessonId) =>
                canManage && handleEditLesson(programId, lessonId)
              }
              onDeleteLesson={(programId, lessonId) =>
                canManage && handleDeleteLesson(programId, lessonId)
              }
              onCreateLesson={(programId) =>
                canManage && handleCreateLesson(programId)
              }
              onContentClick={(content, lessonId) => {
                const program = programs.find((p) =>
                  p.lessons?.some((l) => l.id === lessonId),
                );
                const lesson = program?.lessons?.find((l) => l.id === lessonId);
                handleContentClick({
                  ...content,
                  lesson_id: lessonId,
                  lessonName: lesson?.name,
                  programName: program?.name,
                });
              }}
              onDeleteContent={(lessonId, contentId, title) =>
                canManage && handleDeleteContent(lessonId, contentId, title)
              }
              onCopyContent={(contentId, title) => {
                setCopyContentInfo({ id: contentId, title });
                setShowCopyDialog(true);
              }}
              onDownloadContent={(content) => {
                if (
                  typeof content.type === "string" &&
                  content.type.toLowerCase() === "vocabulary_set"
                ) {
                  setDownloadContentInfo({
                    id: content.id,
                    title: content.title,
                  });
                  setDownloadSheetOpen(true);
                }
              }}
              onCreateContent={(programId, lessonId) =>
                canManage && handleCreateContent(programId, lessonId)
              }
              onInstantPractice={(content) => {
                setInstantPracticeContent({
                  id: content.id,
                  title: content.title,
                  type: content.type,
                });
                setShowInstantPractice(true);
              }}
              onAssignContent={(content, lessonId) => {
                const program = programs.find((p) =>
                  p.lessons?.some((l) => l.id === lessonId),
                );
                const lesson = program?.lessons?.find((l) => l.id === lessonId);
                const cartItem: CartItem = {
                  contentId: content.id,
                  programName: program?.name || "",
                  lessonName: lesson?.name || "",
                  contentTitle: content.title,
                  contentType: content.type || "",
                  itemsCount: content.items_count,
                  order: 0,
                  hasMissingAudio: false,
                  hasMissingExampleAudio: false,
                  hasMissingImage: false,
                };
                setAssignContents([cartItem]);
                setShowAssignmentDialog(true);
              }}
              onReorderPrograms={canManage ? handleReorderPrograms : undefined}
              onReorderLessons={canManage ? handleReorderLessons : undefined}
              onReorderContents={canManage ? handleReorderContents : undefined}
            />
          )}
        </div>

        {/* Reading Assessment Modal (新增模式) */}
        {showReadingEditor && editorLessonId && editorContentId === null && (
          <>
            <div
              className="editor-panel fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-in slide-in-from-right duration-300"
              style={{ left: `${sidebarWidth}px` }}
            >
              <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold">
                  {t("teacherTemplatePrograms.dialogs.addReadingTitle")}
                </h2>
                <div className="flex items-center gap-2">
                  <RefSaveButton panelRef={readingPanelRef} />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={editorBusy}
                    onClick={() => {
                      if (editorBusy) return;
                      if (
                        !window.confirm(
                          t("contentEditor.labels.unsavedChangesConfirm"),
                        )
                      )
                        return;
                      setShowReadingEditor(false);
                      setEditorLessonId(null);
                      setEditorContentId(null);
                      setSelectedContent(null);
                    }}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-6 min-h-0 flex flex-col">
                <ReadingAssessmentPanel
                  ref={readingPanelRef}
                  lessonId={editorLessonId}
                  isCreating={true}
                  onSave={async (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    newContent?: any,
                  ) => {
                    // 如果有返回新內容，直接更新前端狀態，不重整頁面
                    if (newContent && editorLessonId) {
                      setPrograms(
                        programs.map((program) => ({
                          ...program,
                          lessons: program.lessons?.map((lesson) => {
                            if (lesson.id === editorLessonId) {
                              return {
                                ...lesson,
                                contents: [
                                  ...(lesson.contents || []),
                                  newContent,
                                ],
                              };
                            }
                            return lesson;
                          }),
                        })),
                      );
                    }
                    setShowReadingEditor(false);
                    setEditorLessonId(null);
                    setEditorContentId(null);
                    setSelectedContent(null);
                    toast.success(
                      t("teacherTemplatePrograms.messages.contentSaved"),
                    );
                  }}
                  onCancel={() => {
                    setShowReadingEditor(false);
                    setEditorLessonId(null);
                    setEditorContentId(null);
                    setSelectedContent(null);
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* Reading Assessment Panel (編輯模式 - 側邊欄) */}
        {showReadingEditor &&
          editorLessonId &&
          editorContentId !== null &&
          selectedContent && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 bg-black bg-opacity-20 z-40 transition-opacity pointer-events-none" />

              {/* Panel */}
              <div
                className="editor-panel fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 overflow-auto animate-in slide-in-from-right duration-300"
                style={{ left: `${sidebarWidth}px` }}
              >
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {t("teacherTemplatePrograms.dialogs.editContentTitle")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <RefSaveButton panelRef={readingPanelRef} />
                    <button
                      disabled={editorBusy}
                      onClick={() => {
                        if (editorBusy) return;
                        if (
                          !window.confirm(
                            t("contentEditor.labels.unsavedChangesConfirm"),
                          )
                        )
                          return;
                        setShowReadingEditor(false);
                        setEditorLessonId(null);
                        setEditorContentId(null);
                        setSelectedContent(null);
                      }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      aria-label="關閉"
                    >
                      <svg
                        className="w-5 h-5 text-gray-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="p-6">
                  <ReadingAssessmentPanel
                    ref={readingPanelRef}
                    lessonId={editorLessonId}
                    contentId={editorContentId}
                    content={{
                      id: selectedContent.id,
                      title: selectedContent.title,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      items: (selectedContent.items || []) as any,
                    }}
                    onSave={async (
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      updatedContent?: any,
                    ) => {
                      // 直接更新前端 state，不重新載入整個 tree
                      if (updatedContent && editorContentId) {
                        setPrograms((prevPrograms) =>
                          prevPrograms.map((program) => ({
                            ...program,
                            lessons: program.lessons?.map((lesson) => ({
                              ...lesson,
                              contents: lesson.contents?.map((content) =>
                                content.id === editorContentId
                                  ? { ...content, ...updatedContent }
                                  : content,
                              ),
                            })),
                          })),
                        );
                      }
                      setShowReadingEditor(false);
                      setEditorLessonId(null);
                      setEditorContentId(null);
                      setSelectedContent(null);
                      toast.success(
                        t("teacherTemplatePrograms.messages.contentSaved"),
                      );
                    }}
                    onCancel={() => {
                      setShowReadingEditor(false);
                      setEditorLessonId(null);
                      setEditorContentId(null);
                      setSelectedContent(null);
                    }}
                  />
                </div>
              </div>
            </>
          )}

        {/* Sentence Making Editor (新增模式 - 側滑) */}
        {showVocabularySetEditor &&
          vocabularySetLessonId &&
          !vocabularySetContentId && (
            <>
              <div
                className="editor-panel fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col animate-in slide-in-from-right duration-300"
                style={{ left: `${sidebarWidth}px` }}
              >
                <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold">
                    {t("vocabularySet.dialogTitle")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <RefSaveButton panelRef={vocabPanelRef} />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={editorBusy}
                      onClick={() => {
                        if (editorBusy) return;
                        if (
                          !window.confirm(
                            t("contentEditor.labels.unsavedChangesConfirm"),
                          )
                        )
                          return;
                        setShowVocabularySetEditor(false);
                        setVocabularySetLessonId(null);
                        setVocabularySetContentId(null);
                      }}
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-6">
                  <VocabularySetPanel
                    ref={vocabPanelRef}
                    content={undefined}
                    editingContent={{
                      id: vocabularySetContentId || undefined,
                    }}
                    lessonId={vocabularySetLessonId}
                    onUpdateContent={() => {}}
                    onSave={async (
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      newContent?: any,
                    ) => {
                      // 即時更新前端狀態，不重整頁面
                      if (newContent && vocabularySetLessonId) {
                        setPrograms((prevPrograms) =>
                          prevPrograms.map((program) => ({
                            ...program,
                            lessons: program.lessons?.map((lesson) => {
                              if (lesson.id === vocabularySetLessonId) {
                                return {
                                  ...lesson,
                                  contents: [
                                    ...(lesson.contents || []),
                                    newContent,
                                  ],
                                };
                              }
                              return lesson;
                            }),
                          })),
                        );
                      }
                      setShowVocabularySetEditor(false);
                      setVocabularySetLessonId(null);
                      setVocabularySetContentId(null);
                      toast.success("內容已成功儲存");
                    }}
                    onCancel={() => {
                      setShowVocabularySetEditor(false);
                      setVocabularySetLessonId(null);
                      setVocabularySetContentId(null);
                    }}
                    isCreating={!vocabularySetContentId}
                  />
                </div>
              </div>
            </>
          )}

        {/* Sentence Making Editor (編輯模式 - 側邊欄) */}
        {showVocabularySetEditor &&
          vocabularySetLessonId &&
          vocabularySetContentId && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 bg-black bg-opacity-20 z-40 transition-opacity pointer-events-none" />

              {/* Panel */}
              <div
                className="editor-panel fixed top-0 right-0 h-screen bg-white shadow-2xl border-l border-gray-200 z-50 overflow-auto animate-in slide-in-from-right duration-300"
                style={{ left: `${sidebarWidth}px` }}
              >
                <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {t("vocabularySet.editTitle")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <RefSaveButton panelRef={vocabPanelRef} />
                    <button
                      disabled={editorBusy}
                      onClick={() => {
                        if (editorBusy) return;
                        if (
                          !window.confirm(
                            t("contentEditor.labels.unsavedChangesConfirm"),
                          )
                        )
                          return;
                        setShowVocabularySetEditor(false);
                        setVocabularySetLessonId(null);
                        setVocabularySetContentId(null);
                      }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      aria-label="關閉"
                    >
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                </div>

                <div className="p-6">
                  <VocabularySetPanel
                    ref={vocabPanelRef}
                    content={{ id: vocabularySetContentId }}
                    editingContent={{ id: vocabularySetContentId }}
                    lessonId={vocabularySetLessonId}
                    onUpdateContent={() => {}}
                    onSave={async (
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      updatedContent?: any,
                    ) => {
                      // 直接更新前端 state，不重新載入整個 tree
                      if (updatedContent && vocabularySetContentId) {
                        setPrograms((prevPrograms) =>
                          prevPrograms.map((program) => ({
                            ...program,
                            lessons: program.lessons?.map((lesson) => ({
                              ...lesson,
                              contents: lesson.contents?.map((content) =>
                                content.id === vocabularySetContentId
                                  ? { ...content, ...updatedContent }
                                  : content,
                              ),
                            })),
                          })),
                        );
                      }
                      setShowVocabularySetEditor(false);
                      setVocabularySetLessonId(null);
                      setVocabularySetContentId(null);
                      toast.success("內容已成功儲存");
                    }}
                    onCancel={() => {
                      setShowVocabularySetEditor(false);
                      setVocabularySetLessonId(null);
                      setVocabularySetContentId(null);
                    }}
                    isCreating={false}
                  />
                </div>
              </div>
            </>
          )}

        {/* Dialogs */}
        <ProgramDialog
          program={selectedProgram}
          dialogType={programDialogType}
          isTemplate={true}
          organizationId={selectedOrganization?.id}
          onClose={() => {
            setProgramDialogType(null);
            setSelectedProgram(null);
          }}
          onSave={handleSaveProgram}
          onDelete={handleDeleteProgramConfirm}
        />

        <LessonDialog
          lesson={selectedLesson}
          dialogType={lessonDialogType}
          programId={lessonProgramId}
          onClose={() => {
            setLessonDialogType(null);
            setSelectedLesson(null);
            setLessonProgramId(undefined);
          }}
          onSave={handleSaveLesson}
          onDelete={handleDeleteLessonConfirm}
        />

        {contentLessonInfo && (
          <ContentTypeDialog
            open={showContentTypeDialog}
            lessonInfo={contentLessonInfo}
            onClose={() => {
              setShowContentTypeDialog(false);
              setContentLessonInfo(null);
            }}
            onSelect={(selection) => {
              setShowContentTypeDialog(false);
              setContentLessonInfo(null);

              // Handle different content types
              // EXAMPLE_SENTENCES uses the same ReadingAssessmentPanel as READING_ASSESSMENT
              if (
                selection.type === "reading_assessment" ||
                selection.type === "example_sentences" ||
                selection.type === "EXAMPLE_SENTENCES"
              ) {
                // Open modal for new content
                setEditorLessonId(selection.lessonId);
                setEditorContentId(null); // null = new content
                setSelectedContent(null); // No existing content
                setShowReadingEditor(true);
              } else if (
                selection.type === "SENTENCE_MAKING" ||
                selection.type === "sentence_making" ||
                selection.type === "vocabulary_set" ||
                selection.type === "VOCABULARY_SET"
              ) {
                // For sentence_making/vocabulary_set, use popup for new content creation
                setVocabularySetLessonId(selection.lessonId);
                setVocabularySetContentId(null); // null for new content
                setShowVocabularySetEditor(true);
              } else {
                toast.info(
                  `${t("teacherTemplatePrograms.messages.featureInDevelopment", { type: selection.type })}`,
                );
              }
            }}
          />
        )}
      </div>

      {/* Content Copy Dialog */}
      {copyContentInfo && (
        <ContentCopyDialog
          open={showCopyDialog}
          onClose={() => {
            setShowCopyDialog(false);
            setCopyContentInfo(null);
          }}
          onSuccess={() => {
            fetchOrgPrograms();
          }}
          contentId={copyContentInfo.id}
          contentTitle={copyContentInfo.title}
          programs={programs}
        />
      )}

      {/* Content Download Sheet (vocabulary_set worksheet PDF) */}
      <ContentDownloadSheet
        open={downloadSheetOpen}
        onOpenChange={(open) => {
          setDownloadSheetOpen(open);
          if (!open) setDownloadContentInfo(null);
        }}
        contentId={downloadContentInfo?.id ?? null}
        contentTitle={downloadContentInfo?.title}
      />

      {/* Instant Practice Dialog */}
      {instantPracticeContent && (
        <InstantPracticeDialog
          open={showInstantPractice}
          onClose={() => {
            setShowInstantPractice(false);
            setInstantPracticeContent(null);
          }}
          contentId={instantPracticeContent.id}
          contentTitle={instantPracticeContent.title}
          contentType={instantPracticeContent.type}
          onStartPractice={(assignmentId) => {
            window.open(
              `/teacher/assignment/${assignmentId}/preview`,
              "_blank",
              "noopener,noreferrer",
            );
            setShowInstantPractice(false);
            setInstantPracticeContent(null);
          }}
        />
      )}

      {/* Assignment Dialog (no classroomId = multi-classroom mode) */}
      <AssignmentDialog
        open={showAssignmentDialog}
        onClose={() => {
          setShowAssignmentDialog(false);
          setAssignContents([]);
        }}
        preSelectedContents={assignContents}
        organizationId={selectedOrganization?.id}
        onSuccess={() => {
          setShowAssignmentDialog(false);
          setAssignContents([]);
        }}
      />
    </>
  );
}
