import axios from "axios";

const API_BASE = `${import.meta.env.VITE_API_URL || ""}/api`;

export interface BlogPost {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  content: string | null;
  cover_image_url: string | null;
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
  is_published: boolean;
  published_at: string | null;
  locale: string;
  linked_post_id: number | null;
  linked_post_slug: string | null;
  author: { id: number; name: string } | null;
  categories: BlogCategory[];
  images: BlogPostImage[];
  created_at: string;
  updated_at: string | null;
}

export interface BlogCategory {
  id: number;
  name: string;
  slug: string;
}

/** 圖庫中的一張圖（已存進 DB） */
export interface BlogPostImage {
  id: number;
  image_url: string;
  alt_text: string | null;
  order_index: number;
}

/** 送出時的圖庫項目；order_index 由陣列順序決定，不需帶 */
export interface BlogPostImageInput {
  image_url: string;
  alt_text?: string;
}

export interface BlogPostInput {
  title: string;
  slug?: string;
  summary?: string;
  content?: string;
  cover_image_url?: string;
  meta_title?: string;
  meta_description?: string;
  og_image_url?: string;
  locale?: string;
  linked_post_id?: number;
  category_ids?: number[];
  images?: BlogPostImageInput[];
}

export interface TranslatePostInput {
  title: string;
  summary?: string;
  content?: string;
  meta_title?: string;
  meta_description?: string;
  target_locale: string;
}

export interface PaginatedResponse<T> {
  posts: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// Public APIs (no auth)
export const blogPublicApi = {
  getPosts: (page = 1, perPage = 12, category?: string, locale?: string) =>
    axios.get<PaginatedResponse<BlogPost>>(`${API_BASE}/public/blog`, {
      params: { page, per_page: perPage, category, locale },
    }),
  getPost: (slug: string) =>
    axios.get<BlogPost>(`${API_BASE}/public/blog/${slug}`),
  getCategories: () =>
    axios.get<BlogCategory[]>(`${API_BASE}/public/blog/categories`),
};

// Admin APIs (requires auth token)
export const blogAdminApi = {
  getPosts: (
    page = 1,
    perPage = 20,
    token: string,
    status?: string,
    categoryId?: number,
  ) =>
    axios.get<PaginatedResponse<BlogPost>>(`${API_BASE}/blog`, {
      params: { page, per_page: perPage, status, category_id: categoryId },
      headers: { Authorization: `Bearer ${token}` },
    }),
  getPost: (id: number, token: string) =>
    axios.get<BlogPost>(`${API_BASE}/blog/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  createPost: (data: BlogPostInput, token: string) =>
    axios.post<BlogPost>(`${API_BASE}/blog`, data, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  updatePost: (id: number, data: BlogPostInput, token: string) =>
    axios.put<BlogPost>(`${API_BASE}/blog/${id}`, data, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  deletePost: (id: number, token: string) =>
    axios.delete(`${API_BASE}/blog/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  /** 從圖庫移除單張圖；後端確認沒被任何文章引用時才會連雲端檔一起刪 */
  deletePostImage: (postId: number, imageId: number, token: string) =>
    axios.delete<{ deleted: boolean; storage_deleted: boolean }>(
      `${API_BASE}/blog/${postId}/images/${imageId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
  publishPost: (id: number, token: string) =>
    axios.post(`${API_BASE}/blog/${id}/publish`, null, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  getCategories: (token: string) =>
    axios.get<BlogCategory[]>(`${API_BASE}/blog/categories`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  createCategory: (data: { name: string; slug: string }, token: string) =>
    axios.post(`${API_BASE}/blog/categories`, data, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  deleteCategory: (id: number, token: string) =>
    axios.delete(`${API_BASE}/blog/categories/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  translatePost: (id: number, data: TranslatePostInput, token: string) =>
    axios.post<BlogPost>(`${API_BASE}/blog/${id}/translate`, data, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  uploadImage: (file: File, token: string) => {
    const formData = new FormData();
    formData.append("file", file);
    return axios.post<{ url: string }>(
      `${API_BASE}/blog/upload-image`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      },
    );
  },
};
