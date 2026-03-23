import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { blogAdminApi } from "@/services/blogService";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import type {
  BlogPostInput,
  BlogCategory,
  BlogPost,
} from "@/services/blogService";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
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
    category_ids: [],
  });
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
      .then((res) => setCategories(res.data))
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
          category_ids: p.categories.map((c) => c.id),
        });
        setSlugManuallyEdited(true);
      })
      .catch(() => toast.error(t("common.error")))
      .finally(() => setLoading(false));
  }, [id, token, t]);

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
    try {
      if (isEdit && id) {
        await blogAdminApi.updatePost(Number(id), form, token);
        if (publish !== undefined) {
          if (publish) {
            await blogAdminApi.publishPost(Number(id), token);
          }
          // For unpublish, update with is_published via updatePost is handled by backend
        }
        toast.success(t("common.success"));
      } else {
        const res = await blogAdminApi.createPost(form, token);
        if (publish) {
          await blogAdminApi.publishPost(res.data.id, token);
        }
        toast.success(t("common.success"));
        navigate(`/admin/blog/${res.data.id}/edit`, { replace: true });
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    try {
      const res = await blogAdminApi.uploadImage(file, token);
      return res.data.url;
    } catch {
      toast.error(t("common.error"));
      return null;
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await handleImageUpload(file);
    if (url) updateField("cover_image_url", url);
  };

  const handleTextareaDrop = async (
    e: React.DragEvent<HTMLTextAreaElement>,
  ) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    const url = await handleImageUpload(file);
    if (url && textareaRef.current) {
      const ta = textareaRef.current;
      const start = ta.selectionStart;
      const before = (form.content ?? "").substring(0, start);
      const after = (form.content ?? "").substring(ta.selectionEnd);
      const markdown = `![${file.name}](${url})`;
      updateField("content", before + markdown + after);
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {form.content || ""}
                </ReactMarkdown>
              </article>
            </div>
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
