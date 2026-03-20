/**
 * Demo Speech Service
 *
 * Provides Azure Speech token for demo mode (no authentication required).
 * Features:
 * - Token caching with 4-minute validity (5 min server - 1 min buffer)
 * - Daily quota tracking (60 uses per day)
 * - Graceful error handling with user-friendly messages
 */

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { API_URL } from "@/config/api";

interface DemoTokenResponse {
  token: string;
  region: string;
  expires_in: number;
  demo_mode: boolean;
  remaining_today: number;
}

interface DemoLimitError {
  error: "daily_limit_exceeded";
  message: string;
  suggestion: string;
  limit: number;
  reset_at: string;
}

interface TokenCache {
  token: string;
  region: string;
  expiresAt: Date;
  remainingToday: number;
}

/**
 * Error thrown when demo daily limit is exceeded
 */
export class DemoLimitExceededError extends Error {
  public readonly limit: number;
  public readonly resetAt: string;
  public readonly suggestion: string;

  constructor(data: DemoLimitError) {
    super(data.message);
    this.name = "DemoLimitExceededError";
    this.limit = data.limit;
    this.resetAt = data.reset_at;
    this.suggestion = data.suggestion;
  }
}

/**
 * Demo Speech Service for unauthenticated demo mode
 */
class DemoSpeechService {
  private tokenCache: TokenCache | null = null;
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_URL;
  }

  /**
   * Get Azure Speech token for demo mode
   * @param forceRefresh - Skip cache and fetch a new token (e.g. after 401)
   * @throws DemoLimitExceededError if daily limit is reached
   */
  async getToken(forceRefresh = false): Promise<DemoTokenResponse> {
    // Check cache (4 minutes validity = 5 min server - 1 min buffer)
    if (
      !forceRefresh &&
      this.tokenCache &&
      new Date() < this.tokenCache.expiresAt
    ) {
      return {
        token: this.tokenCache.token,
        region: this.tokenCache.region,
        expires_in: Math.floor(
          (this.tokenCache.expiresAt.getTime() - Date.now()) / 1000,
        ),
        demo_mode: true,
        remaining_today: this.tokenCache.remainingToday,
      };
    }

    // Request new token
    const response = await fetch(
      `${this.baseUrl}/api/demo/azure-speech/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      // Handle 429 (rate limit / daily quota exceeded)
      if (response.status === 429) {
        const errorData = await response.json();
        if (errorData.detail?.error === "daily_limit_exceeded") {
          throw new DemoLimitExceededError(errorData.detail);
        }
        throw new Error("請求過於頻繁，請稍後再試");
      }

      // Handle 403 (invalid referer)
      if (response.status === 403) {
        throw new Error("無法驗證請求來源");
      }

      // Handle other errors
      throw new Error("無法取得語音分析授權，請稍後再試");
    }

    const data: DemoTokenResponse = await response.json();

    // Cache token (4 min = 5 min server - 1 min buffer)
    this.tokenCache = {
      token: data.token,
      region: data.region,
      expiresAt: new Date(Date.now() + (data.expires_in - 60) * 1000),
      remainingToday: data.remaining_today,
    };

    return data;
  }

  /**
   * Clear cached token
   */
  clearCache(): void {
    this.tokenCache = null;
  }

  /**
   * Get remaining daily quota (from cache or 0 if unknown)
   */
  getRemainingToday(): number {
    return this.tokenCache?.remainingToday ?? -1;
  }

  /**
   * Analyze pronunciation using Azure Speech SDK (demo mode)
   *
   * @param audioBlob Recording blob (WAV format)
   * @param referenceText Reference text for assessment
   * @param retryCount Internal retry counter
   * @returns Assessment result and latency
   * @throws DemoLimitExceededError if daily limit is reached
   */
  async analyzePronunciation(
    audioBlob: Blob,
    referenceText: string,
    retryCount = 0,
    granularity: "Word" | "Phoneme" = "Word",
  ): Promise<{
    result: sdk.PronunciationAssessmentResult;
    latencyMs: number;
  }> {
    const startTime = Date.now();

    try {
      // 1. Get demo token (force refresh on retry to bypass stale cache)
      const { token, region } = await this.getToken(retryCount > 0);

      // 2. Configure Speech SDK
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(
        token,
        region,
      );
      speechConfig.speechRecognitionLanguage = "en-US";

      // 3. Configure pronunciation assessment
      // 🎯 Issue #492: 單字朗讀使用 Phoneme 層級，與正式版對齊
      const sdkGranularity =
        granularity === "Phoneme"
          ? sdk.PronunciationAssessmentGranularity.Phoneme
          : sdk.PronunciationAssessmentGranularity.Word;
      const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
        referenceText,
        sdk.PronunciationAssessmentGradingSystem.HundredMark,
        sdkGranularity,
        true, // enableMiscue
      );

      // 4. Convert audio to PCM format
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Convert to 16-bit PCM mono
      const pcmData = audioBuffer.getChannelData(0);
      const pcm16 = new Int16Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        pcm16[i] = Math.max(
          -32768,
          Math.min(32767, Math.floor(pcmData[i] * 32768)),
        );
      }

      // Create push stream
      const pushStream = sdk.AudioInputStream.createPushStream();
      pushStream.write(pcm16.buffer);
      pushStream.close();

      const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

      // 5. Create recognizer
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      pronunciationConfig.applyTo(recognizer);

      // 6. Execute recognition
      return new Promise((resolve, reject) => {
        recognizer.recognizeOnceAsync(
          (result) => {
            const latencyMs = Date.now() - startTime;

            if (result.reason === sdk.ResultReason.RecognizedSpeech) {
              const pronunciationResult =
                sdk.PronunciationAssessmentResult.fromResult(result);

              recognizer.close();
              resolve({ result: pronunciationResult, latencyMs });
            } else if (
              (result.reason === sdk.ResultReason.NoMatch ||
                result.errorDetails?.includes("401")) &&
              retryCount === 0
            ) {
              // Token may have expired - retry once
              this.clearCache();
              recognizer.close();
              resolve(this.analyzePronunciation(audioBlob, referenceText, 1, granularity));
            } else {
              console.error("Demo speech recognition failed:", {
                reason: result.reason,
                errorDetails: result.errorDetails,
              });

              recognizer.close();
              const errorMsg =
                result.errorDetails || `識別失敗: ${result.reason}`;
              reject(new Error(errorMsg));
            }
          },
          (error) => {
            console.error("Demo speech recognition error:", error);
            recognizer.close();

            if (error.includes("401") && retryCount === 0) {
              this.clearCache();
              resolve(this.analyzePronunciation(audioBlob, referenceText, 1, granularity));
            } else {
              reject(new Error(`分析失敗: ${error}`));
            }
          },
        );
      });
    } catch (error) {
      // Re-throw DemoLimitExceededError as-is
      if (error instanceof DemoLimitExceededError) {
        throw error;
      }
      console.error("Demo speech analysis failed:", error);
      throw new Error("語音分析失敗，請重試");
    }
  }
}

// Singleton instance
export const demoSpeechService = new DemoSpeechService();
