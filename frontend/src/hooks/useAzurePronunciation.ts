import { useState } from "react";
import { azureSpeechService } from "@/services/azureSpeechService";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// Azure SDK response type definitions
// 🎯 Issue #450: 恢復 Phoneme/Syllable 層級型別，供單字朗讀使用
interface AzurePhonemeData {
  Phoneme: string;
  PronunciationAssessment?: {
    AccuracyScore?: number;
  };
}

interface AzureSyllableData {
  Syllable: string;
  PronunciationAssessment?: {
    AccuracyScore?: number;
  };
  Phonemes?: AzurePhonemeData[];
}

interface AzurePronunciationAssessment {
  AccuracyScore?: number;
  ErrorType?: string;
}

interface AzureWordData {
  Word: string;
  PronunciationAssessment?: AzurePronunciationAssessment;
  Syllables?: AzureSyllableData[];
  Phonemes?: AzurePhonemeData[];
}

interface AzurePrivPronJson {
  Words?: AzureWordData[];
}

interface AzureAnalysisResult {
  privPronJson?: AzurePrivPronJson;
  [key: string]: unknown;
}

// 🎯 Issue #450: 音素分析結果型別
export interface PhonemeDetail {
  phoneme: string;
  accuracy_score: number;
}

export interface SyllableDetail {
  syllable: string;
  accuracy_score: number;
  phonemes: PhonemeDetail[];
}

interface DetailedWord {
  index: number;
  word: string;
  accuracy_score: number;
  error_type?: string;
  // 🎯 Issue #450: 音素層級資料（僅單字朗讀模式）
  syllables?: SyllableDetail[];
  phonemes?: PhonemeDetail[];
}

// 🎯 Issue #118: Upload status for retry mechanism
export type UploadStatus = "success" | "pending_retry" | "failed";

export interface PronunciationResult {
  pronunciationScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  words?: Array<{
    word: string;
    accuracyScore: number;
    errorType: string;
  }>;
  detailed_words?: DetailedWord[];
  analysis_summary?: {
    total_words: number;
    problematic_words: string[];
    assessment_time?: string;
  };
  // 🎯 Issue #118: Upload status tracking for retry mechanism
  uploadStatus?: UploadStatus;
  uploadId?: string;
}

export function useAzurePronunciation() {
  const { t } = useTranslation();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<PronunciationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Analyze pronunciation using Azure Speech Service
   * @param audioBlob - The recorded audio blob
   * @param referenceText - The reference text to compare against
   * @param granularity - "Phoneme" for word reading, "Word" for sentence reading (default)
   * @returns The analysis result or null if failed
   */
  const analyzePronunciation = async (
    audioBlob: Blob,
    referenceText: string,
    granularity: "Word" | "Phoneme" = "Word",
  ): Promise<PronunciationResult | null> => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // Call Azure Speech Service — pass granularity through
      const { result: analysisResult } =
        await azureSpeechService.analyzePronunciation(
          audioBlob,
          referenceText,
          0,
          granularity,
        );

      // Convert Azure result to our format
      const azureResult = analysisResult as unknown as {
        pronunciationScore: number;
        accuracyScore: number;
        fluencyScore: number;
        completenessScore: number;
        words?: Array<{
          word: string;
          accuracyScore: number;
          errorType: string;
        }>;
      };

      // Parse detailed word data from Azure SDK internal JSON
      const detailed_words: DetailedWord[] = [];
      const privPronJson = (analysisResult as unknown as AzureAnalysisResult)
        .privPronJson;

      const wordsData = privPronJson?.Words || [];

      if (wordsData.length > 0) {
        wordsData.forEach((wordData: AzureWordData, idx: number) => {
          const detailedWord: DetailedWord = {
            index: idx,
            word: wordData.Word,
            accuracy_score:
              wordData.PronunciationAssessment?.AccuracyScore || 0,
            error_type: wordData.PronunciationAssessment?.ErrorType || "None",
          };

          // 🎯 Issue #450: 解析音素層級資料（僅 Phoneme granularity 時有值）
          if (granularity === "Phoneme") {
            // Parse syllables
            if (wordData.Syllables && wordData.Syllables.length > 0) {
              detailedWord.syllables = wordData.Syllables.map((syl) => ({
                syllable: syl.Syllable,
                accuracy_score:
                  syl.PronunciationAssessment?.AccuracyScore || 0,
                phonemes: (syl.Phonemes || []).map((ph) => ({
                  phoneme: ph.Phoneme,
                  accuracy_score:
                    ph.PronunciationAssessment?.AccuracyScore || 0,
                })),
              }));
            }

            // Parse phonemes (flat list at word level)
            if (wordData.Phonemes && wordData.Phonemes.length > 0) {
              detailedWord.phonemes = wordData.Phonemes.map((ph) => ({
                phoneme: ph.Phoneme,
                accuracy_score:
                  ph.PronunciationAssessment?.AccuracyScore || 0,
              }));
            }
          }

          detailed_words.push(detailedWord);
        });
      }

      // 🔧 Issue #118 Fix: Upload handled at component level (not here)

      const pronunciationResult: PronunciationResult = {
        pronunciationScore: azureResult.pronunciationScore,
        accuracyScore: azureResult.accuracyScore,
        fluencyScore: azureResult.fluencyScore,
        completenessScore: azureResult.completenessScore,
        words: azureResult.words,
        detailed_words: detailed_words.length > 0 ? detailed_words : undefined,
        analysis_summary: {
          total_words: detailed_words.length,
          problematic_words: detailed_words
            .filter((w) => w.accuracy_score < 80)
            .map((w) => w.word),
          assessment_time: new Date().toISOString(),
        },
      };

      setResult(pronunciationResult);
      setIsAnalyzing(false);

      return pronunciationResult;
    } catch (err) {
      console.error("Pronunciation analysis failed:", err);
      const errorMessage =
        err instanceof Error ? err.message : t("errors.analysisFailedRetry");

      setError(errorMessage);
      setIsAnalyzing(false);

      toast.error(t("errors.analysisFailed"), {
        description: errorMessage,
      });

      return null;
    }
  };

  /**
   * Reset the analysis state
   */
  const reset = () => {
    setResult(null);
    setError(null);
    setIsAnalyzing(false);
  };

  return {
    isAnalyzing,
    result,
    error,
    analyzePronunciation,
    reset,
  };
}
