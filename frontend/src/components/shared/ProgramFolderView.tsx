/**
 * ProgramFolderView - 資料夾式手風琴教材顯示
 *
 * 設計稿: docs/design/teacher-template-programs.pen
 * Issue: #574
 *
 * 結構：
 * - Program 卡片 grid（封面圖 + 名稱 + 統計 + ellipsis menu）
 * - 選中 program 展開區（lessons grid + contents grid）
 * - Lesson 卡片（描述預覽 + 名稱 + 統計 + ellipsis menu）
 * - Content 卡片（文字預覽 + type badge + title + play 按鈕）
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  FileText,
  Ellipsis,
  Pencil,
  Trash2,
  Copy,
  ArrowRightLeft,
  Play,
  Plus,
  SendHorizontal,
  Download,
} from "lucide-react";
import {
  DropdownMenu as ShadcnDropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Program, Lesson, Content } from "@/types";

/* ── Sortable wrapper: gives drag handle to its children ── */
function SortableItem({
  id,
  children,
}: {
  id: number;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

/* ── Cover image mapping by level ── */
const LEVEL_COVERS: Record<string, string> = {
  A1: "https://storage.googleapis.com/duotopia-social-media-videos/website/level-images/A1.png",
  A2: "https://storage.googleapis.com/duotopia-social-media-videos/website/level-images/A2.png",
  B1: "https://storage.googleapis.com/duotopia-social-media-videos/website/level-images/B1.png",
  B2: "https://storage.googleapis.com/duotopia-social-media-videos/website/level-images/B2.png",
  C1: "https://storage.googleapis.com/duotopia-social-media-videos/website/level-images/C1.png",
  C2: "https://storage.googleapis.com/duotopia-social-media-videos/website/level-images/C2.png",
};

const DEFAULT_COVER =
  "https://storage.googleapis.com/duotopia-social-media-videos/website/level-images/A1.png";

function getCoverImage(level?: string): string {
  if (!level) return DEFAULT_COVER;
  return LEVEL_COVERS[level.toUpperCase()] ?? DEFAULT_COVER;
}

/* ── Content type badge config ── */
const TYPE_BADGE: Record<string, { label: string; bg: string; text: string }> =
  {
    example_sentences: { label: "例句集", bg: "#F0FDF4", text: "#059669" },
    EXAMPLE_SENTENCES: { label: "例句集", bg: "#F0FDF4", text: "#059669" },
    reading_assessment: { label: "例句集", bg: "#F0FDF4", text: "#059669" },
    vocabulary_set: { label: "單字集", bg: "#FFFBEB", text: "#D97706" },
    VOCABULARY_SET: { label: "單字集", bg: "#FFFBEB", text: "#D97706" },
    sentence_making: { label: "造句", bg: "#F5F3FF", text: "#7C3AED" },
    SENTENCE_MAKING: { label: "造句", bg: "#F5F3FF", text: "#7C3AED" },
  };

/* ── Dropdown Menu Helpers ──
 * 使用 shadcn/Radix 的 DropdownMenu（透過 Portal 渲染、有內建 collision detection），
 * 避免三點選單造成父容器出現捲軸（舊實作 absolute + z-index 會撐大父容器）、
 * 以及被鄰近卡片遮擋；collisionPadding 讓選單在貼近視窗邊緣時自動翻轉到上方。 */
interface MenuAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function ActionDropdown({ actions }: { actions: MenuAction[] }) {
  return (
    <ShadcnDropdownMenu>
      <DropdownMenuTrigger
        asChild
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <button className="absolute right-3 bottom-3 p-1 opacity-70 hover:opacity-100 transition-opacity">
          <Ellipsis size={18} className="text-gray-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        collisionPadding={16}
        onClick={(e) => e.stopPropagation()}
        className="z-[60] min-w-[100px] bg-white rounded-2xl shadow-lg border border-gray-100 py-[3px]"
      >
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.label}
            disabled={a.disabled}
            onSelect={() => a.onClick()}
            onClick={(e) => e.stopPropagation()}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
              a.disabled
                ? "text-gray-300 cursor-not-allowed"
                : a.danger
                  ? "text-red-500 focus:bg-gray-50 focus:text-red-500"
                  : "text-gray-700 focus:bg-gray-50 focus:text-gray-700"
            }`}
          >
            {a.icon}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </ShadcnDropdownMenu>
  );
}

/* ── Program Card ── */
function ProgramCard({
  program,
  isSelected,
  onClick,
  onEdit,
  onDelete,
  onCopyTo,
}: {
  program: Program;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyTo?: () => void;
}) {
  const { t } = useTranslation();
  const lessons = program.lessons ?? [];
  // Issue #847: include program-direct contents (lesson_id IS NULL, Issue #587)
  // in the card count — previously only lesson.contents were summed, so the
  // badge stayed stale after adding content directly under the program.
  const contentCount =
    lessons.reduce((sum, l) => sum + (l.contents?.length ?? 0), 0) +
    (program.contents?.length ?? 0);

  return (
    <div
      className="relative rounded-2xl bg-white cursor-pointer transition-all hover:shadow-md"
      style={{
        border: isSelected ? "3px solid #4CAF50" : "1px solid #E5E7EB",
      }}
      onClick={onClick}
    >
      {/* Cover image + hover description overlay */}
      <div className="h-[100px] w-full overflow-hidden rounded-t-2xl relative group/cover">
        <img
          src={getCoverImage(program.level)}
          alt={program.name}
          className="w-full h-full object-cover object-bottom"
        />
        {program.description && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/cover:opacity-100 transition-opacity p-3 flex items-center">
            <p className="text-white text-xs leading-relaxed line-clamp-4 whitespace-pre-line">
              {program.description}
            </p>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="relative px-4 pt-2.5 pb-3.5 h-[90px] flex flex-col gap-2">
        <h3 className="text-[17px] font-semibold text-gray-800 line-clamp-2 leading-tight">
          {program.name}
        </h3>
        <p className="text-xs text-gray-500">
          {lessons.length} {t("programFolderView.units", "個單元")} ·{" "}
          {contentCount} {t("programFolderView.contents", "內容")}
        </p>

        <ActionDropdown
          actions={[
            {
              label: t("common.edit", "編輯"),
              icon: <Pencil size={13} />,
              onClick: onEdit,
            },
            ...(onCopyTo
              ? [
                  {
                    label: t("programFolderView.copyTo", "Copy to"),
                    icon: <Copy size={13} />,
                    onClick: onCopyTo,
                  },
                ]
              : []),
            {
              label: t("common.delete", "刪除"),
              icon: <Trash2 size={13} />,
              onClick: onDelete,
              danger: true,
            },
          ]}
        />
      </div>
    </div>
  );
}

/* ── Lesson Card ── */
function LessonCard({
  lesson,
  isSelected,
  onClick,
  onEdit,
  onDelete,
}: {
  lesson: Lesson;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const contents = lesson.contents ?? [];

  return (
    <div
      className="relative rounded-2xl bg-white cursor-pointer transition-all hover:shadow-md"
      style={{
        border: isSelected ? "3px solid #7C3AED" : "1px solid #E5E7EB",
      }}
      onClick={onClick}
    >
      {/* Description preview */}
      <div className="h-[100px] px-3.5 py-3 overflow-hidden rounded-t-2xl bg-[#EEEAF5]">
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-4 whitespace-pre-line">
          {lesson.description ||
            t("programFolderView.noDescription", "尚無描述")}
        </p>
      </div>

      {/* Info */}
      <div className="relative px-4 pt-2.5 pb-3.5 h-[90px] flex flex-col gap-2">
        <h3 className="text-[17px] font-semibold text-[#1E3A5F] line-clamp-2 leading-tight">
          {lesson.name}
        </h3>
        <p className="text-xs text-gray-500">
          {contents.length} {t("programFolderView.contents", "內容")}
        </p>

        <ActionDropdown
          actions={[
            {
              label: t("common.edit", "編輯"),
              icon: <Pencil size={13} />,
              onClick: onEdit,
            },
            {
              label: t("common.delete", "刪除"),
              icon: <Trash2 size={13} />,
              onClick: onDelete,
              danger: true,
            },
          ]}
        />
      </div>
    </div>
  );
}

/* ── Content Card ── */
function ContentCard({
  content,
  onClick,
  onDelete,
  onCopy,
  onDownload,
  onInstantPractice,
  onAssign,
}: {
  content: Content;
  onClick: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onDownload?: () => void;
  onInstantPractice?: () => void;
  onAssign?: () => void;
}) {
  const { t } = useTranslation();
  const items = content.items ?? [];
  const badge = TYPE_BADGE[content.type ?? ""] ?? {
    label: content.type ?? "其他",
    bg: "#F3F4F6",
    text: "#6B7280",
  };

  return (
    <div
      className="relative rounded-xl bg-white border border-gray-200 transition-all hover:shadow-md group"
      onClick={onClick}
    >
      {/* Preview: image + text or text only */}
      <div className="h-[160px] pt-10 px-6 pb-6 overflow-hidden rounded-t-xl relative select-none">
        {/* Type badge */}
        <span
          className="absolute top-2 left-2 z-10 text-[12px] font-medium px-2.5 py-1 rounded"
          style={{ backgroundColor: badge.bg, color: badge.text }}
        >
          {badge.label}
        </span>
        {items.length > 0 ? (
          <div className="flex gap-3 h-full">
            {/* First item image (if exists) */}
            {items[0].image_url && (
              <img
                src={items[0].image_url}
                alt={items[0].text}
                className="w-20 h-20 object-cover rounded-lg shrink-0 opacity-60"
                draggable={false}
              />
            )}
            {items[0].image_url ? (
              // 有圖：text 和 translation 上下排列，truncate 節省空間
              <div className="space-y-0.5 text-[12px] flex-1 min-w-0">
                {items.slice(0, 4).map((item, i) => (
                  <div
                    key={i}
                    className={`truncate leading-tight ${i >= 3 ? "text-gray-400" : i >= 2 ? "text-gray-500" : "text-gray-700"}`}
                  >
                    {item.text}
                    {item.translation && (
                      <span className="text-gray-400"> {item.translation}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              // 無圖：text · translation 同一行，break-words
              <div className="space-y-1 text-[13px] flex-1 min-w-0">
                {items.slice(0, 5).map((item, i) => (
                  <div
                    key={i}
                    className={`break-words leading-tight ${i >= 3 ? "text-gray-400" : i >= 2 ? "text-gray-500" : "text-gray-700"}`}
                  >
                    <span>{item.text}</span>
                    {item.translation && (
                      <>
                        <span className="mx-1 text-gray-300">·</span>
                        <span className="text-gray-400">
                          {item.translation}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-gray-300">
            <FileText size={32} />
          </div>
        )}
        {items.length > 3 && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent" />
        )}

        {/* Action buttons — Play + Assign, centered side-by-side */}
        {(onInstantPractice || onAssign) && (
          <div className="absolute inset-0 flex items-center justify-center gap-8 pointer-events-none">
            {onInstantPractice && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onInstantPractice();
                }}
                title={t("instantPractice.title")}
                // #945: after:inset-[-16px] 透明偽元素向四面各外擴 16px（＝兩鈕 gap-8/2）
                // 作為點擊容錯圈；圈內點歪仍觸發本按鈕而非落到卡片編輯。視覺大小不變。
                className="relative pointer-events-auto w-14 h-14 bg-amber-500/60 hover:bg-amber-500/85 rounded-full flex items-center justify-center shadow-lg transition-colors after:absolute after:inset-[-16px] after:content-['']"
              >
                <Play size={24} className="text-white ml-0.5" />
              </button>
            )}
            {onAssign && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAssign();
                }}
                title={t("tree.assign")}
                // #945: 同上，點擊容錯圈（四面各 +16px）
                className="relative pointer-events-auto w-14 h-14 bg-green-500/60 hover:bg-green-500/85 rounded-full flex items-center justify-center shadow-lg transition-colors after:absolute after:inset-[-16px] after:content-['']"
              >
                <SendHorizontal size={22} className="text-white" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="relative px-3.5 pt-2.5 pb-2 space-y-1.5">
        {/* Title */}
        <h3 className="text-[17px] font-semibold text-gray-800 truncate pr-6">
          {content.title}
        </h3>

        {/* Count */}
        <span className="text-[11px] text-gray-400">
          {content.items_count ?? items.length}{" "}
          {t("programFolderView.questions", "題")}
        </span>

        <ActionDropdown
          actions={[
            ...(onDownload &&
            typeof content.type === "string" &&
            content.type.toLowerCase() === "vocabulary_set"
              ? [
                  {
                    label: t("contentDownload.menu", "下載"),
                    icon: <Download size={13} />,
                    onClick: onDownload,
                  },
                ]
              : []),
            ...(onCopy
              ? [
                  {
                    label: t("common.copy", "複製"),
                    icon: <Copy size={13} />,
                    onClick: onCopy,
                  },
                ]
              : []),
            {
              label: t("common.move", "移動"),
              icon: <ArrowRightLeft size={13} />,
              onClick: () => {
                // TODO: 等工程師實作移動功能
              },
              disabled: true,
            },
            ...(onDelete
              ? [
                  {
                    label: t("common.delete", "刪除"),
                    icon: <Trash2 size={13} />,
                    onClick: onDelete,
                    danger: true,
                  },
                ]
              : []),
          ]}
        />
      </div>
    </div>
  );
}

/* ── Section Header ── */
function SectionHeader({
  icon,
  title,
  iconColor,
  onAdd,
  addLabel,
}: {
  icon: React.ReactNode;
  title: string;
  iconColor?: string;
  onAdd?: () => void;
  addLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: iconColor ?? "#6B7280" }}>{icon}</span>
      <span className="text-[15px] font-semibold text-gray-700">{title}</span>
      <div className="flex-1 h-px bg-gray-200" />
      {onAdd && (
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-[14px] text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-2.5 py-1 hover:bg-blue-50 transition-colors"
        >
          <Plus size={14} />
          {addLabel ?? t("common.add", "新增")}
        </button>
      )}
    </div>
  );
}

/* ── Expand Area (Lessons + Contents for selected program) ── */
function ExpandArea({
  program,
  onEditLesson,
  onDeleteLesson,
  onCreateLesson,
  onContentClick,
  onDeleteContent,
  onCopyContent,
  onDownloadContent,
  onInstantPractice,
  onCreateContent,
  onAssignContent,
  onReorderLessons,
  onReorderContents,
  onReorderProgramContents,
}: {
  program: Program;
  onEditLesson: (programId: number, lessonId: number) => void;
  onDeleteLesson: (programId: number, lessonId: number) => void;
  onCreateLesson: (programId: number) => void;
  onContentClick: (content: Content, lessonId: number) => void;
  onDeleteContent: (lessonId: number, contentId: number, title: string) => void;
  onCopyContent: (contentId: number, title: string) => void;
  onDownloadContent?: (content: Content) => void;
  onInstantPractice?: (content: Content) => void;
  onCreateContent: (programId: number, lessonId: number) => void;
  onAssignContent?: (
    content: Content,
    lessonId: number,
    programId?: number,
  ) => void;
  onReorderLessons?: (
    programId: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onReorderContents?: (
    lessonId: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
  // Issue #587: program-direct content reorder
  onReorderProgramContents?: (
    programId: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
}) {
  const { t } = useTranslation();
  const lessons = program.lessons ?? [];
  // Issue #587: 預設不選任何單元 — 讓老師先看到「教材內容」區塊。
  // 選了單元後才會額外顯示「單元內容」區塊。
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(null);
  const selectedLesson = lessons.find((l) => l.id === selectedLessonId);

  // Issue #587: split into two independent content sections:
  //   - lessonContents: contents under the currently-selected lesson
  //   - programContents: contents living directly under the program (lesson_id IS NULL)
  const lessonContents = selectedLesson?.contents ?? [];
  const programContents = program.contents ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleLessonDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorderLessons) return;
    const fromIndex = lessons.findIndex((l) => l.id === active.id);
    const toIndex = lessons.findIndex((l) => l.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorderLessons(program.id, fromIndex, toIndex);
  };

  const handleLessonContentDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorderContents || !selectedLesson)
      return;
    const fromIndex = lessonContents.findIndex((c) => c.id === active.id);
    const toIndex = lessonContents.findIndex((c) => c.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorderContents(selectedLesson.id, fromIndex, toIndex);
  };

  const handleProgramContentDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorderProgramContents) return;
    const fromIndex = programContents.findIndex((c) => c.id === active.id);
    const toIndex = programContents.findIndex((c) => c.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorderProgramContents(program.id, fromIndex, toIndex);
  };

  return (
    <div className="bg-white rounded-2xl p-5 space-y-4">
      {/* Lessons section */}
      {lessons.length > 0 && (
        <>
          <SectionHeader
            icon={<Folder size={15} />}
            title={`${t("programFolderView.lessonsSection", "單元")}: ${program.name}`}
            onAdd={() => onCreateLesson(program.id)}
            addLabel={t("programFolderView.addLesson", "新增單元")}
          />

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleLessonDragEnd}
          >
            <SortableContext
              items={lessons.map((l) => l.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
                {lessons.map((lesson) => (
                  <SortableItem key={lesson.id} id={lesson.id}>
                    <LessonCard
                      lesson={lesson}
                      isSelected={lesson.id === selectedLessonId}
                      onClick={() =>
                        setSelectedLessonId(
                          lesson.id === selectedLessonId ? null : lesson.id,
                        )
                      }
                      onEdit={() => onEditLesson(program.id, lesson.id)}
                      onDelete={() => onDeleteLesson(program.id, lesson.id)}
                    />
                  </SortableItem>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      {lessons.length === 0 && (
        <>
          <SectionHeader
            icon={<Folder size={15} />}
            title={`${t("programFolderView.lessonsSection", "單元")}: ${program.name}`}
            onAdd={() => onCreateLesson(program.id)}
            addLabel={t("programFolderView.addLesson", "新增單元")}
          />
          <p className="text-sm text-gray-400 text-center py-4">
            {t("programFolderView.noLessons", "尚無單元")}
          </p>
        </>
      )}

      {/* Issue #587: 單元內容 section — only visible when a lesson is selected */}
      {selectedLesson && (
        <>
          <SectionHeader
            icon={<FileText size={15} />}
            title={`${t("programFolderView.lessonContentsSection", "單元內容")}: ${selectedLesson.name}`}
            iconColor="#059669"
            onAdd={() => onCreateContent(program.id, selectedLesson.id)}
            addLabel={t("programFolderView.addLessonContent", "新增單元內容")}
          />

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleLessonContentDragEnd}
          >
            <SortableContext
              items={lessonContents.map((c) => c.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
                {lessonContents.map((content) => (
                  <SortableItem key={content.id} id={content.id}>
                    <ContentCard
                      content={content}
                      onClick={() => onContentClick(content, selectedLesson.id)}
                      onDelete={() =>
                        onDeleteContent(
                          selectedLesson.id,
                          content.id,
                          content.title,
                        )
                      }
                      onCopy={() => onCopyContent(content.id, content.title)}
                      onDownload={
                        onDownloadContent
                          ? () => onDownloadContent(content)
                          : undefined
                      }
                      onInstantPractice={
                        onInstantPractice
                          ? () => onInstantPractice(content)
                          : undefined
                      }
                      onAssign={
                        onAssignContent
                          ? () => onAssignContent(content, selectedLesson.id)
                          : undefined
                      }
                    />
                  </SortableItem>
                ))}
                {lessonContents.length === 0 && (
                  <p className="text-sm text-gray-400 col-span-full text-center py-8">
                    {t("programFolderView.noContents", "此單元尚無內容")}
                  </p>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      {/* Issue #587: 教材內容 section — always visible. Header stays even when
          there are no program-direct contents so teachers know it exists. */}
      <SectionHeader
        icon={<FileText size={15} />}
        title={t("programFolderView.programContentsSection", "教材內容")}
        iconColor="#059669"
        onAdd={() => onCreateContent(program.id, 0)}
        addLabel={t("programFolderView.addProgramContent", "新增教材內容")}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleProgramContentDragEnd}
      >
        <SortableContext
          items={programContents.map((c) => c.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            {programContents.map((content) => (
              <SortableItem key={content.id} id={content.id}>
                <ContentCard
                  content={content}
                  onClick={() => onContentClick(content, 0)}
                  onDelete={() => onDeleteContent(0, content.id, content.title)}
                  onCopy={() => onCopyContent(content.id, content.title)}
                  onDownload={
                    onDownloadContent
                      ? () => onDownloadContent(content)
                      : undefined
                  }
                  onInstantPractice={
                    onInstantPractice
                      ? () => onInstantPractice(content)
                      : undefined
                  }
                  onAssign={
                    onAssignContent
                      ? () => onAssignContent(content, 0, program.id)
                      : undefined
                  }
                />
              </SortableItem>
            ))}
            {programContents.length === 0 && (
              <p className="text-sm text-gray-400 col-span-full text-center py-8">
                {t("programFolderView.noProgramContents", "此教材尚無內容")}
              </p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/* ── Main: ProgramFolderView ── */
export interface ProgramFolderViewProps {
  programs: Program[];
  onEditProgram: (programId: number) => void;
  onDeleteProgram: (programId: number) => void;
  onCopyProgramTo?: (programId: number) => void;
  onEditLesson: (programId: number, lessonId: number) => void;
  onDeleteLesson: (programId: number, lessonId: number) => void;
  onCreateLesson: (programId: number) => void;
  onContentClick: (content: Content, lessonId: number) => void;
  onDeleteContent: (lessonId: number, contentId: number, title: string) => void;
  onCopyContent: (contentId: number, title: string) => void;
  onDownloadContent?: (content: Content) => void;
  onInstantPractice?: (content: Content) => void;
  onCreateContent: (programId: number, lessonId: number) => void;
  onAssignContent?: (
    content: Content,
    lessonId: number,
    programId?: number,
  ) => void;
  onReorderPrograms?: (fromIndex: number, toIndex: number) => void;
  onReorderLessons?: (
    programId: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onReorderContents?: (
    lessonId: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
  // Issue #587: program-direct content reorder
  onReorderProgramContents?: (
    programId: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
}

export default function ProgramFolderView({
  programs,
  onEditProgram,
  onDeleteProgram,
  onCopyProgramTo,
  onEditLesson,
  onDeleteLesson,
  onCreateLesson,
  onContentClick,
  onDeleteContent,
  onCopyContent,
  onDownloadContent,
  onInstantPractice,
  onCreateContent,
  onAssignContent,
  onReorderPrograms,
  onReorderLessons,
  onReorderContents,
  onReorderProgramContents,
}: ProgramFolderViewProps) {
  const { t } = useTranslation();
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(
    null,
  );
  const selectedProgram = programs.find((p) => p.id === selectedProgramId);

  // Detect actual number of grid columns based on container width
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);

  const updateColumns = useCallback(() => {
    const w = containerRef.current?.offsetWidth ?? 1024;
    // Match auto-fill with minmax(240px, 1fr): calculate how many 240px cards fit
    const gap = 20; // gap-5 = 20px
    const cols = Math.max(1, Math.floor((w + gap) / (240 + gap)));
    setColumns(cols);
  }, []);

  useEffect(() => {
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateColumns]);

  // Group programs into rows based on actual column count
  const rows: Program[][] = [];
  for (let i = 0; i < programs.length; i += columns) {
    rows.push(programs.slice(i, i + columns));
  }

  const selectedIndex = programs.findIndex((p) => p.id === selectedProgramId);
  const selectedRowIndex =
    selectedIndex >= 0 ? Math.floor(selectedIndex / columns) : -1;

  const programSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleProgramDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorderPrograms) return;
    const fromIndex = programs.findIndex((p) => p.id === active.id);
    const toIndex = programs.findIndex((p) => p.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorderPrograms(fromIndex, toIndex);
  };

  return (
    <div ref={containerRef} className="space-y-5">
      <DndContext
        sensors={programSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleProgramDragEnd}
      >
        <SortableContext
          items={programs.map((p) => p.id)}
          strategy={rectSortingStrategy}
        >
          {rows.map((row, rowIndex) => (
            <div key={rowIndex}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
                {row.map((program) => (
                  <SortableItem key={program.id} id={program.id}>
                    <ProgramCard
                      program={program}
                      isSelected={program.id === selectedProgramId}
                      onClick={() =>
                        setSelectedProgramId(
                          program.id === selectedProgramId ? null : program.id,
                        )
                      }
                      onEdit={() => onEditProgram(program.id)}
                      onDelete={() => onDeleteProgram(program.id)}
                      onCopyTo={
                        onCopyProgramTo
                          ? () => onCopyProgramTo(program.id)
                          : undefined
                      }
                    />
                  </SortableItem>
                ))}
              </div>

              {/* Expand area below the visual row containing the selected program */}
              {selectedRowIndex === rowIndex && selectedProgram && (
                <div className="relative mt-4 animate-fade-up">
                  {/* Triangle pointer to selected program card */}
                  <div
                    className="absolute -top-3 w-0 h-0 border-l-[30px] border-l-transparent border-r-[30px] border-r-transparent border-b-[12px] border-b-white z-10"
                    style={{
                      left: `calc((100% / ${columns}) * (${selectedIndex % columns} + 0.5) - 30px)`,
                    }}
                  />
                  <ExpandArea
                    program={selectedProgram}
                    onEditLesson={onEditLesson}
                    onDeleteLesson={onDeleteLesson}
                    onCreateLesson={onCreateLesson}
                    onContentClick={onContentClick}
                    onDeleteContent={onDeleteContent}
                    onCopyContent={onCopyContent}
                    onDownloadContent={onDownloadContent}
                    onInstantPractice={onInstantPractice}
                    onCreateContent={onCreateContent}
                    onAssignContent={onAssignContent}
                    onReorderLessons={onReorderLessons}
                    onReorderContents={onReorderContents}
                    onReorderProgramContents={onReorderProgramContents}
                  />
                </div>
              )}
            </div>
          ))}
        </SortableContext>
      </DndContext>

      {programs.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          {t("programFolderView.noPrograms", "尚無教材")}
        </div>
      )}
    </div>
  );
}
