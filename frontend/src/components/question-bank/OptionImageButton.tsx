/**
 * 選項圖片按鈕（Issue #1064）。
 *
 * 上傳邏輯在 `uploadImageFile`（2MB 上限、型別白名單、`apiClient.uploadImage`），
 * 與題組排版的圖片區塊共用。無圖＝圖片 icon；有圖＝縮圖，hover 顯示移除。
 */

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Loader2, X } from "lucide-react";

import { VALID_IMAGE_TYPES, uploadImageFile } from "./uploadImageFile";

export interface OptionImageButtonProps {
  imageUrl: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  label: string;
}

export default function OptionImageButton({
  imageUrl,
  onChange,
  disabled,
  label,
}: OptionImageButtonProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadImageFile(file, t);
      if (url) onChange(url);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept={VALID_IMAGE_TYPES.join(",")}
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
        data-testid="option-image-input"
      />
      {imageUrl ? (
        <div className="group relative h-9 w-9 rounded border border-gray-200 overflow-hidden">
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/50 text-white"
              aria-label={t("questionBank.form.removeImage")}
              data-testid="option-image-remove"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="h-9 w-9 flex items-center justify-center rounded border border-dashed border-gray-300 text-gray-400 hover:text-blue-600 hover:border-blue-400 disabled:opacity-50"
          aria-label={label}
          title={label}
          data-testid="option-image-button"
        >
          {uploading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ImagePlus size={16} />
          )}
        </button>
      )}
    </div>
  );
}
