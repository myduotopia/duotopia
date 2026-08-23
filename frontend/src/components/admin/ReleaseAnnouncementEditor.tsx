import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Megaphone, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import LineFlexPreview from "@/components/admin/LineFlexPreview";
import type {
  ChannelStatus,
  PublishChannel,
  ReleaseAnnouncement,
  ReleaseAnnouncementUpdate,
} from "@/services/releaseAnnouncementService";

interface ReleaseAnnouncementEditorProps {
  announcement: ReleaseAnnouncement;
  /** 其他還沒發布的草稿，可併入這一則一起發 */
  olderDrafts: ReleaseAnnouncement[];
  busy: boolean;
  onSave: (update: ReleaseAnnouncementUpdate) => void;
  onPublish: (channels: PublishChannel[]) => void;
  onMerge: (sourceIds: number[]) => void;
  onDiscard: () => void;
}

/** 表單欄位 ↔ API 欄位對照（值一律用字串，送出前再轉回 null-able） */
const FIELDS = [
  "line_message_zh",
  "line_message_en",
  "article_title_zh",
  "article_body_zh",
  "article_title_en",
  "article_body_en",
  "image_url",
] as const;

type FormState = Record<(typeof FIELDS)[number], string>;

function toForm(announcement: ReleaseAnnouncement): FormState {
  return FIELDS.reduce((acc, field) => {
    acc[field] = announcement[field] ?? "";
    return acc;
  }, {} as FormState);
}

const CHANNEL_STATUS_LABEL: Record<ChannelStatus, string> = {
  pending: "未發布",
  published: "已發布",
  failed: "發布失敗",
};

const CHANNEL_STATUS_CLASS: Record<ChannelStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  published: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: ChannelStatus }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${CHANNEL_STATUS_CLASS[status]}`}
    >
      {CHANNEL_STATUS_LABEL[status]}
    </span>
  );
}

export default function ReleaseAnnouncementEditor({
  announcement,
  olderDrafts,
  busy,
  onSave,
  onPublish,
  onMerge,
  onDiscard,
}: ReleaseAnnouncementEditorProps) {
  const [form, setForm] = useState<FormState>(() => toForm(announcement));
  const [channels, setChannels] = useState<Record<PublishChannel, boolean>>({
    line: announcement.line_status !== "published",
    website: announcement.website_status !== "published",
  });
  const [showMerge, setShowMerge] = useState(false);
  const [mergeIds, setMergeIds] = useState<number[]>([]);

  // 切換到另一則公告時重置表單與勾選狀態
  useEffect(() => {
    setForm(toForm(announcement));
    setChannels({
      line: announcement.line_status !== "published",
      website: announcement.website_status !== "published",
    });
    setShowMerge(false);
    setMergeIds([]);
  }, [announcement]);

  const dirtyUpdate = useMemo<ReleaseAnnouncementUpdate>(() => {
    const update: ReleaseAnnouncementUpdate = {};
    FIELDS.forEach((field) => {
      if (form[field] !== (announcement[field] ?? "")) {
        update[field] = form[field];
      }
    });
    return update;
  }, [form, announcement]);

  const setField = (field: (typeof FIELDS)[number], value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const selectedChannels = (Object.keys(channels) as PublishChannel[]).filter(
    (channel) => channels[channel],
  );

  const linePublished = announcement.line_status === "published";
  const websitePublished = announcement.website_status === "published";

  return (
    <div className="space-y-6">
      {announcement.generation_error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          AI 產生草稿失敗，已改用 release 標題當草稿，請自行編修後再發布。
          <span className="block text-xs text-amber-700">
            {announcement.generation_error}
          </span>
        </div>
      )}

      {/* ===== 區塊 A：LINE 推播文案（與官網文章分開） ===== */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Megaphone className="h-5 w-5 text-blue-600" />
            LINE 推播文案
          </h2>
          <StatusBadge status={announcement.line_status} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label
                htmlFor="line_message_zh"
                className="mb-1 block text-sm font-medium"
              >
                LINE 文案（中文）
              </label>
              <Textarea
                id="line_message_zh"
                rows={4}
                value={form.line_message_zh}
                onChange={(e) => setField("line_message_zh", e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="line_message_en"
                className="mb-1 block text-sm font-medium"
              >
                LINE 文案（英文）
              </label>
              <Textarea
                id="line_message_en"
                rows={4}
                value={form.line_message_en}
                onChange={(e) => setField("line_message_en", e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="image_url"
                className="mb-1 block text-sm font-medium"
              >
                公告圖片網址
              </label>
              <Input
                id="image_url"
                value={form.image_url}
                onChange={(e) => setField("image_url", e.target.value)}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-500">
              LINE 卡片預覽
            </p>
            <LineFlexPreview
              titleZh={form.article_title_zh || "Duotopia 更新公告"}
              bodyZh={form.line_message_zh}
              titleEn={form.article_title_en}
              bodyEn={form.line_message_en}
              imageUrl={form.image_url || null}
              linkUrl={announcement.published_blog_url}
            />
          </div>
        </div>

        {announcement.line_error && (
          <p className="mt-3 text-sm text-red-600">
            上次發布失敗：{announcement.line_error}
          </p>
        )}
      </section>

      {/* ===== 區塊 B：官網雙語文章 ===== */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 md:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">官網雙語文章</h2>
          <StatusBadge status={announcement.website_status} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label
                htmlFor="article_title_zh"
                className="mb-1 block text-sm font-medium"
              >
                文章標題（中文）
              </label>
              <Input
                id="article_title_zh"
                value={form.article_title_zh}
                onChange={(e) => setField("article_title_zh", e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="article_body_zh"
                className="mb-1 block text-sm font-medium"
              >
                文章內文（中文）
              </label>
              <Textarea
                id="article_body_zh"
                rows={8}
                value={form.article_body_zh}
                onChange={(e) => setField("article_body_zh", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="article_title_en"
                className="mb-1 block text-sm font-medium"
              >
                文章標題（英文）
              </label>
              <Input
                id="article_title_en"
                value={form.article_title_en}
                onChange={(e) => setField("article_title_en", e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="article_body_en"
                className="mb-1 block text-sm font-medium"
              >
                文章內文（英文）
              </label>
              <Textarea
                id="article_body_en"
                rows={8}
                value={form.article_body_en}
                onChange={(e) => setField("article_body_en", e.target.value)}
              />
            </div>
          </div>
        </div>

        {announcement.website_error && (
          <p className="mt-3 text-sm text-red-600">
            上次發布失敗：{announcement.website_error}
          </p>
        )}

        {(announcement.published_blog_url ||
          announcement.published_blog_url_en) && (
          <div className="mt-3 space-y-1 text-sm">
            {announcement.published_blog_url && (
              <a
                className="flex items-center gap-1 text-blue-600 hover:underline"
                href={announcement.published_blog_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
                {announcement.published_blog_url}
              </a>
            )}
            {announcement.published_blog_url_en && (
              <a
                className="flex items-center gap-1 text-blue-600 hover:underline"
                href={announcement.published_blog_url_en}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
                {announcement.published_blog_url_en}
              </a>
            )}
          </div>
        )}
      </section>

      {/* ===== 合併未發布的舊草稿 ===== */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">合併先前沒發布的更新</h2>
            <p className="text-sm text-gray-500">
              把之前沒發的草稿併進這一則一起發，省下 LINE 每月訊息量。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setShowMerge((prev) => !prev)}
            disabled={olderDrafts.length === 0}
          >
            載入舊草稿
          </Button>
        </div>

        {showMerge && (
          <div className="mt-4 space-y-2">
            {olderDrafts.map((draft) => (
              <label
                key={draft.id}
                className="flex items-start gap-2 text-sm"
                htmlFor={`merge-${draft.id}`}
              >
                <input
                  id={`merge-${draft.id}`}
                  type="checkbox"
                  className="mt-1"
                  checked={mergeIds.includes(draft.id)}
                  onChange={(e) =>
                    setMergeIds((prev) =>
                      e.target.checked
                        ? [...prev, draft.id]
                        : prev.filter((id) => id !== draft.id),
                    )
                  }
                />
                <span>
                  {draft.release_title || draft.source_ref}
                  <span className="ml-2 text-xs text-gray-400">
                    {draft.source_ref.slice(0, 7)}
                  </span>
                </span>
              </label>
            ))}
            <Button
              className="mt-2"
              disabled={mergeIds.length === 0 || busy}
              onClick={() => onMerge(mergeIds)}
            >
              併入這一則
            </Button>
          </div>
        )}
      </section>

      {/* ===== 發布通道 ===== */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 md:p-5">
        <h2 className="mb-3 text-lg font-semibold">發布</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="channel-line"
          >
            <input
              id="channel-line"
              type="checkbox"
              checked={channels.line}
              disabled={linePublished}
              onChange={(e) =>
                setChannels((prev) => ({ ...prev, line: e.target.checked }))
              }
            />
            LINE 官方帳號
          </label>
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="channel-website"
          >
            <input
              id="channel-website"
              type="checkbox"
              checked={channels.website}
              disabled={websitePublished}
              onChange={(e) =>
                setChannels((prev) => ({ ...prev, website: e.target.checked }))
              }
            />
            官網文章
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || Object.keys(dirtyUpdate).length === 0}
            onClick={() => onSave(dirtyUpdate)}
          >
            儲存草稿
          </Button>
          <Button
            disabled={busy || selectedChannels.length === 0}
            onClick={() => onPublish(selectedChannels)}
          >
            <Send className="mr-2 h-4 w-4" />
            發布
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onDiscard}>
            <Trash2 className="mr-2 h-4 w-4" />
            捨棄
          </Button>
        </div>
      </section>
    </div>
  );
}
