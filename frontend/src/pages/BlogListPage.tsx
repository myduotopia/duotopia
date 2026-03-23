import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import BlogHeader from "@/components/blog/BlogHeader";
import BlogCard from "@/components/blog/BlogCard";
import { blogPublicApi } from "@/services/blogService";
import type { BlogPost, BlogCategory } from "@/services/blogService";

export default function BlogListPage() {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(
    undefined,
  );
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await blogPublicApi.getCategories();
        setCategories(res.data);
      } catch {
        // silently fail
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    const fetchPosts = async () => {
      setLoading(true);
      try {
        const res = await blogPublicApi.getPosts(page, 12, selectedCategory);
        setPosts(res.data.posts);
        setTotalPages(res.data.total_pages);
      } catch {
        setPosts([]);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [page, selectedCategory]);

  const handleCategoryChange = (slug?: string) => {
    setSelectedCategory(slug);
    setPage(1);
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Duotopia Blog",
    description: t("blog.subtitle"),
    url: `${window.location.origin}/blog`,
  };

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>Duotopia Blog</title>
        <meta name="description" content={t("blog.subtitle")} />
        <meta property="og:title" content="Duotopia Blog" />
        <meta property="og:description" content={t("blog.subtitle")} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${window.location.origin}/blog`} />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <BlogHeader />

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#204dc0] to-[#101f6b] text-white py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-3xl font-bold mb-3">{t("blog.title")}</h1>
          <p className="text-blue-200 text-lg">{t("blog.subtitle")}</p>
        </div>
      </section>

      {/* Category Tabs */}
      <div className="container mx-auto px-4 mt-8">
        <nav className="flex flex-wrap gap-2">
          <button
            onClick={() => handleCategoryChange(undefined)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              !selectedCategory
                ? "bg-primary text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t("blog.allCategories")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleCategoryChange(cat.slug)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                selectedCategory === cat.slug
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Posts Grid */}
      <main className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-gray-100 rounded-lg animate-pulse h-80"
              />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg">{t("blog.noPosts")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <BlogCard key={post.id} post={post} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-10">
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
      </main>
    </div>
  );
}
