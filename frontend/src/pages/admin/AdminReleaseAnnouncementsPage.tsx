import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ReleaseAnnouncementEditor from "@/components/admin/ReleaseAnnouncementEditor";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import {
  releaseAnnouncementApi,
  type PublishChannel,
  type ReleaseAnnouncement,
  type ReleaseAnnouncementUpdate,
} from "@/services/releaseAnnouncementService";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  partially_published: "部分發布",
  published: "已發布",
};

const DESCRIPTION =
  "每次 release 進 staging / production 會自動產生草稿；" +
  "草稿不會自動對外發布，由你選擇要發 LINE 官方帳號、官網雙語文章，或兩者都發。";

const EMPTY_HINT =
  "目前沒有待處理的更新公告。下次 release 進 staging 或 production 時會自動產生草稿。";

const CHANGE_TYPE_LABEL: Record<string, string> = {
  feature: "新功能",
  bugfix: "問題修正",
  other: "其他",
};

/**
 * 更新公告管理（issue #804）。
 *
 * 每次 release 進 staging / production 由 CI 產生草稿，這裡負責預覽、編修，
 * 並選擇要發布到 LINE 官方帳號、官網雙語文章，或兩者。
 * LINE 文案與官網文章是分開的兩份內容，各自有發布狀態。
 */
export default function AdminReleaseAnnouncementsPage() {
  const token = useTeacherAuthStore((s) => s.token) ?? "";
  const [announcements, setAnnouncements] = useState<ReleaseAnnouncement[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await releaseAnnouncementApi.list(token);
      const rows = Array.isArray(res.data) ? res.data : [];
      setAnnouncements(rows);
      setSelectedId((prev) =>
        prev && rows.some((row) => row.id === prev)
          ? prev
          : (rows[0]?.id ?? null),
      );
    } catch {
      toast.error("載入更新公告失敗");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchAnnouncements();
  }, [fetchAnnouncements, token]);

  const selected = useMemo(
    () => announcements.find((row) => row.id === selectedId) ?? null,
    [announcements, selectedId],
  );

  /** 可併入的舊草稿：還沒發布過任何通道、且不是目前這一則 */
  const olderDrafts = useMemo(
    () =>
      announcements.filter(
        (row) => row.id !== selectedId && row.status === "draft",
      ),
    [announcements, selectedId],
  );

  const replaceRow = (updated: ReleaseAnnouncement) =>
    setAnnouncements((prev) =>
      prev.map((row) => (row.id === updated.id ? updated : row)),
    );

  const handleSave = async (update: ReleaseAnnouncementUpdate) => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await releaseAnnouncementApi.update(
        selected.id,
        update,
        token,
      );
      replaceRow(res.data);
      toast.success("草稿已儲存");
    } catch {
      toast.error("儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async (channels: PublishChannel[]) => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await releaseAnnouncementApi.publish(
        selected.id,
        channels,
        token,
      );
      replaceRow(res.data);
      const failed = channels.filter(
        (channel) =>
          (channel === "line"
            ? res.data.line_status
            : res.data.website_status) !== "published",
      );
      if (failed.length) {
        toast.error("部分通道發布失敗，請查看錯誤訊息");
      } else {
        toast.success("已發布");
      }
    } catch {
      toast.error("發布失敗");
      // 失敗時後端已記錄各通道狀態，重新載入取得最新錯誤訊息
      fetchAnnouncements();
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = async (sourceIds: number[]) => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await releaseAnnouncementApi.merge(
        selected.id,
        sourceIds,
        token,
      );
      replaceRow(res.data);
      setAnnouncements((prev) =>
        prev.filter((row) => !sourceIds.includes(row.id)),
      );
      toast.success("已併入這一則");
    } catch {
      toast.error("合併失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (!selected) return;
    if (!window.confirm("確定要捨棄這則更新公告嗎？")) return;
    setBusy(true);
    try {
      await releaseAnnouncementApi.discard(selected.id, token);
      setAnnouncements((prev) => prev.filter((row) => row.id !== selected.id));
      setSelectedId(null);
      toast.success("已捨棄");
    } catch {
      toast.error("捨棄失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-blue-600" />
          更新公告
        </CardTitle>
        <p className="mt-1 text-sm text-gray-500">{DESCRIPTION}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-500">載入中…</p>
        ) : announcements.length === 0 ? (
          <p className="text-sm text-gray-500">{EMPTY_HINT}</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            {/* 草稿清單 */}
            <div className="space-y-2">
              {announcements.map((row) => {
                const active = row.id === selectedId;
                return (
                  <button
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                        {row.environment}
                      </span>
                      {row.change_type && (
                        <span className="rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-700">
                          {CHANGE_TYPE_LABEL[row.change_type] ??
                            row.change_type}
                        </span>
                      )}
                      <span className="text-gray-400">
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm font-medium text-gray-900">
                      {row.release_title || row.source_ref}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {row.source_ref.slice(0, 7)}
                      {row.created_at
                        ? ` · ${new Date(row.created_at).toLocaleString("zh-TW")}`
                        : ""}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* 編輯與發布 */}
            {selected && (
              <ReleaseAnnouncementEditor
                announcement={selected}
                olderDrafts={olderDrafts}
                busy={busy}
                onSave={handleSave}
                onPublish={handlePublish}
                onMerge={handleMerge}
                onDiscard={handleDiscard}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
