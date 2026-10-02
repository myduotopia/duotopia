/**
 * 區塊編輯器裡「一個區塊」的表單（Issue #1082；第 2 段修訂改成文件感）。
 *
 * - heading：無框線的大字輸入，聚焦才出現層級（2/3）與粗體／底線工具列（版面內，不浮出）
 * - paragraph：無框線、隨內容長高的 textarea；聚焦才出現粗體／底線工具列（版面內，不浮出）
 *   （克漏字 `{{n}}` 由克漏字段接）
 * - image：上傳（與選項圖片同一條 uploadImageFile 路徑）＋尺寸（小／中／大／原始 → maxWidth）
 *   ／對齊／替代文字／圖說／框線
 * - dialogue：說話者＋內容的行列表
 *
 * 只負責欄位，不知道自己在哪一欄；拖曳把手、寬度、外框、刪除由 LayoutBlockChrome 包在外面。
 */

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  ImagePlus,
  Loader2,
  Plus,
  SquareDashedBottom,
  Trash2,
  Underline,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { LayoutBlock, LayoutDialogueLine } from "@/types/questionBank";
import type { EditorBlock } from "./layoutEditorModel";
import type { Marker } from "./layoutInline";
import { insertBlankIntoText } from "./clozeDraft";
import { VALID_IMAGE_TYPES, uploadImageFile } from "./uploadImageFile";
import { DOC_TEXTAREA_CLASS, useAutoGrow } from "./useAutoGrow";

export interface LayoutBlockEditorProps {
  block: EditorBlock;
  onChange: (patch: Partial<LayoutBlock>) => void;
  disabled?: boolean;
  testId: string;
  /** 克漏字題組：段落工具列多一顆「插入空格」（#1085） */
  clozeMode?: boolean;
  /** 下一個要插入的空格編號（目前最大編號 + 1） */
  nextBlankIndex?: number;
}

/** 在 textarea 目前選取範圍兩側包上標記；沒選取就插入一對標記讓游標停在中間 */
function wrapSelection(
  el: HTMLTextAreaElement | null,
  value: string,
  marker: Marker,
): { next: string; cursor: number } {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const next = `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`;
  return {
    next,
    cursor: selected ? end + marker.length * 2 : start + marker.length,
  };
}

function MarkupToolbar({
  onWrap,
  disabled,
  testId,
}: {
  onWrap: (marker: Marker) => void;
  disabled?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  // mousedown 先擋掉，按鈕才不會把 textarea 的焦點搶走（工具列是聚焦才出現的）
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="flex gap-0.5">
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onWrap("**")}
        disabled={disabled}
        className="rounded p-1 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        title={t("questionBank.group.layout.bold")}
        aria-label={t("questionBank.group.layout.bold")}
        data-testid={`${testId}-bold`}
      >
        <Bold size={14} />
      </button>
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onWrap("__")}
        disabled={disabled}
        className="rounded p-1 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        title={t("questionBank.group.layout.underline")}
        aria-label={t("questionBank.group.layout.underline")}
        data-testid={`${testId}-underline`}
      >
        <Underline size={14} />
      </button>
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onWrap("==")}
        disabled={disabled}
        className="relative rounded p-1 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        title={t("questionBank.group.layout.doubleUnderline")}
        aria-label={t("questionBank.group.layout.doubleUnderline")}
        data-testid={`${testId}-double-underline`}
      >
        <Underline size={14} />
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 text-[9px] font-bold leading-none"
        >
          2
        </span>
      </button>
    </div>
  );
}

function TextBlockFields({
  block,
  onChange,
  disabled,
  testId,
  clozeMode,
  nextBlankIndex,
}: {
  block: Extract<EditorBlock, { type: "heading" | "paragraph" }>;
  onChange: (patch: Partial<LayoutBlock>) => void;
  disabled?: boolean;
  testId: string;
  clozeMode?: boolean;
  nextBlankIndex?: number;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  useAutoGrow(ref, block.text);
  const moveCursor = (cursor: number) => {
    window.setTimeout(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(cursor, cursor);
    }, 0);
  };
  const wrap = (marker: Marker) => {
    const { next, cursor } = wrapSelection(ref.current, block.text, marker);
    onChange({ text: next });
    moveCursor(cursor);
  };
  /**
   * 插入 `{{n}}`（非包裹式）。只改文字 —— 對應的小題卡由 GroupCard 的
   * `syncClozeQuestions` 從空格差集自動建立，避免兩邊各自記一份狀態。
   */
  const insertBlank = () => {
    const el = ref.current;
    const start = el?.selectionStart ?? block.text.length;
    const end = el?.selectionEnd ?? block.text.length;
    const { text, cursor } = insertBlankIntoText(
      block.text,
      start,
      end,
      nextBlankIndex ?? 1,
    );
    onChange({ text });
    moveCursor(cursor);
  };
  const isHeading = block.type === "heading";
  return (
    <div
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      {/* 聚焦才出現的工具列：放在版面內（textarea 上方），文件第一個區塊也不會被裁切 */}
      {focused && !disabled && (
        <div
          className="mb-1 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1 py-0.5 shadow-sm"
          data-testid={`${testId}-toolbar`}
        >
          {isHeading && (
            <Select
              value={String(block.level)}
              onValueChange={(v) => onChange({ level: Number(v) as 2 | 3 })}
              disabled={disabled}
            >
              <SelectTrigger
                className="h-6 w-16 border-0 text-xs shadow-none"
                data-testid={`${testId}-level`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">H2</SelectItem>
                <SelectItem value="3">H3</SelectItem>
              </SelectContent>
            </Select>
          )}
          <MarkupToolbar onWrap={wrap} disabled={disabled} testId={testId} />
          {clozeMode && !isHeading && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertBlank}
              disabled={disabled}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50"
              title={t("questionBank.group.layout.insertBlank")}
              data-testid={`${testId}-insert-blank`}
            >
              <SquareDashedBottom size={14} />
              {t("questionBank.group.layout.insertBlank")}
            </button>
          )}
        </div>
      )}
      <Textarea
        ref={ref}
        value={block.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={1}
        placeholder={t(
          isHeading
            ? "questionBank.group.layout.headingPlaceholder"
            : "questionBank.group.layout.paragraphPlaceholder",
        )}
        disabled={disabled}
        className={cn(
          DOC_TEXTAREA_CLASS,
          isHeading
            ? block.level === 2
              ? "text-lg font-semibold"
              : "text-base font-semibold"
            : "text-sm leading-relaxed",
        )}
        data-testid={`${testId}-text`}
      />
    </div>
  );
}

const IMAGE_SIZES: { key: string; maxWidth: number | undefined }[] = [
  { key: "small", maxWidth: 240 },
  { key: "medium", maxWidth: 480 },
  { key: "large", maxWidth: 720 },
  { key: "original", maxWidth: undefined },
];

function imageSizeKey(maxWidth: number | undefined): string {
  if (maxWidth === undefined) return "original";
  const hit = IMAGE_SIZES.find((s) => s.maxWidth === maxWidth);
  if (hit) return hit.key;
  // 舊資料的自訂數值：歸到最接近的一級
  return maxWidth <= 300 ? "small" : maxWidth <= 600 ? "medium" : "large";
}

function ImageBlockFields({
  block,
  onChange,
  disabled,
  testId,
}: {
  block: Extract<EditorBlock, { type: "image" }>;
  onChange: (patch: Partial<LayoutBlock>) => void;
  disabled?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadImageFile(file, t);
      if (url) onChange({ url });
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="space-y-2">
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
        data-testid={`${testId}-file`}
      />
      {/* 圖片本體：照對齊與尺寸顯示，跟預覽一致；還沒圖就是一個上傳區 */}
      <div
        className={cn(
          "flex",
          (block.align ?? "center") === "left" && "justify-start",
          (block.align ?? "center") === "center" && "justify-center",
          (block.align ?? "center") === "right" && "justify-end",
        )}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className={cn(
            "flex items-center justify-center overflow-hidden rounded text-gray-400 hover:text-blue-600 disabled:opacity-50",
            block.url
              ? cn("max-h-72", block.frame && "border border-gray-400 p-1")
              : "h-28 w-full border border-dashed border-gray-300 hover:border-blue-400",
          )}
          style={
            block.url && block.maxWidth
              ? { maxWidth: block.maxWidth }
              : undefined
          }
          aria-label={t("questionBank.group.layout.imageUpload")}
          title={
            block.url ? t("questionBank.group.layout.imageReplace") : undefined
          }
          data-testid={`${testId}-upload`}
        >
          {uploading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : block.url ? (
            <img
              src={block.url}
              alt={block.alt ?? ""}
              className="max-h-72 w-full object-contain"
            />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs">
              <ImagePlus size={18} />
              {t("questionBank.group.layout.imageUpload")}
            </span>
          )}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={imageSizeKey(block.maxWidth)}
          onValueChange={(v) =>
            onChange({
              maxWidth: IMAGE_SIZES.find((s) => s.key === v)?.maxWidth,
            })
          }
          disabled={disabled}
        >
          <SelectTrigger
            className="h-7 w-24 text-xs"
            data-testid={`${testId}-size`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMAGE_SIZES.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {t(`questionBank.group.layout.imageSize.${s.key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={block.align ?? "center"}
          onValueChange={(v) =>
            onChange({ align: v as "left" | "center" | "right" })
          }
          disabled={disabled}
        >
          <SelectTrigger
            className="h-7 w-20 text-xs"
            data-testid={`${testId}-align`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left">
              {t("questionBank.group.layout.alignLeft")}
            </SelectItem>
            <SelectItem value="center">
              {t("questionBank.group.layout.alignCenter")}
            </SelectItem>
            <SelectItem value="right">
              {t("questionBank.group.layout.alignRight")}
            </SelectItem>
          </SelectContent>
        </Select>
        <label className="flex shrink-0 items-center gap-1 text-xs text-gray-600">
          <Checkbox
            checked={block.frame ?? false}
            onCheckedChange={(c) => onChange({ frame: c === true })}
            disabled={disabled}
            data-testid={`${testId}-frame-image`}
          />
          {t("questionBank.group.layout.imageFrame")}
        </label>
        <Input
          value={block.caption ?? ""}
          onChange={(e) => onChange({ caption: e.target.value || undefined })}
          placeholder={t("questionBank.group.layout.imageCaption")}
          className="h-7 min-w-[8rem] flex-1 text-xs"
          disabled={disabled}
          data-testid={`${testId}-caption`}
        />
        <Input
          value={block.alt ?? ""}
          onChange={(e) => onChange({ alt: e.target.value })}
          placeholder={t("questionBank.group.layout.imageAlt")}
          className="h-7 min-w-[8rem] flex-1 text-xs"
          disabled={disabled}
          data-testid={`${testId}-alt`}
        />
      </div>
    </div>
  );
}

function DialogueBlockFields({
  block,
  onChange,
  disabled,
  testId,
}: {
  block: Extract<EditorBlock, { type: "dialogue" }>;
  onChange: (patch: Partial<LayoutBlock>) => void;
  disabled?: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const setLines = (lines: LayoutDialogueLine[]) => onChange({ lines });
  const patchLine = (i: number, p: Partial<LayoutDialogueLine>) =>
    setLines(block.lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  return (
    <div className="space-y-1.5">
      {block.lines.map((line, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <Input
            value={line.speaker}
            onChange={(e) => patchLine(i, { speaker: e.target.value })}
            placeholder={t("questionBank.group.layout.dialogueSpeaker")}
            className="h-8 w-24 shrink-0 text-xs"
            disabled={disabled}
            data-testid={`${testId}-speaker-${i}`}
          />
          <Textarea
            value={line.text}
            onChange={(e) => patchLine(i, { text: e.target.value })}
            placeholder={t("questionBank.group.layout.dialogueText")}
            rows={1}
            className="min-h-0 flex-1 text-sm"
            disabled={disabled}
            data-testid={`${testId}-line-${i}`}
          />
          <button
            type="button"
            onClick={() => setLines(block.lines.filter((_, idx) => idx !== i))}
            disabled={disabled || block.lines.length <= 1}
            className="mt-1.5 text-gray-400 hover:text-red-600 disabled:opacity-40"
            aria-label={t("questionBank.group.layout.removeLine")}
            data-testid={`${testId}-remove-line-${i}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-gray-600"
          onClick={() => setLines([...block.lines, { speaker: "", text: "" }])}
          disabled={disabled}
          data-testid={`${testId}-add-line`}
        >
          <Plus size={12} />
          {t("questionBank.group.layout.addLine")}
        </Button>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <Checkbox
            checked={block.frame !== false}
            onCheckedChange={(c) => onChange({ frame: c === true })}
            disabled={disabled}
          />
          {t("questionBank.group.layout.frame")}
        </label>
      </div>
    </div>
  );
}

export default function LayoutBlockEditor({
  block,
  onChange,
  disabled,
  testId,
  clozeMode,
  nextBlankIndex,
}: LayoutBlockEditorProps) {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return (
        <TextBlockFields
          block={block}
          onChange={onChange}
          disabled={disabled}
          testId={testId}
          clozeMode={clozeMode}
          nextBlankIndex={nextBlankIndex}
        />
      );
    case "image":
      return (
        <ImageBlockFields
          block={block}
          onChange={onChange}
          disabled={disabled}
          testId={testId}
        />
      );
    case "dialogue":
      return (
        <DialogueBlockFields
          block={block}
          onChange={onChange}
          disabled={disabled}
          testId={testId}
        />
      );
  }
}
