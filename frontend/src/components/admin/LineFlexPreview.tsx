interface LineFlexPreviewProps {
  titleZh: string;
  bodyZh: string;
  titleEn?: string;
  bodyEn?: string;
  imageUrl?: string | null;
  linkUrl?: string | null;
}

/**
 * LINE Flex 卡片預覽（issue #804）。
 *
 * 對應後端 LinePublishService.build_release_flex 的版型：
 * hero 圖 → 中文標題/文案 → 分隔線 → 英文標題/文案 → 連結按鈕。
 * 英文欄位留空時不顯示英文段，與實際送出的訊息一致。
 */
export default function LineFlexPreview({
  titleZh,
  bodyZh,
  titleEn,
  bodyEn,
  imageUrl,
  linkUrl,
}: LineFlexPreviewProps) {
  const hasEnglish = Boolean(titleEn || bodyEn);

  return (
    <div
      data-testid="line-flex-preview"
      className="w-full max-w-[300px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      {imageUrl && (
        <img
          src={imageUrl}
          alt="公告樣板圖"
          className="h-[130px] w-full object-cover"
        />
      )}
      <div className="space-y-2 p-4">
        <p className="text-base font-bold text-gray-900 break-words">
          {titleZh}
        </p>
        <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">
          {bodyZh}
        </p>
        {hasEnglish && (
          <>
            <div className="my-3 border-t border-gray-200" />
            {titleEn && (
              <p className="text-sm font-bold text-gray-900 break-words">
                {titleEn}
              </p>
            )}
            {bodyEn && (
              <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">
                {bodyEn}
              </p>
            )}
          </>
        )}
      </div>
      {linkUrl && (
        <div className="px-4 pb-4">
          <div className="rounded-md bg-blue-600 py-2 text-center text-sm font-medium text-white">
            看完整更新 / Read more
          </div>
        </div>
      )}
    </div>
  );
}
