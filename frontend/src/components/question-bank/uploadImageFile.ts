/**
 * 題庫圖片上傳（Issue #1064 / #1082）。
 *
 * 抽自 OptionImageButton（原抽自 VocabularySetPanel）：2MB 上限、型別白名單、
 * `apiClient.uploadImage`。選項圖片、題組排版的圖片區塊共用同一條路徑。
 * 回傳 image_url；驗證不過或上傳失敗回 null（已 toast）。
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
): Promise<string | null> {
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error(t("vocabularySet.image.tooLarge"));
    return null;
  }
  if (!VALID_IMAGE_TYPES.includes(file.type)) {
    toast.error(t("vocabularySet.image.invalidType"));
    return null;
  }
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiClient.uploadImage(formData);
    return res.image_url;
  } catch (err) {
    console.error("Question bank image upload failed:", err);
    toast.error(t("vocabularySet.image.uploadFailed"));
    return null;
  }
}
