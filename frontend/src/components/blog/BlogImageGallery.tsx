/**
 * BlogImageGallery — 部落格編輯器的圖庫（媒體匣）
 *
 * 一篇文章的所有已上傳圖片集中在這裡，每張可以：
 *   - 插入內文（在游標處插入 markdown）
 *   - 設為封面 / 取消封面（對應 BlogPost.cover_image_url）
 *   - 刪除（後端確認沒被任何文章引用時才會連雲端檔一起刪）
 *   - 拖拉調整先後順序（order_index 由陣列順序決定，儲存時落庫）
 *
 * 圖庫狀態由父層 AdminBlogEditorPage 持有（form.images），本元件只負責呈現與事件。
 */
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { ImagePlus, Star, Trash2, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 圖庫項目：已存進 DB 的有 id，剛上傳尚未儲存的沒有 */
export interface GalleryItem {
  id?: number;
  image_url: string;
  alt_text?: string;
}

interface BlogImageGalleryProps {
  images: GalleryItem[];
  coverImageUrl: string;
  uploading: boolean;
  onReorder: (images: GalleryItem[]) => void;
  onInsert: (image: GalleryItem) => void;
  onSetCover: (imageUrl: string) => void;
  onDelete: (image: GalleryItem, index: number) => void;
  onUploadClick: () => void;
}

interface SortableImageProps {
  item: GalleryItem;
  index: number;
  isCover: boolean;
  onInsert: (image: GalleryItem) => void;
  onSetCover: (imageUrl: string) => void;
  onDelete: (image: GalleryItem, index: number) => void;
}

function SortableImage({
  item,
  index,
  isCover,
  onInsert,
  onSetCover,
  onDelete,
}: SortableImageProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.image_url });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded border overflow-hidden bg-white ${
        isCover ? "ring-2 ring-blue-500 border-blue-500" : "border-gray-200"
      }`}
    >
      {/* 圖片本身即拖拉握把 */}
      <img
        src={item.image_url}
        alt={item.alt_text ?? ""}
        loading="lazy"
        className="aspect-square w-full object-cover cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      />

      {isCover && (
        <span className="absolute top-1 left-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {t("blog.admin.currentCover")}
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          title={t("blog.admin.insertIntoContent")}
          aria-label={t("blog.admin.insertIntoContent")}
          onClick={() => onInsert(item)}
          className="rounded p-1 text-white hover:bg-white/20"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={
            isCover ? t("blog.admin.removeCover") : t("blog.admin.setAsCover")
          }
          aria-label={
            isCover ? t("blog.admin.removeCover") : t("blog.admin.setAsCover")
          }
          onClick={() => onSetCover(isCover ? "" : item.image_url)}
          className="rounded p-1 text-white hover:bg-white/20"
        >
          <Star className={`h-4 w-4 ${isCover ? "fill-current" : ""}`} />
        </button>
        <button
          type="button"
          title={t("blog.admin.deleteImage")}
          aria-label={t("blog.admin.deleteImage")}
          onClick={() => onDelete(item, index)}
          className="rounded p-1 text-white hover:bg-white/20"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function BlogImageGallery({
  images,
  coverImageUrl,
  uploading,
  onReorder,
  onInsert,
  onSetCover,
  onDelete,
  onUploadClick,
}: BlogImageGalleryProps) {
  const { t } = useTranslation();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = images.findIndex((i) => i.image_url === active.id);
    const newIndex = images.findIndex((i) => i.image_url === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(images, oldIndex, newIndex));
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">
            {t("blog.admin.gallery")}
          </label>
          {images.length > 0 && (
            <span className="text-xs text-gray-500">
              {t("blog.admin.reorderHint")}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={onUploadClick}
        >
          {uploading ? t("blog.admin.uploading") : t("blog.admin.uploadImages")}
        </Button>
      </div>

      {images.length === 0 && !uploading ? (
        <div className="flex flex-col items-center gap-2 rounded border border-dashed border-gray-300 py-8 text-gray-400">
          <ImageIcon className="h-8 w-8" />
          <p className="px-4 text-center text-sm">
            {t("blog.admin.galleryEmpty")}
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={images.map((i) => i.image_url)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {images.map((item, index) => (
                <SortableImage
                  key={item.image_url}
                  item={item}
                  index={index}
                  isCover={
                    Boolean(coverImageUrl) && coverImageUrl === item.image_url
                  }
                  onInsert={onInsert}
                  onSetCover={onSetCover}
                  onDelete={onDelete}
                />
              ))}
              {uploading && (
                <div className="aspect-square animate-pulse rounded border border-gray-200 bg-gray-100" />
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
