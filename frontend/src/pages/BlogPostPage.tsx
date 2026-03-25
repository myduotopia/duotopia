import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import BlogHeader from "@/components/blog/BlogHeader";
import { blogPublicApi } from "@/services/blogService";
import type { BlogPost } from "@/services/blogService";

function estimateReadingTime(content: string): number {
  // ~200 words/min for Chinese, ~250 for English
  // Rough: count CJK chars + split English words
  const cjkChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = content
    .replace(/[\u4e00-\u9fff]/g, "")
    .split(/\s+/)
    .filter(Boolean).length;
  const minutes = cjkChars / 200 + englishWords / 250;
  return Math.max(1, Math.round(minutes));
}

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    const fetchPost = async () => {
      setLoading(true);
      try {
        const res = await blogPublicApi.getPost(slug);
        setPost(res.data);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchPost();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <BlogHeader />
        <div className="container mx-auto max-w-3xl px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
            <div className="h-64 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="min-h-screen bg-white">
        <BlogHeader />
        <div className="container mx-auto max-w-3xl px-4 py-20 text-center">
          <h1 className="text-2xl font-bold mb-4">404</h1>
          <p className="text-muted-foreground mb-6">{t("blog.noPosts")}</p>
          <Link to="/blog" className="text-primary hover:underline">
            {t("blog.backToBlog")}
          </Link>
        </div>
      </div>
    );
  }

  const readingTime = post.content ? estimateReadingTime(post.content) : 1;
  const formattedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString("zh-TW", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
  const canonicalUrl = `${window.location.origin}/blog/${post.slug}`;
  const metaTitle = post.meta_title || post.title;
  const metaDescription = post.meta_description || post.summary || post.title;
  const ogImage = post.og_image_url || post.cover_image_url;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: metaDescription,
    image: ogImage,
    datePublished: post.published_at,
    author: { "@type": "Organization", name: "Duotopia" },
  };

  return (
    <div className="min-h-screen bg-white">
      <Helmet>
        <title>{metaTitle} | Duotopia Blog</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonicalUrl} />
        {ogImage && <meta property="og:image" content={ogImage} />}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <BlogHeader />

      <main className="container mx-auto max-w-3xl px-4 py-8">
        {/* Back link + Language toggle */}
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/blog"
            className="text-sm text-muted-foreground hover:text-primary"
          >
            {t("blog.backToBlog")}
          </Link>
          {post.linked_post_slug && (
            <Link
              to={`/blog/${post.linked_post_slug}`}
              className="text-sm text-primary hover:underline"
            >
              {post.locale === "zh-TW" ? "Read in English" : "閱讀中文版"}
            </Link>
          )}
        </div>

        {/* Category badges */}
        {post.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {post.categories.map((cat) => (
              <span
                key={cat.id}
                className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs"
              >
                {cat.name}
              </span>
            ))}
          </div>
        )}

        {/* Title */}
        <h1 className="text-3xl font-bold mb-3">{post.title}</h1>

        {/* Meta */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-6">
          {formattedDate && (
            <span>
              {t("blog.publishedOn")}{" "}
              <time dateTime={post.published_at ?? undefined}>
                {formattedDate}
              </time>
            </span>
          )}
          <span>
            {readingTime} {t("blog.readingTime")}
          </span>
        </div>

        {/* Cover image */}
        {post.cover_image_url && (
          <img
            src={post.cover_image_url}
            alt={post.title}
            className="w-full rounded-lg mb-8"
          />
        )}

        {/* Content */}
        {post.content && (
          <article className="prose prose-lg max-w-none prose-headings:font-bold prose-a:text-blue-600">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {post.content}
            </ReactMarkdown>
          </article>
        )}
      </main>
    </div>
  );
}
