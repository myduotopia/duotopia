/**
 * 題庫圖片上傳（Issue #1064 / #1082）。
 *
 * 抽自 OptionImageButton（原抽自 VocabularySetPanel）：2MB 上限、型別白名單、
 * `apiClient.uploadImage`。選項圖片、題組排版的圖片區塊共用同一條路徑。
 * 回傳 image_url；驗證不過或上傳失敗回 null（已 toast）。
 *
 * `silent`：批次上傳（擷取一次裁十幾張，#1084）時不要每張都彈 toast，
 * 由呼叫端在整批結束後統一報「n 張圖片上傳失敗」。
 */

import { toast } from "sonner";
import type { TFunction } from "i18next";

import { apiClient } from "@/lib/api";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const VALID_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export async function uploadImageFile(
  file: File,
  t: TFunction,
  options: { silent?: boolean } = {},
): Promise<string | null> {
  const fail = (key: string) => {
    if (!options.silent) toast.error(t(key));
    return null;
  };
  if (file.size > MAX_IMAGE_BYTES) {
    return fail("vocabularySet.image.tooLarge");
  }
  if (!VALID_IMAGE_TYPES.includes(file.type)) {
    return fail("vocabularySet.image.invalidType");
  }
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiClient.uploadImage(formData);
    return res.image_url;
  } catch (err) {
    console.error("Question bank image upload failed:", err);
    return fail("vocabularySet.image.uploadFailed");
  }
}
