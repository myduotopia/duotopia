/**
 * TugOfWarGame - 拔河遊戲主元件
 *
 * 2 人同螢幕對戰的單字選擇遊戲。純前端，不寫入資料庫。
 * 透過 assignment API 取得單字資料後，遊戲邏輯全在前端。
 *
 * Props:
 * - assignmentId: 用來 fetch 單字列表
 * - isPreviewMode / isDemoMode: API endpoint 切換
 * - onComplete: 遊戲結束/關閉時的回調
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, ChevronDown, Loader2, RotateCcw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiClient } from "@/lib/api";
import { useGameLogic } from "./tug-of-war/useGameLogic";
import { QuestionDisplay } from "./tug-of-war/QuestionDisplay";
import { TeamOptions } from "./tug-of-war/TeamOptions";
import { TugOfWarScene } from "@/games/tug-of-war/TugOfWarScene";
import type { TugOfWarState } from "@/games/tug-of-war/TugOfWarScene";
import type { VocabItem, QuestionMode } from "./tug-of-war/types";
import { DEFAULT_GAME_CONFIG } from "./tug-of-war/types";

interface TugOfWarGameProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  onComplete?: () => void;
}

interface WordOptionResponse {
  content_item_id: number;
  text: string;
  translation: string;
  audio_url?: string;
  image_url?: string;
}

const QUESTION_MODES: { value: QuestionMode; labelKey: string }[] = [
  { value: "audio_to_english", labelKey: "tugOfWar.modes.audioToEnglish" },
  { value: "audio_to_chinese", labelKey: "tugOfWar.modes.audioToChinese" },
  { value: "english_to_chinese", labelKey: "tugOfWar.modes.englishToChinese" },
  { value: "chinese_to_english", labelKey: "tugOfWar.modes.chineseToEnglish" },
  { value: "image_to_english", labelKey: "tugOfWar.modes.imageToEnglish" },
];

export function TugOfWarGame({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  onComplete,
}: TugOfWarGameProps) {
  const { t } = useTranslation();
  const [vocabItems, setVocabItems] = useState<VocabItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(false);
  const [viewport, setViewport] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    height: typeof window !== "undefined" ? window.innerHeight : 768,
  });
  const isPortrait = viewport.height > viewport.width;

  // Viewport size tracking
  useEffect(() => {
    const updateViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", updateViewport);
    screen.orientation?.addEventListener("change", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      screen.orientation?.removeEventListener("change", updateViewport);
    };
  }, []);

  // Attempt fullscreen + landscape lock on mount
  useEffect(() => {
    const requestLandscape = async () => {
      try {
        await document.documentElement.requestFullscreen?.();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (screen.orientation as any)?.lock?.("landscape");
      } catch {
        // Not supported — rely on rotate overlay
      }
    };
    requestLandscape();

    return () => {
      document.exitFullscreen?.().catch(() => {});
      try {
        screen.orientation?.unlock?.();
      } catch {
        // Ignore
      }
    };
  }, []);

  // Fetch vocabulary items
  useEffect(() => {
    const fetchVocab = async () => {
      try {
        setLoading(true);
        const endpoint = isDemoMode
          ? `/api/demo/assignments/${assignmentId}/preview/word-selection-start`
          : isPreviewMode
            ? `/api/teachers/assignments/${assignmentId}/preview/word-selection-start`
            : `/api/students/assignments/${assignmentId}/vocabulary/selection/start`;

        const data = await apiClient.get<{
          words: WordOptionResponse[];
          total_words: number;
        }>(endpoint);

        const items: VocabItem[] = data.words.map((w) => ({
          id: w.content_item_id,
          text: w.text,
          translation: w.translation,
          audio_url: w.audio_url,
          image_url: w.image_url,
        }));

        setVocabItems(items);
      } catch (err) {
        console.error("Failed to fetch vocabulary:", err);
        setError(t("tugOfWar.error.loadFailed"));
      } finally {
        setLoading(false);
      }
    };

    fetchVocab();
  }, [assignmentId, isPreviewMode, isDemoMode, t]);

  const {
    gameState,
    currentQuestion,
    totalQuestions,
    winScore,
    progress,
    winner,
    answerHistory,
    startGame,
    changeMode,
    handleAnswer,
  } = useGameLogic(vocabItems);

  const allHaveImages = vocabItems.every((v) => !!v.image_url);

  // Auto-start when vocab loads
  useEffect(() => {
    if (vocabItems.length > 0 && gameState.gameStatus === "waiting") {
      startGame("audio_to_english");
    }
  }, [vocabItems, gameState.gameStatus, startGame]);

  const handleModeChange = useCallback(
    (mode: QuestionMode) => {
      changeMode(mode);
    },
    [changeMode],
  );

  const handleClose = useCallback(() => {
    document.exitFullscreen?.().catch(() => {});
    try {
      screen.orientation?.unlock?.();
    } catch {
      // Ignore
    }
    onComplete?.();
  }, [onComplete]);

  const handleRestart = useCallback(() => {
    startGame(gameState.questionMode);
  }, [startGame, gameState.questionMode]);

  const isAnswered = gameState.answeredBy !== null;
  const isImageMode = gameState.questionMode === "image_to_english";
  const effectiveShowImages = showImages && !isImageMode;

  // Phaser game instance - must be before any early returns
  const phaserContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phaserGameRef = useRef<any>(null);

  // Init Phaser (lazy-loaded to avoid ~1MB in main bundle)
  useEffect(() => {
    if (!phaserContainerRef.current || phaserGameRef.current) return;
    if (loading || error) return;

    let destroyed = false;
    import("phaser").then(({ default: Phaser }) => {
      if (destroyed || !phaserContainerRef.current) return;

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        width: 350,
        height: 300,
        parent: phaserContainerRef.current,
        transparent: false,
        scene: [TugOfWarScene],
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
        },
      });
      phaserGameRef.current = game;
    });

    return () => {
      destroyed = true;
      if (phaserGameRef.current) {
        phaserGameRef.current.destroy(true);
        phaserGameRef.current = null;
      }
    };
  }, [loading, error]);

  // Sync React state → Phaser scene
  useEffect(() => {
    const game = phaserGameRef.current;
    if (!game) return;
    const scene = game.scene.getScene("TugOfWarScene");
    if (!scene) return;

    const state: TugOfWarState = {
      ropePosition: gameState.ropePosition,
      maxPosition: totalQuestions,
      winScore,
      lastCorrectTeam: gameState.lastCorrectTeam,
      isPaused: isAnswered,
      teamACooldown: gameState.teamACooldown,
      teamBCooldown: gameState.teamBCooldown,
      winner: winner,
    };
    scene.data.set("state", state);
  }, [gameState, totalQuestions, isAnswered]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-amber-500" />
          <p className="text-sm text-gray-500">{t("tugOfWar.loading")}</p>
        </div>
      </div>
    );
  }

  if (error || vocabItems.length < 4) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <p className="text-red-500 font-medium">
            {error || t("tugOfWar.error.notEnoughWords")}
          </p>
          <Button variant="outline" onClick={handleClose}>
            {t("common.back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-hidden px-2 py-2 flex flex-col gap-2">
      {/* Portrait orientation overlay */}
      {isPortrait && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-white">
          <Smartphone className="h-16 w-16 mb-4 rotate-90" />
          <p className="text-lg font-medium">
            {t("tugOfWar.rotateDevice")}
          </p>
          <p className="text-sm text-white/60 mt-2">
            {t("tugOfWar.rotateDeviceHint")}
          </p>
        </div>
      )}

      {/* CSS for game fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Silkscreen&family=Patrick+Hand&display=swap');
        .pixel-font { font-family: 'Silkscreen', monospace; }
        .handwrite-font { font-family: 'Patrick Hand', cursive; letter-spacing: 0.05em; }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1 pixel-font">
              {t(
                QUESTION_MODES.find((m) => m.value === gameState.questionMode)
                  ?.labelKey || "",
              )}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-white dark:bg-gray-900 border shadow-lg">
            {QUESTION_MODES.map((mode) => {
              const isDisabled =
                mode.value === "image_to_english" && !allHaveImages;
              return (
                <DropdownMenuItem
                  key={mode.value}
                  onClick={() => !isDisabled && handleModeChange(mode.value)}
                  disabled={isDisabled}
                  className={
                    mode.value === gameState.questionMode
                      ? "bg-amber-50"
                      : isDisabled
                        ? "opacity-40 cursor-not-allowed"
                        : ""
                  }
                >
                  {t(mode.labelKey)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <label className={`flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none ${isImageMode ? "opacity-40 pointer-events-none" : ""}`}>
          <input
            type="checkbox"
            checked={showImages}
            onChange={(e) => setShowImages(e.target.checked)}
            disabled={isImageMode}
            className="rounded border-gray-300"
          />
          {t("tugOfWar.showImages")}
        </label>

        <div className="pixel-font text-sm text-gray-500">
          {progress} / {totalQuestions}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Score display */}
      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <span className="pixel-font text-sm text-red-500">
            {t("tugOfWar.teamA")}
          </span>
          <span className="pixel-font text-2xl font-bold text-red-500 ml-2">
            {gameState.scores.a}
          </span>
        </div>
        <span className="text-gray-300 pixel-font">vs</span>
        <div className="text-center">
          <span className="pixel-font text-2xl font-bold text-blue-500 mr-2">
            {gameState.scores.b}
          </span>
          <span className="pixel-font text-sm text-blue-500">
            {t("tugOfWar.teamB")}
          </span>
        </div>
      </div>

      {/* Game area: three-column layout, fills remaining parent space */}
      <div className="flex gap-3 items-stretch flex-1 min-h-0">
        {/* Team A — left */}
        <div className="flex-1 p-2 rounded-xl border-2 border-red-500 bg-red-500/20 flex items-center overflow-y-auto">
          {currentQuestion ? (
            <TeamOptions
              team="a"
              options={currentQuestion.optionsA}
              onSelect={handleAnswer}
              disabled={isAnswered}
              isCooldown={gameState.teamACooldown}
              cooldownMs={DEFAULT_GAME_CONFIG.cooldownMs}
              teamLabel={t("tugOfWar.teamA")}
              showImages={effectiveShowImages}
              vocabItems={vocabItems}
              useHandwriteFont={
                gameState.questionMode === "audio_to_english" ||
                gameState.questionMode === "chinese_to_english" ||
                gameState.questionMode === "image_to_english"
              }
            />
          ) : winner && answerHistory.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 w-full">
              {answerHistory
                .filter((r) => r.team === "a")
                .filter(
                  (r, i, arr) =>
                    arr.findIndex(
                      (x) =>
                        x.question.vocabItem.id === r.question.vocabItem.id,
                    ) === i,
                )
                .map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm"
                  >
                    <span className="font-bold text-red-600">
                      {r.question.vocabItem.text}
                    </span>
                    <span className="text-gray-400">-</span>
                    <span className="text-gray-600">
                      {r.question.vocabItem.translation}
                    </span>
                  </div>
                ))}
            </div>
          ) : null}
        </div>

        {/* Canvas center — question + animation */}
        <div className="w-[350px] flex-shrink-0 relative rounded-xl overflow-hidden bg-sky-100">
          <div ref={phaserContainerRef} className="w-full" />
          {/* Replay icon */}
          {winner && (
            <button
              onClick={handleRestart}
              className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 p-2 rounded-full hover:scale-110 transition-transform cursor-pointer"
            >
              <RotateCcw
                className="h-10 w-10 text-white drop-shadow-md"
                strokeWidth={3}
              />
            </button>
          )}
          {/* Question overlay — top of canvas */}
          {currentQuestion && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <QuestionDisplay
                question={currentQuestion}
                showPrompt={!isAnswered}
              />
            </div>
          )}
        </div>

        {/* Team B — right */}
        <div className="flex-1 p-2 rounded-xl border-2 border-blue-500 bg-blue-500/20 flex items-center overflow-y-auto">
          {currentQuestion ? (
            <TeamOptions
              team="b"
              options={currentQuestion.optionsB}
              onSelect={handleAnswer}
              disabled={isAnswered}
              isCooldown={gameState.teamBCooldown}
              cooldownMs={DEFAULT_GAME_CONFIG.cooldownMs}
              teamLabel={t("tugOfWar.teamB")}
              showImages={effectiveShowImages}
              vocabItems={vocabItems}
              useHandwriteFont={
                gameState.questionMode === "audio_to_english" ||
                gameState.questionMode === "chinese_to_english" ||
                gameState.questionMode === "image_to_english"
              }
            />
          ) : winner && answerHistory.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 w-full">
              {answerHistory
                .filter((r) => r.team === "b")
                .filter(
                  (r, i, arr) =>
                    arr.findIndex(
                      (x) =>
                        x.question.vocabItem.id === r.question.vocabItem.id,
                    ) === i,
                )
                .map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-sm"
                  >
                    <span className="font-bold text-blue-600">
                      {r.question.vocabItem.text}
                    </span>
                    <span className="text-gray-400">-</span>
                    <span className="text-gray-600">
                      {r.question.vocabItem.translation}
                    </span>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
