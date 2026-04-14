/**
 * WordReadingActivity - 單字朗讀練習活動容器
 *
 * Phase 2-2: 管理單字朗讀練習的完整流程
 *
 * 功能:
 * - 載入單字集的所有單字
 * - 管理練習進度
 * - 處理錄音上傳
 * - 顯示 AI 評估結果
 * - 提交作業
 */

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Send,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import WordReadingTemplate from "./WordReadingTemplate";
import { useTranslation } from "react-i18next";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { cn } from "@/lib/utils";
import { useAzurePronunciation } from "@/hooks/useAzurePronunciation";
import { retryAudioUpload } from "@/utils/retryHelper";

interface WordItem {
  id: number;
  text: string;
  translation?: string;
  audio_url?: string;
  image_url?: string;
  part_of_speech?: string;
  progress_id?: number;
  recording_url?: string;
  ai_assessment?: {
    accuracy_score?: number;
    fluency_score?: number;
    completeness_score?: number;
    pronunciation_score?: number;
    detailed_words?: Array<{
      index: number;
      word: string;
      accuracy_score: number;
      error_type?: string;
      phonemes?: Array<{ phoneme: string; accuracy_score: number }>;
    }>;
  };
  teacher_feedback?: string;
  teacher_passed?: boolean;
  teacher_review_score?: number;
  review_status?: string;
}

interface WordReadingActivityProps {
  assignmentId: number;
  isPreviewMode?: boolean;
  isDemoMode?: boolean; // Demo mode - uses public demo API endpoints
  authToken?: string; // 認證 token（預覽模式用老師 token）
  showTranslation?: boolean;
  showImage?: boolean;
  onComplete?: () => void;
  canUseAiAnalysis?: boolean; // 教師/機構是否有 AI 分析額度
  readOnly?: boolean; // 已提交/已完成/已訂正時禁止修改
  timeLimitPerQuestion?: number; // 每題錄音限時（秒），由父元件傳入，覆蓋 API 值
}

export default function WordReadingActivity({
  assignmentId,
  isPreviewMode = false,
  isDemoMode = false,
  authToken,
  showTranslation: _showTranslationProp = true, // 保留 prop 但使用 API 返回的值
  showImage: _showImageProp = true, // 保留 prop 但使用 API 返回的值
  onComplete,
  readOnly = false,
  canUseAiAnalysis: canUseAiAnalysisProp,
  timeLimitPerQuestion: timeLimitProp,
}: WordReadingActivityProps) {
  const { t } = useTranslation();
  const { token: studentToken } = useStudentAuthStore();
  // 預覽模式使用傳入的 authToken（老師 token），否則使用學生 token
  const token = isPreviewMode && authToken ? authToken : studentToken;

  // State
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<WordItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [timeLimitFromApi, setTimeLimitFromApi] = useState(0);
  // 優先使用父元件傳入的 prop，與例句朗讀統一資料來源
  const timeLimitPerQuestion = timeLimitProp ?? timeLimitFromApi;
  // 從 API 讀取的顯示設定（解決圖片不顯示的 bug）
  const [showImageFromApi, setShowImageFromApi] = useState(true);
  const [showTranslationFromApi, setShowTranslationFromApi] = useState(true);
  // AI 分析額度（從 API 讀取，或使用 prop 傳入的值）
  const [canUseAiAnalysisFromApi, setCanUseAiAnalysisFromApi] = useState(true);
  const canUseAiAnalysis = canUseAiAnalysisProp ?? canUseAiAnalysisFromApi;
  const { analyzePronunciation } = useAzurePronunciation();

  /**
   * 🔧 Review fix: 共用的分析+儲存+上傳邏輯，消除三處重複
   */
  const performAnalysisAndSave = useCallback(
    async (params: {
      audioBlob: Blob;
      text: string;
      itemIndex: number;
      progressId?: number;
    }) => {
      const { audioBlob, text, itemIndex, progressId } = params;
      const azureResult = await analyzePronunciation(
        audioBlob,
        text,
        "Phoneme",
      );
      if (!azureResult) return;

      const assessment = {
        accuracy_score: azureResult.accuracyScore,
        fluency_score: azureResult.fluencyScore,
        completeness_score: azureResult.completenessScore,
        pronunciation_score: azureResult.pronunciationScore,
        // 🎯 音素詳細資料（重開時可還原圖表）
        detailed_words: azureResult.detailed_words || [],
        reference_text: text,
      };

      setItems((prev) => {
        const updated = [...prev];
        updated[itemIndex] = {
          ...updated[itemIndex],
          ai_assessment: assessment,
        };
        return updated;
      });

      const apiUrl = import.meta.env.VITE_API_URL || "";
      if (progressId) {
        const ext = audioBlob.type.includes("mp4")
          ? "recording.mp4"
          : audioBlob.type.includes("webm")
            ? "recording.webm"
            : "recording.audio";
        const analysisForm = new FormData();
        analysisForm.append("audio_file", audioBlob, ext);
        analysisForm.append(
          "analysis_json",
          JSON.stringify({
            pronunciation_score: azureResult.pronunciationScore,
            accuracy_score: azureResult.accuracyScore,
            fluency_score: azureResult.fluencyScore,
            completeness_score: azureResult.completenessScore,
            overall_score: azureResult.pronunciationScore,
            detailed_words: azureResult.detailed_words || [],
            reference_text: text,
          }),
        );
        analysisForm.append("progress_id", progressId.toString());
        analysisForm.append("analysis_id", crypto.randomUUID());

        fetch(`${apiUrl}/api/speech/upload-analysis`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: analysisForm,
        }).catch((err) => console.error("Upload analysis failed:", err));
      }

      return assessment;
    },
    [analyzePronunciation, token],
  );

  // Load vocabulary items from backend
  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      const apiUrl = import.meta.env.VITE_API_URL || "";

      // 根據模式選擇不同的端點
      const endpoint = isDemoMode
        ? `${apiUrl}/api/demo/assignments/${assignmentId}/preview/vocabulary/activities`
        : isPreviewMode
          ? `${apiUrl}/api/teachers/assignments/${assignmentId}/preview/vocabulary/activities`
          : `${apiUrl}/api/students/assignments/${assignmentId}/vocabulary/activities`;

      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load vocabulary items: ${response.status}`);
      }

      const data = await response.json();
      setItems(data.items || []);
      setTimeLimitFromApi(data.time_limit_per_question || 0);
      // 讀取 API 返回的顯示設定
      setShowImageFromApi(data.show_image ?? true);
      setShowTranslationFromApi(data.show_translation ?? true);
      setCanUseAiAnalysisFromApi(data.can_use_ai_analysis ?? true);

      // Find first incomplete item
      const firstIncomplete = (data.items || []).findIndex(
        (item: WordItem) => !item.recording_url,
      );
      if (firstIncomplete >= 0) {
        setCurrentIndex(firstIncomplete);
      }
    } catch (error) {
      console.error("Error loading vocabulary items:", error);
      toast.error(
        t("wordReading.toast.loadFailed") || "Failed to load vocabulary items",
      );
    } finally {
      setLoading(false);
    }
  }, [assignmentId, token, isPreviewMode, isDemoMode, t]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Handle recording complete
  const handleRecordingComplete = async (blob: Blob, url: string) => {
    // 🔧 Review fix: 捕獲 index 避免 async 回調中使用 stale closure
    const capturedIndex = currentIndex;
    const currentItem = items[capturedIndex];

    // Update local state immediately
    setItems((prev) => {
      const updated = [...prev];
      updated[capturedIndex] = {
        ...updated[capturedIndex],
        recording_url: url,
      };
      return updated;
    });

    // Skip upload in preview mode or demo mode
    if (isPreviewMode || isDemoMode) {
      toast.success(
        t("wordReading.toast.recordedPreview") ||
          "Recording saved (preview mode)",
      );
      return;
    }

    // Upload to server
    try {
      setUploading(true);
      const apiUrl = import.meta.env.VITE_API_URL || "";

      const formData = new FormData();
      formData.append("assignment_id", assignmentId.toString());
      formData.append("content_item_id", currentItem.id.toString());

      const uploadFileExtension = blob.type.includes("mp4")
        ? "recording.mp4"
        : blob.type.includes("webm")
          ? "recording.webm"
          : "recording.audio";
      formData.append("audio_file", blob, uploadFileExtension);

      const response = await fetch(`${apiUrl}/api/students/upload-recording`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const result = await response.json();

      // Revoke blob URL before replacing with server URL to prevent memory leak
      const oldUrl = items[capturedIndex]?.recording_url;
      if (oldUrl && oldUrl.startsWith("blob:")) {
        URL.revokeObjectURL(oldUrl);
      }

      // Update with server URL
      setItems((prev) => {
        const updated = [...prev];
        updated[capturedIndex] = {
          ...updated[capturedIndex],
          recording_url: result.audio_url,
          progress_id: result.progress_id,
        };
        return updated;
      });

      toast.success(t("wordReading.toast.uploaded") || "Recording uploaded");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(t("wordReading.toast.uploadFailed") || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Handle assessment complete
  const handleAssessmentComplete = async (result: {
    overallScore: number;
    accuracyScore: number;
    fluencyScore: number;
    completenessScore: number;
    pronunciationScore: number;
    detailed_words?: Array<{
      index: number;
      word: string;
      accuracy_score: number;
      error_type?: string;
      phonemes?: Array<{ phoneme: string; accuracy_score: number }>;
    }>;
  }) => {
    // 🔧 Review fix: 捕獲 index 避免 async assessment 完成時使用 stale closure
    const capturedIndex = currentIndex;
    // Update local state（含音素詳細資料，切換題目時可還原）
    setItems((prev) => {
      const updated = [...prev];
      updated[capturedIndex] = {
        ...updated[capturedIndex],
        ai_assessment: {
          accuracy_score: result.accuracyScore,
          fluency_score: result.fluencyScore,
          completeness_score: result.completenessScore,
          pronunciation_score: result.pronunciationScore,
          detailed_words: result.detailed_words,
        },
      };
      return updated;
    });

    // Assessment is persisted by the template's uploadAnalysisInBackground
    // or by background performAnalysisAndSave (both use upload-analysis endpoint).
  };

  // Navigate to next item
  const handleNext = () => {
    // 🎯 Issue #227: 切換到下一題時，背景分析當前未分析的題目
    if (canUseAiAnalysis && !isPreviewMode && !isDemoMode) {
      const currentItem = items[currentIndex];
      // 🔧 Review fix: 捕獲 index 避免 async 回調中使用 stale closure
      const capturedIndex = currentIndex;
      const hasRecording =
        currentItem?.recording_url && currentItem.recording_url !== "";
      if (hasRecording && !currentItem?.ai_assessment && currentItem.text) {
        // fire-and-forget：背景分析不阻塞導航
        (async () => {
          try {
            const resp = await fetch(currentItem.recording_url!);
            if (!resp.ok) {
              console.warn(
                `Audio fetch failed (${resp.status}), skipping background analysis`,
              );
              return;
            }
            const audioBlob = await resp.blob();
            await performAnalysisAndSave({
              audioBlob,
              text: currentItem.text,
              itemIndex: capturedIndex,
              progressId: currentItem.progress_id,
            });
          } catch (err) {
            console.error("Background analysis on next failed:", err);
          }
        })();
      }
    }

    if (currentIndex < items.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  // Navigate to previous item
  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  // Handle clear recording — 同步刪除後端錄音和評估
  const handleClearRecording = useCallback(async () => {
    const currentItem = items[currentIndex];
    if (!currentItem?.progress_id) return;

    // 清除本地 state（題號按鈕立即變白）
    setItems((prev) => {
      const updated = [...prev];
      updated[currentIndex] = {
        ...updated[currentIndex],
        recording_url: undefined,
        ai_assessment: undefined,
      };
      return updated;
    });

    // 背景呼叫後端 DELETE API（優先使用 progress_id，避免 index 排序問題）
    if (!isPreviewMode && !isDemoMode) {
      const apiUrl = import.meta.env.VITE_API_URL || "";
      const progressId = currentItem?.progress_id;
      const deleteUrl = progressId
        ? `${apiUrl}/api/speech/assessment/${assignmentId}/progress/${progressId}`
        : `${apiUrl}/api/speech/assessment/${assignmentId}/item/${currentIndex}`;
      fetch(deleteUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch((err) => console.error("Clear recording failed:", err));
    }
  }, [items, currentIndex, assignmentId, token, isPreviewMode, isDemoMode]);

  // Submit assignment
  const handleSubmit = async () => {
    if (isPreviewMode || isDemoMode) {
      toast.info(
        t("wordReading.toast.cannotSubmitPreview") ||
          "Cannot submit in preview mode",
      );
      return;
    }

    // Check for incomplete items
    const incompleteCount = items.filter((item) => !item.recording_url).length;
    if (incompleteCount > 0) {
      toast.warning(
        t("wordReading.toast.incompleteItems", { count: incompleteCount }) ||
          `${incompleteCount} items not recorded`,
      );
      return;
    }

    try {
      setSubmitting(true);
      const apiUrl = import.meta.env.VITE_API_URL || "";

      // 🎯 Issue #227: 提交前確保所有 blob URL 上傳到 GCS
      const blobItems = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.recording_url?.startsWith("blob:"));

      if (blobItems.length > 0) {
        let uploadFailures = 0;
        for (const { item, index } of blobItems) {
          try {
            const resp = await fetch(item.recording_url!);
            const audioBlob = await resp.blob();
            const ext = audioBlob.type.includes("mp4")
              ? "recording.mp4"
              : audioBlob.type.includes("webm")
                ? "recording.webm"
                : "recording.audio";

            const formData = new FormData();
            formData.append("assignment_id", assignmentId.toString());
            formData.append("content_item_id", item.id.toString());
            formData.append("audio_file", audioBlob, ext);

            const uploadResult = await retryAudioUpload(
              async () => {
                const uploadResp = await fetch(
                  `${apiUrl}/api/students/upload-recording`,
                  {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData,
                  },
                );
                if (!uploadResp.ok)
                  throw new Error(`Upload failed: ${uploadResp.status}`);
                return await uploadResp.json();
              },
              () => {},
            );

            setItems((prev) => {
              const updated = [...prev];
              updated[index] = {
                ...updated[index],
                recording_url: uploadResult.audio_url,
                progress_id: uploadResult.progress_id,
              };
              return updated;
            });
          } catch (error) {
            uploadFailures++;
            console.error(
              `Failed to upload blob for item ${index + 1}:`,
              error,
            );
          }
        }

        if (uploadFailures > 0) {
          toast.error(
            t("wordReading.toast.uploadFailedCount", {
              count: uploadFailures,
            }) || `${uploadFailures} recording(s) failed to upload`,
          );
          setSubmitting(false);
          return;
        }
      }

      // 🎯 Issue #227: 提交前補分析所有有錄音但未分析的題目
      if (canUseAiAnalysis) {
        const unanalyzedItems = items
          .map((item, index) => ({ item, index }))
          .filter(
            ({ item }) =>
              item.recording_url &&
              item.recording_url !== "" &&
              !item.ai_assessment,
          );

        if (unanalyzedItems.length > 0) {
          for (const { item, index } of unanalyzedItems) {
            try {
              const audioResp = await fetch(item.recording_url!);
              if (!audioResp.ok) {
                console.warn(
                  `Audio fetch failed for item ${index + 1} (${audioResp.status})`,
                );
                continue;
              }
              const audioBlob = await audioResp.blob();
              await performAnalysisAndSave({
                audioBlob,
                text: item.text,
                itemIndex: index,
                progressId: item.progress_id,
              });
            } catch (error) {
              console.error(`Failed to analyze item ${index + 1}:`, error);
            }
          }
        }
      }

      // 提交作業
      const response = await fetch(
        `${apiUrl}/api/students/assignments/${assignmentId}/vocabulary/submit`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Submit failed: ${response.status}`);
      }

      toast.success(t("wordReading.toast.submitted") || "Assignment submitted");
      onComplete?.();
    } catch (error) {
      console.error("Submit error:", error);
      toast.error(t("wordReading.toast.submitFailed") || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <Card className="p-8">
        <CardContent className="flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-gray-600">
            {t("wordReading.loading") || "Loading vocabulary items..."}
          </p>
        </CardContent>
      </Card>
    );
  }

  // No items
  if (items.length === 0) {
    return (
      <Card className="p-8">
        <CardContent className="text-center">
          <p className="text-gray-600">
            {t("wordReading.noItems") || "No vocabulary items found"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const currentItem = items[currentIndex];
  const completedCount = items.filter((item) => item.recording_url).length;
  const progress = (completedCount / items.length) * 100;
  const isLastItem = currentIndex === items.length - 1;
  const allCompleted = completedCount === items.length;

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {t("wordReading.wordReading") || "Word Reading"}
          </Badge>
          <span className="text-sm text-gray-600">
            {t("wordReading.itemProgress", {
              current: currentIndex + 1,
              total: items.length,
            }) || `${currentIndex + 1} / ${items.length}`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span>
            {t("wordReading.completedCount", { count: completedCount }) ||
              `${completedCount} completed`}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <Progress value={progress} className="h-2" />

      {/* Item Navigation Dots */}
      <div className="flex gap-1 overflow-x-auto pb-1 mx-auto w-fit max-w-full">
        {items.map((item, index) => {
          const isActive = index === currentIndex;
          const isCompleted = !!item.recording_url;
          const hasAssessment = !!item.ai_assessment;

          return (
            <button
              key={item.id}
              onClick={() => setCurrentIndex(index)}
              className={cn(
                "w-8 h-8 rounded border transition-all flex items-center justify-center text-xs font-medium flex-shrink-0",
                isActive && "border-2 border-blue-600",
                hasAssessment
                  ? "bg-green-100 text-green-800 border-green-400"
                  : isCompleted
                    ? "bg-yellow-100 text-yellow-800 border-yellow-400"
                    : "bg-white text-gray-600 border-gray-300 hover:border-blue-400",
              )}
              title={
                hasAssessment
                  ? t("wordReading.assessed") || "Assessed"
                  : isCompleted
                    ? t("wordReading.recorded") || "Recorded"
                    : t("wordReading.notRecorded") || "Not recorded"
              }
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      {/* Word Reading Template */}
      <WordReadingTemplate
        currentItem={currentItem}
        currentIndex={currentIndex}
        totalItems={items.length}
        showTranslation={showTranslationFromApi}
        showImage={showImageFromApi}
        existingAudioUrl={currentItem.recording_url}
        onRecordingComplete={handleRecordingComplete}
        progressId={currentItem.progress_id}
        readOnly={readOnly}
        isDemoMode={isDemoMode}
        timeLimit={timeLimitPerQuestion}
        onAssessmentComplete={handleAssessmentComplete}
        onClearRecording={handleClearRecording}
        canUseAiAnalysis={canUseAiAnalysisProp ?? canUseAiAnalysisFromApi}
      />

      {/* Navigation Buttons */}
      <div className="flex items-center justify-center gap-4 pt-4 border-t">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={currentIndex === 0 || uploading}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t("wordReading.previous") || "Previous"}
        </Button>

        {isLastItem && allCompleted ? (
          <Button
            onClick={handleSubmit}
            disabled={submitting || uploading}
            className="bg-green-600 hover:bg-green-700"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                {t("wordReading.submitting") || "Submitting..."}
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-1" />
                {t("wordReading.submit") || "Submit"}
              </>
            )}
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={handleNext}
            disabled={currentIndex === items.length - 1 || uploading}
          >
            {t("wordReading.next") || "Next"}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
