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
  /** 進行中的動作數（可能兩批同時跑），> 0 就是 busy */
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const [cropping, setCropping] = useState<ScenarioImage | null>(null);
  /**
   * 5 張上限的計數要即時，而且要算進「還在上傳中」的（review 7）：
   *
   * - 一次擷取多個檔案時是在同一個 async 流程裡連續新增，閉包裡的 `images.length`
   *   還是開始時的值 → 用 ref 記「已經在清單上」的張數（committed）。
   * - 兩批同時在跑（例如擷取還在上傳、老師又補傳）時，各自讀到的空位都還沒扣掉對方
   *   → 開始上傳**之前**先同步預留格數（pending），上傳完再轉成 committed。
   *
   * 清單被外部整個換掉（改選情境來源時清空）時，committed 由 effect 對回實際張數。
   */
  const committedRef = useRef(images.length);
  const pendingRef = useRef(0);
  useEffect(() => {
    committedRef.current = images.length;
  }, [images.length]);

  /** 同步預留最多 `wanted` 格，回傳實際拿到幾格（0 = 已滿） */
  const reserve = useCallback((wanted: number) => {
    const room = Math.max(
      0,
      MAX_SCENARIO_IMAGES - committedRef.current - pendingRef.current,
    );
    const take = Math.min(room, wanted);
    pendingRef.current += take;
    return take;
  }, []);

  /** 共用的收尾：釋放預留、附加到清單末端、報告失敗與略過張數 */
  const append = useCallback(
    (
      reserved: number,
      added: ScenarioImage[],
      failed: number,
      skipped: number,
    ) => {
      pendingRef.current = Math.max(0, pendingRef.current - reserved);
      if (added.length) {
        committedRef.current += added.length;
        // 最後一道守衛：無論如何不超過上限
        setImages((prev) => [...prev, ...added].slice(0, MAX_SCENARIO_IMAGES));
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
      setBusyCount((c) => c + 1);
      const reserved = reserve(valid.length);
      let result = { images: [] as ScenarioImage[], failed: 0, skipped: 0 };
      try {
        result = await uploadCrops(
          // 自己上傳的圖整張就是情境圖，原圖也留著讓老師之後可以裁小一點
          valid.map((file) => ({ file, source: { file, box: FULL_BOX } })),
          reserved,
          t,
        );
      } finally {
        append(reserved, result.images, result.failed, result.skipped);
        setBusyCount((c) => c - 1);
      }
    },
    [append, reserve, t],
  );

  const addExtracted = useCallback(
    async (file: File, figures: ExtractedFigure[]) => {
      if (figures.length === 0) return;
      setBusyCount((c) => c + 1);
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
        const reserved = reserve(crops.length);
        let result = { images: [] as ScenarioImage[], failed: 0, skipped: 0 };
        try {
          result = await uploadCrops(crops, reserved, t);
        } finally {
          append(reserved, result.images, result.failed, result.skipped);
        }
      } finally {
        setBusyCount((c) => c - 1);
      }
    },
    [append, reserve, t],
  );

  const remove = useCallback(
    (id: string) => setImages((prev) => prev.filter((img) => img.id !== id)),
    [setImages],
  );

  const applyCrop = useCallback(
    async (box: number[]) => {
      if (!cropping) return;
      setBusyCount((c) => c + 1);
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
        setBusyCount((c) => c - 1);
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
