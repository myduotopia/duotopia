import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { BlogPost } from "@/services/blogService";

interface BlogCardProps {
  post: BlogPost;
}

export default function BlogCard({ post }: BlogCardProps) {
  const { t } = useTranslation();

  const formattedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString("zh-TW", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <Link to={`/blog/${post.slug}`} className="group block">
      <article className="bg-white rounded-lg shadow-sm hover:shadow-md transition overflow-hidden h-full flex flex-col">
        {post.cover_image_url && (
          <div className="aspect-[16/9] overflow-hidden">
            <img
              src={post.cover_image_url}
              alt={post.title}
              className="w-full h-full object-cover rounded-t-lg group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        )}
        <div className="p-4 flex flex-col flex-1">
          {post.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
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
          <h3 className="text-lg font-semibold line-clamp-2 mb-2 group-hover:text-primary transition-colors">
            {post.title}
          </h3>
          {post.summary && (
            <p className="text-sm text-muted-foreground line-clamp-3 mb-3 flex-1">
              {post.summary}
            </p>
          )}
          <div className="flex items-center justify-between mt-auto">
            {formattedDate && (
              <time
                dateTime={post.published_at ?? undefined}
                className="text-xs text-muted-foreground"
              >
                {formattedDate}
              </time>
            )}
            <span className="text-xs text-primary font-medium">
              {t("blog.readMore")}
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
