/**
 * 情境圖手動重裁（Issue #1146）。
 *
 * 點情境圖縮圖開這個對話框：在**原圖**（PDF 則是該頁的頁面圖）上拖拉一個框，按「套用」
 * 就依新框重裁、重新上傳、換掉那張情境圖。原圖只在前端記憶體（見 scenarioImages.ts）。
 *
 * 一開啟就畫出目前的裁切框，老師只想微調時看得到從哪裡開始。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { rectToBox, type ScenarioImage } from "./scenarioImages";

interface Props {
  image: ScenarioImage | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (box: number[]) => void;
}

type Point = { x: number; y: number };

export function ScenarioImageCropDialog({
  image,
  busy,
  onOpenChange,
  onApply,
}: Props) {
  const { t } = useTranslation();
  const source = image?.source ?? null;
  const [box, setBox] = useState<number[] | null>(source?.box ?? null);
  const dragStart = useRef<Point | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const sourceUrl = useMemo(
    () => (source ? URL.createObjectURL(source.file) : null),
    [source],
  );
  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    },
    [sourceUrl],
  );
  // 換一張圖重開時，框回到那張圖目前的裁切範圍
  useEffect(() => setBox(source?.box ?? null), [source]);

  const toPoint = (e: React.PointerEvent): Point | null => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toPoint(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragStart.current = p;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const p = toPoint(e);
    if (!p) return;
    const next = rectToBox(dragStart.current, p);
    if (next) setBox(next);
  };
  const onPointerUp = () => {
    dragStart.current = null;
  };

  const boxStyle = box
    ? {
        top: `${box[0] / 10}%`,
        left: `${box[1] / 10}%`,
        height: `${(box[2] - box[0]) / 10}%`,
        width: `${(box[3] - box[1]) / 10}%`,
      }
    : null;

  return (
    <Dialog open={!!image} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("scenarioDialogue.images.cropTitle")}</DialogTitle>
          <DialogDescription>
            {t("scenarioDialogue.images.cropHint")}
          </DialogDescription>
        </DialogHeader>

        {sourceUrl && (
          <div className="flex justify-center">
            <div
              className="relative inline-block select-none touch-none cursor-crosshair"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              data-testid="scenario-crop-area"
            >
              <img
                ref={imgRef}
                src={sourceUrl}
                alt=""
                draggable={false}
                className="block max-h-[60vh] max-w-full"
              />
              {boxStyle && (
                <div
                  className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/10"
                  style={boxStyle}
                />
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("contentEditor.buttons.cancel")}
          </Button>
          <Button onClick={() => box && onApply(box)} disabled={busy || !box}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("scenarioDialogue.images.applyCrop")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
