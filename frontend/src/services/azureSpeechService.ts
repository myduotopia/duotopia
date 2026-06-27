import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import axios from "axios";
import { useStudentAuthStore } from "@/stores/studentAuthStore";
import { useTeacherAuthStore } from "@/stores/teacherAuthStore";

interface TokenCache {
  token: string;
  region: string;
  expiresAt: Date;
}

// 🎯 Issue #118: Upload retry mechanism interfaces
interface PendingUpload {
  id: string;
  audioBase64: string;
  analysisResult: Record<string, unknown>;
  latencyMs: number;
  progressId?: number;
  timestamp: number;
  retryCount: number;
}

export interface UploadResult {
  success: boolean;
  uploadId: string;
  error?: string;
}

export class AzureSpeechService {
  private tokenCache: TokenCache | null = null;

  // 🎯 Issue #118: localStorage key for pending uploads
  private readonly STORAGE_KEY = "duotopia_pending_uploads";
  // 🎯 Issue #138: optimistic-locking version counter for the queue
  private readonly VERSION_KEY = "duotopia_pending_uploads_version";
  private readonly MAX_QUEUE_SIZE = 10 * 1024 * 1024; // 10MB limit
  private readonly MAX_RETRIES = 2;
  // 🎯 Issue #138: max attempts to commit a queue mutation under contention
  private readonly QUEUE_MUTATION_RETRIES = 3;

  /**
   * 获取 Azure Speech Token（带缓存，提前1分钟过期）
   * @private
   */
  private async getToken(): Promise<{ token: string; region: string }> {
    // 检查 cache 是否有效（提前1分钟过期）
    if (this.tokenCache && new Date() < this.tokenCache.expiresAt) {
      return {
        token: this.tokenCache.token,
        region: this.tokenCache.region,
      };
    }

    // Cache 过期或不存在，重新获取
    try {
      // 🔑 获取 auth token（优先学生，fallback 老师预览）
      const studentToken = useStudentAuthStore.getState().token;
      const teacherToken = useTeacherAuthStore.getState().token;
      const authToken = studentToken || teacherToken;

      if (!authToken) {
        throw new Error("未登入或 token 已过期");
      }

      const apiUrl = import.meta.env.VITE_API_URL || "";
      const response = await axios.post(
        `${apiUrl}/api/azure-speech/token`,
        null,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );
      const { token, region, expires_in } = response.data;

      // Cache token（提前1分钟过期 = 9分钟有效）
      this.tokenCache = {
        token,
        region,
        expiresAt: new Date(Date.now() + (expires_in - 60) * 1000),
      };

      return { token, region };
    } catch (error) {
      console.error("Failed to get Azure Speech token:", {
        error: (error as { response?: { status?: number } }).response?.status,
        message: (error as Error).message,
      });
      throw new Error("无法获取语音分析授权，请刷新页面重试");
    }
  }

  /**
   * 直接调用 Azure Speech API 分析发音
   *
   * @param audioBlob 录音 Blob (WAV 格式)
   * @param referenceText 参考文本
   * @param retryCount 内部重试计数（用户无需传入）
   * @returns 分析结果和延迟时间
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
      // 1. 获取短效 token
      const { token, region } = await this.getToken();

      // 2. 配置 Speech SDK
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(
        token,
        region,
      );
      speechConfig.speechRecognitionLanguage = "en-US";

      // 3. 配置发音评估参数
      // 🎯 Issue #450: 單字朗讀使用 Phoneme 層級，例句朗讀維持 Word 層級
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

      // 4. 从 Blob 创建音频配置（使用 push stream 支持所有格式）
      // 解码音频为 PCM 数据
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      } finally {
        await audioContext.close();
      }

      // 转换为 16-bit PCM mono
      const pcmData = audioBuffer.getChannelData(0); // Get mono channel
      const pcm16 = new Int16Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        // Convert float32 [-1, 1] to int16 [-32768, 32767]
        pcm16[i] = Math.max(
          -32768,
          Math.min(32767, Math.floor(pcmData[i] * 32768)),
        );
      }

      // 创建 push stream 并推送数据
      const pushStream = sdk.AudioInputStream.createPushStream();
      pushStream.write(pcm16.buffer);
      pushStream.close();

      const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

      // 5. 创建语音识别器
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      pronunciationConfig.applyTo(recognizer);

      // 6. 执行识别（Promise 包装）
      return new Promise((resolve, reject) => {
        recognizer.recognizeOnceAsync(
          (result) => {
            const latencyMs = Date.now() - startTime;

            // 识别成功
            if (result.reason === sdk.ResultReason.RecognizedSpeech) {
              const pronunciationResult =
                sdk.PronunciationAssessmentResult.fromResult(result);

              recognizer.close();
              resolve({ result: pronunciationResult, latencyMs });
            }
            // Token 可能过期 - 自动 retry
            else if (
              (result.reason === sdk.ResultReason.NoMatch ||
                result.errorDetails?.includes("401")) &&
              retryCount === 0
            ) {
              this.tokenCache = null; // 清除旧 token
              recognizer.close();

              // 递归重试（只重试一次）
              resolve(
                this.analyzePronunciation(
                  audioBlob,
                  referenceText,
                  1,
                  granularity,
                ),
              );
            }
            // 其他错误
            else {
              console.error("Azure Speech recognition failed:", {
                reason: result.reason,
                errorDetails: result.errorDetails,
              });

              recognizer.close();
              const errorMsg =
                result.errorDetails || `识别失败: ${result.reason}`;
              reject(new Error(errorMsg));
            }
          },
          (error) => {
            console.error("Azure Speech recognition error:", error);

            recognizer.close();

            // 401 错误 - 自动 retry
            if (error.includes("401") && retryCount === 0) {
              this.tokenCache = null;
              resolve(
                this.analyzePronunciation(
                  audioBlob,
                  referenceText,
                  1,
                  granularity,
                ),
              );
            } else {
              reject(new Error(`分析失败: ${error}`));
            }
          },
        );
      });
    } catch (error) {
      console.error("Azure Speech analysis failed:", error);
      throw new Error("语音分析失败，请重试");
    }
  }

  /**
   * 🎯 Issue #118: Upload with retry mechanism
   * First attempt to upload, if failed, save to localStorage for later retry
   *
   * @param audioBlob 录音 Blob
   * @param analysisResult 分析结果
   * @param latencyMs 客户端到 Azure 的延迟
   * @param progressId StudentItemProgress ID (optional)
   * @returns Upload result with success status and uploadId
   */
  async uploadWithRetry(
    audioBlob: Blob,
    analysisResult: sdk.PronunciationAssessmentResult | Record<string, unknown>,
    latencyMs: number,
    progressId?: number,
  ): Promise<UploadResult> {
    const uploadId = crypto.randomUUID();

    // 老师预览模式：跳过上传
    const studentToken = useStudentAuthStore.getState().token;
    const teacherToken = useTeacherAuthStore.getState().token;
    if (!studentToken && teacherToken) {
      console.log("Teacher preview mode: skipping upload");
      return { success: true, uploadId };
    }

    try {
      await this.uploadToServer(
        audioBlob,
        analysisResult,
        latencyMs,
        progressId,
      );
      return { success: true, uploadId };
    } catch (error) {
      console.error("First upload attempt failed:", error);

      // Save to localStorage for later retry
      const saved = this.savePendingUpload({
        id: uploadId,
        audioBase64: await this.blobToBase64(audioBlob),
        analysisResult: analysisResult as Record<string, unknown>,
        latencyMs,
        progressId,
        timestamp: Date.now(),
        retryCount: 1,
      });

      return {
        success: false,
        uploadId,
        error: saved
          ? "Upload failed, saved for retry"
          : "Upload failed, could not save for retry",
      };
    }
  }

  /**
   * 🎯 Issue #118: Retry all pending uploads (called on submit)
   * @returns Object with success and failed upload IDs
   */
  async retryPendingUploads(): Promise<{
    success: string[];
    failed: string[];
  }> {
    const pending = this.getPendingUploads();
    const success: string[] = [];
    const failed: string[] = [];

    for (const upload of pending) {
      if (upload.retryCount >= this.MAX_RETRIES) {
        // Max retries reached, mark as failed
        failed.push(upload.id);
        this.removePendingUpload(upload.id);
        continue;
      }

      try {
        const audioBlob = await this.base64ToBlob(upload.audioBase64);
        await this.uploadToServer(
          audioBlob,
          upload.analysisResult,
          upload.latencyMs,
          upload.progressId,
        );
        success.push(upload.id);
        // 🎯 Issue #138: if removal loses to sustained contention the item
        // stays queued and will be re-submitted next cycle (backend dedups
        // via analysis_id) — surface it so it isn't silently swallowed.
        if (!this.removePendingUpload(upload.id)) {
          console.warn(
            `Uploaded ${upload.id} but could not remove from queue; may re-submit`,
          );
        }
      } catch (error) {
        console.error(`Retry failed for ${upload.id}:`, error);
        upload.retryCount++;
        this.updatePendingUpload(upload);

        // If still under max retries, keep in queue
        if (upload.retryCount >= this.MAX_RETRIES) {
          failed.push(upload.id);
          this.removePendingUpload(upload.id);
        }
      }
    }

    return { success, failed };
  }

  /**
   * 🎯 Issue #118: Get count of pending uploads
   */
  getPendingUploadCount(): number {
    return this.getPendingUploads().length;
  }

  /**
   * 🎯 Issue #118: Internal upload to server
   * 🎯 Issue #208: Generate unique analysis_id for deduction idempotency
   */
  private async uploadToServer(
    audioBlob: Blob,
    analysisResult: sdk.PronunciationAssessmentResult | Record<string, unknown>,
    latencyMs: number,
    progressId?: number,
  ): Promise<void> {
    const studentToken = useStudentAuthStore.getState().token;
    const teacherToken = useTeacherAuthStore.getState().token;
    const authToken = studentToken || teacherToken;

    if (!authToken) {
      throw new Error("No auth token available");
    }

    const formData = new FormData();
    formData.append("audio_file", audioBlob, "recording.wav");
    formData.append("analysis_json", JSON.stringify(analysisResult));
    formData.append("latency_ms", latencyMs.toString());
    if (progressId) {
      formData.append("progress_id", progressId.toString());
    }

    // 🎯 Issue #208: Generate unique analysis_id for each upload
    // This enables backend to:
    // 1. Deduct points for each Azure SDK call (not just on submit)
    // 2. Prevent duplicate deduction on network retry (same analysis_id)
    const analysisId = crypto.randomUUID();
    formData.append("analysis_id", analysisId);

    const apiUrl = import.meta.env.VITE_API_URL || "";
    await axios.post(`${apiUrl}/api/speech/upload-analysis`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
        Authorization: `Bearer ${authToken}`,
      },
      timeout: 30000, // 30 second timeout
    });
  }

  // ===== localStorage Management =====

  /**
   * 🎯 Issue #138: Atomically read-modify-write the queue with optimistic
   * locking. The mutator runs against a fresh snapshot; if another context
   * (e.g. a second browser tab) bumped the version between our read and our
   * write, we re-read and retry instead of clobbering their change.
   *
   * Known residual risk: localStorage offers no atomic compare-and-swap, so a
   * narrow undetectable window remains — if two tabs read the same version and
   * both pass the check before either writes, the later writer silently wins
   * and bumps the version to the same value, so neither tab can detect the
   * loss. This shrinks but does not eliminate the race; a complete fix needs a
   * cross-tab mutex (Web Locks API / BroadcastChannel). Within a single tab JS
   * is single-threaded, so this path is fully safe there.
   *
   * The version write is committed *before* the data write so that a
   * QuotaExceededError on the second setItem can never leave the data
   * persisted under a stale version (which would let a later write clobber it
   * undetected). A failed data write only over-bumps the version, which is
   * safe: other tabs simply see a conflict and retry.
   *
   * @param mutator Returns the next queue, or null to abort the write.
   * @returns true if the mutation was committed, false otherwise.
   */
  private mutateQueue(
    mutator: (queue: PendingUpload[]) => PendingUpload[] | null,
  ): boolean {
    for (let attempt = 0; attempt < this.QUEUE_MUTATION_RETRIES; attempt++) {
      try {
        const versionBefore = localStorage.getItem(this.VERSION_KEY) || "0";
        const current = this.getPendingUploads();

        const next = mutator(current);
        if (next === null) {
          return false; // mutator chose to abort (e.g. item too large)
        }

        // Optimistic lock: bail to a retry if anyone wrote since our read.
        const versionNow = localStorage.getItem(this.VERSION_KEY) || "0";
        if (versionNow !== versionBefore) {
          continue;
        }

        // Version first: if the data write below throws (e.g. quota), we never
        // leave committed data sitting under an unchanged version.
        localStorage.setItem(
          this.VERSION_KEY,
          String(parseInt(versionBefore, 10) + 1),
        );
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(next));
        return true;
      } catch (error) {
        console.error("Failed to mutate pending upload queue:", error);
        return false;
      }
    }

    console.warn("Queue mutation gave up after version conflicts");
    return false;
  }

  /**
   * 🎯 Issue #118: Save pending upload to localStorage
   * 🎯 Issue #138: now goes through mutateQueue for concurrency safety
   */
  private savePendingUpload(upload: PendingUpload): boolean {
    const itemSize = new Blob([JSON.stringify(upload)]).size;

    // If single item is too large, reject (independent of queue state).
    if (itemSize > this.MAX_QUEUE_SIZE) {
      console.warn("Audio file too large for retry queue");
      return false;
    }

    const saved = this.mutateQueue((existing) => {
      const queue = [...existing];

      // Prune oldest items until the new item fits under the size limit.
      let currentSize = new Blob([JSON.stringify(queue)]).size;
      while (currentSize + itemSize > this.MAX_QUEUE_SIZE && queue.length > 0) {
        const removed = queue.shift();
        if (removed) {
          console.warn(`Pruning old upload ${removed.id} to make space`);
        }
        currentSize = new Blob([JSON.stringify(queue)]).size;
      }

      queue.push(upload);
      return queue;
    });

    if (saved) {
      console.log(`Saved pending upload ${upload.id} for retry`);
    }
    return saved;
  }

  /**
   * 🎯 Issue #118: Get all pending uploads from localStorage
   */
  private getPendingUploads(): PendingUpload[] {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  /**
   * 🎯 Issue #118: Remove a pending upload from localStorage
   */
  private removePendingUpload(id: string): boolean {
    // 🎯 Issue #138: concurrency-safe removal via mutateQueue.
    // Returns false if the mutation could not be committed (sustained
    // contention) so callers can react instead of silently dropping it.
    return this.mutateQueue((pending) => pending.filter((u) => u.id !== id));
  }

  /**
   * 🎯 Issue #118: Update a pending upload in localStorage
   */
  private updatePendingUpload(upload: PendingUpload): boolean {
    // 🎯 Issue #138: concurrency-safe update via mutateQueue
    return this.mutateQueue((pending) => {
      const index = pending.findIndex((u) => u.id === upload.id);
      if (index < 0) {
        // Entry was concurrently removed elsewhere; don't resurrect it.
        return null;
      }
      const next = [...pending];
      next[index] = upload;
      return next;
    });
  }

  // ===== Utility Methods =====

  /**
   * 🎯 Issue #118: Convert Blob to base64 string
   */
  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 🎯 Issue #118: Convert base64 string back to Blob
   */
  private async base64ToBlob(base64: string): Promise<Blob> {
    const response = await fetch(base64);
    return response.blob();
  }

  /**
   * 背景上传音档和分析结果（不阻塞 UI）
   * @deprecated Use uploadWithRetry instead for retry support
   *
   * @param audioBlob 录音 Blob
   * @param analysisResult 分析结果
   * @param latencyMs 客户端到 Azure 的延迟
   */
  async uploadAnalysisInBackground(
    audioBlob: Blob,
    analysisResult: sdk.PronunciationAssessmentResult | Record<string, unknown>,
    latencyMs: number,
  ): Promise<void> {
    // 🎯 Issue #118: Now uses uploadWithRetry for retry support
    await this.uploadWithRetry(audioBlob, analysisResult, latencyMs);
  }
}

// Singleton instance
export const azureSpeechService = new AzureSpeechService();
