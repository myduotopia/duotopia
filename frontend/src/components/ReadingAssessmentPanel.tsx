import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Mic,
  Volume2,
  GripVertical,
  Copy,
  Trash2,
  Plus,
  Globe,
  Play,
  Square,
  RefreshCw,
  Clipboard,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useSidebar } from "@/contexts/SidebarContext";
import { apiClient, ApiError } from "@/lib/api";
import { retryAudioUpload } from "@/utils/retryHelper";
import {
  TTS_ACCENTS,
  TTS_GENDERS,
  TTS_SPEEDS,
  getVoiceAndRate,
} from "@/utils/ttsVoiceResolver";
import {
  BatchPasteArea,
  BatchTTSSettings,
  BatchWorkPanel,
} from "@/components/shared/batch";
// dnd-kit imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// 翻譯語言選項
type TranslationLanguage = "chinese" | "japanese" | "korean" | "other";

// Language constants - labels will be translated dynamically using t()
const TRANSLATION_LANGUAGES = [
  { value: "chinese" as const, labelKey: "chinese", code: "zh-TW" },
  { value: "japanese" as const, labelKey: "japanese", code: "ja" },
  { value: "korean" as const, labelKey: "korean", code: "ko" },
  { value: "other" as const, labelKey: "other", code: "" },
];

// 每個例句集的題目上限
const MAX_ROWS = 15;
// 批次貼上/翻譯的項目上限
const MAX_BATCH_ITEMS = MAX_ROWS;
// 每題最少單字數
const MIN_WORDS_PER_ITEM = 2;

// 檢測重複的行 index（text 完全相同，忽略大小寫與前後空白）
// 回傳 Map<index, reasons[]>，給 UI 用來標紅 + 顯示重複內容
function findDuplicates(rows: { text: string }[]): Map<number, string[]> {
  const dupes = new Map<number, string[]>();
  const textMap = new Map<string, number[]>();

  rows.forEach((row, i) => {
    const text = row.text?.trim().toLowerCase();
    if (text) {
      if (!textMap.has(text)) textMap.set(text, []);
      textMap.get(text)!.push(i);
    }
  });

  for (const [text, indices] of textMap.entries()) {
    if (indices.length > 1) {
      indices.forEach((i) => {
        if (!dupes.has(i)) dupes.set(i, []);
        dupes.get(i)!.push(text);
      });
    }
  }

  return dupes;
}

interface ContentRow {
  id: string | number;
  text: string;
  definition: string;
  audioUrl?: string;
  audio_url?: string;
  translation?: string;
  japanese_translation?: string;
  korean_translation?: string;
  selectedLanguage?: TranslationLanguage; // 最後選擇的語言
  audioSettings?: {
    accent: string;
    gender: string;
    speed: string;
  };
  // Phase 1: Example sentence fields
  example_sentence?: string;
  example_sentence_translation?: string;
  example_sentence_definition?: string;
  has_student_progress?: boolean; // 是否有學生進度
}

interface TTSModalProps {
  open: boolean;
  onClose: () => void;
  row: ContentRow;
  onConfirm: (
    audioUrl: string,
    settings: {
      accent?: string;
      gender?: string;
      speed?: string;
      source?: string;
      audioBlob?: Blob | null;
    },
  ) => void;
  contentId?: number;
  itemIndex?: number;
  isCreating?: boolean; // 是否為新增模式
}

const TTSModal = ({
  open,
  onClose,
  row,
  onConfirm,
  contentId,
  itemIndex,
  isCreating = false,
}: TTSModalProps) => {
  const { t } = useTranslation();
  const [text, setText] = useState(row.text);
  const [accent, setAccent] = useState(
    row.audioSettings?.accent || "American English",
  );
  const [gender, setGender] = useState(row.audioSettings?.gender || "Male");
  const [speed, setSpeed] = useState(row.audioSettings?.speed || "Normal x1");
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState<string>("");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showAudioAnimation, setShowAudioAnimation] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<
    "tts" | "recording" | null
  >(null);
  const [activeTab, setActiveTab] = useState<string>("generate");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const recordingDurationRef = useRef<number>(0);

  const accents = TTS_ACCENTS;
  const genders = TTS_GENDERS;
  const speeds = TTS_SPEEDS;

  // 當 modal 打開或 row.text 改變時，更新 text state
  useEffect(() => {
    if (open && row.text) {
      setText(row.text);
    }
  }, [open, row.text]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { voice, rate } = getVoiceAndRate(accent, gender, speed);

      const result = await apiClient.generateTTS(text, voice, rate, "+0%");

      if (result?.audio_url) {
        // 如果是相對路徑，加上 API base URL
        const fullUrl = result.audio_url.startsWith("http")
          ? result.audio_url
          : `${import.meta.env.VITE_API_URL}${result.audio_url}`;
        setAudioUrl(fullUrl);

        // 觸發動畫效果
        setShowAudioAnimation(true);
        setTimeout(() => setShowAudioAnimation(false), 3000);

        // 自動播放一次讓使用者知道音檔已生成
        const previewAudio = new Audio(fullUrl);
        previewAudio.volume = 0.5;
        previewAudio.play().catch(() => {
          // 如果自動播放失敗（瀏覽器限制），仍顯示成功訊息
        });

        toast.success(t("contentEditor.messages.audioGeneratedSuccess"));
      }
    } catch (err) {
      console.error("TTS generation failed:", err);
      toast.error(t("contentEditor.messages.generationFailed"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlayAudio = () => {
    if (audioUrl && audioRef.current) {
      audioRef.current.play();
    }
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 檢查支援的 MIME 類型 - 優先使用 opus 編碼
      let mimeType = "audio/webm";
      const possibleTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4",
      ];

      for (const type of possibleTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000, // 設定位元率
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setRecordingDuration(0);

      // 設定計時器
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          const newDuration = prev + 1;
          // 30秒自動停止
          if (newDuration >= 30) {
            handleStopRecording();
            toast.info(t("contentEditor.messages.maxRecordingTimeReached"));
          }
          return newDuration;
        });
      }, 1000);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // 清理計時器
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        // 使用基本的 MIME type，去掉 codec 信息
        const basicMimeType = mimeType.split(";")[0];
        const audioBlob = new Blob(audioChunksRef.current, {
          type: basicMimeType,
        });

        // 使用 ref 來獲取當前的錄音時長
        const currentDuration =
          recordingDurationRef.current || recordingDuration;

        // 檢查檔案大小 (2MB 限制)
        if (audioBlob.size > 2 * 1024 * 1024) {
          toast.error(t("contentEditor.messages.recordingFileTooLarge"));
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // 確保有錄音資料
        if (audioBlob.size === 0) {
          toast.error(t("contentEditor.messages.recordingFailed"));
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // 儲存 blob 以便之後上傳
        audioBlobRef.current = audioBlob;
        recordingDurationRef.current = currentDuration;

        // 創建本地 URL 供預覽播放
        const localUrl = URL.createObjectURL(audioBlob);
        setRecordedAudio(localUrl);
        toast.success(t("contentEditor.messages.recordingComplete"));

        stream.getTracks().forEach((track) => track.stop());
      };

      // 使用 timeslice 參數，每100ms收集一次數據
      mediaRecorder.start(100);
      setIsRecording(true);
      toast.success(t("contentEditor.messages.recordingStarted"));
    } catch {
      toast.error(t("contentEditor.messages.cannotStartRecording"));
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      // 先儲存當前的錄音時長到 ref
      recordingDurationRef.current = recordingDuration;

      mediaRecorderRef.current.stop();
      setIsRecording(false);

      // 清理計時器
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const handleConfirm = async () => {
    // 如果兩種音源都有，需要用戶選擇
    if (audioUrl && recordedAudio) {
      if (!selectedSource) {
        toast.warning(t("contentEditor.messages.selectAudioSource"));
        return;
      }

      // 新增模式：不上傳，只傳遞本地 URL
      if (isCreating) {
        const finalUrl = selectedSource === "tts" ? audioUrl : recordedAudio;
        onConfirm(finalUrl, {
          accent,
          gender,
          speed,
          source: selectedSource,
          audioBlob:
            selectedSource === "recording" ? audioBlobRef.current : null,
        });
        onClose();
        return;
      }

      // 編輯模式：如果選擇錄音且還沒上傳（URL 是 blob:// 開頭），現在上傳
      if (
        selectedSource === "recording" &&
        recordedAudio.startsWith("blob:") &&
        audioBlobRef.current
      ) {
        setIsUploading(true);
        try {
          const result = await retryAudioUpload(
            () =>
              apiClient.uploadAudio(
                audioBlobRef.current!,
                recordingDurationRef.current || 1,
                Number(contentId),
                Number(itemIndex),
              ),
            (attempt, error) => {
              toast.warning(t("contentEditor.messages.uploadRetrying"));
              console.error(`Upload attempt ${attempt} failed:`, error);
            },
          );

          if (result && result.audio_url) {
            onConfirm(result.audio_url, {
              accent,
              gender,
              speed,
              source: "recording",
            });
            onClose();
          } else {
            throw new Error("No audio URL returned");
          }
        } catch (err) {
          console.error("Upload failed after retries:", err);
          toast.error(t("contentEditor.messages.uploadFailed"));
        } finally {
          setIsUploading(false);
        }
        return;
      }

      const finalUrl = selectedSource === "tts" ? audioUrl : recordedAudio;
      onConfirm(finalUrl, { accent, gender, speed, source: selectedSource });
    } else {
      // 只有一種音源
      const finalAudioUrl = recordedAudio || audioUrl;
      if (!finalAudioUrl) {
        toast.error(t("contentEditor.messages.generateOrRecordFirst"));
        return;
      }

      // 新增模式：不上傳，只傳遞本地 URL
      if (isCreating) {
        const source = recordedAudio ? "recording" : "tts";
        onConfirm(finalAudioUrl, {
          accent,
          gender,
          speed,
          source,
          audioBlob: source === "recording" ? audioBlobRef.current : null,
        });
        onClose();
        return;
      }

      // 編輯模式：如果是錄音且還沒上傳，現在上傳
      if (
        recordedAudio &&
        recordedAudio.startsWith("blob:") &&
        audioBlobRef.current
      ) {
        setIsUploading(true);
        try {
          const result = await retryAudioUpload(
            () =>
              apiClient.uploadAudio(
                audioBlobRef.current!,
                recordingDurationRef.current || 1,
                Number(contentId),
                Number(itemIndex),
              ),
            (attempt, error) => {
              toast.warning(t("contentEditor.messages.uploadRetrying"));
              console.error(`Upload attempt ${attempt} failed:`, error);
            },
          );

          if (result && result.audio_url) {
            onConfirm(result.audio_url, {
              accent,
              gender,
              speed,
              source: "recording",
            });
            onClose();
          } else {
            throw new Error("No audio URL returned");
          }
        } catch (err) {
          console.error("Upload failed after retries:", err);
          toast.error(t("contentEditor.messages.uploadFailed"));
        } finally {
          setIsUploading(false);
        }
        return;
      }

      const source = recordedAudio ? "recording" : "tts";
      onConfirm(finalAudioUrl, { accent, gender, speed, source });
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("contentEditor.modals.audioSettings")}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-gray-100 p-1 rounded-lg">
            <TabsTrigger
              value="generate"
              className="data-[state=active]:bg-blue-500 data-[state=active]:text-white rounded-md transition-all"
            >
              <Volume2 className="h-4 w-4 mr-1" />
              Generate
              {audioUrl && <span className="ml-1 text-xs">✓</span>}
            </TabsTrigger>
            <TabsTrigger
              value="record"
              className="data-[state=active]:bg-red-500 data-[state=active]:text-white rounded-md transition-all"
            >
              <Mic className="h-4 w-4 mr-1" />
              Record
              {recordedAudio && <span className="ml-1 text-xs">✓</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4">
            <div>
              <label className="text-sm font-medium">Text</label>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-md"
                placeholder="Enter text to generate speech"
              />
            </div>

            <div>
              <label className="text-sm font-medium">
                {t("contentEditor.generate.accent")}
              </label>
              <select
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-md"
              >
                {accents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">
                  {t("contentEditor.generate.gender")}
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                >
                  {genders.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">
                  {t("contentEditor.generate.speed")}
                </label>
                <select
                  value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border rounded-md"
                >
                  {speeds.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="flex-1 bg-yellow-500 hover:bg-yellow-600 dark:bg-yellow-400 dark:hover:bg-yellow-500 text-black"
                title={t("contentEditor.tooltips.ttsMicrosoftEdge")}
              >
                {isGenerating
                  ? t("contentEditor.generate.generating")
                  : t("contentEditor.generate.generate")}
              </Button>
              {audioUrl && (
                <Button
                  variant="outline"
                  onClick={handlePlayAudio}
                  size="icon"
                  className={`
                    border-2 transition-all duration-300
                    ${
                      showAudioAnimation
                        ? "border-green-500 bg-green-50 animate-bounce scale-110"
                        : "border-gray-300 hover:border-green-500 hover:bg-green-50"
                    }
                  `}
                  title={t("contentEditor.tooltips.playGeneratedAudio")}
                >
                  <Play
                    className={`h-4 w-4 ${showAudioAnimation ? "text-green-600" : "text-gray-600"}`}
                  />
                </Button>
              )}
            </div>

            {/* 音檔生成成功提示與管理 */}
            {audioUrl && (
              <div
                className={`mt-3 p-3 border rounded-lg transition-all duration-300 ${
                  showAudioAnimation
                    ? "bg-green-50 border-green-200 animate-pulse"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-700">
                    {showAudioAnimation && (
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <div
                          className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
                          style={{ animationDelay: "0.2s" }}
                        ></div>
                        <div
                          className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
                          style={{ animationDelay: "0.4s" }}
                        ></div>
                      </div>
                    )}
                    <Volume2 className="h-4 w-4 text-gray-600" />
                    <span className="text-sm font-medium">
                      {showAudioAnimation
                        ? t("contentEditor.messages.audioGenerated")
                        : t("contentEditor.messages.ttsAudioReady")}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAudioUrl("");
                      setSelectedSource(null);
                      toast.info(t("contentEditor.messages.ttsAudioDeleted"));
                    }}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {audioUrl && (
              <audio ref={audioRef} src={audioUrl} className="hidden" />
            )}
          </TabsContent>

          <TabsContent value="record" className="space-y-4">
            <div className="flex flex-col items-center justify-center py-8">
              <div className="mb-4">
                <div
                  className={`w-24 h-24 rounded-full flex items-center justify-center ${
                    isRecording ? "bg-red-100 animate-pulse" : "bg-gray-100"
                  }`}
                >
                  <Mic
                    className={`h-12 w-12 ${isRecording ? "text-red-600" : "text-gray-600"}`}
                  />
                </div>
              </div>

              {/* 顯示錄音時間 */}
              {isRecording && (
                <div className="mb-4 text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {Math.floor(recordingDuration / 60)
                      .toString()
                      .padStart(2, "0")}
                    :{(recordingDuration % 60).toString().padStart(2, "0")} /
                    00:30
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {t("contentEditor.messages.maxRecordingTime")}
                  </div>
                </div>
              )}

              {/* 顯示上傳狀態 */}
              {isUploading && (
                <div className="mb-4 text-center">
                  <div className="text-sm text-blue-600">
                    {t("contentEditor.messages.uploadingRecording")}
                  </div>
                </div>
              )}

              {!isRecording && !recordedAudio && !isUploading && (
                <Button onClick={handleStartRecording} size="lg">
                  <Mic className="h-5 w-5 mr-2" />
                  {t("contentEditor.buttons.startRecording")}
                </Button>
              )}

              {isRecording && (
                <Button
                  onClick={handleStopRecording}
                  variant="destructive"
                  size="lg"
                >
                  <Square className="h-5 w-5 mr-2" />
                  {t("contentEditor.buttons.stopRecording")}
                </Button>
              )}

              {recordedAudio && !isRecording && (
                <div className="space-y-4">
                  {/* 使用自定義播放按鈕避免瀏覽器相容性問題 */}
                  <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            if (!recordedAudio) {
                              toast.error(
                                t("contentEditor.messages.noRecordingToPlay"),
                              );
                              return;
                            }

                            const audio = new Audio(recordedAudio);
                            audio.play().catch((err) => {
                              console.error("Play failed:", err);
                              toast.error(
                                t("contentEditor.messages.cannotPlayRecording"),
                              );
                            });
                          }}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-2">
                          <Mic className="h-4 w-4 text-red-600" />
                          <span className="text-sm text-gray-700 font-medium">
                            {t("contentEditor.messages.recordingFileReady", {
                              duration: recordingDuration,
                            })}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRecordedAudio("");
                          setSelectedSource(null);
                          audioBlobRef.current = null;
                          setRecordingDuration(0);
                          recordingDurationRef.current = 0;
                          toast.info(
                            t("contentEditor.messages.recordingDeleted"),
                          );
                        }}
                        className="text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={handleStartRecording} variant="outline">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t("contentEditor.buttons.rerecord")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* 音源選擇（當兩種都有時） */}
        {audioUrl && recordedAudio && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm font-medium text-yellow-800 mb-3">
              🎵 {t("contentEditor.messages.selectAudioSourceToUse")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSelectedSource("tts")}
                className={`p-3 rounded-lg border-2 transition-all ${
                  selectedSource === "tts"
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 bg-white hover:border-gray-400"
                }`}
              >
                <Volume2
                  className={`h-5 w-5 mx-auto mb-1 ${
                    selectedSource === "tts" ? "text-blue-600" : "text-gray-600"
                  }`}
                />
                <div className="text-sm font-medium">
                  {t("contentEditor.audioSources.tts")}
                </div>
                <div className="text-xs text-gray-500">
                  {t("contentEditor.audioSources.aiGenerated")}
                </div>
              </button>

              <button
                onClick={() => setSelectedSource("recording")}
                className={`p-3 rounded-lg border-2 transition-all ${
                  selectedSource === "recording"
                    ? "border-red-500 bg-red-50"
                    : "border-gray-300 bg-white hover:border-gray-400"
                }`}
              >
                <Mic
                  className={`h-5 w-5 mx-auto mb-1 ${
                    selectedSource === "recording"
                      ? "text-red-600"
                      : "text-gray-600"
                  }`}
                />
                <div className="text-sm font-medium">
                  {t("contentEditor.audioSources.recording")}
                </div>
                <div className="text-xs text-gray-500">
                  {t("contentEditor.audioSources.teacherRecorded")}
                </div>
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleConfirm}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// SortableRowInner component with complete functionality
interface SortableRowInnerProps {
  row: ContentRow;
  index: number;
  handleUpdateRow: (
    index: number,
    field: keyof ContentRow,
    value: string,
  ) => void;
  handleRemoveRow: (index: number) => void;
  handleDuplicateRow: (index: number) => void;
  handleOpenTTSModal: (row: ContentRow) => void;
  handleRemoveAudio: (index: number) => void;
  handleGenerateSingleDefinition: (index: number) => Promise<void>;
  handleGenerateSingleDefinitionWithLang?: (
    index: number,
    lang: TranslationLanguage,
  ) => Promise<void>;
  rowsLength: number;
  panelTranslateLang?: TranslationLanguage | "";
  panelCustomLang?: string;
  duplicateReasons?: string[];
}

function SortableRowInner({
  row,
  index,
  handleUpdateRow,
  handleRemoveRow,
  handleDuplicateRow,
  handleOpenTTSModal,
  handleRemoveAudio,
  handleGenerateSingleDefinition,
  rowsLength,
  panelTranslateLang = "",
  panelCustomLang = "",
  duplicateReasons,
}: SortableRowInnerProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const autoHeightRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, []);

  const hasDuplicate = !!duplicateReasons && duplicateReasons.length > 0;
  // 只有當 row 有內容但單字數 <MIN 才標記（空 row 不標）
  const rowWordCount = row.text?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const tooFewWords =
    rowWordCount > 0 && rowWordCount < MIN_WORDS_PER_ITEM;
  const hasError = hasDuplicate || tooFewWords;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 rounded-lg ${
        hasError ? "bg-red-50 border-2 border-red-400" : "bg-gray-50"
      }`}
    >
      {/* Header: drag + index + error labels | Copy + Delete */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Drag handle - ONLY this triggers drag */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none"
            title={t("contentEditor.tooltips.dragToReorder")}
          >
            <GripVertical className="h-5 w-5 text-gray-400 hover:text-gray-700 transition-colors" />
          </div>
          <span className="text-sm font-medium text-gray-600">
            {index + 1}
          </span>
          {hasDuplicate && (
            <span className="text-xs text-red-600 font-medium">
              {t("contentEditor.messages.duplicateWord")}
            </span>
          )}
          {tooFewWords && (
            <span className="text-xs text-red-600 font-medium">
              {t("contentEditor.messages.wordsTooFewLabel", {
                limit: MIN_WORDS_PER_ITEM,
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleDuplicateRow(index)}
            className="p-1 rounded hover:bg-gray-200"
            title={t("contentEditor.tooltips.duplicate")}
          >
            <Copy className="h-4 w-4 text-gray-600" />
          </button>
          <button
            onClick={() => handleRemoveRow(index)}
            className={`p-1 rounded ${
              row.has_student_progress || rowsLength <= 1
                ? "cursor-not-allowed"
                : "hover:bg-gray-200"
            }`}
            title={
              row.has_student_progress
                ? t("contentEditor.tooltips.cannotDeleteWithProgress")
                : t("contentEditor.tooltips.delete")
            }
            disabled={rowsLength <= 1 || row.has_student_progress}
          >
            <Trash2
              className={`h-4 w-4 ${
                rowsLength <= 1 || row.has_student_progress
                  ? "text-gray-300"
                  : "text-gray-600"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Body: text + translation inputs */}
      <div className="space-y-2">
        {/* Text input */}
        <div className="relative">
          <textarea
            value={row.text}
            onChange={(e) => {
              const words = e.target.value.trim().split(/\s+/).filter(Boolean);
              if (words.length > 25) return;
              handleUpdateRow(index, "text", e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            ref={autoHeightRef}
            className="w-full px-3 py-2 pr-20 border rounded-md text-sm resize-y min-h-[38px] overflow-hidden"
            placeholder={t("contentEditor.placeholders.enterText")}
            rows={1}
          />
          <div className="absolute right-2 top-2 flex items-center space-x-1">
            {row.audioUrl && (
              <button
                onClick={() => {
                  if (!row.audioUrl) {
                    toast.error(t("contentEditor.messages.noRecordingToPlay"));
                    return;
                  }
                  const audio = new Audio(row.audioUrl);
                  audio.onerror = (e) => {
                    console.error("Audio playback error:", e);
                    toast.error(
                      t("contentEditor.messages.audioGeneratedSuccess"),
                    );
                  };
                  audio.play().catch((error) => {
                    console.error("Play failed:", error);
                    toast.error(
                      t("contentEditor.messages.cannotPlayRecording"),
                    );
                  });
                }}
                className="p-1 rounded text-green-600 hover:bg-green-100"
                title={t("contentEditor.tooltips.playAudio")}
              >
                <Play className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => handleOpenTTSModal(row)}
              className={`p-1 rounded ${
                row.audioUrl
                  ? "text-blue-600 hover:bg-blue-100"
                  : "text-gray-600 bg-yellow-100 hover:bg-yellow-200"
              }`}
              title={
                row.audioUrl
                  ? t("contentEditor.tooltips.rerecordOrGenerate")
                  : t("contentEditor.tooltips.openTTSRecording")
              }
            >
              <Mic className="h-4 w-4" />
            </button>
            {row.audioUrl && (
              <button
                onClick={() => handleRemoveAudio(index)}
                className="p-1 rounded text-red-600 hover:bg-red-100"
                title={t("contentEditor.tooltips.removeAudio")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Translation textarea */}
        <div className="space-y-2">
          <div className="relative">
            <textarea
              value={(() => {
                const lang = panelTranslateLang || row.selectedLanguage || "";
                if (lang === "chinese" || lang === "other" || lang === "")
                  return row.definition || "";
                if (lang === "japanese") return row.japanese_translation || "";
                if (lang === "korean") return row.korean_translation || "";
                return row.definition || "";
              })()}
              onChange={(e) => {
                const lang = panelTranslateLang || row.selectedLanguage || "";
                let field: keyof ContentRow = "definition";
                if (lang === "japanese") field = "japanese_translation";
                else if (lang === "korean") field = "korean_translation";
                handleUpdateRow(index, field, e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              ref={autoHeightRef}
              className="w-full px-3 py-2 pr-24 border rounded-md text-sm resize-y min-h-[38px] overflow-hidden"
              placeholder={(() => {
                const lang = panelTranslateLang || row.selectedLanguage || "";
                if (!lang) return t("contentEditor.labels.selectLanguage");
                if (lang === "other")
                  return (
                    panelCustomLang || t("contentEditor.labels.otherLanguage")
                  );
                const langConfig = TRANSLATION_LANGUAGES.find(
                  (l) => l.value === lang,
                );
                return `${t(`contentEditor.translationLanguages.${langConfig?.labelKey || "chinese"}`)}`;
              })()}
              rows={2}
              maxLength={500}
            />
            <div className="absolute right-2 top-2">
              <button
                onClick={() => handleGenerateSingleDefinition(index)}
                className="text-xs text-gray-400 hover:text-blue-500 hover:underline cursor-pointer transition-colors"
                title={t("contentEditor.messages.generatingTranslation")}
              >
                {(() => {
                  const lang = panelTranslateLang || row.selectedLanguage || "";
                  if (!lang) return t("contentEditor.labels.selectLanguage");
                  if (lang === "other")
                    return (
                      panelCustomLang || t("contentEditor.labels.otherLanguage")
                    );
                  const langConfig = TRANSLATION_LANGUAGES.find(
                    (l) => l.value === lang,
                  );
                  return langConfig
                    ? t(
                        `contentEditor.translationLanguages.${langConfig.labelKey}`,
                      )
                    : lang;
                })()}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface ReadingAssessmentPanelHandle {
  save: () => Promise<void>;
  isBusy: boolean;
}

interface ReadingAssessmentPanelProps {
  content?: { id?: number; title?: string; items?: ContentRow[] };
  editingContent?: { id?: number; title?: string; items?: ContentRow[] };
  onUpdateContent?: (content: Record<string, unknown>) => void;
  onSave?: () => void | Promise<void>;
  // Alternative props for ClassroomDetail usage
  lessonId?: number;
  programLevel?: string; // Program difficulty level for AI generation
  contentId?: number;
  onCancel?: () => void;
  isOpen?: boolean;
  isCreating?: boolean; // 是否為新增模式
  isAssignmentCopy?: boolean; // 是否為作業副本（需要特別處理刪除）
}

const ReadingAssessmentPanel = forwardRef<
  ReadingAssessmentPanelHandle,
  ReadingAssessmentPanelProps
>(function ReadingAssessmentPanel(
  {
    content,
    editingContent,
    onUpdateContent,
    onSave,
    lessonId,
    // programLevel - reserved for future AI generation features
    isCreating = false,
    isAssignmentCopy = false,
  },
  ref,
) {
  const { t } = useTranslation();
  const { setEditorBusy } = useSidebar();

  const [title, setTitle] = useState("");
  const [duplicateMap, setDuplicateMap] = useState<Map<number, string[]>>(
    new Map(),
  );
  const [rows, setRows] = useState<ContentRow[]>([
    {
      id: "1",
      text: "",
      definition: "",
      translation: "",
      selectedLanguage: undefined,
      example_sentence: "",
      example_sentence_translation: "",
      example_sentence_definition: "",
    },
    {
      id: "2",
      text: "",
      definition: "",
      translation: "",
      selectedLanguage: undefined,
      example_sentence: "",
      example_sentence_translation: "",
      example_sentence_definition: "",
    },
    {
      id: "3",
      text: "",
      definition: "",
      translation: "",
      selectedLanguage: undefined,
      example_sentence: "",
      example_sentence_translation: "",
      example_sentence_definition: "",
    },
  ]);
  const [selectedRow, setSelectedRow] = useState<ContentRow | null>(null);
  const [ttsModalOpen, setTtsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [batchPasteDialogOpen, setBatchPasteDialogOpen] = useState(false);
  const [batchPasteText, setBatchPasteText] = useState("");
  const [batchPasteAutoTTS, setBatchPasteAutoTTS] = useState(false);
  const [batchPasteAutoTranslate, setBatchPasteAutoTranslate] = useState(false);
  const [selectedTranslateLang, setSelectedTranslateLang] = useState<
    TranslationLanguage | ""
  >("");
  const [customTranslateLang, setCustomTranslateLang] = useState("");
  const [isInitialLoad, setIsInitialLoad] = useState(true); // 🔥 標記是否為初始載入

  // TTS settings for batch paste (Issue #121)
  const [batchTTSAccent, setBatchTTSAccent] = useState("Random");
  const [batchTTSGender, setBatchTTSGender] = useState("Random");
  const [batchTTSSpeed, setBatchTTSSpeed] = useState("Normal x1");
  const [isBatchGeneratingTTS, setIsBatchGeneratingTTS] = useState(false); // 批次生成 TTS 中
  const [isBatchGeneratingTranslation, setIsBatchGeneratingTranslation] =
    useState(false); // 批次生成翻譯中
  const [isPasting, setIsPasting] = useState(false); // 批次貼上中

  // 計算是否有批次操作正在進行
  const isBatchProcessing =
    isBatchGeneratingTTS || isBatchGeneratingTranslation || isPasting;

  // Sync batch state to SidebarContext.editorBusy so that RefSaveButton (and
  // sidebar close buttons) can reactively reflect busy state. Cleanup on
  // unmount prevents lock-out if panel closes mid-operation. (#651)
  useEffect(() => {
    setEditorBusy(isBatchProcessing);
    return () => setEditorBusy(false);
  }, [isBatchProcessing, setEditorBusy]);

  // Recalculate duplicates whenever rows change
  useEffect(() => {
    setDuplicateMap(findDuplicates(rows));
  }, [rows]);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Save handler - extracted for useImperativeHandle
  const handleSave = async () => {
    const validRows = rows.filter((row) => row.text && row.text.trim());

    if (validRows.length === 0) {
      toast.error(t("contentEditor.messages.addAtLeastOneItem"));
      return;
    }

    if (!title || title.trim() === "") {
      toast.error(t("contentEditor.messages.enterTitle"));
      return;
    }

    // 檢查單字數下限
    const underLimitRow = validRows.find((row) => {
      const words = row.text.trim().split(/\s+/).filter(Boolean);
      return words.length < MIN_WORDS_PER_ITEM;
    });
    if (underLimitRow) {
      toast.error(
        t("contentEditor.messages.wordLimitTooFew", {
          limit: MIN_WORDS_PER_ITEM,
        }),
      );
      return;
    }

    // 檢查單字數上限
    const overLimitRow = validRows.find((row) => {
      const words = row.text.trim().split(/\s+/).filter(Boolean);
      return words.length > 25;
    });
    if (overLimitRow) {
      toast.error(
        t("contentEditor.messages.wordLimitExceeded", { limit: 25 }),
      );
      return;
    }

    // 檢查重複
    const dupes = findDuplicates(validRows);
    if (dupes.size > 0) {
      setDuplicateMap(dupes);
      toast.error(t("contentEditor.messages.duplicateItems"));
      return;
    }

    // 修正句子之間缺少空格的問題（例如 "end.Begin" → "end. Begin"）
    const fixSentenceSpacing = (text: string) =>
      text.replace(/([.!?])([A-Z])/g, "$1 $2");

    const saveData = {
      title: title,
      items: validRows.map((row) => ({
        text: fixSentenceSpacing(row.text.trim()),
        definition: row.definition || "",
        english_definition: row.translation || "",
        translation: row.definition || "",
        selectedLanguage: row.selectedLanguage || "chinese",
        audio_url: row.audioUrl || row.audio_url || "",
      })),
      target_wpm: 60,
      target_accuracy: 0.8,
      time_limit_seconds: 180,
    };

    const existingContentId = editingContent?.id || content?.id;

    if (existingContentId) {
      try {
        await apiClient.updateContent(existingContentId, saveData);
        toast.success(t("contentEditor.messages.savingSuccess"));
        if (onSave) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (onSave as (content?: any) => void | Promise<void>)({
            id: existingContentId,
            title: saveData.title,
            items: saveData.items,
          });
        }
      } catch (error: unknown) {
        console.error("Failed to update content:", error);
        if (error instanceof ApiError) {
          const detail = error.detail;
          const errorMessage =
            typeof detail === "object" &&
            !Array.isArray(detail) &&
            detail?.message
              ? detail.message
              : typeof detail === "string"
                ? detail
                : null;
          toast.error(errorMessage || t("contentEditor.messages.savingFailed"));
        } else {
          toast.error(t("contentEditor.messages.savingFailed"));
        }
      }
    } else if (isCreating && lessonId) {
      try {
        const newContent = await apiClient.createContent(lessonId, {
          type: "EXAMPLE_SENTENCES",
          ...saveData,
        });
        toast.success(t("contentEditor.messages.contentCreatedSuccess"));
        if (onSave) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (onSave as (content?: any) => void | Promise<void>)(newContent);
        }
      } catch (error: unknown) {
        console.error("Failed to create content:", error);
        if (error instanceof ApiError) {
          const detail = error.detail;
          const errorMessage =
            typeof detail === "object" &&
            !Array.isArray(detail) &&
            detail?.message
              ? detail.message
              : typeof detail === "string"
                ? detail
                : null;
          toast.error(
            errorMessage || t("contentEditor.messages.creatingContentFailed"),
          );
        } else {
          toast.error(t("contentEditor.messages.creatingContentFailed"));
        }
      }
    }
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    get isBusy() {
      return isBatchProcessing;
    },
  }));

  // TTS options still used by handleBatchGenerateTTS logic

  // Load saved TTS settings from localStorage (Issue #121)
  useEffect(() => {
    const saved = localStorage.getItem("duotopia_batch_tts_settings");
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.accent) setBatchTTSAccent(settings.accent);
        if (settings.gender) setBatchTTSGender(settings.gender);
        if (settings.speed) setBatchTTSSpeed(settings.speed);
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save TTS settings to localStorage (Issue #121)
  // Note: "Random" is intentionally persisted as the user's preference,
  // so re-opening the panel preserves their intent to randomize.
  const saveBatchTTSSettings = () => {
    localStorage.setItem(
      "duotopia_batch_tts_settings",
      JSON.stringify({
        accent: batchTTSAccent,
        gender: batchTTSGender,
        speed: batchTTSSpeed,
      }),
    );
  };

  // Load existing content data from database
  useEffect(() => {
    if (content?.id) {
      setIsInitialLoad(true); // 🔥 標記為初始載入
      loadContentData();
    } else if (editingContent?.id) {
      // 🔥 如果有 editingContent，直接使用它（不需要重新載入）
      setIsInitialLoad(true);
      setTitle(editingContent.title || "");
      if (editingContent.items && Array.isArray(editingContent.items)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const convertedRows = (editingContent.items as any[]).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (item: any, index: number) => ({
            id: item.id || (index + 1).toString(),
            text: item.text || "",
            definition: item.definition || "",
            translation: item.translation || "",
            audioUrl: item.audio_url || "",
            selectedLanguage: undefined,
            has_student_progress: item.has_student_progress || false, // 🔥 保留學生進度狀態
          }),
        );
        setRows(convertedRows);
      }
      setIsLoading(false);
      setTimeout(() => {
        setIsInitialLoad(false);
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only reload when content ID changes, not on every editingContent mutation
  }, [content?.id, editingContent?.id]);

  const loadContentData = async () => {
    if (!content?.id) return;

    setIsLoading(true);
    try {
      const data = (await apiClient.getContentDetail(content.id)) as {
        title?: string;
        items?: Array<{
          text?: string;
          translation?: string;
          definition?: string;
          audio_url?: string;
        }>;
        level?: string;
        tags?: string[];
        is_public?: boolean;
        audio_urls?: string[];
      };
      setTitle(data.title || "");

      // Convert items to rows format
      if (data.items && Array.isArray(data.items)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const convertedRows = (data.items as any[]).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (item: any, index: number): ContentRow => {
            // Convert legacy "english" to "chinese" (default)
            const rawLang = item.selectedLanguage || "chinese";
            const savedLang: TranslationLanguage =
              rawLang === "english" ||
              rawLang === "chinese" ||
              rawLang === "japanese" ||
              rawLang === "korean"
                ? rawLang === "english"
                  ? "chinese"
                  : rawLang
                : "chinese";

            return {
              id: item.id || (index + 1).toString(),
              text: item.text || "",
              definition: item.definition || "", // 中文翻譯
              translation: item.english_definition || "", // 英文釋義
              audioUrl: item.audio_url || "",
              selectedLanguage: savedLang,
              japanese_translation: item.japanese_translation || "",
              korean_translation: item.korean_translation || "",
              example_sentence: item.example_sentence || "",
              example_sentence_translation:
                item.example_sentence_translation || "",
              example_sentence_definition:
                item.example_sentence_definition || "",
              has_student_progress: item.has_student_progress || false, // 🔥 保留學生進度狀態
            };
          },
        );
        setRows(convertedRows);
      }
    } catch (error) {
      console.error("Failed to load content:", error);
      toast.error(t("contentEditor.messages.loadingContentFailed"));
    } finally {
      setIsLoading(false);
      // 🔥 載入完成後，等待一個 tick 再標記為非初始載入
      setTimeout(() => {
        setIsInitialLoad(false);
      }, 100);
    }
  };

  // Update parent when data changes (但不包括初始載入)
  useEffect(() => {
    if (!onUpdateContent || isInitialLoad) return; // 🔥 初始載入時不觸發

    const items = rows.map((row) => ({
      text: row.text,
      definition: row.definition, // 中文翻譯
      translation: row.translation, // 英文釋義
      audio_url: row.audioUrl,
      selectedLanguage: row.selectedLanguage, // 記錄最後選擇的語言
      example_sentence: row.example_sentence,
      example_sentence_translation: row.example_sentence_translation,
      example_sentence_definition: row.example_sentence_definition,
    }));

    onUpdateContent({
      ...editingContent,
      title,
      items,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUpdateContent/editingContent excluded to prevent infinite update loop
  }, [rows, title, isInitialLoad]);

  // dnd-kit drag end handler
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setRows((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleAddRow = () => {
    if (rows.length >= MAX_ROWS) {
      toast.error(t("contentEditor.messages.maxRowsReached"));
      return;
    }
    // 找出最大的 ID 數字，然後加 1
    const maxId = Math.max(...rows.map((r) => parseInt(String(r.id)) || 0));
    const newRow: ContentRow = {
      id: (maxId + 1).toString(),
      text: "",
      definition: "",
      translation: "",
      selectedLanguage: undefined,
      example_sentence: "",
      example_sentence_translation: "",
      example_sentence_definition: "",
    };
    setRows([...rows, newRow]);
  };

  const handleDeleteRow = (index: number) => {
    if (rows.length <= 1) {
      toast.error(t("contentEditor.messages.minRowsRequired"));
      return;
    }

    // 檢查此題目是否有學生進度
    if (rows[index].has_student_progress) {
      toast.error(t("contentEditor.messages.cannotDeleteWithProgress"));
      return;
    }

    const newRows = rows.filter((_, i) => i !== index);
    setRows(newRows);
  };

  const handleCopyRow = (index: number) => {
    if (rows.length >= MAX_ROWS) {
      toast.error(t("contentEditor.messages.maxRowsReached"));
      return;
    }
    const rowToCopy = rows[index];
    // 找出最大的 ID 數字，然後加 1
    const maxId = Math.max(...rows.map((r) => parseInt(String(r.id)) || 0));
    const newRow: ContentRow = {
      ...rowToCopy,
      id: (maxId + 1).toString(),
    };
    const newRows = [...rows];
    newRows.splice(index + 1, 0, newRow);
    setRows(newRows);
  };

  const handleUpdateRow = (
    index: number,
    field: keyof ContentRow,
    value: string | "chinese" | "english",
  ) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    setRows(newRows);
  };

  const handleRemoveAudio = async (index: number) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], audioUrl: "" };
    setRows(newRows);

    // 如果是編輯模式，立即更新到後端
    if (!isCreating && editingContent?.id) {
      try {
        const items = newRows.map((row) => ({
          text: row.text,
          definition: row.definition,
          translation: row.translation,
          audio_url: row.audioUrl || "",
          selectedLanguage: row.selectedLanguage,
        }));

        await apiClient.updateContent(editingContent.id, {
          title: title || editingContent.title,
          items,
        });

        toast.success(t("contentEditor.messages.audioRemoved"));
      } catch (error: unknown) {
        console.error("Failed to remove audio:", error);
        // 解析 ApiError 的結構化錯誤訊息
        if (error instanceof ApiError) {
          const detail = error.detail;
          const errorMessage =
            typeof detail === "object" &&
            !Array.isArray(detail) &&
            detail?.message
              ? detail.message
              : typeof detail === "string"
                ? detail
                : null;
          toast.error(
            errorMessage || t("contentEditor.messages.removeAudioFailed"),
          );
        } else {
          toast.error(t("contentEditor.messages.removeAudioFailed"));
        }
        // 恢復原始狀態
        const originalRows = [...rows];
        setRows(originalRows);
      }
    } else {
      toast.info(t("contentEditor.messages.audioRemoved"));
    }
  };

  const handleOpenTTSModal = (row: ContentRow) => {
    setSelectedRow(row);
    setTtsModalOpen(true);
  };

  const handleTTSConfirm = async (
    audioUrl: string,
    settings: {
      accent?: string;
      gender?: string;
      speed?: string;
      source?: string;
      audioBlob?: Blob | null;
    },
  ) => {
    if (selectedRow) {
      const index = rows.findIndex((r) => r.id === selectedRow.id);
      if (index !== -1) {
        const newRows = [...rows];
        // 一個 item 只能有一種音檔來源（TTS 或錄音）
        newRows[index] = {
          ...newRows[index],
          audioUrl, // 新的音檔會覆蓋舊的
          audioSettings: {
            accent: settings.accent || "American English",
            gender: settings.gender || "Male",
            speed: settings.speed || "Normal x1",
          },
        };
        setRows(newRows);

        // 立即更新 content 並儲存到後端
        const items = newRows.map((row) => ({
          text: row.text,
          definition: row.definition, // 中文翻譯
          translation: row.translation, // 英文釋義
          audio_url: row.audioUrl || "",
          selectedLanguage: row.selectedLanguage, // 記錄最後選擇的語言
        }));

        // 新增模式：只更新本地狀態
        if (isCreating) {
          // 更新本地狀態
          if (onUpdateContent) {
            onUpdateContent({
              ...editingContent,
              title,
              items,
            });
          }
        } else if (editingContent?.id) {
          // 編輯模式：直接呼叫 API 更新
          try {
            const updateData = {
              title: title || editingContent?.title,
              items,
            };

            await apiClient.updateContent(editingContent.id, updateData);

            // 更新成功後，重新從後端載入內容以確保同步
            const response = await apiClient.getContentDetail(
              editingContent.id,
            );
            if (response && response.items) {
              const updatedRows = response.items.map(
                (
                  item: {
                    text?: string;
                    translation?: string;
                    definition?: string;
                    audio_url?: string;
                  },
                  index: number,
                ) => ({
                  id: String(index + 1),
                  text: item.text || "",
                  definition: item.translation || "",
                  audioUrl: item.audio_url || "",
                }),
              );
              setRows(updatedRows);
            }

            // 更新本地狀態
            if (onUpdateContent) {
              onUpdateContent({
                ...editingContent,
                title,
                items,
              });
            }
          } catch (error: unknown) {
            console.error("Failed to update content:", error);
            // 解析 ApiError 的結構化錯誤訊息
            if (error instanceof ApiError) {
              const detail = error.detail;
              const errorMessage =
                typeof detail === "object" &&
                !Array.isArray(detail) &&
                detail?.message
                  ? detail.message
                  : typeof detail === "string"
                    ? detail
                    : null;
              toast.error(
                errorMessage ||
                  t("contentEditor.messages.updateFailedButAudioGenerated"),
              );
            } else {
              toast.error(
                t("contentEditor.messages.updateFailedButAudioGenerated"),
              );
            }
          }
        }

        // 關閉 modal 但不要關閉 panel
        setTtsModalOpen(false);
        setSelectedRow(null);
      }
    }
  };

  const handleBatchGenerateTTS = async () => {
    // 收集需要生成 TTS 的文字
    const textsToGenerate = rows
      .filter((row) => row.text && !row.audioUrl)
      .map((row) => row.text);

    if (textsToGenerate.length === 0) {
      toast.info(t("contentEditor.messages.allItemsHaveAudio"));
      return;
    }

    setIsBatchGeneratingTTS(true);
    try {
      toast.info(
        t("contentEditor.messages.generatingAudioFiles", {
          count: textsToGenerate.length,
        }),
      );

      // 批次生成 TTS — Random 時每題不同語音
      const isRandom =
        batchTTSAccent === "Random" || batchTTSGender === "Random";
      const newRows = [...rows];

      if (isRandom) {
        // Per-item TTS with different random voices
        for (let i = 0; i < newRows.length; i++) {
          if (newRows[i].text && !newRows[i].audioUrl) {
            const { voice, rate } = getVoiceAndRate(
              batchTTSAccent,
              batchTTSGender,
              batchTTSSpeed,
            );
            const ttsResult = await apiClient.generateTTS(
              newRows[i].text,
              voice,
              rate,
              "+0%",
            );
            if (
              ttsResult &&
              typeof ttsResult === "object" &&
              "audio_url" in ttsResult
            ) {
              const audioUrl = (ttsResult as { audio_url: string }).audio_url;
              newRows[i].audioUrl = audioUrl.startsWith("http")
                ? audioUrl
                : `${import.meta.env.VITE_API_URL}${audioUrl}`;
            }
          }
        }
      } else {
        // Batch TTS with single voice
        const { voice, rate } = getVoiceAndRate(
          batchTTSAccent,
          batchTTSGender,
          batchTTSSpeed,
        );
        const result = await apiClient.batchGenerateTTS(
          textsToGenerate,
          voice,
          rate,
          "+0%",
        );

        if (
          result &&
          typeof result === "object" &&
          "audio_urls" in result &&
          Array.isArray(result.audio_urls)
        ) {
          let audioIndex = 0;
          for (let i = 0; i < newRows.length; i++) {
            if (newRows[i].text && !newRows[i].audioUrl) {
              const audioUrl = (result as { audio_urls: string[] }).audio_urls[
                audioIndex
              ];
              newRows[i].audioUrl = audioUrl.startsWith("http")
                ? audioUrl
                : `${import.meta.env.VITE_API_URL}${audioUrl}`;
              audioIndex++;
            }
          }
        }
      }

      setRows(newRows);

      // 立即更新 content 並儲存到後端（不要用 onSave 避免關閉 panel）
      const items = newRows.map((row) => ({
        text: row.text,
        definition: row.definition, // 中文翻譯
        translation: row.translation, // 英文釋義
        audio_url: row.audioUrl || "",
        selectedLanguage: row.selectedLanguage, // 記錄最後選擇的語言
      }));

      // 新增模式：只更新本地狀態，不呼叫 API
      if (isCreating) {
        if (onUpdateContent) {
          onUpdateContent({
            ...editingContent,
            title,
            items,
          });
        }

        toast.success(
          t("contentEditor.messages.audioGeneratedSuccessfully", {
            count: textsToGenerate.length,
          }),
        );
      } else if (editingContent?.id) {
        // 編輯模式：直接呼叫 API 更新
        try {
          const updateData = {
            title: title || editingContent?.title,
            items,
          };

          await apiClient.updateContent(editingContent.id, updateData);

          if (onUpdateContent) {
            onUpdateContent({
              ...editingContent,
              title,
              items,
            });
          }

          toast.success(
            t("contentEditor.messages.audioGeneratedAndSaved", {
              count: textsToGenerate.length,
            }),
          );
        } catch (error: unknown) {
          console.error("Failed to save TTS:", error);
          if (error instanceof ApiError) {
            const detail = error.detail;
            const errorMessage =
              typeof detail === "object" &&
              !Array.isArray(detail) &&
              detail?.message
                ? detail.message
                : typeof detail === "string"
                  ? detail
                  : null;
            toast.error(
              errorMessage ||
                t("contentEditor.messages.savingFailedButAudioGenerated"),
            );
          } else {
            toast.error(
              t("contentEditor.messages.savingFailedButAudioGenerated"),
            );
          }
        }
      } else {
        toast.success(
          t("contentEditor.messages.audioGeneratedSuccessfully", {
            count: textsToGenerate.length,
          }),
        );
      }
    } catch (error) {
      console.error("Batch TTS generation failed:", error);
      toast.error(t("contentEditor.messages.batchGenerationFailed"));
    } finally {
      setIsBatchGeneratingTTS(false);
    }
  };

  const handleGenerateSingleDefinition = async (index: number) => {
    const currentLang =
      rows[index].selectedLanguage || selectedTranslateLang || "chinese";
    return handleGenerateSingleDefinitionWithLang(
      index,
      currentLang as TranslationLanguage,
    );
  };

  const handleGenerateSingleDefinitionWithLang = async (
    index: number,
    targetLang: TranslationLanguage,
  ) => {
    const newRows = [...rows];
    if (!newRows[index].text) {
      toast.error(t("contentEditor.messages.enterTextFirst"));
      return;
    }

    const langConfig = TRANSLATION_LANGUAGES.find(
      (l) => l.value === targetLang,
    );
    toast.info(t("contentEditor.messages.generatingTranslation"));

    try {
      const response = (await apiClient.translateText(
        newRows[index].text,
        langConfig?.code || "zh-TW",
      )) as { translation: string };

      // 根據目標語言寫入對應欄位
      if (targetLang === "chinese") {
        newRows[index].definition = response.translation;
      } else if (targetLang === "japanese") {
        newRows[index].japanese_translation = response.translation;
      } else if (targetLang === "korean") {
        newRows[index].korean_translation = response.translation;
      }
      // 記錄最後選擇的語言
      newRows[index].selectedLanguage = targetLang;

      setRows(newRows);
      toast.success(t("contentEditor.messages.translationComplete"));
    } catch (error) {
      console.error("Translation error:", error);
      toast.error(t("contentEditor.messages.translationFailed"));
    }
  };

  const handleBatchGenerateDefinitions = async () => {
    // 收集需要翻譯的項目（現在同時翻譯兩種語言）
    const itemsToTranslate: { index: number; text: string }[] = [];

    rows.forEach((row, index) => {
      if (row.text && (!row.definition || !row.translation)) {
        itemsToTranslate.push({ index, text: row.text });
      }
    });

    if (itemsToTranslate.length === 0) {
      toast.info(t("contentEditor.messages.noItemsNeedTranslation"));
      return;
    }

    // 檢查是否超過上限
    if (itemsToTranslate.length > MAX_BATCH_ITEMS) {
      toast.error(
        t("contentEditor.messages.batchLimitError", { count: MAX_BATCH_ITEMS }),
      );
      return;
    }

    setIsBatchGeneratingTranslation(true);
    toast.info(t("contentEditor.messages.startingBatchTranslation"));
    const newRows = [...rows];

    try {
      // 收集需要中文翻譯的項目
      const needsChinese = itemsToTranslate.filter(
        (item) => !newRows[item.index].definition,
      );
      // 收集需要英文翻譯的項目
      const needsEnglish = itemsToTranslate.filter(
        (item) => !newRows[item.index].translation,
      );

      // 批次處理中文翻譯
      if (needsChinese.length > 0) {
        const chineseTexts = needsChinese.map((item) => item.text);
        const chineseResponse = await apiClient.batchTranslate(
          chineseTexts,
          "zh-TW",
        );
        const chineseTranslations =
          (chineseResponse as { translations?: string[] }).translations || [];

        needsChinese.forEach((item, idx) => {
          newRows[item.index].definition =
            chineseTranslations[idx] || item.text;
          // 不清空英文欄位，保留兩種語言
        });
      }

      // 批次處理英文釋義
      if (needsEnglish.length > 0) {
        const englishTexts = needsEnglish.map((item) => item.text);
        const englishResponse = await apiClient.batchTranslate(
          englishTexts,
          "en",
        );
        const englishTranslations =
          (englishResponse as { translations?: string[] }).translations || [];

        needsEnglish.forEach((item, idx) => {
          newRows[item.index].translation =
            englishTranslations[idx] || item.text;
          // 不清空中文欄位，保留兩種語言
        });
      }

      // 批次翻譯時預設使用中文
      itemsToTranslate.forEach((item) => {
        if (!newRows[item.index].selectedLanguage) {
          newRows[item.index].selectedLanguage = "chinese";
        }
      });

      setRows(newRows);
      toast.success(
        t("contentEditor.messages.batchTranslationComplete", {
          count: itemsToTranslate.length,
        }),
      );
    } catch (error) {
      console.error("Batch translation error:", error);
      toast.error(t("contentEditor.messages.batchTranslationFailed"));
    } finally {
      setIsBatchGeneratingTranslation(false);
    }
  };

  const handleBatchPaste = async (autoTTS: boolean, autoTranslate: boolean) => {
    // 分割文字，每行一個項目
    const rawLines = batchPasteText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // 1. 貼上框內部去重（忽略大小寫）
    const seen = new Set<string>();
    const deduped = rawLines.filter((l) => {
      const key = l.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const internalDupes = rawLines.length - deduped.length;

    // 2. 跟右側已有 row 去重
    const existingTexts = new Set(
      rows
        .filter((r) => r.text && r.text.trim())
        .map((r) => r.text.trim().toLowerCase()),
    );
    const lines = deduped.filter((l) => !existingTexts.has(l.toLowerCase()));
    const existingDupes = deduped.length - lines.length;

    // 提醒去重結果
    if (internalDupes > 0 || existingDupes > 0) {
      const msgs: string[] = [];
      if (internalDupes > 0)
        msgs.push(
          t("contentEditor.messages.removedInternalDupes", {
            count: internalDupes,
          }),
        );
      if (existingDupes > 0)
        msgs.push(
          t("contentEditor.messages.removedExistingDupes", {
            count: existingDupes,
          }),
        );
      toast.info(msgs.join("、"));
    }

    // === Backfill 模式：textarea 空白時，補齊已有項目缺少的翻譯/TTS ===
    // Backfill 模式只在貼上框本來就空白時觸發；若使用者有貼內容但全被去重掉，
    // 應顯示空結果提示而非進 Backfill。
    const isBackfillMode = lines.length === 0 && rawLines.length === 0;

    if (!isBackfillMode && lines.length === 0) {
      // 全部都是重複，前面的 toast.info 已顯示；直接結束
      return;
    }

    if (isBackfillMode) {
      const existingRows = rows.filter((r) => r.text && r.text.trim());
      if (existingRows.length === 0) {
        toast.error(t("contentEditor.messages.enterContent"));
        return;
      }

      // 檢查翻譯語言
      if (autoTranslate && !selectedTranslateLang) {
        toast.error(t("contentEditor.labels.selectLanguage"));
        return;
      }
      if (
        autoTranslate &&
        selectedTranslateLang === "other" &&
        !customTranslateLang.trim()
      ) {
        toast.error(t("contentEditor.labels.enterCustomLanguage"));
        return;
      }

      setIsPasting(true);
      const currentRows = [...rows];
      let processed = 0;

      try {
        // 補齊翻譯
        if (autoTranslate && selectedTranslateLang) {
          const langCode =
            selectedTranslateLang === "other"
              ? customTranslateLang || ""
              : TRANSLATION_LANGUAGES.find(
                  (l) => l.value === selectedTranslateLang,
                )?.code || "zh-TW";

          const needsTranslation = currentRows
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => r.text?.trim() && !r.definition?.trim());

          if (needsTranslation.length > 0) {
            const texts = needsTranslation.map(({ r }) => r.text.trim());
            const result = await apiClient.batchTranslate(texts, langCode);
            const translations =
              (result as { translations?: string[] }).translations || [];
            needsTranslation.forEach(({ i }, idx) => {
              if (translations[idx]) {
                currentRows[i].definition = translations[idx];
                currentRows[i].selectedLanguage = selectedTranslateLang;
              }
            });
            processed += needsTranslation.length;
          }
        }

        // 補齊 TTS
        if (autoTTS) {
          saveBatchTTSSettings();
          const needsTTS = currentRows
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => r.text?.trim() && !r.audioUrl && !r.audio_url);

          if (needsTTS.length > 0) {
            const isRandom =
              batchTTSAccent === "Random" || batchTTSGender === "Random";

            if (isRandom) {
              for (const { r, i } of needsTTS) {
                const { voice, rate } = getVoiceAndRate(
                  batchTTSAccent,
                  batchTTSGender,
                  batchTTSSpeed,
                );
                const ttsResult = await apiClient.generateTTS(
                  r.text,
                  voice,
                  rate,
                  "+0%",
                );
                if (ttsResult?.audio_url) {
                  const fullUrl = ttsResult.audio_url.startsWith("http")
                    ? ttsResult.audio_url
                    : `${import.meta.env.VITE_API_URL}${ttsResult.audio_url}`;
                  currentRows[i].audioUrl = fullUrl;
                  currentRows[i].audio_url = fullUrl;
                }
              }
            } else {
              const { voice, rate } = getVoiceAndRate(
                batchTTSAccent,
                batchTTSGender,
                batchTTSSpeed,
              );
              const texts = needsTTS.map(({ r }) => r.text.trim());
              const ttsResult = await apiClient.batchGenerateTTS(
                texts,
                voice,
                rate,
                "+0%",
              );
              if (
                ttsResult &&
                typeof ttsResult === "object" &&
                "audio_urls" in ttsResult
              ) {
                const audioUrls = (ttsResult as { audio_urls: string[] })
                  .audio_urls;
                needsTTS.forEach(({ i }, idx) => {
                  if (audioUrls[idx]) {
                    const fullUrl = audioUrls[idx].startsWith("http")
                      ? audioUrls[idx]
                      : `${import.meta.env.VITE_API_URL}${audioUrls[idx]}`;
                    currentRows[i].audioUrl = fullUrl;
                    currentRows[i].audio_url = fullUrl;
                  }
                });
              }
            }
            processed += needsTTS.length;
          }
        }

        setRows(currentRows);

        if (processed === 0) {
          toast.info(
            t("contentEditor.messages.noItemsNeedProcessing", {
              defaultValue: "所有項目已完成，無需補齊",
            }),
          );
        } else {
          toast.success(
            t("contentEditor.messages.backfillComplete", {
              defaultValue: `已補齊 ${processed} 個項目`,
              count: processed,
            }),
          );
        }
      } catch (error) {
        console.error("Backfill error:", error);
        toast.error(t("contentEditor.messages.batchProcessingFailed"));
      } finally {
        setIsPasting(false);
      }
      return;
    }

    // === 正常貼上模式 ===

    // 勾了翻譯但沒選語言
    if (autoTranslate && !selectedTranslateLang) {
      toast.error(t("contentEditor.labels.selectLanguage"));
      return;
    }

    // 選了「其他」但沒輸入語言名稱
    if (
      autoTranslate &&
      selectedTranslateLang === "other" &&
      !customTranslateLang.trim()
    ) {
      toast.error(t("contentEditor.labels.enterCustomLanguage"));
      return;
    }

    // 計算還能新增幾題（扣除現有非空白題目）
    const nonEmptyCount = rows.filter(
      (row) => row.text && row.text.trim(),
    ).length;
    const remaining = MAX_ROWS - nonEmptyCount;

    if (remaining <= 0) {
      toast.error(t("contentEditor.messages.maxRowsReached"));
      return;
    }

    // 超過剩餘可用數量時自動截斷
    if (lines.length > remaining) {
      toast.warning(
        t("contentEditor.messages.batchLimitTruncated", {
          count: remaining,
        }),
      );
      lines.length = remaining;
    }

    setIsPasting(true);
    toast.info(
      t("contentEditor.messages.processingItems", { count: lines.length }),
    );

    // 清除空白 items
    const nonEmptyRows = rows.filter((row) => row.text && row.text.trim());

    // 建立新 items
    let newItems: ContentRow[] = lines.map((text, index) => ({
      id: `batch-${Date.now()}-${index}`,
      text,
      definition: "",
      translation: "",
      selectedLanguage: undefined,
      example_sentence: "",
      example_sentence_translation: "",
      example_sentence_definition: "",
    }));

    // 批次處理 TTS 和翻譯
    if (autoTTS || autoTranslate) {
      try {
        if (autoTTS) {
          saveBatchTTSSettings();

          const isRandom =
            batchTTSAccent === "Random" || batchTTSGender === "Random";

          if (isRandom) {
            // Random 模式：每題個別生成，確保口音/性別不同
            for (let i = 0; i < newItems.length; i++) {
              const { voice, rate } = getVoiceAndRate(
                batchTTSAccent,
                batchTTSGender,
                batchTTSSpeed,
              );
              const ttsResult = await apiClient.generateTTS(
                newItems[i].text,
                voice,
                rate,
                "+0%",
              );
              if (ttsResult?.audio_url) {
                const fullUrl = ttsResult.audio_url.startsWith("http")
                  ? ttsResult.audio_url
                  : `${import.meta.env.VITE_API_URL}${ttsResult.audio_url}`;
                newItems[i] = {
                  ...newItems[i],
                  audioUrl: fullUrl,
                  audio_url: fullUrl,
                };
              }
            }
          } else {
            // 固定口音/性別：批次生成
            const { voice, rate } = getVoiceAndRate(
              batchTTSAccent,
              batchTTSGender,
              batchTTSSpeed,
            );
            const ttsResult = await apiClient.batchGenerateTTS(
              lines,
              voice,
              rate,
              "+0%",
            );
            if (
              ttsResult &&
              typeof ttsResult === "object" &&
              "audio_urls" in ttsResult
            ) {
              const audioUrls = (ttsResult as { audio_urls: string[] })
                .audio_urls;
              newItems = newItems.map((item, i) => ({
                ...item,
                audioUrl: audioUrls[i]?.startsWith("http")
                  ? audioUrls[i]
                  : `${import.meta.env.VITE_API_URL}${audioUrls[i]}`,
                audio_url: audioUrls[i]?.startsWith("http")
                  ? audioUrls[i]
                  : `${import.meta.env.VITE_API_URL}${audioUrls[i]}`,
              }));
            }
          }
        }

        if (autoTranslate && selectedTranslateLang) {
          const langCode =
            selectedTranslateLang === "other"
              ? customTranslateLang || ""
              : TRANSLATION_LANGUAGES.find(
                  (l) => l.value === selectedTranslateLang,
                )?.code || "zh-TW";
          const result = await apiClient.batchTranslate(lines, langCode);
          const translations =
            (result as { translations?: string[] }).translations || result;
          if (Array.isArray(translations)) {
            newItems = newItems.map((item, i) => ({
              ...item,
              definition: translations[i] || "",
              selectedLanguage: selectedTranslateLang,
            }));
          }
        }
      } catch (error) {
        console.error("Batch processing error:", error);
        toast.error(t("contentEditor.messages.batchProcessingFailed"));
        setIsPasting(false);
        return;
      }
    }

    // 合併新舊項目
    const updatedRows = [...nonEmptyRows, ...newItems];

    // 更新前端狀態
    setRows(updatedRows);

    const existingContentId = editingContent?.id || content?.id;

    if (existingContentId) {
      // 編輯模式：直接儲存到資料庫
      try {
        const saveData = {
          title: title,
          items: updatedRows.map((row) => ({
            text: row.text.trim(),
            definition: row.definition || "",
            english_definition: row.translation || "",
            translation: row.definition || "",
            selectedLanguage: row.selectedLanguage || "chinese",
            audio_url: row.audioUrl || row.audio_url || "",
          })),
          target_wpm: 60,
          target_accuracy: 0.8,
          time_limit_seconds: 180,
        };

        await apiClient.updateContent(existingContentId, saveData);
        toast.success(
          t("contentEditor.messages.itemsAddedAndSaved", {
            added: lines.length,
            total: updatedRows.length,
          }),
        );
      } catch (error) {
        console.error("Failed to save batch paste:", error);
        toast.error(t("contentEditor.messages.batchProcessingFailed"));
        setIsPasting(false);
        return;
      }
    } else {
      // 新增模式：只更新本地狀態，不儲存到資料庫
      // 使用者需要按「儲存」按鈕才會真正創建內容
      if (onUpdateContent) {
        onUpdateContent({
          ...editingContent,
          title,
          items: updatedRows.map((row) => ({
            text: row.text,
            definition: row.definition,
            translation: row.translation,
            audio_url: row.audioUrl || row.audio_url || "",
            selectedLanguage: row.selectedLanguage,
          })),
        });
      }
      toast.success(
        t("contentEditor.messages.itemsAddedSaveToComplete", {
          added: lines.length,
          total: updatedRows.length,
        }),
      );
    }

    setIsPasting(false);
    setBatchPasteDialogOpen(false);
    setBatchPasteText("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">
            {t("contentEditor.messages.loading")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-70px)]">
      {/* Fixed Header Section */}
      <div className="flex-shrink-0 space-y-4 pb-4">
        {/* Assignment Copy Warning Banner */}
        {isAssignmentCopy && (
          <div className="bg-orange-50 border-l-4 border-orange-400 p-4 rounded-md">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-orange-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-orange-800">
                  <span className="font-medium">
                    {t("contentEditor.warnings.assignmentCopy")}
                  </span>
                  <br />
                  {t("contentEditor.warnings.assignmentCopyDescription")}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Title Input - Show in both create and edit mode */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">
            {t("contentEditor.labels.title")}{" "}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("contentEditor.placeholders.enterContentTitle")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Batch Actions - Mobile only (desktop uses left panel) */}
        <div className="flex flex-wrap gap-2 md:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBatchPasteDialogOpen(true)}
            disabled={isBatchProcessing}
            className="bg-blue-100 hover:bg-blue-200 border-blue-300 disabled:opacity-50"
            title={t("readingAssessmentPanel.batchActions.batchPasteTooltip")}
          >
            <Clipboard className="h-4 w-4 mr-1" />
            {t("readingAssessmentPanel.batchActions.batchPaste")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBatchGenerateTTS}
            disabled={isBatchProcessing}
            className="bg-yellow-100 hover:bg-yellow-200 border-yellow-300 disabled:opacity-50"
            title={t(
              "readingAssessmentPanel.batchActions.batchGenerateTTSTooltip",
            )}
          >
            {isBatchGeneratingTTS ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4 mr-1" />
            )}
            {isBatchGeneratingTTS
              ? t("readingAssessmentPanel.batchActions.generatingTTS")
              : t("readingAssessmentPanel.batchActions.batchGenerateTTS")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBatchGenerateDefinitions()}
            disabled={isBatchProcessing}
            className="bg-green-100 hover:bg-green-200 border-green-300 disabled:opacity-50"
            title={t(
              "readingAssessmentPanel.batchActions.batchGenerateTranslationTooltip",
            )}
          >
            {isBatchGeneratingTranslation ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Globe className="h-4 w-4 mr-1" />
            )}
            {isBatchGeneratingTranslation
              ? t("readingAssessmentPanel.batchActions.generatingTranslation")
              : t(
                  "readingAssessmentPanel.batchActions.batchGenerateTranslation",
                )}
          </Button>
        </div>
      </div>

      {/* Desktop: Side-by-side layout / Mobile: Editor only */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left: Batch Work Area (Desktop only) */}
        <BatchWorkPanel
          text={batchPasteText}
          onTextChange={setBatchPasteText}
          maxItems={MAX_BATCH_ITEMS}
          placeholder="put&#10;Put it away.&#10;It's time to put everything away. Right now."
          autoTranslate={batchPasteAutoTranslate}
          onAutoTranslateChange={setBatchPasteAutoTranslate}
          selectedLanguage={selectedTranslateLang}
          onLanguageChange={(lang) => {
            setSelectedTranslateLang(lang as TranslationLanguage | "");
            if (lang !== "other") setCustomTranslateLang("");
          }}
          translationLanguages={TRANSLATION_LANGUAGES.map((l) => ({
            value: l.value,
            label: t(`contentEditor.translationLanguages.${l.labelKey}`),
            code: l.code,
          }))}
          customLanguage={customTranslateLang}
          onCustomLanguageChange={setCustomTranslateLang}
          autoTTS={batchPasteAutoTTS}
          onAutoTTSChange={setBatchPasteAutoTTS}
          ttsSettings={{
            accent: batchTTSAccent,
            gender: batchTTSGender,
            speed: batchTTSSpeed,
          }}
          onTTSSettingsChange={(s) => {
            setBatchTTSAccent(s.accent);
            setBatchTTSGender(s.gender);
            setBatchTTSSpeed(s.speed);
          }}
          onConfirm={() =>
            handleBatchPaste(batchPasteAutoTTS, batchPasteAutoTranslate)
          }
          isBusy={isPasting}
        />

        {/* Right: Editor Area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Scrollable Content Rows with dnd-kit */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={rows.map((row) => row.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3 pr-2">
                {rows.map((row, index) => {
                  // useSortable must be called inside the component that's in SortableContext
                  // so we'll use a nested component
                  return (
                    <SortableRowInner
                      key={row.id}
                      row={row}
                      index={index}
                      handleUpdateRow={handleUpdateRow}
                      handleRemoveRow={handleDeleteRow}
                      handleDuplicateRow={handleCopyRow}
                      handleOpenTTSModal={handleOpenTTSModal}
                      handleRemoveAudio={handleRemoveAudio}
                      handleGenerateSingleDefinition={
                        handleGenerateSingleDefinition
                      }
                      handleGenerateSingleDefinitionWithLang={
                        handleGenerateSingleDefinitionWithLang
                      }
                      rowsLength={rows.length}
                      panelTranslateLang={selectedTranslateLang}
                      panelCustomLang={customTranslateLang}
                      duplicateReasons={duplicateMap.get(index)}
                    />
                  );
                })}

                {/* Add Row Button */}
                <button
                  onClick={handleAddRow}
                  className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 flex items-center justify-center gap-2 text-gray-600 hover:text-blue-600"
                  disabled={rows.length >= MAX_ROWS}
                >
                  <Plus className="h-5 w-5" />
                  {t("contentEditor.buttons.addItem")}
                </button>
              </div>
            </SortableContext>
          </DndContext>
        </div>
        {/* End Right: Editor Area */}
      </div>
      {/* End Desktop: Side-by-side layout */}

      {/* TTS Modal */}
      {selectedRow && (
        <TTSModal
          open={ttsModalOpen}
          onClose={() => setTtsModalOpen(false)}
          row={selectedRow}
          onConfirm={handleTTSConfirm}
          contentId={editingContent?.id}
          itemIndex={rows.findIndex((r) => r.id === selectedRow.id)}
          isCreating={isCreating}
        />
      )}

      {/* Batch Paste Dialog */}
      <Dialog
        open={batchPasteDialogOpen}
        onOpenChange={(open) => {
          if (!isPasting) setBatchPasteDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader className="pb-4 flex-shrink-0">
            <DialogTitle className="text-2xl font-bold text-gray-900">
              {t("contentEditor.modals.batchPasteTitle")}
            </DialogTitle>
            <p className="text-sm text-gray-500 mt-2">
              {t("contentEditor.modals.batchPasteSubtitle")}
            </p>
          </DialogHeader>
          <div className="space-y-6 overflow-y-auto flex-1 min-h-0">
            <BatchPasteArea
              text={batchPasteText}
              onChange={setBatchPasteText}
              maxItems={MAX_BATCH_ITEMS}
              placeholder="put&#10;Put it away.&#10;It's time to put everything away. Right now."
              variant="dialog"
            />
            <div className="flex gap-6 p-4 bg-gray-50 rounded-lg">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchPasteAutoTTS}
                  onChange={(e) => setBatchPasteAutoTTS(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-base font-medium text-gray-700">
                  {t("contentEditor.checkboxes.autoGenerateTTS")}
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchPasteAutoTranslate}
                  onChange={(e) => setBatchPasteAutoTranslate(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-base font-medium text-gray-700">
                  {t("contentEditor.checkboxes.autoTranslate")}
                </span>
              </label>
            </div>

            {/* TTS Settings Section (Issue #121) */}
            {batchPasteAutoTTS && (
              <BatchTTSSettings
                settings={{
                  accent: batchTTSAccent,
                  gender: batchTTSGender,
                  speed: batchTTSSpeed,
                }}
                onChange={(s) => {
                  setBatchTTSAccent(s.accent);
                  setBatchTTSGender(s.gender);
                  setBatchTTSSpeed(s.speed);
                }}
                variant="section"
              />
            )}
          </div>
          <DialogFooter className="pt-6 flex-shrink-0 border-t border-gray-200 mt-4">
            <Button
              variant="outline"
              onClick={() => setBatchPasteDialogOpen(false)}
              disabled={isPasting}
              className="px-6 py-2 text-base"
            >
              {t("contentEditor.buttons.cancel")}
            </Button>
            <Button
              onClick={() =>
                handleBatchPaste(batchPasteAutoTTS, batchPasteAutoTranslate)
              }
              disabled={isPasting}
              className="px-6 py-2 text-base bg-blue-600 hover:bg-blue-700"
            >
              {isPasting
                ? t("contentEditor.buttons.generating")
                : t("contentEditor.buttons.confirmPaste")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

export default ReadingAssessmentPanel;
