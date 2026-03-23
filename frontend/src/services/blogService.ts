import axios from "axios";

const API_BASE = "/api";

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
  author_name: string | null;
  categories: BlogCategory[];
  created_at: string;
  updated_at: string | null;
}

export interface BlogCategory {
  id: number;
  name: string;
  slug: string;
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
  category_ids?: number[];
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// Public APIs (no auth)
export const blogPublicApi = {
  getPosts: (page = 1, perPage = 12, category?: string) =>
    axios.get<PaginatedResponse<BlogPost>>(`${API_BASE}/public/blog`, {
      params: { page, per_page: perPage, category },
    }),
  getPost: (slug: string) =>
    axios.get<BlogPost>(`${API_BASE}/public/blog/${slug}`),
  getCategories: () =>
    axios.get<BlogCategory[]>(`${API_BASE}/public/blog/categories`),
};

// Admin APIs (requires auth token)
export const blogAdminApi = {
  getPosts: (page = 1, perPage = 20, token: string) =>
    axios.get<PaginatedResponse<BlogPost>>(`${API_BASE}/blog`, {
      params: { page, per_page: perPage },
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
