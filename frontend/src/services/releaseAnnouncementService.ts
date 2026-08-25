import axios from "axios";

const API_BASE = `${import.meta.env.VITE_API_URL || ""}/api`;

/** 單一通道的發布狀態 */
export type ChannelStatus = "pending" | "published" | "failed";

/** 可發布的通道：LINE 官方帳號 / 官網雙語文章 */
export type PublishChannel = "line" | "website";

/** 公告整體狀態（部分發布 = 只有其中一個通道成功） */
export type AnnouncementStatus =
  | "draft"
  | "partially_published"
  | "published"
  | "discarded"
  | "merged";

/**
 * 一次 release 對應的更新公告（issue #804）。
 *
 * LINE 文案（line_message_*）與官網文章（article_*）是彼此獨立的兩份內容，
 * 後台可分開編輯、分開發布。
 */
export interface ReleaseAnnouncement {
  id: number;
  environment: string;
  source_ref: string;
  source_branch: string | null;
  pr_number: number | null;
  issue_numbers: string | null;
  release_title: string | null;
  change_type: string | null;

  line_message_zh: string | null;
  line_message_en: string | null;
  article_title_zh: string | null;
  article_body_zh: string | null;
  article_title_en: string | null;
  article_body_en: string | null;
  image_url: string | null;

  status: AnnouncementStatus;
  line_status: ChannelStatus;
  line_error: string | null;
  line_published_at: string | null;
  website_status: ChannelStatus;
  website_error: string | null;
  website_published_at: string | null;
  published_blog_url: string | null;
  published_blog_url_en: string | null;
  generation_error: string | null;
  merged_into_id: number | null;
  created_at: string | null;
}

/** PATCH 只送有改動的欄位 */
export type ReleaseAnnouncementUpdate = Partial<
  Pick<
    ReleaseAnnouncement,
    | "line_message_zh"
    | "line_message_en"
    | "article_title_zh"
    | "article_body_zh"
    | "article_title_en"
    | "article_body_en"
    | "image_url"
  >
>;

const ENDPOINT = `${API_BASE}/admin/release-announcements`;

const auth = (token: string) => ({
  headers: { Authorization: `Bearer ${token}` },
});

export const releaseAnnouncementApi = {
  list: (token: string, status?: string) =>
    axios.get<ReleaseAnnouncement[]>(ENDPOINT, {
      params: status ? { status } : undefined,
      ...auth(token),
    }),
  update: (id: number, data: ReleaseAnnouncementUpdate, token: string) =>
    axios.patch<ReleaseAnnouncement>(`${ENDPOINT}/${id}`, data, auth(token)),
  /** 把沒發布的舊草稿併進這一則，一起發（省 LINE 每月訊息量） */
  merge: (id: number, sourceIds: number[], token: string) =>
    axios.post<ReleaseAnnouncement>(
      `${ENDPOINT}/${id}/merge`,
      { source_ids: sourceIds },
      auth(token),
    ),
  publish: (id: number, channels: PublishChannel[], token: string) =>
    axios.post<ReleaseAnnouncement>(
      `${ENDPOINT}/${id}/publish`,
      { channels },
      auth(token),
    ),
  discard: (id: number, token: string) =>
    axios.post<ReleaseAnnouncement>(
      `${ENDPOINT}/${id}/discard`,
      null,
      auth(token),
    ),
};
