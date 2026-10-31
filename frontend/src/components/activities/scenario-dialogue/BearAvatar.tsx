/**
 * BearAvatar — 情境對話 AI 一側的頭像：線描熊熊（#1158 E-2，取代原本灰底 Bot 圖示）。
 *
 * 圓底 purple-100、線條 purple-700（情境對話分類色，和情境卡標頭同色系）。SVG viewBox 24×24，
 * 線寬 1.8、圓角端點；口鼻橢圓線寬 1.1（比其他線條細）；臉填圓底色，蓋住耳朵內側。
 * 對話中 40px（SVG 約 30px）。純裝飾（aria-hidden），學生一側不放頭像。
 */

import { cn } from "@/lib/utils";

export function BearAvatar({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700",
        className,
      )}
      aria-hidden
      data-testid="bear-avatar"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[30px] w-[30px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="6.2" cy="6.8" r="2.6" className="fill-purple-100" />
        <circle cx="17.8" cy="6.8" r="2.6" className="fill-purple-100" />
        <circle cx="12" cy="13.2" r="7.6" className="fill-purple-100" />
        <circle cx="9.3" cy="11.6" r="0.75" fill="currentColor" stroke="none" />
        <circle
          cx="14.7"
          cy="11.6"
          r="0.75"
          fill="currentColor"
          stroke="none"
        />
        <ellipse cx="12" cy="15.9" rx="3.3" ry="2.5" strokeWidth={1.1} />
        <path d="M11.2 15.0h1.6L12 15.8z" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
