/**
 * 題組模式的考卷擷取接線（Issue #1084 第 1 段）。
 *
 * MagicPasteInput（reading_group）擷取完 → 本 hook：
 * 1. 找到右側唯一的題組單元；已有內容就先開覆蓋確認（`pending`），空的直接套用
 * 2. kind=image：圖片檔依 box_2d 裁圖（`cropImageFile`）→ 上傳；裁不出來就整張圖上傳並提示；
 *    PDF 無法裁圖 → 不放圖，提示老師在排版另外上傳素材圖
 * 3. `groupDraftFromExtracted` 填進題組草稿（保留 key／公開／來源／年段）
 *
 * `onInsertGroup` 回傳的 Promise 在套用或取消後才 resolve，MagicPasteInput 據此維持 loading。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { toast } from "sonner";

import type { MagicPasteGroupResult } from "@/components/shared/MagicPasteInput";

import { cropImageFile } from "./cropImage";
import { groupDraftFromExtracted } from "./extractedGroup";
import { unitHasContent, type GroupDraft, type UnitDraft } from "./questionDraft";
import { uploadImageFile } from "./uploadImageFile";

export interface PendingGroupExtract {
  result: MagicPasteGroupResult;
  file: File;
  base: GroupDraft;
}

interface Options {
  units: UnitDraft[];
  /** 套用擷取結果到題組單元（key 相同） */
  replaceGroup: (key: string, next: GroupDraft) => void;
  t: TFunction;
}

export function useExtractedGroup({ units, replaceGroup, t }: Options) {
  const [extracting, setExtracting] = useState(false);
  const [pending, setPending] = useState<PendingGroupExtract | null>(null);
  const unitsRef = useRef(units);
  const resolveRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    unitsRef.current = units;
  }, [units]);

  const apply = useCallback(
    async (result: MagicPasteGroupResult, file: File, base: GroupDraft) => {
      setExtracting(true);
      try {
        let imageUrl: string | null = null;
        if (result.stimulus.kind === "image") {
          if (file.type.startsWith("image/")) {
            const cropped = await cropImageFile(file, result.stimulus.box_2d);
            if (!cropped) {
              toast.info(t("contentEditor.magicPaste.groupImageFallbackWhole"));
            }
            imageUrl = await uploadImageFile(cropped ?? file, t);
          } else {
            toast.info(t("contentEditor.magicPaste.groupImageNeedsUpload"));
          }
        }
        const next = groupDraftFromExtracted(result, base, imageUrl);
        replaceGroup(base.key, next);
        toast.success(
          t("contentEditor.magicPaste.insertedGroup", {
            count: next.questions.length,
          }),
        );
      } finally {
        setExtracting(false);
      }
    },
    [replaceGroup, t],
  );

  const finishPending = useCallback(() => {
    resolveRef.current?.();
    resolveRef.current = null;
    setPending(null);
  }, []);

  /** 交給 MagicPasteInput 的回呼：擷取完（AI 已回）才會被叫到 */
  const onInsertGroup = useCallback(
    (result: MagicPasteGroupResult, file: File): Promise<void> => {
      const target = unitsRef.current.find(
        (u): u is { kind: "group"; draft: GroupDraft } => u.kind === "group",
      );
      if (!target) return Promise.resolve();
      const base = target.draft;
      if (unitHasContent(target)) {
        return new Promise<void>((resolve) => {
          resolveRef.current = resolve;
          setPending({ result, file, base });
        });
      }
      return apply(result, file, base);
    },
    [apply],
  );

  const confirmPending = useCallback(async () => {
    const p = pending;
    if (!p) return;
    setPending(null);
    try {
      await apply(p.result, p.file, p.base);
    } finally {
      resolveRef.current?.();
      resolveRef.current = null;
    }
  }, [apply, pending]);

  return {
    extracting,
    pending,
    onInsertGroup,
    confirmPending,
    cancelPending: finishPending,
  };
}
