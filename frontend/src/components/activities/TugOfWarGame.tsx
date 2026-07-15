/**
 * TugOfWarGame - 拔河遊戲主元件（issue #920：像素風重繪 + 全寬三帶響應式版面）
 *
 * 2 人同螢幕對戰的單字選擇遊戲。純前端，不寫入資料庫。
 * 透過 assignment API 取得單字資料後，遊戲邏輯全在前端（useGameLogic）。
 * 對戰動畫改用 DOM/CSS 像素 sprite（PixelTugStage，取代舊 Phaser 層）。
 *
 * 版面（強制橫向）：
 *   Header（back / 題型 / 同題·不同題 / 比分 / 進度）
 *   ├─ 場景帶：PixelTugStage（全寬，音檔題含中央懸掛看板）
 *   ├─ 題目帶：兩隊各一份（聽音檔題、圖片題收起）
 *   └─ 選項帶：AB 兩隊；圖片題改三欄「A 選項 ┃ 置中大圖 ┃ B 選項」（強制同題）
 *
 * Props:
 * - assignmentId: 用來 fetch 單字列表
 * - isPreviewMode / isDemoMode: API endpoint 切換
 * - onComplete: 遊戲結束/關閉時的回調
 */

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Maximize,
  Minimize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiClient } from "@/lib/api";
import { withDemoOverrides } from "@/lib/demoOverrides";
import {
  useGameLogic,
  isAudioOnlyMode,
  forcesSameQuestion,
  hasValidCloze,
  hasWordAudio,
} from "./tug-of-war/useGameLogic";
import { useQuestionAudio } from "./tug-of-war/useQuestionAudio";
import { QuestionDisplay } from "./tug-of-war/QuestionDisplay";
import { TeamOptions, isLongOption } from "./tug-of-war/TeamOptions";
import { PixelTugStage } from "./tug-of-war/pixel/PixelTugStage";
import { RotateOverlay } from "./tug-of-war/pixel/RotateOverlay";
import type {
  VocabItem,
  QuestionMode,
  Team,
  Question,
} from "./tug-of-war/types";
import { DEFAULT_GAME_CONFIG } from "./tug-of-war/types";

interface TugOfWarGameProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean;
  onComplete?: () => void;
  /** 老師預覽時注入的 header 動作（例如「進階設定」按鈕）。因拔河遊戲以
   *  fixed inset-0 z-50 全螢幕覆蓋外層 sticky header，需把入口 thread 進本元件
   *  自己的 header 才看得到。僅在 isPreviewMode 時渲染。 */
  headerActions?: ReactNode;
}

interface WordOptionResponse {
  content_item_id: number;
  text: string;
  translation: string;
  audio_url?: string;
  image_url?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_audio_url?: string;
}

const QUESTION_MODES: { value: QuestionMode; labelKey: string }[] = [
  { value: "audio_to_english", labelKey: "tugOfWar.modes.audioToEnglish" },
  { value: "audio_to_chinese", labelKey: "tugOfWar.modes.audioToChinese" },
  { value: "english_to_chinese", labelKey: "tugOfWar.modes.englishToChinese" },
  { value: "chinese_to_english", labelKey: "tugOfWar.modes.chineseToEnglish" },
  { value: "image_to_english", labelKey: "tugOfWar.modes.imageToEnglish" },
  { value: "cloze_to_english", labelKey: "tugOfWar.modes.clozeToEnglish" },
];

// 這些題型正解為英文 → 選項用手寫字體
const HANDWRITE_MODES: QuestionMode[] = [
  "audio_to_english",
  "chinese_to_english",
  "image_to_english",
  "cloze_to_english",
];

export function TugOfWarGame({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  onComplete,
  headerActions,
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
  // 兩人左右分邊對戰 → 純直向才提示轉向（版面已流動化，窄橫屏可直接玩）
  const isPortrait = viewport.height > viewport.width;
  const [portraitDismissed, setPortraitDismissed] = useState(false);

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

  // 全螢幕狀態（供 header 切換鈕顯示 enter/exit icon）
  const [isFullscreen, setIsFullscreen] = useState(false);

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen?.();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (screen.orientation as any)?.lock?.("landscape");
    } catch {
      // Not supported / rejected — fixed 100dvh overlay 仍滿版，靠 rotate overlay 提示轉向
    }
  }, []);

  // Attempt fullscreen + landscape lock on mount（成功更好，失敗靠 fixed 覆蓋層 + 切換鈕）
  useEffect(() => {
    enterFullscreen();
    return () => {
      document.exitFullscreen?.().catch(() => {});
      try {
        screen.orientation?.unlock?.();
      } catch {
        // Ignore
      }
    };
  }, [enterFullscreen]);

  // 追蹤全螢幕變化（使用者按 Esc 退出後，切換鈕才能反映狀態並讓其一鍵重進）
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      enterFullscreen();
    }
  }, [enterFullscreen]);

  // Fetch vocabulary items
  useEffect(() => {
    const fetchVocab = async () => {
      try {
        setLoading(true);
        const endpoint = isDemoMode
          ? withDemoOverrides(
              `/api/demo/assignments/${assignmentId}/preview/word-selection-start`,
            )
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
          example_sentence: w.example_sentence,
          example_sentence_translation: w.example_sentence_translation,
          example_sentence_audio_url: w.example_sentence_audio_url,
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
    currentQuestionA,
    currentQuestionB,
    answeredA,
    answeredB,
    pullA,
    pullB,
    totalQuestions,
    winScore,
    progress,
    progressB,
    winner,
    answerHistory,
    startGame,
    changeMode,
    setDiffMode,
    handleAnswer,
    toggleSentenceTranslation,
    toggleAudioMute,
  } = useGameLogic(vocabItems);

  const hasEnoughImages = vocabItems.filter((v) => !!v.image_url).length >= 4;
  // 有效題門檻：克漏字需例句含目標字、音檔題需真錄音；整份 0 有效 → 該模式禁用
  const hasAnyValidCloze = vocabItems.some(hasValidCloze);
  const hasAnyWordAudio = vocabItems.some(hasWordAudio);
  const mode = gameState.questionMode;
  const isClozeMode = mode === "cloze_to_english";
  const isImageMode = mode === "image_to_english";
  const audioOnly = isAudioOnlyMode(mode);
  // 圖片題自身用圖當題目、克漏字要讀例句 → 這兩種選項恆用文字（不套選項圖片）
  const effectiveShowImages = showImages && !isImageMode && !isClozeMode;
  const useHandwriteFont = HANDWRITE_MODES.includes(mode);
  // 克漏字 + 兩隊題目相異：音檔停用，強制在題目下方顯示例句翻譯補償
  const showClozeTranslation =
    gameState.showSentenceTranslation || (isClozeMode && gameState.diffMode);
  // 長選項（多詞英英釋義）→ 給選項帶更多高度（整局為準，換題型才變，避免每題跳動）；
  // 與 TeamOptions 的欄數判定共用 isLongOption（詞數為主），確保一致。
  const hasLongOption = gameState.questions.some((q) =>
    q.options.some(isLongOption),
  );

  // 預設題型：有錄音就開聽音檔選英文；否則退回「看英文→選翻譯」（純文字，恆可用）
  const defaultMode: QuestionMode = hasAnyWordAudio
    ? "audio_to_english"
    : "english_to_chinese";

  // Auto-start when vocab loads
  useEffect(() => {
    if (vocabItems.length > 0 && gameState.gameStatus === "waiting") {
      startGame(defaultMode);
    }
  }, [vocabItems, gameState.gameStatus, startGame, defaultMode]);

  // 音檔集中播放：只有同題（非 diffMode）且該題有音檔時啟用；由懸掛看板承載
  const audioActive = !gameState.diffMode && !!currentQuestion?.hasAudio;
  useQuestionAudio(currentQuestion, {
    enabled: audioActive && !answeredA,
    muted: gameState.audioMuted,
  });

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

  // Root grid rows（第一列 auto = header，其後 場景/題目/選項）。
  // 場景帶固定為音檔題高度（場景恆 1fr、非 header 總 fr 恆 2.2 → 場景恆 ≈45%，不被題目擠壓）；
  // 剩餘空間分給題目+選項。靠 fixed 100dvh + overflow-hidden 保證一屏可見、永不卷軸。
  const gridTemplateRows = audioOnly
    ? // 音檔題：無題目帶，選項帶吃剩餘
      "auto 1fr 1.2fr"
    : isImageMode
      ? // 圖片題：無題目帶（圖移入選項帶中欄），場景 + 三欄選項帶
        "auto 1fr 1.2fr"
      : isClozeMode
        ? // 克漏字：題目帶（例句）中等、選項帶略大
          hasLongOption
          ? "auto 1fr 0.45fr 0.75fr"
          : "auto 1fr 0.55fr 0.65fr"
        : // 純單字題（看英文/看翻譯）：題目只有一個詞 → 選項帶較大
          hasLongOption
          ? "auto 1fr 0.3fr 0.9fr"
          : "auto 1fr 0.4fr 0.8fr";

  // 遊戲結束後各隊答對的單字清單（去重）
  const historyFor = (team: Team) =>
    answerHistory
      .filter((r) => r.team === team)
      .filter(
        (r, i, arr) =>
          arr.findIndex(
            (x) => x.question.vocabItem.id === r.question.vocabItem.id,
          ) === i,
      );

  const renderSide = (
    team: Team,
    question: Question | null,
    disabled: boolean,
    isCooldown: boolean,
  ) => {
    if (question) {
      return (
        <TeamOptions
          team={team}
          options={team === "a" ? question.optionsA : question.optionsB}
          onSelect={handleAnswer}
          disabled={disabled}
          isCooldown={isCooldown}
          cooldownMs={DEFAULT_GAME_CONFIG.cooldownMs}
          teamLabel={t(team === "a" ? "tugOfWar.teamA" : "tugOfWar.teamB")}
          showImages={effectiveShowImages}
          vocabItems={vocabItems}
          useHandwriteFont={useHandwriteFont}
          correctAnswer={question.correctAnswer}
          reveal={disabled}
        />
      );
    }
    if (winner) {
      const isA = team === "a";
      return (
        <div className="grid grid-cols-1 gap-2 w-full overflow-y-auto content-start">
          {historyFor(team).map((r, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                isA ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"
              }`}
            >
              <span
                className={`font-bold ${isA ? "text-red-600" : "text-blue-600"}`}
              >
                {r.question.vocabItem.text}
              </span>
              <span className="text-gray-400">-</span>
              <span className="text-gray-600">
                {r.question.vocabItem.translation}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className="fixed inset-0 z-50 grid h-[100dvh] w-screen overflow-hidden bg-[#c7ecff]"
      style={{ gridTemplateRows }}
    >
      {/* Fonts + shared pixel styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Silkscreen&family=Patrick+Hand&display=swap');
        .pixel-font { font-family: 'Silkscreen', monospace; }
        .handwrite-font { font-family: 'Patrick Hand', cursive; letter-spacing: 0.05em; }
      `}</style>

      {/* Portrait rotate overlay */}
      {isPortrait && !portraitDismissed && (
        <RotateOverlay
          title={t("tugOfWar.rotateDevice")}
          hint={t("tugOfWar.rotateDeviceHint")}
          continueLabel={t("tugOfWar.continueAnyway", "繼續遊玩")}
          onContinue={() => setPortraitDismissed(true)}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap bg-[#2e222f] px-2 py-1.5 min-h-[44px]">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="pixel-font gap-1 text-white hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1 pixel-font">
              {t(QUESTION_MODES.find((m) => m.value === mode)?.labelKey || "")}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-white dark:bg-gray-900 border shadow-lg">
            {QUESTION_MODES.map((m) => {
              const isAudioMode =
                m.value === "audio_to_english" ||
                m.value === "audio_to_chinese";
              const isDisabled =
                (m.value === "image_to_english" && !hasEnoughImages) ||
                (m.value === "cloze_to_english" && !hasAnyValidCloze) ||
                (isAudioMode && !hasAnyWordAudio);
              const disabledTitle =
                m.value === "image_to_english"
                  ? t(
                      "tugOfWar.imagesModeRequirement",
                      "需要至少 4 個單字有圖片",
                    )
                  : m.value === "cloze_to_english"
                    ? t(
                        "tugOfWar.clozeModeRequirement",
                        "此教材沒有可用的克漏字例句（例句需含該單字）",
                      )
                    : isAudioMode
                      ? t("tugOfWar.audioModeRequirement", "此教材沒有單字錄音")
                      : undefined;
              return (
                <DropdownMenuItem
                  key={m.value}
                  onClick={() => !isDisabled && changeMode(m.value)}
                  disabled={isDisabled}
                  className={
                    m.value === mode
                      ? "bg-amber-50"
                      : isDisabled
                        ? "opacity-40 cursor-not-allowed"
                        : ""
                  }
                  title={isDisabled ? disabledTitle : undefined}
                >
                  {t(m.labelKey)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 兩隊不同題 switch（聽音檔、圖片題強制同題 → 不提供） */}
        {!forcesSameQuestion(mode) && (
          <Button
            variant={gameState.diffMode ? "default" : "outline"}
            size="sm"
            onClick={() => setDiffMode(!gameState.diffMode)}
            className={`pixel-font ${gameState.diffMode ? "bg-amber-400 text-[#2e222f] hover:bg-amber-500" : ""}`}
            title={t("tugOfWar.diffModeHint", "開啟後兩隊各出不同題目")}
          >
            {gameState.diffMode
              ? t("tugOfWar.diffModeOn", "不同題")
              : t("tugOfWar.diffModeOff", "同題")}
          </Button>
        )}

        {/* 顯示圖片（圖片題/克漏字停用） */}
        {!isImageMode && !isClozeMode && (
          <label className="flex items-center gap-1.5 text-xs text-white/80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showImages}
              onChange={(e) => setShowImages(e.target.checked)}
              className="rounded border-gray-300"
            />
            {t("tugOfWar.showImages")}
          </label>
        )}

        {/* 克漏字：顯示例句翻譯。不同題時音檔停用 → 強制勾選且鎖定（不可取消） */}
        {isClozeMode && (
          <label
            className={`flex items-center gap-1.5 text-xs text-white/80 select-none ${
              gameState.diffMode
                ? "opacity-60 cursor-not-allowed"
                : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={gameState.showSentenceTranslation || gameState.diffMode}
              onChange={toggleSentenceTranslation}
              disabled={gameState.diffMode}
              className="rounded border-gray-300"
            />
            {t("tugOfWar.showSentenceTranslation", "顯示例句翻譯")}
          </label>
        )}

        {/* 比分已移到場景中（各隊旗桿上方）→ 此處留 spacer 讓進度/全螢幕靠右 */}
        <div className="flex-1" />

        {/* 進度 */}
        <div className="pixel-font text-xs text-gray-400 whitespace-nowrap">
          {gameState.diffMode
            ? `A${progress}·B${progressB}/${totalQuestions}`
            : `${progress}/${totalQuestions}`}
        </div>

        {/* 老師預覽用的 header 動作（如「進階設定」）。學生實際作答不注入，
            這裡再以 isPreviewMode 雙保險 gate 一次。 */}
        {isPreviewMode && headerActions && (
          <div className="flex-shrink-0">{headerActions}</div>
        )}

        {/* 全螢幕切換（Esc 退出後可一鍵重進；瀏覽器限制需使用者手勢） */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleFullscreen}
          className="h-8 w-8 p-0 text-white hover:bg-white/10 hover:text-white"
          title={t(
            isFullscreen
              ? "tugOfWar.exitFullscreen"
              : "tugOfWar.enterFullscreen",
            isFullscreen ? "退出全螢幕" : "全螢幕",
          )}
        >
          {isFullscreen ? (
            <Minimize className="h-4 w-4" />
          ) : (
            <Maximize className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Band 1: 場景動畫（全寬） */}
      <div className="relative min-h-0">
        <PixelTugStage
          ropePosition={gameState.ropePosition}
          winScore={winScore}
          pullA={pullA}
          pullB={pullB}
          teamACooldown={gameState.teamACooldown}
          teamBCooldown={gameState.teamBCooldown}
          winner={winner}
          showSign={audioActive}
          audioMuted={gameState.audioMuted}
          onSignClick={toggleAudioMute}
          scoreA={gameState.scores.a}
          scoreB={gameState.scores.b}
          onReplay={handleRestart}
          teamAWinsLabel={t("tugOfWar.result.teamAWins")}
          teamBWinsLabel={t("tugOfWar.result.teamBWins")}
          drawLabel={t("tugOfWar.result.draw")}
          replayLabel={t("tugOfWar.result.playAgain")}
        />
      </div>

      {/* Band 2: 題目帶（兩隊各一份；聽音檔題、圖片題收起） */}
      {!audioOnly && !isImageMode && (
        <div className="grid grid-cols-2 min-h-0 border-t-4 border-[#2e222f] bg-[#fdf6e3]">
          <div className="min-h-0 border-r-2 border-dashed border-[#b8ab8e]">
            {currentQuestionA && (
              <QuestionDisplay
                question={currentQuestionA}
                showPrompt={!answeredA}
                showSentenceTranslation={showClozeTranslation}
              />
            )}
          </div>
          <div className="min-h-0">
            {currentQuestionB && (
              <QuestionDisplay
                question={currentQuestionB}
                showPrompt={!answeredB}
                showSentenceTranslation={showClozeTranslation}
              />
            )}
          </div>
        </div>
      )}

      {/* Band 3: 選項帶（AB 兩隊）。圖片題插入置中大圖成三欄，其餘題型維持兩欄 */}
      <div
        className={`grid min-h-0 border-t-4 border-[#2e222f] ${
          isImageMode
            ? "grid-cols-[minmax(0,1fr)_minmax(160px,32%)_minmax(0,1fr)]"
            : "grid-cols-2"
        }`}
      >
        <div className="relative flex min-h-0 flex-col bg-gradient-to-b from-[#f9d9d3] to-[#f6c3bc] p-2 pt-5">
          <span className="pixel-font absolute left-2 top-1 z-[2] bg-[#e83b3b] px-2 py-0.5 text-[11px] tracking-wide text-white">
            {t("tugOfWar.teamA")}
          </span>
          {renderSide(
            "a",
            currentQuestionA,
            answeredA,
            gameState.teamACooldown,
          )}
        </div>

        {/* 圖片題中欄：兩隊共用的置中大圖（無框、完整不裁；缺圖 fallback 顯示單字） */}
        {isImageMode && (
          <div className="flex min-h-0 items-center justify-center overflow-hidden bg-[#fdf6e3] p-2">
            {currentQuestion?.vocabItem.image_url ? (
              <img
                src={currentQuestion.vocabItem.image_url}
                alt=""
                className="h-auto w-auto max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="handwrite-font text-center text-3xl text-[#2e222f]">
                {currentQuestion?.vocabItem.text}
              </span>
            )}
          </div>
        )}

        <div className="relative flex min-h-0 flex-col border-l-4 border-[#2e222f] bg-gradient-to-b from-[#d3e8f9] to-[#bcd9f6] p-2 pt-5">
          <span className="pixel-font absolute left-2 top-1 z-[2] bg-[#4d9be6] px-2 py-0.5 text-[11px] tracking-wide text-white">
            {t("tugOfWar.teamB")}
          </span>
          {renderSide(
            "b",
            currentQuestionB,
            answeredB,
            gameState.teamBCooldown,
          )}
        </div>
      </div>
    </div>
  );
}
