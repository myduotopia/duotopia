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

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  FileText,
  Ellipsis,
  Pencil,
  Trash2,
  Copy,
  Play,
  Plus,
} from "lucide-react";
import type { Program, Lesson, Content } from "@/types";

/* ── Cover image mapping by level ── */
const LEVEL_COVERS: Record<string, string> = {
  A1: "/images/course-covers/A1.png",
  A2: "/images/course-covers/A2.png",
  B1: "/images/course-covers/B1.png",
  B2: "/images/course-covers/B2.png",
  C1: "/images/course-covers/C1.png",
  C2: "/images/course-covers/C2.png",
};

const DEFAULT_COVER = "/images/course-covers/A1.png";

function getCoverImage(level?: string): string {
  if (!level) return DEFAULT_COVER;
  return LEVEL_COVERS[level.toUpperCase()] ?? DEFAULT_COVER;
}

/* ── Content type badge config ── */
const TYPE_BADGE: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  example_sentences: { label: "段落集", bg: "#F0FDF4", text: "#059669" },
  EXAMPLE_SENTENCES: { label: "段落集", bg: "#F0FDF4", text: "#059669" },
  reading_assessment: { label: "段落集", bg: "#F0FDF4", text: "#059669" },
  vocabulary_set: { label: "單字集", bg: "#FFFBEB", text: "#D97706" },
  VOCABULARY_SET: { label: "單字集", bg: "#FFFBEB", text: "#D97706" },
  sentence_making: { label: "造句", bg: "#F5F3FF", text: "#7C3AED" },
  SENTENCE_MAKING: { label: "造句", bg: "#F5F3FF", text: "#7C3AED" },
};

/* ── Dropdown Menu ── */
interface MenuAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

function DropdownMenu({
  actions,
  onClose,
}: {
  actions: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-20 w-[100px] bg-white rounded-2xl shadow-lg border border-gray-100 py-[3px]"
    >
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            a.onClick();
            onClose();
          }}
          className={`flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-md text-xs hover:bg-gray-50 transition-colors ${
            a.danger ? "text-red-500" : "text-gray-700"
          }`}
        >
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  );
}

/* ── Program Card ── */
function ProgramCard({
  program,
  isSelected,
  onClick,
  onEdit,
  onDelete,
}: {
  program: Program;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const lessons = program.lessons ?? [];
  const contentCount = lessons.reduce(
    (sum, l) => sum + (l.contents?.length ?? 0),
    0,
  );

  return (
    <div
      className="relative rounded-2xl bg-white cursor-pointer transition-all hover:shadow-md"
      style={{
        border: isSelected
          ? "2px solid #4CAF50"
          : "1px solid #E5E7EB",
      }}
      onClick={onClick}
    >
      {/* Cover image + hover description overlay */}
      <div className="h-[100px] w-full overflow-hidden rounded-t-2xl relative group/cover">
        <img
          src={getCoverImage(program.level)}
          alt={program.name}
          className="w-full h-full object-cover"
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
      <div className="relative px-4 py-3.5 h-[90px] flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold text-gray-800 line-clamp-2 leading-tight">
          {program.name}
        </h3>
        <p className="text-xs text-gray-500">
          {lessons.length} {t("programFolderView.units", "個單元")} ·{" "}
          {contentCount} {t("programFolderView.contents", "內容")}
        </p>

        {/* Ellipsis menu trigger */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="absolute right-3 bottom-3 p-1 opacity-70 hover:opacity-100 transition-opacity"
        >
          <Ellipsis size={18} className="text-gray-500" />
        </button>

        {showMenu && (
          <DropdownMenu
            onClose={() => setShowMenu(false)}
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
        )}
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
  const [showMenu, setShowMenu] = useState(false);
  const contents = lesson.contents ?? [];

  return (
    <div
      className="relative rounded-2xl bg-white cursor-pointer transition-all hover:shadow-md"
      style={{
        border: isSelected
          ? "2px solid #7C3AED"
          : "1px solid #E5E7EB",
      }}
      onClick={onClick}
    >
      {/* Description preview */}
      <div className="h-[100px] px-3.5 py-3 overflow-hidden rounded-t-2xl bg-[#EEEAF5]">
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-4 whitespace-pre-line">
          {lesson.description || t("programFolderView.noDescription", "尚無描述")}
        </p>
      </div>

      {/* Info */}
      <div className="relative px-4 py-3.5 h-[90px] flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold text-[#1E3A5F] line-clamp-2 leading-tight">
          {lesson.name}
        </h3>
        <p className="text-xs text-gray-500">
          {contents.length} {t("programFolderView.contents", "內容")}
        </p>

        {/* Ellipsis menu trigger */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="absolute right-3 bottom-3 p-1 opacity-70 hover:opacity-100 transition-opacity"
        >
          <Ellipsis size={18} className="text-gray-500" />
        </button>

        {showMenu && (
          <DropdownMenu
            onClose={() => setShowMenu(false)}
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
        )}
      </div>
    </div>
  );
}

/* ── Content Card ── */
function ContentCard({
  content,
  onClick,
  onEdit,
  onDelete,
  onCopy,
  onInstantPractice,
}: {
  content: Content;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onInstantPractice?: () => void;
}) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
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
      {/* Text preview */}
      <div className="h-[160px] p-6 overflow-hidden rounded-t-xl relative">
        {items.length > 0 ? (
          <div className="space-y-1.5 text-[13px] w-full">
            {items.slice(0, 5).map((item, i) => (
              <p
                key={i}
                className={`break-words ${i >= 3 ? "text-gray-400" : i >= 2 ? "text-gray-500" : "text-gray-700"}`}
              >
                {item.text}
                {item.translation && (
                  <span className="ml-2 text-gray-400">
                    {item.translation}
                  </span>
                )}
              </p>
            ))}
          </div>
        ) : (
          <div className="text-gray-300">
            <FileText size={32} />
          </div>
        )}
        {items.length > 3 && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent" />
        )}

        {/* Play button — centered in preview area */}
        {onInstantPractice && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInstantPractice();
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 bg-amber-500/60 hover:bg-amber-500/85 rounded-full flex items-center justify-center shadow-lg transition-colors"
          >
            <Play size={24} className="text-white ml-0.5" />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="px-3.5 py-2.5 space-y-1.5">
        {/* Type badge + count */}
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded"
            style={{ backgroundColor: badge.bg, color: badge.text }}
          >
            {badge.label}
          </span>
          <span className="text-[11px] text-gray-400">
            {content.items_count ?? items.length}{" "}
            {t("programFolderView.questions", "題")}
          </span>
        </div>

        {/* Title + ellipsis */}
        <div className="relative flex items-center gap-1">
          <h3 className="text-sm font-semibold text-gray-800 truncate flex-1">
            {content.title}
          </h3>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="text-gray-400 hover:text-gray-600 shrink-0"
          >
            <span className="text-sm font-bold">⋯</span>
          </button>
          {showMenu && (
            <DropdownMenu
              onClose={() => setShowMenu(false)}
              actions={[
                ...(onEdit
                  ? [
                      {
                        label: t("common.edit", "編輯"),
                        icon: <Pencil size={13} />,
                        onClick: onEdit,
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
          )}
        </div>
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
}: {
  icon: React.ReactNode;
  title: string;
  iconColor?: string;
  onAdd?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: iconColor ?? "#6B7280" }}>{icon}</span>
      <span className="text-[13px] font-semibold text-gray-700">{title}</span>
      <div className="flex-1 h-px bg-gray-200" />
      {onAdd && (
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors"
        >
          <Plus size={14} />
          {t("common.add", "新增")}
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
  onInstantPractice,
  onCreateContent,
}: {
  program: Program;
  onEditLesson: (programId: number, lessonId: number) => void;
  onDeleteLesson: (programId: number, lessonId: number) => void;
  onCreateLesson: (programId: number) => void;
  onContentClick: (content: Content, lessonId: number) => void;
  onDeleteContent: (lessonId: number, contentId: number, title: string) => void;
  onCopyContent: (contentId: number, title: string) => void;
  onInstantPractice: (content: Content) => void;
  onCreateContent: (programId: number, lessonId: number) => void;
}) {
  const { t } = useTranslation();
  const lessons = program.lessons ?? [];
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(
    lessons.length > 0 ? lessons[0].id : null,
  );
  const selectedLesson = lessons.find((l) => l.id === selectedLessonId);

  // Contents to display: selected lesson's contents, or program-level contents
  const displayContents = selectedLesson
    ? selectedLesson.contents ?? []
    : program.contents ?? [];
  const contentsSectionTitle = selectedLesson
    ? `${t("programFolderView.contentsSection", "內容")} — ${selectedLesson.name}`
    : t("programFolderView.contentsSection", "內容");
  // lessonId for callbacks: use selected lesson, or 0 for program-level
  const contentsLessonId = selectedLesson?.id ?? 0;

  return (
    <div className="bg-white rounded-2xl p-5 space-y-4">
      {/* Lessons section */}
      {lessons.length > 0 && (
        <>
          <SectionHeader
            icon={<Folder size={14} />}
            title={t("programFolderView.lessonsSection", "單元")}
            onAdd={() => onCreateLesson(program.id)}
          />

          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                isSelected={lesson.id === selectedLessonId}
                onClick={() => setSelectedLessonId(lesson.id === selectedLessonId ? null : lesson.id)}
                onEdit={() => onEditLesson(program.id, lesson.id)}
                onDelete={() => onDeleteLesson(program.id, lesson.id)}
              />
            ))}
          </div>
        </>
      )}

      {lessons.length === 0 && (
        <SectionHeader
          icon={<Folder size={14} />}
          title={t("programFolderView.lessonsSection", "單元")}
          onAdd={() => onCreateLesson(program.id)}
        />
      )}

      {/* Contents section — always visible */}
      <SectionHeader
        icon={<FileText size={14} />}
        title={contentsSectionTitle}
        iconColor="#059669"
        // TODO: 當沒有選中 lesson 時，新增內容的 lessonId 傳 0，
        // 後端工程師需決定 program-level content 的建立方式與儲存邏輯
        onAdd={() =>
          onCreateContent(program.id, selectedLesson?.id ?? 0)
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {displayContents.map((content) => (
          <ContentCard
            key={content.id}
            content={content}
            onClick={() => {/* 點擊卡片不開啟編輯器，透過三點選單操作 */}}
            onEdit={() => onContentClick(content, contentsLessonId)}
            onDelete={() =>
              onDeleteContent(contentsLessonId, content.id, content.title)
            }
            onCopy={() => onCopyContent(content.id, content.title)}
            onInstantPractice={() => onInstantPractice(content)}
          />
        ))}
        {displayContents.length === 0 && (
          <p className="text-sm text-gray-400 col-span-full text-center py-8">
            {selectedLesson
              ? t("programFolderView.noContents", "此單元尚無內容")
              : t("programFolderView.noProgramContents", "此教材尚無內容")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Main: ProgramFolderView ── */
export interface ProgramFolderViewProps {
  programs: Program[];
  onEditProgram: (programId: number) => void;
  onDeleteProgram: (programId: number) => void;
  onEditLesson: (programId: number, lessonId: number) => void;
  onDeleteLesson: (programId: number, lessonId: number) => void;
  onCreateLesson: (programId: number) => void;
  onContentClick: (content: Content, lessonId: number) => void;
  onDeleteContent: (lessonId: number, contentId: number, title: string) => void;
  onCopyContent: (contentId: number, title: string) => void;
  onInstantPractice: (content: Content) => void;
  onCreateContent: (programId: number, lessonId: number) => void;
}

export default function ProgramFolderView({
  programs,
  onEditProgram,
  onDeleteProgram,
  onEditLesson,
  onDeleteLesson,
  onCreateLesson,
  onContentClick,
  onDeleteContent,
  onCopyContent,
  onInstantPractice,
  onCreateContent,
}: ProgramFolderViewProps) {
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

  return (
    <div ref={containerRef} className="space-y-5">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            {row.map((program) => (
              <ProgramCard
                key={program.id}
                program={program}
                isSelected={program.id === selectedProgramId}
                onClick={() =>
                  setSelectedProgramId(
                    program.id === selectedProgramId ? null : program.id,
                  )
                }
                onEdit={() => onEditProgram(program.id)}
                onDelete={() => onDeleteProgram(program.id)}
              />
            ))}
          </div>

          {/* Expand area below the visual row containing the selected program */}
          {selectedRowIndex === rowIndex && selectedProgram && (
            <div className="mt-4">
              <ExpandArea
                program={selectedProgram}
                onEditLesson={onEditLesson}
                onDeleteLesson={onDeleteLesson}
                onCreateLesson={onCreateLesson}
                onContentClick={onContentClick}
                onDeleteContent={onDeleteContent}
                onCopyContent={onCopyContent}
                onInstantPractice={onInstantPractice}
                onCreateContent={onCreateContent}
              />
            </div>
          )}
        </div>
      ))}

      {programs.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          尚無教材
        </div>
      )}
    </div>
  );
}
