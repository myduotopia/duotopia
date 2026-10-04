/**
 * 題組模式的考卷擷取接線（Issue #1084 第 1 段）。
 *
 * MagicPasteInput（reading_group）擷取完 → 本 hook：
 * 1. 找到右側唯一的題組單元；已有內容就先開覆蓋確認（`pending`，只記 key，確認時以最新草稿
 *    為底，對話框開著時老師改的公開／來源／年段不會被舊快照蓋掉），空的直接套用；
 *    找不到題組單元時 toast 錯誤（不靜默丟掉）
 * 2. 圖片檔依座標一次裁好所有圖並上傳（`uploadExtractedGroupImages`）：整塊素材圖、
 *    文章插圖、小題題幹圖與選項圖；素材圖裁不出來就整張圖上傳並提示；
 *    PDF 無法裁圖 → 文字與空格照常，提示老師手動補圖
 * 3. `groupDraftFromExtracted` 填進題組草稿（保留 key／公開／來源／年段）
 *
 * `onInsertGroup` 回傳的 Promise 在套用或取消後才 resolve，MagicPasteInput 據此維持 loading。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { toast } from "sonner";

import type { MagicPasteGroupResult } from "@/components/shared/MagicPasteInput";

import { groupDraftFromExtracted } from "./extractedGroup";
import { uploadExtractedGroupImages } from "./extractedImages";
import {
  unitHasContent,
  type GroupDraft,
  type UnitDraft,
} from "./questionDraft";

export interface PendingGroupExtract {
  result: MagicPasteGroupResult;
  file: File;
  /** 要覆蓋的題組單元 key；確認時以最新草稿為底，不用擷取當下的快照 */
  key: string;
}

function findGroupUnit(
  units: UnitDraft[],
  key?: string,
): { kind: "group"; draft: GroupDraft } | undefined {
  return units.find(
    (u): u is { kind: "group"; draft: GroupDraft } =>
      u.kind === "group" && (key === undefined || u.draft.key === key),
  );
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
        const images = await uploadExtractedGroupImages(result, file, t);
        const next = groupDraftFromExtracted(result, base, images);
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
      const target = findGroupUnit(unitsRef.current);
      if (!target) {
        // 正常 gating 下不會發生；若發生要讓老師知道結果被丟掉了
        console.warn("[useExtractedGroup] no group unit to receive extraction");
        toast.error(t("contentEditor.magicPaste.extractFailed"));
        return Promise.resolve();
      }
      if (unitHasContent(target)) {
        return new Promise<void>((resolve) => {
          resolveRef.current = resolve;
          setPending({ result, file, key: target.draft.key });
        });
      }
      return apply(result, file, target.draft);
    },
    [apply, t],
  );

  const confirmPending = useCallback(async () => {
    const p = pending;
    if (!p) return;
    setPending(null);
    try {
      // 對話框開著時老師可能改了公開／來源／年段：以最新草稿為底
      const target = findGroupUnit(unitsRef.current, p.key);
      if (!target) {
        console.warn(
          "[useExtractedGroup] group unit disappeared before confirm",
        );
        toast.error(t("contentEditor.magicPaste.extractFailed"));
        return;
      }
      await apply(p.result, p.file, target.draft);
    } finally {
      resolveRef.current?.();
      resolveRef.current = null;
    }
  }, [apply, pending, t]);

  return {
    extracting,
    pending,
    onInsertGroup,
    confirmPending,
    cancelPending: finishPending,
  };
}
