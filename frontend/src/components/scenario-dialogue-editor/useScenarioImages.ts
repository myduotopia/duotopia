/**
 * 情境圖 state 與動作（Issue #1146）：新增（擷取裁切／老師自己上傳）、刪除、重裁。
 *
 * state 本身由面板持有（存檔、出題都要讀），這裡只包動作與 loading，讓面板不必再長一段。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  MAX_SCENARIO_IMAGES,
  FULL_BOX,
  cropFigures,
  recropImage,
  uploadCrops,
  validateManualImage,
  type ExtractedFigure,
  type ScenarioImage,
} from "./scenarioImages";

export interface ScenarioImageActions {
  images: ScenarioImage[];
  busy: boolean;
  /** 正在重裁的那張（開著裁切對話框） */
  cropping: ScenarioImage | null;
  setCropping: (image: ScenarioImage | null) => void;
  addManual: (files: FileList | File[]) => Promise<void>;
  addExtracted: (file: File, figures: ExtractedFigure[]) => Promise<void>;
  remove: (id: string) => void;
  applyCrop: (box: number[]) => Promise<void>;
}

export function useScenarioImages(
  images: ScenarioImage[],
  setImages: Dispatch<SetStateAction<ScenarioImage[]>>,
): ScenarioImageActions {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState<ScenarioImage | null>(null);
  /**
   * 目前的張數要即時：一次擷取多個檔案時是在同一個 async 流程裡連續新增，閉包裡的
   * `images.length` 還是開始時的值，會讓總數超過 5 張。新增時同步更新這個 ref。
   */
  const countRef = useRef(images.length);
  countRef.current = Math.max(countRef.current, images.length);
  useEffect(() => {
    countRef.current = images.length;
  }, [images.length]);

  /** 共用的收尾：附加到清單末端、報告失敗與略過張數 */
  const append = useCallback(
    (added: ScenarioImage[], failed: number, skipped: number) => {
      if (added.length) {
        countRef.current += added.length;
        setImages((prev) => [...prev, ...added]);
      }
      if (failed > 0) {
        toast.error(
          t("scenarioDialogue.images.uploadFailed", { count: failed }),
        );
      }
      if (skipped > 0) {
        toast.info(
          t("scenarioDialogue.images.overLimit", {
            max: MAX_SCENARIO_IMAGES,
            count: skipped,
          }),
        );
      }
    },
    [setImages, t],
  );

  const addManual = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const valid: File[] = [];
      for (const file of list) {
        const errorKey = validateManualImage(file);
        if (errorKey) toast.error(t(errorKey));
        else valid.push(file);
      }
      if (valid.length === 0) return;
      setBusy(true);
      try {
        const {
          images: added,
          failed,
          skipped,
        } = await uploadCrops(
          // 自己上傳的圖整張就是情境圖，原圖也留著讓老師之後可以裁小一點
          valid.map((file) => ({ file, source: { file, box: FULL_BOX } })),
          MAX_SCENARIO_IMAGES - countRef.current,
          t,
        );
        append(added, failed, skipped);
      } finally {
        setBusy(false);
      }
    },
    [append, t],
  );

  const addExtracted = useCallback(
    async (file: File, figures: ExtractedFigure[]) => {
      if (figures.length === 0) return;
      setBusy(true);
      try {
        let crops: Awaited<ReturnType<typeof cropFigures>> = [];
        try {
          crops = await cropFigures(file, figures);
        } catch (err) {
          // PDF 讀不開（加密、壞檔）時文字仍然擷取得到，只是沒有圖
          console.error("Scenario image crop failed:", err);
        }
        if (crops.length < figures.length) {
          toast.info(t("scenarioDialogue.images.someNotCropped"));
        }
        const {
          images: added,
          failed,
          skipped,
        } = await uploadCrops(crops, MAX_SCENARIO_IMAGES - countRef.current, t);
        append(added, failed, skipped);
      } finally {
        setBusy(false);
      }
    },
    [append, t],
  );

  const remove = useCallback(
    (id: string) => setImages((prev) => prev.filter((img) => img.id !== id)),
    [setImages],
  );

  const applyCrop = useCallback(
    async (box: number[]) => {
      if (!cropping) return;
      setBusy(true);
      try {
        const next = await recropImage(cropping, box, t);
        if (!next) {
          toast.error(t("scenarioDialogue.images.cropFailed"));
          return;
        }
        setImages((prev) =>
          prev.map((img) => (img.id === next.id ? next : img)),
        );
        setCropping(null);
      } finally {
        setBusy(false);
      }
    },
    [cropping, setImages, t],
  );

  return {
    images,
    busy,
    cropping,
    setCropping,
    addManual,
    addExtracted,
    remove,
    applyCrop,
  };
}
