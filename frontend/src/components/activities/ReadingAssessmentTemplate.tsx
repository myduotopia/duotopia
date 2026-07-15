/**
 * ReadingAssessmentTemplate — 例句朗讀單題顯示元件
 *
 * ⚠️ 此元件同時被學生作答頁與派發 sheet 預覽共用。
 *    改動前必讀：docs/design/preview-architecture.md
 */
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Star, Mic, Clock } from "lucide-react";
import { toast } from "sonner";
import AudioRecorder from "@/components/shared/AudioRecorder";
import { useTranslation } from "react-i18next";
import { useAzurePronunciation } from "@/hooks/useAzurePronunciation";
import { useDemoAzurePronunciation } from "@/hooks/useDemoAzurePronunciation";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";
import { appendAudioToFormData } from "@/utils/audioFormatDetection";

interface AssessmentResult {
  overallScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronunciationScore: number;
  feedback: string;
}

interface ReadingAssessmentProps {
  content: string;
  targetText: string;
  // #880: 例句朗讀時 content 帶的是句子的中文翻譯，依派發設定決定顯示與否。
  // 其他用途（未知題型 fallback）不傳，預設顯示，行為不變。
  showTranslation?: boolean;
  existingAudioUrl?: string | null; // 現有的錄音（例如重刷頁面後）
  onRecordingComplete?: (blob: Blob, url: string) => void; // 錄音完成回調
  exampleAudioUrl?: string;
  progressId?: number;
  readOnly?: boolean; // 唯讀模式
  isDemoMode?: boolean; // Demo mode - uses public demo API endpoints
  timeLimit?: number; // 錄音時間限制（秒），0 = 不限時
  canUseAiAnalysis?: boolean; // 教師/機構是否有 AI 分析額度
  // Issue #689 — Phase 1 frontend attempt gate
  recordingDisabled?: boolean; // true → 麥克風 / Analyze 鎖定
  attemptsHint?: React.ReactNode; // 愛心指示器
  onAnalysisSuccess?: () => void; // Azure 分析成功時觸發 +1
  // Issue #752: dialog 內即時預覽 — 跳過 background upload（避免扣老師點數）
  isLivePreview?: boolean;
}

export default function ReadingAssessmentTemplate({
  content,
  targetText,
  showTranslation = true,
  existingAudioUrl,
  onRecordingComplete,
  exampleAudioUrl,
  progressId: _progressId, // Legacy prop (not used with Azure direct calls)
  readOnly = false,
  isDemoMode = false,
  timeLimit = 0, // 預設不限時
  canUseAiAnalysis = true,
  recordingDisabled = false,
  attemptsHint,
  onAnalysisSuccess,
  isLivePreview = false,
}: ReadingAssessmentProps) {
  const { t } = useTranslation();
  const [audioUrl, setAudioUrl] = useState<string | undefined>(
    existingAudioUrl || undefined,
  );
  const [, setIsPlayingExample] = useState(false);
  const [isAssessing, setIsAssessing] = useState(false);
  const [assessmentResult, setAssessmentResult] =
    useState<AssessmentResult | null>(null);
  const exampleAudioRef = useRef<HTMLAudioElement>(null);

  // 🚀 Azure Speech Service hook for direct API calls
  // Use demo hook when in demo mode (no authentication required)
  const regularHook = useAzurePronunciation();
  const demoHook = useDemoAzurePronunciation();
  const { analyzePronunciation } = isDemoMode ? demoHook : regularHook;

  // Recording start timestamp (for duration check against timeLimit)
  const recordingStartTimeRef = useRef<number>(0);

  /**
   * 背景上傳音檔和分析結果（不阻塞 UI）
   */
  const uploadAnalysisInBackground = async (
    audioBlob: Blob,
    analysisResult: AssessmentResult,
  ) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const formData = new FormData();

      await appendAudioToFormData(formData, "audio_file", audioBlob);
      formData.append(
        "analysis_json",
        JSON.stringify({
          pronunciation_score: analysisResult.pronunciationScore,
          accuracy_score: analysisResult.accuracyScore,
          fluency_score: analysisResult.fluencyScore,
          completeness_score: analysisResult.completenessScore,
          overall_score: analysisResult.overallScore,
        }),
      );

      if (_progressId) {
        formData.append("progress_id", _progressId.toString());
      }

      // 🎯 Issue #208: Generate unique analysis_id for deduction
      const analysisId = crypto.randomUUID();
      formData.append("analysis_id", analysisId);

      // 背景上傳（不等待結果）
      fetch(`${apiUrl}/api/speech/upload-analysis`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${useStudentAuthStore.getState().token || useTeacherAuthStore.getState().token || ""}`,
        },
        body: formData,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
          }
          console.log("✅ Background upload completed");
        })
        .catch((error) => {
          console.error("❌ Background upload failed:", error);
        });
    } catch (error) {
      console.error("Failed to prepare background upload:", error);
    }
  };

  const handleAssessment = async () => {
    if (!audioUrl) {
      toast.error(t("readingAssessment.toast.missingData"));
      return;
    }

    setIsAssessing(true);
    try {
      // Convert audioUrl to blob for analysis
      const response = await fetch(audioUrl);
      const audioBlob = await response.blob();

      // 🚀 先分析（快速顯示結果）
      const normalizedTargetText = targetText.replace(/\n+/g, " ").trim();
      const azureResult = await analyzePronunciation(
        audioBlob,
        normalizedTargetText,
      );

      if (!azureResult) {
        throw new Error("Azure analysis failed");
      }

      // Issue #689: 分析成功 → 計入次數
      onAnalysisSuccess?.();

      // ⚡ 立即顯示結果（用戶無需等待上傳）
      const result: AssessmentResult = {
        overallScore: azureResult.pronunciationScore,
        accuracyScore: azureResult.accuracyScore,
        fluencyScore: azureResult.fluencyScore,
        completenessScore: azureResult.completenessScore,
        pronunciationScore: azureResult.pronunciationScore,
        feedback: "", // Azure doesn't provide feedback text
      };

      setAssessmentResult(result);
      toast.success(t("readingAssessment.toast.aiComplete"));

      // 🎯 背景上傳（不阻塞 UI）— 預覽模式跳過避免扣老師點數
      if (!readOnly && !isLivePreview && audioUrl.startsWith("blob:")) {
        uploadAnalysisInBackground(audioBlob, result);
      }
    } catch (error) {
      console.error("Assessment error:", error);
      toast.error(
        error instanceof Error ? error.message : "AI 評估失敗，請重試",
      );
    } finally {
      setIsAssessing(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBadgeVariant = (score: number) => {
    if (score >= 80) return "default";
    if (score >= 60) return "secondary";
    return "destructive";
  };

  return (
    <>
      <div className="flex items-start space-x-8 min-h-[500px]">
        {/* Left Side - Avatar/Icon Circle */}
        <div className="flex-shrink-0">
          <div className="w-48 h-48 bg-gray-200 rounded-full flex items-center justify-center">
            <div className="w-24 h-24 bg-gray-400 rounded-full flex items-center justify-center">
              <Mic className="h-12 w-12 text-gray-600" />
            </div>
          </div>
        </div>

        {/* Right Side - Content Area */}
        <div className="flex-1 space-y-6">
          {/* Time Limit Display (static) */}
          {!readOnly && timeLimit > 0 && !audioUrl && (
            <div className="flex justify-end">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
                <Clock className="h-4 w-4" />
                <span>
                  {t("wordReading.timeLimit", { seconds: timeLimit }) ||
                    `限時 ${timeLimit} 秒`}
                </span>
              </div>
            </div>
          )}

          {/* Example Audio Section */}
          {exampleAudioUrl && (
            <div className="space-y-2">
              <audio
                ref={exampleAudioRef}
                src={exampleAudioUrl}
                controls
                className="w-full h-10"
                onEnded={() => setIsPlayingExample(false)}
              />
            </div>
          )}

          {/* Main Content */}
          <div className="space-y-4">
            <h2 className="text-3xl font-medium text-gray-900 leading-relaxed whitespace-pre-wrap">
              {targetText}
            </h2>
            {/* #880: content 為句子的中文翻譯，依派發設定的「顯示翻譯」開關顯示 */}
            {showTranslation && content && (
              <p className="text-lg text-gray-600 whitespace-pre-wrap">
                {content}
              </p>
            )}
          </div>

          {/* 🎯 錄音元件 - 使用統一的 AudioRecorder */}
          <AudioRecorder
            existingAudioUrl={audioUrl}
            disabled={recordingDisabled}
            onRecordingComplete={(blob, url) => {
              // Check recording duration against time limit (0.5s tolerance
              // for auto-stop timer imprecision)
              if (timeLimit > 0 && recordingStartTimeRef.current > 0) {
                const elapsedSeconds =
                  (Date.now() - recordingStartTimeRef.current) / 1000;
                if (elapsedSeconds > timeLimit + 0.5) {
                  toast.error(
                    t("wordReading.toast.recordingExceedsLimit", {
                      recorded: Math.round(elapsedSeconds),
                      limit: timeLimit,
                    }) ||
                      `錄音時間 ${Math.round(elapsedSeconds)} 秒超過限制 ${timeLimit} 秒，請重新錄音`,
                  );
                  URL.revokeObjectURL(url);
                  return; // Don't set audioUrl — discard over-limit recording
                }
              }
              setAudioUrl(url);
              onRecordingComplete?.(blob, url);
            }}
            onRecordingStart={() => {
              recordingStartTimeRef.current = Date.now();
            }}
            readOnly={readOnly}
            autoStop={timeLimit > 0 ? timeLimit : undefined}
            variant="default"
            showProgress={true}
            showTimer={true}
          />

          {/* Bottom Buttons */}
          <div className="flex flex-col items-start gap-2 pt-6">
            {audioUrl && !readOnly && canUseAiAnalysis && (
              <>
                {!assessmentResult && (
                  <Button
                    onClick={handleAssessment}
                    disabled={isAssessing || recordingDisabled}
                    className="bg-blue-500 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500 text-white"
                    title={
                      recordingDisabled
                        ? t("recordingAttempts.lockedTooltip")
                        : undefined
                    }
                  >
                    {isAssessing ? (
                      <>
                        <Brain className="h-4 w-4 mr-2 animate-spin" />
                        AI 評估中...
                      </>
                    ) : (
                      <>
                        <Brain className="h-4 w-4 mr-2" />
                        {t("studentActivity.aiAnalysis.analyze", {
                          defaultValue: "分析",
                        })}
                      </>
                    )}
                  </Button>
                )}
                {attemptsHint}
              </>
            )}
          </div>

          {/* Assessment Results */}
          {assessmentResult && (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-lg p-6 space-y-6 mt-6">
              <div className="text-center">
                <h4 className="text-xl font-bold text-blue-900 mb-4 flex items-center justify-center gap-2">
                  <Brain className="h-6 w-6" />
                  AI 評估結果
                </h4>

                {/* Overall Score */}
                <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
                  <div className="text-4xl font-bold text-blue-600 mb-2">
                    {assessmentResult.overallScore}分
                  </div>
                  <Badge
                    variant={getScoreBadgeVariant(
                      assessmentResult.overallScore,
                    )}
                    className="text-sm px-3 py-1"
                  >
                    總體評分
                  </Badge>
                </div>
              </div>

              {/* Detailed Scores */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">準確度</div>
                  <div
                    className={`text-lg font-bold ${getScoreColor(assessmentResult.accuracyScore)}`}
                  >
                    {assessmentResult.accuracyScore}分
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">流暢度</div>
                  <div
                    className={`text-lg font-bold ${getScoreColor(assessmentResult.fluencyScore)}`}
                  >
                    {assessmentResult.fluencyScore}分
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">完整度</div>
                  <div
                    className={`text-lg font-bold ${getScoreColor(assessmentResult.completenessScore)}`}
                  >
                    {assessmentResult.completenessScore}分
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">發音分數</div>
                  <div
                    className={`text-lg font-bold ${getScoreColor(assessmentResult.pronunciationScore)}`}
                  >
                    {assessmentResult.pronunciationScore}分
                  </div>
                </div>
              </div>

              {/* AI Feedback */}
              {assessmentResult.feedback && (
                <div className="bg-white rounded-lg p-4">
                  <h5 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
                    <Star className="h-4 w-4" />
                    AI 建議
                  </h5>
                  <p className="text-gray-700 text-sm leading-relaxed">
                    {assessmentResult.feedback}
                  </p>
                </div>
              )}

              <div className="text-center">
                <Button
                  onClick={() => setAssessmentResult(null)}
                  variant="outline"
                  size="sm"
                  className="border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  重新評估
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
