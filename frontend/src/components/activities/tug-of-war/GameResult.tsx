/**
 * GameResult - 遊戲結果覆蓋層
 *
 * 顯示勝負結果、雙方分數，以及重新開始按鈕。
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RotateCcw, X } from "lucide-react";
import type { Team } from "./types";

interface GameResultProps {
  winner: Team | "draw";
  scores: { a: number; b: number };
  totalQuestions: number;
  onRestart: () => void;
  onClose: () => void;
}

export function GameResult({
  winner,
  scores,
  totalQuestions: _totalQuestions,
  onRestart,
  onClose,
}: GameResultProps) {
  const { t } = useTranslation();

  const resultColor =
    winner === "a"
      ? "text-blue-500"
      : winner === "b"
        ? "text-red-500"
        : "text-amber-500";

  const resultText =
    winner === "a"
      ? t("tugOfWar.result.teamAWins")
      : winner === "b"
        ? t("tugOfWar.result.teamBWins")
        : t("tugOfWar.result.draw");

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur rounded-xl px-6 py-3 shadow-lg flex items-center gap-4">
        {/* Winner */}
        <span className="text-lg pixel-font">
          {winner === "draw" ? "🤝" : "🏆"}
        </span>
        <span className={`text-lg font-bold pixel-font ${resultColor}`}>
          {resultText}
        </span>

        {/* Scores */}
        <div className="flex items-center gap-2 text-sm font-bold pixel-font">
          <span className="text-blue-600">{scores.a}</span>
          <span className="text-gray-400">:</span>
          <span className="text-red-600">{scores.b}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="gap-1 h-8"
          >
            <X className="h-3.5 w-3.5" />
            {t("tugOfWar.result.close")}
          </Button>
          <Button
            size="sm"
            onClick={onRestart}
            className="gap-1 h-8 bg-amber-500 hover:bg-amber-600 text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("tugOfWar.result.playAgain")}
          </Button>
        </div>
      </div>
    </div>
  );
}
