/**
 * Demo Azure Pronunciation Hook
 *
 * Same functionality as useAzurePronunciation but for demo mode.
 * Uses demoSpeechService which doesn't require authentication.
 * Throws DemoLimitExceededError when daily quota is exceeded.
 *
 * Supports Phoneme-level granularity for word reading activities (Issue #492).
 */

import { useState } from "react";
import {
  demoSpeechService,
  DemoLimitExceededError,
} from "@/services/demoSpeechService";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// Re-export the error for convenience
export { DemoLimitExceededError };

// Azure SDK response type definitions
// 🎯 Issue #492: 音素/音節型別，與 useAzurePronunciation 對齊
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

interface PhonemeDetail {
  phoneme: string;
  accuracy_score: number;
}

interface SyllableDetail {
  syllable: string;
  accuracy_score: number;
  phonemes: PhonemeDetail[];
}

interface DetailedWord {
  index: number;
  word: string;
  accuracy_score: number;
  error_type?: string;
  syllables?: SyllableDetail[];
  phonemes?: PhonemeDetail[];
}

interface AzurePronunciationResultShape {
  pronunciationScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  words?: Array<{
    word: string;
    accuracyScore: number;
    errorType: string;
  }>;
}

function isAzurePronunciationResult(
  obj: unknown,
): obj is AzurePronunciationResultShape {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "pronunciationScore" in obj &&
    "accuracyScore" in obj &&
    "fluencyScore" in obj &&
    "completenessScore" in obj
  );
}

interface PronunciationResult {
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
}

interface UseDemoAzurePronunciationResult {
  isAnalyzing: boolean;
  result: PronunciationResult | null;
  error: string | null;
  limitExceeded: boolean;
  limitError: DemoLimitExceededError | null;
  remainingToday: number;
  analyzePronunciation: (
    audioBlob: Blob,
    referenceText: string,
    granularity?: "Word" | "Phoneme",
  ) => Promise<PronunciationResult | null>;
  reset: () => void;
  clearLimitError: () => void;
}

export function useDemoAzurePronunciation(): UseDemoAzurePronunciationResult {
  const { t } = useTranslation();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<PronunciationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [limitError, setLimitError] = useState<DemoLimitExceededError | null>(
    null,
  );
  const [remainingToday, setRemainingToday] = useState(-1);

  /**
   * Analyze pronunciation using Demo Speech Service (no auth required)
   * @param audioBlob - The recorded audio blob
   * @param referenceText - The reference text to compare against
   * @returns The analysis result or null if failed
   * @throws DemoLimitExceededError if daily quota is exceeded (caught and stored in state)
   */
  const analyzePronunciation = async (
    audioBlob: Blob,
    referenceText: string,
    granularity: "Word" | "Phoneme" = "Word",
  ): Promise<PronunciationResult | null> => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // Call Demo Speech Service directly — pass granularity through
      const { result: analysisResult, latencyMs } =
        await demoSpeechService.analyzePronunciation(
          audioBlob,
          referenceText,
          0,
          granularity,
        );

      console.log(`Demo pronunciation analysis completed in ${latencyMs}ms`);

      // Update remaining quota
      const remaining = demoSpeechService.getRemainingToday();
      if (remaining >= 0) {
        setRemainingToday(remaining);
      }

      // Convert Azure result to our format (with type guard validation)
      const rawResult: unknown = analysisResult;
      if (!isAzurePronunciationResult(rawResult)) {
        throw new Error("Invalid analysis result format");
      }
      const azureResult = rawResult;

      // Parse detailed word data
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

          // 🎯 Issue #492: 解析音素層級資料（僅 Phoneme granularity 時有值）
          if (granularity === "Phoneme") {
            if (wordData.Syllables && wordData.Syllables.length > 0) {
              detailedWord.syllables = wordData.Syllables.map((syl) => ({
                syllable: syl.Syllable,
                accuracy_score: syl.PronunciationAssessment?.AccuracyScore || 0,
                phonemes: (syl.Phonemes || []).map((ph) => ({
                  phoneme: ph.Phoneme,
                  accuracy_score:
                    ph.PronunciationAssessment?.AccuracyScore || 0,
                })),
              }));
            }
            if (wordData.Phonemes && wordData.Phonemes.length > 0) {
              detailedWord.phonemes = wordData.Phonemes.map((ph) => ({
                phoneme: ph.Phoneme,
                accuracy_score: ph.PronunciationAssessment?.AccuracyScore || 0,
              }));
            }
          }

          detailed_words.push(detailedWord);
        });
      }

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
      console.error("Demo pronunciation analysis failed:", err);

      // Handle daily limit exceeded error specially
      if (err instanceof DemoLimitExceededError) {
        setLimitExceeded(true);
        setLimitError(err);
        setIsAnalyzing(false);
        // Don't show toast for limit error - let the modal handle it
        return null;
      }

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

  /**
   * Clear the limit exceeded error (after user dismisses modal)
   */
  const clearLimitError = () => {
    setLimitExceeded(false);
    setLimitError(null);
  };

  return {
    isAnalyzing,
    result,
    error,
    limitExceeded,
    limitError,
    remainingToday,
    analyzePronunciation,
    reset,
    clearLimitError,
  };
}
