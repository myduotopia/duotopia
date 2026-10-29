/**
 * 原卷這一題的截圖（#1112 C4b；設計文件第五節「編輯一題」）：只是顯示——用整頁圖＋AI 給的題目框
 * （bbox，[ymin, xmin, ymax, xmax]，0–1000）以 CSS 裁出那一塊，不另外裁圖存檔（cold-read B1）。
 * 點圖用 ZoomableImage 放大看原卷整頁（「框歪了？點圖看原卷整頁」）。框太小或不合法時直接顯示整頁縮圖。
 * 頁圖的長寬比要等圖片載入才知道，載入前先佔一個固定高度。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ZoomableImage } from "../LayoutRenderer";

const SCALE = 1000;
/** 框外多留一點邊，避免切到字 */
const PAD = 12;

interface Props {
  src: string;
  bbox: number[] | null | undefined;
  testId?: string;
}

export default function ExamImportOriginalCrop({
  src,
  bbox,
  testId = "exam-review-original",
}: Props) {
  const { t } = useTranslation();
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0)
        setRatio(img.naturalWidth / img.naturalHeight);
    };
    img.src = src;
  }, [src]);

  const box =
    bbox && bbox.length === 4 && bbox.every((v) => Number.isFinite(v))
      ? bbox
      : null;
  const clamp = (v: number) => Math.min(SCALE, Math.max(0, v));
  const [ymin, xmin, ymax, xmax] = box
    ? [
        clamp(box[0] - PAD),
        clamp(box[1] - PAD),
        clamp(box[2] + PAD),
        clamp(box[3] + PAD),
      ]
    : [0, 0, SCALE, SCALE];
  const fw = (xmax - xmin) / SCALE;
  const fh = (ymax - ymin) / SCALE;
  const valid = fw > 0.02 && fh > 0.01;
  const alt = t("questionBank.examImport.review.originalAlt");

  return (
    <figure className="space-y-1" data-testid={testId}>
      {valid && ratio ? (
        <div
          className="relative w-full overflow-hidden rounded border border-gray-200 bg-white"
          style={{ aspectRatio: `${(fw * ratio) / fh}`, maxHeight: 320 }}
        >
          <ZoomableImage
            src={src}
            alt={alt}
            buttonClassName="absolute inset-0 block h-full w-full overflow-hidden"
            className="absolute left-0 top-0 max-w-none"
            style={{
              width: `${100 / fw}%`,
              transform: `translate(-${xmin / 10}%, -${ymin / 10}%)`,
            }}
            testId={`${testId}-img`}
          />
        </div>
      ) : (
        <div className="h-40 overflow-hidden rounded border border-gray-200 bg-gray-50">
          <ZoomableImage
            src={src}
            alt={alt}
            buttonClassName="block h-full w-full"
            className="h-full w-full object-contain"
            testId={`${testId}-img`}
          />
        </div>
      )}
      <figcaption className="text-xs text-gray-500">
        {t("questionBank.examImport.review.originalHint")}
      </figcaption>
    </figure>
  );
}
