/**
 * ResourceFolderView - 公版教材資料夾式顯示（唯讀 + 複製）
 *
 * 與 ProgramFolderView 類似的卡片樣式，但：
 * - 唯讀：無編輯/刪除/排序
 * - 無即時練習
 * - 課程卡上有複製按鈕
 * - 點擊卡片 fetch detail 後展開顯示 lessons/contents
 * - 分頁（預設 12 個/頁）
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Folder,
  FileText,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import type {
  ResourceMaterial,
  ResourceMaterialDetail,
} from "@/hooks/useResourceMaterialsAPI";

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

function getCoverImage(level?: string | null): string {
  if (!level) return DEFAULT_COVER;
  return LEVEL_COVERS[level.toUpperCase()] ?? DEFAULT_COVER;
}

/* ── Content type badge config ── */
const TYPE_BADGE: Record<string, { label: string; bg: string; text: string }> =
  {
    example_sentences: { label: "段落集", bg: "#F0FDF4", text: "#059669" },
    EXAMPLE_SENTENCES: { label: "段落集", bg: "#F0FDF4", text: "#059669" },
    reading_assessment: { label: "段落集", bg: "#F0FDF4", text: "#059669" },
    vocabulary_set: { label: "單字集", bg: "#FFFBEB", text: "#D97706" },
    VOCABULARY_SET: { label: "單字集", bg: "#FFFBEB", text: "#D97706" },
    sentence_making: { label: "造句", bg: "#F5F3FF", text: "#7C3AED" },
    SENTENCE_MAKING: { label: "造句", bg: "#F5F3FF", text: "#7C3AED" },
  };

/* ── Resource Program Card ── */
function ResourceProgramCard({
  material,
  isSelected,
  onClick,
  onCopy,
}: {
  material: ResourceMaterial;
  isSelected: boolean;
  onClick: () => void;
  onCopy: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="relative rounded-2xl bg-white cursor-pointer transition-all hover:shadow-md"
      style={{
        border: isSelected ? "3px solid #4CAF50" : "1px solid #E5E7EB",
      }}
      onClick={onClick}
    >
      {/* Cover image + hover description */}
      <div className="h-[100px] w-full overflow-hidden rounded-t-2xl relative group/cover">
        <img
          src={getCoverImage(material.level)}
          alt={material.name}
          className="w-full h-full object-cover object-bottom"
        />
        {material.description && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/cover:opacity-100 transition-opacity p-3 flex items-center">
            <p className="text-white text-xs leading-relaxed line-clamp-4 whitespace-pre-line">
              {material.description}
            </p>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="relative px-4 pt-2.5 pb-3.5 h-[90px] flex flex-col gap-2">
        <h3 className="text-[17px] font-semibold text-gray-800 line-clamp-2 leading-tight">
          {material.name}
        </h3>
        <p className="text-xs text-gray-500">
          {material.lesson_count} {t("programFolderView.units", "個單元")} ·{" "}
          {material.content_count} {t("programFolderView.contents", "內容")}
        </p>

        {/* Copy button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          disabled={material.copied_today}
          className={`absolute right-3 bottom-3 p-1.5 rounded-lg transition-colors ${
            material.copied_today
              ? "text-gray-300 cursor-not-allowed"
              : "text-gray-500 hover:text-blue-600 hover:bg-blue-50"
          }`}
          title={
            material.copied_today
              ? t("resourceMaterials.card.copiedToday", "今日已複製")
              : t("resourceMaterials.card.copyToMy", "複製到我的教材")
          }
        >
          <Copy size={18} />
        </button>
      </div>
    </div>
  );
}

/* ── Section Header ── */
function SectionHeader({
  icon,
  title,
  iconColor,
}: {
  icon: React.ReactNode;
  title: string;
  iconColor?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: iconColor ?? "#6B7280" }}>{icon}</span>
      <span className="text-[15px] font-semibold text-gray-700">{title}</span>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

/* ── Content Preview Card (read-only) ── */
function ContentPreviewCard({
  content,
  onClick,
}: {
  content: ResourceMaterialDetail["lessons"][0]["contents"][0];
  onClick?: () => void;
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
      className="rounded-xl bg-white border border-gray-200 transition-all hover:shadow-md cursor-pointer"
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
            {items[0].image_url && (
              <img
                src={items[0].image_url}
                alt={items[0].text}
                className="w-20 h-20 object-cover rounded-lg shrink-0 opacity-60"
                draggable={false}
              />
            )}
            <div className="space-y-1 text-[13px] flex-1 min-w-0">
              {items.slice(0, items[0].image_url ? 4 : 5).map((item, i) => (
                <div
                  key={i}
                  className={`break-words leading-tight ${i >= 3 ? "text-gray-400" : i >= 2 ? "text-gray-500" : "text-gray-700"}`}
                >
                  <span>{item.text}</span>
                  {item.translation && (
                    <>
                      <span className="mx-1 text-gray-300">·</span>
                      <span className="text-gray-400">{item.translation}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-300">
            <FileText size={32} />
          </div>
        )}
        {items.length > 3 && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent" />
        )}
      </div>

      {/* Info */}
      <div className="px-3.5 pt-2.5 pb-2 space-y-1.5">
        <h3 className="text-[17px] font-semibold text-gray-800 truncate">
          {content.title}
        </h3>
        <span className="text-[11px] text-gray-400">
          {content.item_count ?? items.length}{" "}
          {t("programFolderView.questions", "題")}
        </span>
      </div>
    </div>
  );
}

/* ── Expand Area ── */
function ExpandArea({
  detail,
  loadingDetail,
  onContentClick,
}: {
  detail: ResourceMaterialDetail | null;
  loadingDetail: boolean;
  onContentClick?: (
    content: ResourceMaterialDetail["lessons"][0]["contents"][0],
  ) => void;
}) {
  const { t } = useTranslation();
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(null);

  // Reset selection when detail changes
  useEffect(() => {
    if (detail && detail.lessons.length > 0) {
      setSelectedLessonId(detail.lessons[0].id);
    } else {
      setSelectedLessonId(null);
    }
  }, [detail]);

  if (loadingDetail) {
    return (
      <div className="bg-white rounded-2xl p-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!detail) return null;

  const lessons = detail.lessons;
  const selectedLesson = lessons.find((l) => l.id === selectedLessonId);
  const displayContents = selectedLesson?.contents ?? [];

  return (
    <div className="bg-white rounded-2xl p-5 space-y-4">
      {/* Lessons section */}
      {lessons.length > 0 && (
        <>
          <SectionHeader
            icon={<Folder size={15} />}
            title={`${t("programFolderView.lessonsSection", "單元")}: ${detail.name}`}
          />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            {lessons.map((lesson) => (
              <div
                key={lesson.id}
                className="rounded-2xl bg-white cursor-pointer transition-all hover:shadow-md"
                style={{
                  border:
                    lesson.id === selectedLessonId
                      ? "3px solid #7C3AED"
                      : "1px solid #E5E7EB",
                }}
                onClick={() =>
                  setSelectedLessonId(
                    lesson.id === selectedLessonId ? null : lesson.id,
                  )
                }
              >
                <div className="h-[100px] px-3.5 py-3 overflow-hidden rounded-t-2xl bg-[#EEEAF5]">
                  <p className="text-xs text-gray-500 leading-relaxed line-clamp-4 whitespace-pre-line">
                    {lesson.description ||
                      t("programFolderView.noDescription", "尚無描述")}
                  </p>
                </div>
                <div className="px-4 pt-2.5 pb-3.5 h-[90px] flex flex-col gap-2">
                  <h3 className="text-[17px] font-semibold text-[#1E3A5F] line-clamp-2 leading-tight">
                    {lesson.name}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {lesson.content_count}{" "}
                    {t("programFolderView.contents", "內容")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Contents section */}
      <SectionHeader
        icon={<FileText size={15} />}
        title={
          selectedLesson
            ? `${t("programFolderView.contentsSection", "內容")}: ${selectedLesson.name}`
            : t("programFolderView.contentsSection", "內容")
        }
        iconColor="#059669"
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        {displayContents.map((content) => (
          <ContentPreviewCard
            key={content.id}
            content={content}
            onClick={onContentClick ? () => onContentClick(content) : undefined}
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

/* ── Pagination ── */
function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        className="p-2 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm text-gray-600 px-3">
        {page + 1} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages - 1}
        className="p-2 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

/* ── Main: ResourceFolderView ── */
export type ResourceContentItem =
  ResourceMaterialDetail["lessons"][0]["contents"][0];

export interface ResourceFolderViewProps {
  materials: ResourceMaterial[];
  onSelect: (material: ResourceMaterial) => void;
  onCopy: (material: ResourceMaterial) => void;
  onContentClick?: (content: ResourceContentItem) => void;
  selectedDetail: ResourceMaterialDetail | null;
  loadingDetail: boolean;
  selectedId: number | null;
  pageSize?: number;
}

export default function ResourceFolderView({
  materials,
  onSelect,
  onCopy,
  onContentClick,
  selectedDetail,
  loadingDetail,
  selectedId,
  pageSize = 12,
}: ResourceFolderViewProps) {
  const [page, setPage] = useState(0);

  // Reset page when materials change
  useEffect(() => {
    setPage(0);
  }, [materials.length]);

  const totalPages = Math.ceil(materials.length / pageSize);
  const pagedMaterials = materials.slice(
    page * pageSize,
    (page + 1) * pageSize,
  );

  // Responsive row grouping (same as ProgramFolderView)
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);

  const updateColumns = useCallback(() => {
    const w = containerRef.current?.offsetWidth ?? 1024;
    const gap = 20;
    const cols = Math.max(1, Math.floor((w + gap) / (240 + gap)));
    setColumns(cols);
  }, []);

  useEffect(() => {
    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateColumns]);

  // Group into rows
  const rows: ResourceMaterial[][] = [];
  for (let i = 0; i < pagedMaterials.length; i += columns) {
    rows.push(pagedMaterials.slice(i, i + columns));
  }

  const selectedIndex = pagedMaterials.findIndex((m) => m.id === selectedId);
  const selectedRowIndex =
    selectedIndex >= 0 ? Math.floor(selectedIndex / columns) : -1;

  return (
    <div ref={containerRef} className="space-y-5">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            {row.map((material) => (
              <ResourceProgramCard
                key={material.id}
                material={material}
                isSelected={material.id === selectedId}
                onClick={() => onSelect(material)}
                onCopy={() => onCopy(material)}
              />
            ))}
          </div>

          {selectedRowIndex === rowIndex && (
            <div className="relative mt-4 animate-fade-up">
              {/* Triangle pointer to selected program card */}
              <div
                className="absolute -top-3 w-0 h-0 border-l-[30px] border-l-transparent border-r-[30px] border-r-transparent border-b-[12px] border-b-white z-10"
                style={{
                  left: `calc((100% / ${columns}) * (${selectedIndex % columns} + 0.5) - 30px)`,
                }}
              />
              <ExpandArea
                detail={selectedDetail}
                loadingDetail={loadingDetail}
                onContentClick={onContentClick}
              />
            </div>
          )}
        </div>
      ))}

      {materials.length === 0 && (
        <div className="text-center py-12 text-gray-400">尚無公版教材</div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
