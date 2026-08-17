import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { blogAdminApi } from "@/services/blogService";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import BlogImageGallery from "@/components/blog/BlogImageGallery";
import type { GalleryItem } from "@/components/blog/BlogImageGallery";
import type {
  BlogPostInput,
  BlogCategory,
  BlogPost,
} from "@/services/blogService";

function slugify(text: string): string {
  // Match backend _generate_slug: strip non-word chars, collapse hyphens
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function AdminBlogEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const token = useTeacherAuthStore((s) => s.token) ?? "";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [form, setForm] = useState<BlogPostInput>({
    title: "",
    slug: "",
    summary: "",
    content: "",
    cover_image_url: "",
    meta_title: "",
    meta_description: "",
    og_image_url: "",
    locale: "zh-TW",
    category_ids: [],
  });
  // 圖庫獨立於 form：已存 DB 的項目帶 id（刪除時要用），送出時才轉成 payload
  const [images, setImages] = useState<GalleryItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [hasUnsavedImages, setHasUnsavedImages] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  // Fetch categories
  useEffect(() => {
    if (!token) return;
    blogAdminApi
      .getCategories(token)
      .then((res) => setCategories(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, [token]);

  // Fetch post if editing
  useEffect(() => {
    if (!id || !token) return;
    setLoading(true);
    blogAdminApi
      .getPost(Number(id), token)
      .then((res) => {
        const p = res.data;
        setPost(p);
        setForm({
          title: p.title,
          slug: p.slug,
          summary: p.summary ?? "",
          content: p.content ?? "",
          cover_image_url: p.cover_image_url ?? "",
          meta_title: p.meta_title ?? "",
          meta_description: p.meta_description ?? "",
          og_image_url: p.og_image_url ?? "",
          category_ids: (p.categories ?? []).map((c) => c.id),
        });
        setImages(
          (p.images ?? []).map((img) => ({
            id: img.id,
            image_url: img.image_url,
            alt_text: img.alt_text ?? undefined,
          })),
        );
        setHasUnsavedImages(false);
        setSlugManuallyEdited(true);
      })
      .catch(() => toast.error(t("common.error")))
      .finally(() => setLoading(false));
  }, [id, token, t]);

  // 有上傳但未儲存的圖片時，離開前提醒（圖已在雲端，但關聯還沒存進文章）
  useEffect(() => {
    if (!hasUnsavedImages) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedImages]);

  const updateField = useCallback(
    <K extends keyof BlogPostInput>(key: K, value: BlogPostInput[K]) => {
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "title" && !slugManuallyEdited) {
          next.slug = slugify(value as string);
        }
        return next;
      });
    },
    [slugManuallyEdited],
  );

  const toggleCategory = (catId: number) => {
    setForm((prev) => {
      const ids = prev.category_ids ?? [];
      return {
        ...prev,
        category_ids: ids.includes(catId)
          ? ids.filter((i) => i !== catId)
          : [...ids, catId],
      };
    });
  };

  const handleSave = async (publish?: boolean) => {
    if (!form.title.trim()) {
      toast.error(t("blog.admin.postTitle") + " is required");
      return;
    }
    setSaving(true);
    // 圖庫整包送出，order_index 由陣列順序決定
    const payload = {
      ...form,
      images: images.map((i) => ({
        image_url: i.image_url,
        alt_text: i.alt_text,
      })),
    };
    try {
      if (isEdit && id) {
        await blogAdminApi.updatePost(Number(id), payload, token);
        if (publish !== undefined) {
          if (publish && !post?.is_published) {
            await blogAdminApi.publishPost(Number(id), token);
          } else if (!publish && post?.is_published) {
            await blogAdminApi.publishPost(Number(id), token);
          }
        }
        // Refresh post state to reflect publish toggle
        const updated = await blogAdminApi.getPost(Number(id), token);
        setPost(updated.data);
        setImages(
          (updated.data.images ?? []).map((img) => ({
            id: img.id,
            image_url: img.image_url,
            alt_text: img.alt_text ?? undefined,
          })),
        );
        setHasUnsavedImages(false);
        toast.success(t("common.success"));
      } else {
        const res = await blogAdminApi.createPost(payload, token);
        if (publish) {
          await blogAdminApi.publishPost(res.data.id, token);
        }
        setHasUnsavedImages(false);
        toast.success(t("common.success"));
        navigate(`/admin/blog/${res.data.id}/edit`, { replace: true });
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (file: File, name?: string) => {
    try {
      const res = await blogAdminApi.uploadImage(file, token);
      return res.data.url;
    } catch {
      toast.error(
        name ? t("blog.admin.uploadFailed", { name }) : t("common.error"),
      );
      return null;
    }
  };

  /** 把 markdown 插到 textarea 游標處（拖放與圖庫的「插入內文」共用） */
  const insertAtCursor = useCallback((markdown: string) => {
    const ta = textareaRef.current;
    setForm((prev) => {
      const content = prev.content ?? "";
      const start = ta ? ta.selectionStart : content.length;
      const end = ta ? ta.selectionEnd : content.length;
      return {
        ...prev,
        content:
          content.substring(0, start) + markdown + content.substring(end),
      };
    });
    if (ta) {
      const caret = ta.selectionStart + markdown.length;
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }, 0);
    }
  }, []);

  /** 把上傳好的圖加進圖庫（已存在的網址不重複加） */
  const appendToGallery = useCallback((item: GalleryItem) => {
    setImages((prev) =>
      prev.some((i) => i.image_url === item.image_url) ? prev : [...prev, item],
    );
    setHasUnsavedImages(true);
  }, []);

  /** 逐檔序列上傳，避免多張大圖同時打爆連線；失敗的個別提示 */
  const uploadFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return [];

    setUploading(true);
    const uploaded: GalleryItem[] = [];
    try {
      for (const file of imageFiles) {
        const url = await handleImageUpload(file, file.name);
        if (!url) continue;
        const item = { image_url: url, alt_text: file.name };
        appendToGallery(item);
        uploaded.push(item);
      }
    } finally {
      setUploading(false);
    }
    return uploaded;
  };

  const handleGalleryUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // 允許重選同一個檔案
    await uploadFiles(files);
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = await handleImageUpload(file, file.name);
    if (url) {
      updateField("cover_image_url", url);
      appendToGallery({ image_url: url, alt_text: file.name });
    }
  };

  const handleTextareaDrop = async (
    e: React.DragEvent<HTMLTextAreaElement>,
  ) => {
    e.preventDefault();
    const uploaded = await uploadFiles(Array.from(e.dataTransfer.files));
    for (const item of uploaded) {
      insertAtCursor(`![${item.alt_text ?? ""}](${item.image_url})`);
    }
  };

  const handleDeleteGalleryImage = async (item: GalleryItem, index: number) => {
    if (!window.confirm(t("blog.admin.confirmDeleteImage"))) return;

    // 已存進 DB 的才需要打後端（後端會判斷是否連雲端檔一起刪）
    if (item.id && isEdit && id) {
      try {
        await blogAdminApi.deletePostImage(Number(id), item.id, token);
      } catch {
        toast.error(t("common.error"));
        return;
      }
    }
    setImages((prev) => prev.filter((_, i) => i !== index));
    if (form.cover_image_url === item.image_url) {
      updateField("cover_image_url", "");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">
            {isEdit ? t("blog.admin.editPost") : t("blog.admin.newPost")}
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/admin/blog")}>
              {t("blog.admin.back")}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              {t("blog.admin.saveDraft")}
            </Button>
            {post?.is_published ? (
              <Button
                variant="secondary"
                onClick={() => handleSave(false)}
                disabled={saving}
              >
                {t("blog.admin.unpublish")}
              </Button>
            ) : (
              <Button onClick={() => handleSave(true)} disabled={saving}>
                {t("blog.admin.publish")}
              </Button>
            )}
          </div>
        </div>

        {/* Form Fields */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("blog.admin.postTitle")}
            </label>
            <Input
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
              placeholder={t("blog.admin.postTitle")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("blog.admin.slug")}
            </label>
            <Input
              value={form.slug}
              onChange={(e) => {
                setSlugManuallyEdited(true);
                updateField("slug", e.target.value);
              }}
              placeholder="url-slug"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("blog.admin.summary")}
            </label>
            <Textarea
              value={form.summary}
              onChange={(e) => updateField("summary", e.target.value)}
              rows={2}
              placeholder={t("blog.admin.summary")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("blog.admin.categories")}
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <label
                  key={cat.id}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={form.category_ids?.includes(cat.id) ?? false}
                    onChange={() => toggleCategory(cat.id)}
                    className="rounded"
                  />
                  {cat.name}
                </label>
              ))}
            </div>
          </div>
          {/* Locale & Translation */}
          {isEdit && post && (
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("blog.admin.locale")}
                </label>
                <span className="inline-block px-3 py-1 text-sm rounded-full bg-gray-100">
                  {post.locale === "zh-TW"
                    ? t("blog.admin.localeZhTW")
                    : t("blog.admin.localeEn")}
                </span>
              </div>
              {post.linked_post_slug ? (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t("blog.admin.linkedPost")}
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      navigate(`/admin/blog/${post.linked_post_id}/edit`)
                    }
                  >
                    {t("blog.admin.editLinkedPost")}
                  </Button>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t("blog.admin.translate")}
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const targetLocale =
                          post.locale === "zh-TW" ? "en" : "zh-TW";
                        const res = await blogAdminApi.translatePost(
                          post.id,
                          {
                            title: `[${targetLocale.toUpperCase()}] ${post.title}`,
                            target_locale: targetLocale,
                          },
                          token,
                        );
                        toast.success(t("common.success"));
                        navigate(`/admin/blog/${res.data.id}/edit`);
                      } catch {
                        toast.error(t("common.error"));
                      }
                    }}
                  >
                    {t("blog.admin.createTranslation")}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("blog.admin.coverImage")}
            </label>
            <div className="flex items-center gap-3">
              <Input
                value={form.cover_image_url}
                onChange={(e) => updateField("cover_image_url", e.target.value)}
                placeholder="https://..."
                className="flex-1"
              />
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() =>
                    document.getElementById("cover-upload")?.click()
                  }
                >
                  {t("blog.admin.uploadImage")}
                </Button>
                <input
                  id="cover-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleCoverUpload}
                />
              </div>
            </div>
            {form.cover_image_url && (
              <img
                src={form.cover_image_url}
                alt="cover preview"
                className="mt-2 max-h-40 rounded"
              />
            )}
          </div>
        </div>

        {/* Content Editor */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <label className="block text-sm font-medium mb-2">
            {t("blog.admin.content")}
          </label>

          {/* Mobile tabs */}
          <div className="flex gap-2 mb-3 md:hidden">
            <button
              onClick={() => setMobileTab("edit")}
              className={`px-3 py-1 rounded text-sm font-medium ${
                mobileTab === "edit"
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {t("blog.admin.edit")}
            </button>
            <button
              onClick={() => setMobileTab("preview")}
              className={`px-3 py-1 rounded text-sm font-medium ${
                mobileTab === "preview"
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {t("blog.admin.preview")}
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Editor */}
            <div className={mobileTab !== "edit" ? "hidden md:block" : ""}>
              <Textarea
                ref={textareaRef}
                value={form.content}
                onChange={(e) => updateField("content", e.target.value)}
                onDrop={handleTextareaDrop}
                onDragOver={(e) => e.preventDefault()}
                rows={20}
                className="font-mono text-sm resize-y min-h-[400px]"
                placeholder="Markdown content..."
              />
            </div>
            {/* Preview */}
            <div
              className={`border rounded-lg p-4 overflow-y-auto min-h-[400px] max-h-[600px] ${
                mobileTab !== "preview" ? "hidden md:block" : ""
              }`}
            >
              <article className="prose prose-lg max-w-none prose-headings:font-bold prose-a:text-blue-600">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, rehypeSanitize]}
                >
                  {form.content || ""}
                </ReactMarkdown>
              </article>
            </div>
          </div>

          {/* Gallery */}
          <div className={mobileTab !== "edit" ? "hidden md:block" : ""}>
            <BlogImageGallery
              images={images}
              coverImageUrl={form.cover_image_url ?? ""}
              uploading={uploading}
              onReorder={(next) => {
                setImages(next);
                setHasUnsavedImages(true);
              }}
              onInsert={(item) =>
                insertAtCursor(`![${item.alt_text ?? ""}](${item.image_url})`)
              }
              onSetCover={(url) => updateField("cover_image_url", url)}
              onDelete={handleDeleteGalleryImage}
              onUploadClick={() => galleryInputRef.current?.click()}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleGalleryUpload}
            />
          </div>
        </div>

        {/* SEO Section */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <button
            onClick={() => setSeoOpen(!seoOpen)}
            className="w-full flex items-center justify-between p-6 text-left"
          >
            <span className="text-sm font-medium">
              {t("blog.admin.seoSettings")}
            </span>
            {seoOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {seoOpen && (
            <div className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("blog.admin.metaTitle")}
                </label>
                <Input
                  value={form.meta_title}
                  onChange={(e) => updateField("meta_title", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t("blog.admin.metaDescription")}
                </label>
                <Textarea
                  value={form.meta_description}
                  onChange={(e) =>
                    updateField("meta_description", e.target.value)
                  }
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  OG Image URL
                </label>
                <Input
                  value={form.og_image_url}
                  onChange={(e) => updateField("og_image_url", e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
