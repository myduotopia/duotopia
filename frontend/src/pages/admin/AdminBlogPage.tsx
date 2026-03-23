import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { blogAdminApi } from "@/services/blogService";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import type { BlogPost } from "@/services/blogService";

export default function AdminBlogPage() {
  const { t } = useTranslation();
  const token = useTeacherAuthStore((s) => s.token) ?? "";
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await blogAdminApi.getPosts(page, 20, token);
      setPosts(res.data.posts);
      setTotalPages(res.data.total_pages);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [page, token, t]);

  useEffect(() => {
    if (token) fetchPosts();
  }, [fetchPosts, token]);

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

  return (
    <AdminLayout
      title={t("blog.admin.title")}
      description="Blog 文章管理"
      icon={FileText}
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">{t("blog.admin.title")}</h2>
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
                        {post.categories.map((cat) => (
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
