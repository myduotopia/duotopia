import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText, Plus, X } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { blogAdminApi } from "@/services/blogService";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import type { BlogPost, BlogCategory } from "@/services/blogService";

export default function AdminBlogPage() {
  const { t } = useTranslation();
  const token = useTeacherAuthStore((s) => s.token) ?? "";
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<
    "all" | "published" | "draft"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);

  // Category management
  const [showCatForm, setShowCatForm] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await blogAdminApi.getPosts(
        page,
        20,
        token,
        statusFilter === "all" ? undefined : statusFilter,
        categoryFilter ?? undefined,
      );
      setPosts(res.data.posts ?? []);
      setTotalPages(res.data.total_pages ?? 1);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [page, token, t, statusFilter, categoryFilter]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await blogAdminApi.getCategories(token);
      setCategories(Array.isArray(res.data) ? res.data : []);
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchPosts();
      fetchCategories();
    }
  }, [fetchPosts, fetchCategories, token]);

  const handleDelete = async (id: number) => {
    if (!window.confirm(t("blog.admin.confirmDelete"))) return;
    try {
      await blogAdminApi.deletePost(id, token);
      toast.success(t("common.success"));
      fetchPosts();
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    try {
      await blogAdminApi.createCategory(
        { name: newCatName.trim(), slug: "" },
        token,
      );
      setNewCatName("");
      setShowCatForm(false);
      toast.success(t("common.success"));
      fetchCategories();
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleDeleteCategory = async (id: number, name: string) => {
    if (!window.confirm(`確定要刪除分類「${name}」嗎？`)) return;
    try {
      await blogAdminApi.deleteCategory(id, token);
      toast.success(t("common.success"));
      if (categoryFilter === id) setCategoryFilter(null);
      fetchCategories();
    } catch {
      toast.error(t("common.error"));
    }
  };

  return (
    <AdminLayout
      title={t("blog.admin.title")}
      description="Blog 文章管理"
      icon={FileText}
    >
      {/* Category management */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700">
            {t("blog.admin.categories")}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCatForm(!showCatForm)}
          >
            <Plus className="h-4 w-4 mr-1" />
            新增分類
          </Button>
        </div>
        {showCatForm && (
          <div className="flex gap-2 mb-3">
            <Input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="分類名稱"
              className="max-w-xs"
              onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
            />
            <Button size="sm" onClick={handleAddCategory}>
              新增
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCatForm(false);
                setNewCatName("");
              }}
            >
              取消
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <span
              key={cat.id}
              className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs"
            >
              {cat.name}
              <button
                onClick={() => handleDeleteCategory(cat.id, cat.name)}
                className="text-blue-400 hover:text-red-500 ml-0.5"
                title="刪除分類"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {categories.length === 0 && (
            <span className="text-xs text-gray-400">尚無分類</span>
          )}
        </div>
      </div>

      {/* Toolbar: filters + new post */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-2">
          {/* Status filter */}
          {(["all", "published", "draft"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
                statusFilter === s
                  ? "bg-blue-50 text-blue-700 border-blue-300"
                  : "bg-gray-100 text-gray-600 border-transparent hover:bg-gray-200"
              }`}
            >
              {s === "all"
                ? "全部"
                : s === "published"
                  ? t("blog.admin.published")
                  : t("blog.admin.draft")}
            </button>
          ))}
          {/* Category filter */}
          <select
            value={categoryFilter ?? ""}
            onChange={(e) => {
              setCategoryFilter(e.target.value ? Number(e.target.value) : null);
              setPage(1);
            }}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border-0 cursor-pointer"
          >
            <option value="">所有分類</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
        <Link to="/admin/blog/new">
          <Button>{t("blog.admin.newPost")}</Button>
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">
                  {t("blog.admin.postTitle")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("blog.admin.status")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("blog.admin.categories")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("blog.publishedOn")}
                </th>
                <th className="px-4 py-3 font-medium text-right">
                  {t("common.edit")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center">
                    {t("common.loading")}
                  </td>
                </tr>
              ) : posts.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {t("blog.noPosts")}
                  </td>
                </tr>
              ) : (
                posts.map((post) => (
                  <tr key={post.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 max-w-xs truncate font-medium">
                      {post.title}
                    </td>
                    <td className="px-4 py-3">
                      {post.is_published ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                          {t("blog.admin.published")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          {t("blog.admin.draft")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(post.categories ?? []).map((cat) => (
                          <span
                            key={cat.id}
                            className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs"
                          >
                            {cat.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {post.published_at
                        ? new Date(post.published_at).toLocaleDateString(
                            "zh-TW",
                          )
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link to={`/admin/blog/${post.id}/edit`}>
                          <Button variant="outline" size="sm">
                            {t("blog.admin.edit")}
                          </Button>
                        </Link>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(post.id)}
                        >
                          {t("blog.admin.delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-6">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`w-10 h-10 rounded-full text-sm font-medium transition ${
                p === page
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
