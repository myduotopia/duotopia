/**
 * RotateOverlay — 直向提示遮罩（issue #920）
 *
 * 拔河為兩人左右分邊對戰，需橫向。偵測到直向時以像素風提示轉向，可略過續玩。
 */

import { useMemo } from "react";
import { makeSheet, spriteStyle } from "./renderSprite";
import { makePhone } from "./sprites/scenery";

interface RotateOverlayProps {
  title: string;
  hint: string;
  continueLabel: string;
  onContinue: () => void;
}

export function RotateOverlay({
  title,
  hint,
  continueLabel,
  onContinue,
}: RotateOverlayProps) {
  const phoneStyle = useMemo(() => {
    const sheet = makeSheet(makePhone(), {}, "phone");
    return spriteStyle(sheet, 5);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#2e222f] text-center">
      <div className="tow-phone-tilt" style={phoneStyle} />
      <h2 className="pixel-font text-xl text-[#f9c22b]">{title}</h2>
      <p className="text-sm text-[#9babb2]">{hint}</p>
      <button
        onClick={onContinue}
        className="pixel-font mt-2 bg-[#625565] px-4 py-2 text-sm text-white border-b-[3px] border-[#3e3546] active:translate-y-[2px]"
      >
        {continueLabel}
      </button>
    </div>
  );
}
