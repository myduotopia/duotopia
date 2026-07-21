import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useTranslation } from "react-i18next";
import { useSidebar } from "@/contexts/SidebarContext";
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
  Image as ImageIcon,
  X,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import MagicPasteDialog from "@/components/shared/MagicPasteDialog";
import MagicPasteInput, {
  type MagicPasteItem,
} from "@/components/shared/MagicPasteInput";
import { retryAudioUpload } from "@/utils/retryHelper";
import {
  TTS_ACCENTS,
  TTS_GENDERS,
  TTS_SPEEDS,
  getVoiceAndRate,
} from "@/utils/ttsVoiceResolver";
import {
  BatchWorkPanel,
  BatchPasteArea,
  BatchTTSSettings,
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

// 詞性列表
// value 用全名存資料庫，label 用縮寫顯示
const PARTS_OF_SPEECH = [
  { value: "noun", label: "n.", fullName: "noun" },
  { value: "verb", label: "v.", fullName: "verb" },
  { value: "adjective", label: "adj.", fullName: "adjective" },
  { value: "adverb", label: "adv.", fullName: "adverb" },
  { value: "pronoun", label: "pron.", fullName: "pronoun" },
  { value: "preposition", label: "prep.", fullName: "preposition" },
  { value: "conjunction", label: "conj.", fullName: "conjunction" },
  { value: "interjection", label: "interj.", fullName: "interjection" },
  { value: "determiner", label: "det.", fullName: "determiner" },
  { value: "auxiliary", label: "aux.", fullName: "auxiliary" },
] as const;

/**
 * 將縮寫詞性轉換為完整名稱
 * 例如："n." -> "noun", "v." -> "verb"
 */
const convertAbbreviatedPOS = (abbreviatedList: string[]): string[] => {
  return abbreviatedList
    .map((abbr) => {
      // 先嘗試找縮寫對應的完整名稱
      const found = PARTS_OF_SPEECH.find(
        (pos) => pos.label === abbr || pos.label === abbr + ".",
      );
      if (found) return found.value;
      // 如果已經是完整名稱就直接返回
      const isFullName = PARTS_OF_SPEECH.find((pos) => pos.value === abbr);
      if (isFullName) return abbr;
      return null;
    })
    .filter((v): v is string => v !== null);
};

/**
 * 解析 AI 回傳的多個定義
 * 支援格式：
 *   - 編號換行：  "1. (n.) ...\n2. (n.) ..."
 *   - 編號同行：  "1. (v.) 探す  2. (v.) 求める"
 *   - POS 換行：  "(v.) 수행하다\n(v.) 공연하다\n(v.) 연기하다"
 *   - POS 同行：  "(v.) 수행하다  (v.) 공연하다"
 * 回傳各定義字串陣列；若只有 1 個定義則回傳空陣列（不需選擇）
 */
const parseMultipleDefinitions = (text: string): string[] => {
  const numbered = /^\d+\.\s/;
  const posStart = /^\(\w+\.\)\s/;

  // 1) 換行分割 → 編號格式
  let parts = text
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => numbered.test(s));
  if (parts.length > 1) return parts;

  // 2) 同行分割 → 編號格式
  parts = text
    .split(/(?=\d+\.\s)/)
    .map((s) => s.trim())
    .filter((s) => numbered.test(s));
  if (parts.length > 1) return parts;

  // 3) 換行分割 → POS 開頭格式 (無編號)
  parts = text
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => posStart.test(s));
  if (parts.length > 1) return parts;

  // 4) 同行分割 → POS 開頭格式 (無編號)
  parts = text
    .split(/(?=\(\w+\.\)\s)/)
    .map((s) => s.trim())
    .filter((s) => posStart.test(s));
  if (parts.length > 1) return parts;

  return [];
};

/**
 * 從翻譯結果中提取 POS 並清理文字
 * 輸入: "1. (v.) to recognize..." 或 "(n.) 蘋果" 或 "蘋果"
 * 回傳: { text: "to recognize...", pos: "v." } 或 { text: "蘋果", pos: null }
 */
const extractPosFromTranslation = (
  raw: string,
): { text: string; pos: string | null } => {
  // 先去掉編號 "1. "
  let text = raw.replace(/^\d+\.\s*/, "");
  // 提取詞性 (v.) (n.) (adj.) 等
  const posMatch = text.match(/^\((\w+\.)\)\s*/);
  if (posMatch) {
    text = text.replace(/^\(\w+\.\)\s*/, "");
    return { text, pos: posMatch[1] };
  }
  return { text, pos: null };
};

/**
 * 批次翻譯用：若有多義，只取第一個定義並提取 POS
 */
const extractFirstDefinition = (
  raw: string,
): { text: string; pos: string | null } => {
  const multiDefs = parseMultipleDefinitions(raw);
  const first = multiDefs.length > 0 ? multiDefs[0] : raw;
  return extractPosFromTranslation(first);
};

// 單字翻譯語言選項（含英文）
type WordTranslationLanguage =
  | "chinese"
  | "english"
  | "japanese"
  | "korean"
  | "other";

const WORD_TRANSLATION_LANGUAGES = [
  { value: "chinese" as const, label: "中文", code: "zh-TW" },
  { value: "english" as const, label: "English", code: "en" },
  { value: "japanese" as const, label: "日本語", code: "ja" },
  { value: "korean" as const, label: "한국어", code: "ko" },
  { value: "other" as const, label: "Other", code: "" },
];

// 例句翻譯語言選項（不含英文）
type SentenceTranslationLanguage = "chinese" | "japanese" | "korean";

const SENTENCE_TRANSLATION_LANGUAGES = [
  { value: "chinese" as const, label: "中文", code: "zh-TW" },
  { value: "japanese" as const, label: "日本語", code: "ja" },
  { value: "korean" as const, label: "한국어", code: "ko" },
];

// 批次貼上上限 (#422)
const BATCH_PASTE_MAX = 30;

/**
 * 檢測重複的行 index（單字完全相同 或 翻譯完全相同）
 * 回傳 Map<index, reasons[]>，例如 { 0: ["單字重複: zebra"], 1: ["單字重複: zebra"] }
 */
function findDuplicates(
  rows: { text: string; definition: string }[],
): Map<number, string[]> {
  const dupes = new Map<number, string[]>();
  const textMap = new Map<string, number[]>();
  const defMap = new Map<string, number[]>();

  rows.forEach((row, i) => {
    const text = row.text?.trim().toLowerCase();
    const def = row.definition?.trim().toLowerCase();

    if (text) {
      if (!textMap.has(text)) textMap.set(text, []);
      textMap.get(text)!.push(i);
    }
    if (def) {
      if (!defMap.has(def)) defMap.set(def, []);
      defMap.get(def)!.push(i);
    }
  });

  for (const [word, indices] of textMap.entries()) {
    if (indices.length > 1) {
      indices.forEach((i) => {
        if (!dupes.has(i)) dupes.set(i, []);
        dupes.get(i)!.push(word);
      });
    }
  }
  for (const [def, indices] of defMap.entries()) {
    if (indices.length > 1) {
      indices.forEach((i) => {
        if (!dupes.has(i)) dupes.set(i, []);
        dupes.get(i)!.push(def);
      });
    }
  }

  return dupes;
}

interface ContentRow {
  id: string | number; // 本地用（React key / drag-drop），非 DB id
  // #861: 既有題目的真實 DB ContentItem id；新題目為 undefined。存檔時帶回後端，
  // 後端據此原地更新而非全刪重建，學生作答紀錄才不會失聯。
  dbId?: number;
  text: string;
  definition: string; // 中文翻譯
  audioUrl?: string;
  audio_url?: string;
  imageUrl?: string; // 單字圖片 URL
  translation?: string; // 英文釋義
  japanese_translation?: string; // 日文翻譯
  korean_translation?: string; // 韓文翻譯
  selectedWordLanguage?: WordTranslationLanguage; // 單字翻譯語言
  selectedSentenceLanguage?: SentenceTranslationLanguage; // 例句翻譯語言
  partsOfSpeech?: string[]; // 詞性陣列（可複選）
  audioSettings?: {
    accent: string;
    gender: string;
    speed: string;
  };
  // Example sentence fields
  example_sentence?: string;
  example_sentence_translation?: string; // 例句中文翻譯
  example_sentence_japanese?: string; // 例句日文翻譯
  example_sentence_korean?: string; // 例句韓文翻譯
  example_sentence_audio_url?: string; // 例句音檔 URL
  // Issue #632: 單字克漏字答案（例句中要被挖空的單字/片語的實際變體）
  cloze_answer?: string;
  // 干擾項（單字選擇題用）
  // Issue #631 / #729: canonical shape is { text, image_url }. Legacy data may
  // still be string[]; both shapes flow through unchanged so we don't drop
  // image_url on round-trip.
  distractors?: Distractor[];
}

export type Distractor = string | { text: string; image_url?: string | null };

interface ApiContentItem {
  id?: number; // #861: 真實 DB ContentItem id，存檔時帶回供後端原地更新
  text?: string;
  definition?: string;
  audio_url?: string;
  image_url?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
  parts_of_speech?: string[];
  distractors?: Distractor[];
  vocabulary_translation?: string;
  vocabulary_translation_lang?: WordTranslationLanguage;
  example_sentence_translation_lang?: SentenceTranslationLanguage;
  english_definition?: string;
  selectedWordLanguage?: WordTranslationLanguage;
  translation?: string;
  japanese_translation?: string;
  korean_translation?: string;
  example_sentence_japanese?: string;
  example_sentence_korean?: string;
  example_sentence_audio_url?: string;
  cloze_answer?: string;
  selectedSentenceLanguage?: SentenceTranslationLanguage;
}

// Must stay in sync with the API response shape — used by every reload path to avoid silently dropping fields.
function mapApiItemToRow(item: ApiContentItem, index: number): ContentRow {
  let definition = "";
  let translation = "";
  let japanese_translation = "";
  let korean_translation = "";
  let selectedWordLanguage: WordTranslationLanguage = "chinese";

  if (item.vocabulary_translation_lang && item.vocabulary_translation) {
    selectedWordLanguage = item.vocabulary_translation_lang;
    definition = item.definition || "";
    if (selectedWordLanguage === "chinese") {
      definition = item.vocabulary_translation;
    } else if (selectedWordLanguage === "english") {
      translation = item.vocabulary_translation;
    } else if (selectedWordLanguage === "japanese") {
      japanese_translation = item.vocabulary_translation;
    } else if (selectedWordLanguage === "korean") {
      korean_translation = item.vocabulary_translation;
    }
  } else {
    definition = item.definition || "";
  }

  let example_sentence_translation = "";
  let example_sentence_japanese = "";
  let example_sentence_korean = "";
  let selectedSentenceLanguage: SentenceTranslationLanguage = "chinese";

  if (
    item.example_sentence_translation_lang &&
    item.example_sentence_translation
  ) {
    selectedSentenceLanguage = item.example_sentence_translation_lang;
    if (item.example_sentence_translation_lang === "chinese") {
      example_sentence_translation = item.example_sentence_translation;
    } else if (item.example_sentence_translation_lang === "japanese") {
      example_sentence_japanese = item.example_sentence_translation;
    } else if (item.example_sentence_translation_lang === "korean") {
      example_sentence_korean = item.example_sentence_translation;
    }
  } else {
    example_sentence_translation = item.example_sentence_translation || "";
    example_sentence_japanese = item.example_sentence_japanese || "";
    example_sentence_korean = item.example_sentence_korean || "";
    selectedSentenceLanguage = item.selectedSentenceLanguage || "chinese";
  }

  return {
    id: (index + 1).toString(),
    dbId: item.id, // #861: 保留真實 DB id 供存檔時帶回
    text: item.text || "",
    definition,
    translation,
    japanese_translation,
    korean_translation,
    audioUrl: item.audio_url || "",
    imageUrl: item.image_url || "",
    selectedWordLanguage,
    selectedSentenceLanguage,
    example_sentence: item.example_sentence || "",
    example_sentence_translation,
    example_sentence_japanese,
    example_sentence_korean,
    example_sentence_audio_url: item.example_sentence_audio_url || "",
    cloze_answer: item.cloze_answer || "",
    partsOfSpeech: item.parts_of_speech || [],
    distractors: item.distractors,
  };
}

function getDistractorText(d: Distractor): string {
  if (typeof d === "string") return d;
  return d?.text ?? "";
}

function getDistractorImage(d: Distractor): string | null {
  if (typeof d === "string") return null;
  return d?.image_url ?? null;
}

function setDistractorText(d: Distractor, text: string): Distractor {
  if (typeof d === "string") return text;
  return { ...d, text };
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

        // 創建本地 URL 供預覽播放（先釋放舊的 object URL）
        setRecordedAudio((prev) => {
          if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
          return URL.createObjectURL(audioBlob);
        });
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
                          setRecordedAudio((prev) => {
                            if (prev && prev.startsWith("blob:"))
                              URL.revokeObjectURL(prev);
                            return "";
                          });
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

// Issue #632: 單字克漏字答案編輯器。
// 例句以「純文字」呈現，可自由圈選（不再把每個字做成按鈕，避免片語圈選卡頓）：
//   - 單字：點兩下（double-click，瀏覽器會自動選取該字）即成為答案
//   - 片語：圈選文字後點「新增答案」按鈕即成為答案
// 答案會在例句中以高亮標示。空白時提示老師補齊（派發 word_cloze 作業的前提）。
interface ClozeAnswerEditorProps {
  sentence: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ClozeAnswerEditor({
  sentence,
  value,
  onChange,
  disabled = false,
}: ClozeAnswerEditorProps) {
  const { t } = useTranslation();

  const answer = (value || "").trim();
  const lowerSentence = sentence.toLowerCase();
  const matchStart = answer ? lowerSentence.indexOf(answer.toLowerCase()) : -1;
  const matchEnd = matchStart >= 0 ? matchStart + answer.length : -1;
  const hasHighlight = matchStart >= 0;

  // 取得目前選取的文字，驗證它確實出現在例句中後設為答案（保留例句原始大小寫）。
  const commitSelection = (showErrors: boolean): boolean => {
    if (disabled) return false;
    const selected = window.getSelection()?.toString().trim() || "";
    if (!selected) {
      if (showErrors) toast.error(t("vocabularySet.cloze.noSelection"));
      return false;
    }
    const idx = lowerSentence.indexOf(selected.toLowerCase());
    if (idx < 0) {
      if (showErrors)
        toast.error(t("vocabularySet.cloze.selectionNotInSentence"));
      return false;
    }
    onChange(sentence.slice(idx, idx + selected.length));
    return true;
  };

  // 點兩下：瀏覽器會自動選取整個單字，直接採用為答案（不跳錯誤）。
  const handleDoubleClick = () => {
    commitSelection(false);
  };

  return (
    <div
      className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-lg"
      data-testid="cloze-editor"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-purple-700">
          {t("vocabularySet.cloze.label")}
        </span>
        {answer ? (
          <span
            className="text-xs px-2 py-0.5 rounded bg-purple-200 text-purple-800 font-semibold"
            data-testid="cloze-current"
          >
            {answer}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange("")}
                className="ml-1 text-purple-600 hover:text-purple-900"
                title={t("vocabularySet.cloze.clear")}
                data-testid="cloze-clear"
              >
                ×
              </button>
            )}
          </span>
        ) : (
          <span
            className="text-xs text-amber-600"
            data-testid="cloze-empty-hint"
          >
            {t("vocabularySet.cloze.emptyHint")}
          </span>
        )}
      </div>

      <div
        className="text-sm leading-7 select-text cursor-text"
        data-testid="cloze-sentence"
        onDoubleClick={handleDoubleClick}
      >
        {hasHighlight ? (
          <>
            <span>{sentence.slice(0, matchStart)}</span>
            <mark
              className="bg-purple-300 text-purple-900 font-semibold rounded px-0.5"
              data-testid="cloze-highlight"
            >
              {sentence.slice(matchStart, matchEnd)}
            </mark>
            <span>{sentence.slice(matchEnd)}</span>
          </>
        ) : (
          <span>{sentence}</span>
        )}
      </div>

      {!disabled && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => commitSelection(true)}
            className="text-xs px-2 py-1 rounded border border-purple-300 text-purple-700 hover:bg-purple-100"
            data-testid="cloze-use-selection"
          >
            {t("vocabularySet.cloze.usePhrase")}
          </button>
          <span className="text-xs text-gray-500">
            {t("vocabularySet.cloze.hint")}
          </span>
        </div>
      )}
    </div>
  );
}

// SortableRowInner component with complete functionality
interface SortableRowInnerProps {
  row: ContentRow;
  index: number;
  handleUpdateRow: (
    index: number,
    field: keyof ContentRow,
    value: string | string[] | Distractor[],
  ) => void;
  handleRemoveRow: (index: number) => void;
  handleDuplicateRow: (index: number) => void;
  handleOpenTTSModal: (row: ContentRow) => void;
  handleRemoveAudio: (index: number) => void;
  handleImageUpload: (index: number, file: File) => Promise<void>;
  handleRemoveImage: (index: number) => void;
  handleGenerateSingleDefinition: (index: number) => Promise<void>;
  handleGenerateSingleDefinitionWithLang: (
    index: number,
    lang: WordTranslationLanguage,
  ) => Promise<void>;
  handleGenerateExampleTranslation: (index: number) => Promise<void>;
  handleGenerateExampleTranslationWithLang: (
    index: number,
    lang: SentenceTranslationLanguage,
  ) => Promise<void>;
  handleOpenAIGenerateModal: (index: number | null) => void;
  rowsLength: number;
  imageUploading?: boolean;
  // 剪貼簿貼上圖片功能
  isActive?: boolean;
  onRowFocus?: () => void;
  onWordLanguageChange?: (lang: WordTranslationLanguage) => void;
  isAssignmentCopy?: boolean; // 是否為作業副本（顯示干擾項編輯）
  showOptionImages?: boolean; // Issue #729: 派發時若勾選顯示選項圖片，干擾項唯讀
  duplicateReasons?: string[]; // 重複的原因
  customTranslationLang?: string; // 自訂翻譯語言名稱
  sentenceTranslationLang?: string; // 例句翻譯語言
  customSentenceTranslationLang?: string; // 自訂例句翻譯語言
}

function SortableRowInner({
  row,
  index,
  handleUpdateRow,
  handleRemoveRow,
  handleDuplicateRow,
  handleOpenTTSModal,
  handleRemoveAudio,
  handleImageUpload,
  handleRemoveImage,
  handleGenerateSingleDefinition,
  handleGenerateSingleDefinitionWithLang:
    _handleGenerateSingleDefinitionWithLang,
  handleGenerateExampleTranslation,
  handleGenerateExampleTranslationWithLang:
    _handleGenerateExampleTranslationWithLang,
  handleOpenAIGenerateModal,
  rowsLength,
  imageUploading,
  isActive = false,
  onRowFocus,
  onWordLanguageChange: _onWordLanguageChange,
  isAssignmentCopy = false,
  showOptionImages = false,
  duplicateReasons,
  customTranslationLang = "",
  sentenceTranslationLang: _sentenceTranslationLang = "",
  customSentenceTranslationLang: _customSentenceLang = "",
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

  const inlineAudioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup audio on unmount to prevent background playback
  useEffect(() => {
    return () => {
      inlineAudioRef.current?.pause();
      inlineAudioRef.current = null;
    };
  }, []);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // 偵測作業系統，用於顯示對應的截圖提示
  const getScreenshotHint = (): string => {
    // 手機版不顯示提示（sm breakpoint = 640px）
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      return "";
    }
    // 偵測作業系統
    if (typeof navigator !== "undefined") {
      const platform = navigator.platform?.toLowerCase() || "";
      const userAgent = navigator.userAgent?.toLowerCase() || "";
      if (platform.includes("mac") || userAgent.includes("mac")) {
        return t("vocabularySet.image.macScreenshotHint");
      }
      if (platform.includes("win") || userAgent.includes("win")) {
        return t("vocabularySet.image.windowsScreenshotHint");
      }
    }
    return "";
  };

  // 處理詞性切換
  const handleTogglePartOfSpeech = (pos: string) => {
    const currentPOS = row.partsOfSpeech || [];
    const newPOS = currentPOS.includes(pos)
      ? currentPOS.filter((p) => p !== pos)
      : [...currentPOS, pos];
    handleUpdateRow(index, "partsOfSpeech", newPOS);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-4 rounded-lg transition-all cursor-pointer ${
        duplicateReasons && duplicateReasons.length > 0
          ? "bg-red-50 border-2 border-red-400"
          : isActive
            ? "bg-blue-50 border-l-4 border-l-blue-500"
            : "bg-gray-50"
      }`}
      onClick={onRowFocus}
    >
      {/* 頂部：拖曳手把 + 序號 + 動作按鈕 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Drag handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none"
            title={t("contentEditor.tooltips.dragToReorder")}
          >
            <GripVertical className="h-5 w-5 text-gray-400 hover:text-gray-700 transition-colors" />
          </div>
          <span className="text-sm font-medium text-gray-600">{index + 1}</span>
          {duplicateReasons && duplicateReasons.length > 0 && (
            <span className="text-xs text-red-500 font-medium">
              {t("contentEditor.messages.duplicateWord")}:{" "}
              {duplicateReasons.join(", ")}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* Audio controls */}
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
                  toast.error(t("contentEditor.messages.cannotPlayRecording"));
                });
              }}
              className="p-1.5 rounded text-green-600 hover:bg-green-100"
              title={t("contentEditor.tooltips.playAudio")}
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => handleOpenTTSModal(row)}
            className={`p-1.5 rounded ${
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
              className="p-1.5 rounded text-red-600 hover:bg-red-100"
              title={t("contentEditor.tooltips.removeAudio")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="w-px h-4 bg-gray-300 mx-1" />
          <button
            onClick={() => handleDuplicateRow(index)}
            className="p-1.5 rounded hover:bg-gray-200"
            title={t("contentEditor.tooltips.duplicate")}
          >
            <Copy className="h-4 w-4 text-gray-600" />
          </button>
          <button
            onClick={() => handleRemoveRow(index)}
            className="p-1.5 rounded hover:bg-gray-200"
            title={t("contentEditor.tooltips.delete")}
            disabled={rowsLength <= 1}
          >
            <Trash2
              className={`h-4 w-4 ${rowsLength <= 1 ? "text-gray-300" : "text-gray-600"}`}
            />
          </button>
        </div>
      </div>

      {/* 第一列：英文單字 + 翻譯（同一列，flex-wrap） */}
      <div className="flex flex-wrap gap-2 mb-3">
        {/* 英文單字 input - 限制 50 字元 */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={row.text}
            onChange={(e) => handleUpdateRow(index, "text", e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm"
            placeholder={t("vocabularySet.placeholders.enterEnglishWord")}
            maxLength={50}
          />
        </div>

        {/* 翻譯 input */}
        <div className="flex-1 min-w-[200px] relative">
          <input
            type="text"
            value={(() => {
              const lang = row.selectedWordLanguage || "chinese";
              if (lang === "chinese") return row.definition || "";
              if (lang === "english") return row.translation || "";
              if (lang === "japanese") return row.japanese_translation || "";
              if (lang === "korean") return row.korean_translation || "";
              return row.definition || "";
            })()}
            onChange={(e) => {
              const lang = row.selectedWordLanguage || "chinese";
              let field: keyof ContentRow = "definition";
              if (lang === "english") field = "translation";
              else if (lang === "japanese") field = "japanese_translation";
              else if (lang === "korean") field = "korean_translation";
              handleUpdateRow(index, field, e.target.value);
            }}
            className="w-full px-3 py-2 pr-24 border rounded-md text-sm"
            placeholder={t("vocabularySet.placeholders.translation", {
              lang: t(
                `contentEditor.translationLanguages.${WORD_TRANSLATION_LANGUAGES.find((l) => l.value === (row.selectedWordLanguage || "chinese"))?.value || "chinese"}`,
              ),
            })}
            maxLength={200}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
            <button
              onClick={() => handleGenerateSingleDefinition(index)}
              className="text-xs text-gray-400 hover:text-blue-500 hover:underline cursor-pointer transition-colors"
              title={t("vocabularySet.tooltips.generateTranslation", {
                lang:
                  row.selectedWordLanguage === "other"
                    ? customTranslationLang || "..."
                    : WORD_TRANSLATION_LANGUAGES.find(
                        (l) =>
                          l.value === (row.selectedWordLanguage || "chinese"),
                      )?.label,
              })}
            >
              {row.selectedWordLanguage === "other"
                ? customTranslationLang || "..."
                : WORD_TRANSLATION_LANGUAGES.find(
                    (l) => l.value === (row.selectedWordLanguage || "chinese"),
                  )?.label}
            </button>
          </div>
        </div>
      </div>

      {/* 第二列：詞性選擇 Chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        {PARTS_OF_SPEECH.map((pos) => {
          const isSelected = (row.partsOfSpeech || []).includes(pos.value);
          return (
            <button
              key={pos.value}
              onClick={() => handleTogglePartOfSpeech(pos.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isSelected
                  ? "bg-gradient-to-r from-cyan-400 to-teal-400 text-white shadow-sm"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
              title={pos.fullName}
            >
              {pos.label}
            </button>
          );
        })}
      </div>

      {/* 圖片上傳區域 */}
      <div className="mb-3">
        {row.imageUrl ? (
          <div className="relative inline-block">
            <img
              src={row.imageUrl}
              alt={row.text || "word image"}
              className="h-20 w-20 object-cover rounded-lg border border-gray-300"
            />
            <button
              onClick={() => handleRemoveImage(index)}
              className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
              title={t("vocabularySet.image.remove")}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <label
            className={`inline-flex items-center gap-2 px-3 py-2 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
              imageUploading
                ? "opacity-50 cursor-not-allowed border-gray-300"
                : isActive
                  ? "border-blue-400 bg-blue-50 hover:bg-blue-100"
                  : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
            }`}
            title={isActive ? getScreenshotHint() : ""}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              disabled={imageUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleImageUpload(index, file);
                }
                // Reset input so same file can be selected again
                e.target.value = "";
              }}
            />
            {imageUploading ? (
              <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
            ) : (
              <ImageIcon
                className={`h-4 w-4 ${isActive ? "text-blue-500" : "text-gray-500"}`}
              />
            )}
            <span
              className={`text-sm ${isActive ? "text-blue-600" : "text-gray-600"}`}
            >
              {imageUploading ? (
                t("vocabularySet.image.uploading")
              ) : isActive ? (
                <>
                  <span className="hidden sm:inline">
                    {t("vocabularySet.image.pasteShortcut")}
                  </span>
                  {t("vocabularySet.image.clickToUpload")}
                </>
              ) : (
                t("vocabularySet.image.upload")
              )}
            </span>
          </label>
        )}
      </div>

      {/* 第三列：例句輸入（帶 AI 按鈕 + 音檔按鈕） */}
      <div className="relative mb-2">
        <input
          type="text"
          value={row.example_sentence || ""}
          onChange={(e) =>
            handleUpdateRow(index, "example_sentence", e.target.value)
          }
          className="w-full px-3 py-2 pr-24 border rounded-md text-sm"
          placeholder={t("vocabularySet.placeholders.enterEnglishSentence")}
          maxLength={500}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {/* 例句音檔播放 */}
          {row.example_sentence_audio_url && (
            <button
              onClick={() => {
                // Stop any currently playing audio before starting new one
                if (inlineAudioRef.current) {
                  inlineAudioRef.current.pause();
                  inlineAudioRef.current = null;
                }
                const audio = new Audio(row.example_sentence_audio_url);
                inlineAudioRef.current = audio;
                audio.play().catch((err) => console.error("Play failed:", err));
              }}
              className="p-1 rounded text-green-600 hover:bg-green-100"
              title={t("contentEditor.tooltips.playAudio")}
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          {/* 例句 TTS 生成 */}
          {row.example_sentence && (
            <button
              onClick={async () => {
                if (!row.example_sentence) return;
                // Stop any currently playing audio before regenerating
                inlineAudioRef.current?.pause();
                inlineAudioRef.current = null;
                const { voice, rate } = getVoiceAndRate(
                  row.audioSettings?.accent || "American English",
                  row.audioSettings?.gender || "Male",
                  row.audioSettings?.speed || "Normal x1",
                );
                try {
                  const result = await apiClient.generateTTS(
                    row.example_sentence,
                    voice,
                    rate,
                    "+0%",
                  );
                  if (result?.audio_url) {
                    handleUpdateRow(
                      index,
                      "example_sentence_audio_url",
                      result.audio_url,
                    );
                    toast.success(
                      t("contentEditor.messages.audioGeneratedSuccess"),
                    );
                  }
                } catch (err) {
                  console.error("TTS generation failed:", err);
                  toast.error(
                    t("contentEditor.messages.audioGenerationFailed"),
                  );
                }
              }}
              className={`p-1 rounded ${
                row.example_sentence_audio_url
                  ? "text-blue-500 hover:bg-blue-100"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
              title={
                row.example_sentence_audio_url
                  ? t("contentEditor.tooltips.rerecordOrGenerate")
                  : t("contentEditor.tooltips.openTTSRecording")
              }
            >
              <Mic className="h-3 w-3" />
            </button>
          )}
          {/* 例句音檔刪除 */}
          {row.example_sentence_audio_url && (
            <button
              onClick={() => {
                handleUpdateRow(index, "example_sentence_audio_url", "");
              }}
              className="p-1 rounded text-red-500 hover:bg-red-100"
              title={t("contentEditor.tooltips.removeAudio")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <div className="w-px h-3 bg-gray-300" />
          {/* AI 例句生成 */}
          <button
            onClick={() => handleOpenAIGenerateModal(index)}
            className="p-1 rounded hover:bg-blue-100 text-blue-600 border border-blue-300"
            title={t("vocabularySet.tooltips.generateExampleSentence")}
          >
            <span className="text-xs font-medium">AI</span>
          </button>
        </div>
      </div>

      {/* 第四列：例句翻譯 */}
      <div className="relative">
        <input
          type="text"
          value={(() => {
            const lang = row.selectedSentenceLanguage || "chinese";
            if (lang === "chinese")
              return row.example_sentence_translation || "";
            if (lang === "japanese") return row.example_sentence_japanese || "";
            if (lang === "korean") return row.example_sentence_korean || "";
            return row.example_sentence_translation || "";
          })()}
          onChange={(e) => {
            const lang = row.selectedSentenceLanguage || "chinese";
            let field: keyof ContentRow = "example_sentence_translation";
            if (lang === "japanese") field = "example_sentence_japanese";
            else if (lang === "korean") field = "example_sentence_korean";
            handleUpdateRow(index, field, e.target.value);
          }}
          className="w-full px-3 py-2 pr-24 border rounded-md text-sm"
          placeholder={t("vocabularySet.placeholders.exampleTranslation", {
            lang: t(
              `contentEditor.translationLanguages.${SENTENCE_TRANSLATION_LANGUAGES.find((l) => l.value === (row.selectedSentenceLanguage || "chinese"))?.value || "chinese"}`,
            ),
          })}
          maxLength={500}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
          <button
            type="button"
            onClick={() => handleGenerateExampleTranslation(index)}
            className="text-xs text-gray-400 hover:text-blue-500 hover:underline cursor-pointer transition-colors"
            title={t("vocabularySet.tooltips.generateExampleTranslation", {
              lang: SENTENCE_TRANSLATION_LANGUAGES.find(
                (l) => l.value === (row.selectedSentenceLanguage || "chinese"),
              )?.label,
            })}
          >
            {SENTENCE_TRANSLATION_LANGUAGES.find(
              (l) => l.value === (row.selectedSentenceLanguage || "chinese"),
            )?.label || ""}
          </button>
        </div>
      </div>

      {/* Issue #632: 單字克漏字答案編輯（有例句時才顯示）
        老師可點擊單字或框選片語設為克漏字答案；作業副本同樣可調整。 */}
      {row.example_sentence && row.example_sentence.trim() && (
        <ClozeAnswerEditor
          sentence={row.example_sentence}
          value={row.cloze_answer || ""}
          onChange={(v) => handleUpdateRow(index, "cloze_answer", v)}
        />
      )}

      {/* 干擾項編輯區塊（僅在作業副本模式 + 有干擾項時顯示）
        Issue #729: distractors may be legacy string[] or { text, image_url }[].
        When showOptionImages=true the snapshotted images are committed and
        the panel renders read-only; otherwise text inputs preserve image_url
        on edit by only mutating the .text field of the object shape. */}
      {isAssignmentCopy && row.distractors && row.distractors.length > 0 && (
        <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-orange-600" />
            <span className="text-xs font-semibold text-orange-800">
              {t("vocabularySet.distractors.label", {
                defaultValue: "干擾項（單字選擇題的錯誤選項）",
              })}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {row.distractors.map((distractor, dIdx) => {
              const text = getDistractorText(distractor);
              const imageUrl = getDistractorImage(distractor);

              if (showOptionImages) {
                return (
                  <div
                    key={dIdx}
                    className="flex-1 min-w-[120px] flex items-center gap-2 px-2 py-1.5 border border-gray-200 rounded-md bg-gray-50 text-sm"
                  >
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={text}
                        className="h-10 w-10 object-cover rounded border border-gray-200 flex-shrink-0"
                      />
                    )}
                    <span className="truncate text-gray-700">{text}</span>
                  </div>
                );
              }

              return (
                <input
                  key={dIdx}
                  type="text"
                  value={text}
                  onChange={(e) => {
                    const newDistractors = [...(row.distractors || [])];
                    newDistractors[dIdx] = setDistractorText(
                      distractor,
                      e.target.value,
                    );
                    handleUpdateRow(index, "distractors", newDistractors);
                  }}
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                  placeholder={t("vocabularySet.distractors.placeholder", {
                    defaultValue: `干擾項 ${dIdx + 1}`,
                    number: dIdx + 1,
                  })}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export interface VocabularySetPanelHandle {
  save: () => Promise<void>;
  isBusy: boolean;
}

interface VocabularySetPanelProps {
  content?: { id?: number; title?: string; items?: ContentRow[] };
  editingContent?: { id?: number; title?: string; items?: ContentRow[] };
  onUpdateContent?: (content: Record<string, unknown>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave?: (content?: any) => void | Promise<void>;
  // Alternative props for ClassroomDetail usage
  lessonId?: number;
  // Issue #587: programId is set (and lessonId omitted) when creating
  // content directly under a program (no lesson).
  programId?: number;
  programLevel?: string; // Program difficulty level for AI generation
  onCancel?: () => void;
  isOpen?: boolean;
  isCreating?: boolean; // 是否為新增模式
  isAssignmentCopy?: boolean; // 是否為作業副本（顯示干擾項編輯）
  showOptionImages?: boolean; // Issue #729: 派發時若啟用顯示選項圖片，干擾項唯讀
}

const VocabularySetPanel = forwardRef<
  VocabularySetPanelHandle,
  VocabularySetPanelProps
>(function VocabularySetPanel(
  {
    content,
    editingContent,
    onUpdateContent,
    onSave,
    lessonId,
    programId,
    programLevel,
    isCreating = false,
    isAssignmentCopy = false,
    showOptionImages = false,
  },
  ref,
) {
  const { t } = useTranslation();
  const { setEditorBusy } = useSidebar();

  const [title, setTitle] = useState("");
  // 記住用戶最後選擇的翻譯語言，批次翻譯時使用
  const [lastSelectedWordLang, setLastSelectedWordLang] = useState<
    WordTranslationLanguage | ""
  >("");
  const [customTranslationLang, setCustomTranslationLang] = useState("");
  const [rows, setRows] = useState<ContentRow[]>([
    {
      id: "1",
      text: "",
      definition: "",
      translation: "",
      imageUrl: "",
      selectedWordLanguage: "chinese",
      example_sentence: "",
      example_sentence_translation: "",
    },
    {
      id: "2",
      text: "",
      definition: "",
      translation: "",
      imageUrl: "",
      selectedWordLanguage: "chinese",
      example_sentence: "",
      example_sentence_translation: "",
    },
    {
      id: "3",
      text: "",
      definition: "",
      translation: "",
      imageUrl: "",
      selectedWordLanguage: "chinese",
      example_sentence: "",
      example_sentence_translation: "",
    },
  ]);
  const [selectedRow, setSelectedRow] = useState<ContentRow | null>(null);
  const [ttsModalOpen, setTtsModalOpen] = useState(false);
  // 追蹤當前編輯的行索引（用於剪貼簿貼上圖片）
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [batchPasteDialogOpen, setBatchPasteDialogOpen] = useState(false);
  // 魔術貼上（issue #891）
  const [magicPasteOpen, setMagicPasteOpen] = useState(false);
  const [batchPasteText, setBatchPasteText] = useState("");
  const [batchPasteAutoTTS, setBatchPasteAutoTTS] = useState(true);
  const [batchPasteAutoTranslate, setBatchPasteAutoTranslate] = useState(true);
  const [isBatchPasting, setIsBatchPasting] = useState(false);

  // Sync batch-paste state to SidebarContext.editorBusy so that RefSaveButton
  // (and sidebar close buttons) can reactively reflect busy state. Cleanup on
  // unmount prevents lock-out if panel closes mid-operation. (#651)
  useEffect(() => {
    setEditorBusy(isBatchPasting);
    return () => setEditorBusy(false);
  }, [isBatchPasting, setEditorBusy]);
  const [batchProgress, setBatchProgress] = useState<{
    completedItems: number;
    totalItems: number;
    completedSteps: number;
    totalSteps: number;
  } | null>(null);
  const batchPauseRef = useRef(false);
  // 魔術貼上插入後補洞用的一次性旗標（issue #891）：翻譯 + 詞性 + 例句翻譯 + 語音
  const magicGapFillRef = useRef(false);
  const magicPosFillRef = useRef(false);
  const magicExampleFillRef = useRef(false);
  const magicTtsFillRef = useRef(false);
  const [duplicateMap, setDuplicateMap] = useState<Map<number, string[]>>(
    new Map(),
  );

  // #582: 例句翻譯語言由造句元件獨立控制，不再與單字翻譯語言連動

  // Recalculate duplicates whenever rows change
  useEffect(() => {
    setDuplicateMap(findDuplicates(rows));
  }, [rows]);

  // TTS settings for batch paste (Issue #121)
  const [batchTTSAccent, setBatchTTSAccent] = useState("Random");
  const [batchTTSGender, setBatchTTSGender] = useState("Random");
  const [batchTTSSpeed, setBatchTTSSpeed] = useState("Normal x1");

  // 多義 Picker 狀態（英英釋義 / 中文翻譯皆可）
  const [definitionPicker, setDefinitionPicker] = useState<{
    rowIndex: number;
    word: string;
    options: string[];
    targetLang: WordTranslationLanguage;
  } | null>(null);

  // AI 生成例句對話框狀態
  const [aiGenerateModalOpen, setAiGenerateModalOpen] = useState(false);
  const [aiGenerateExpanded, setAiGenerateExpanded] = useState(true);
  const [aiGenerateTargetIndex, setAiGenerateTargetIndex] = useState<
    number | null
  >(null); // null 表示批次生成
  const [aiGenerateLevel, setAiGenerateLevel] = useState<string>(
    programLevel || "A1",
  ); // 🔥 階段2：預設使用 Program level
  const [aiGeneratePrompt, setAiGeneratePrompt] = useState("");
  const [aiGenerateTranslateLang, setAiGenerateTranslateLang] =
    useState<string>("");
  const [customSentenceTranslationLang, setCustomSentenceTranslationLang] =
    useState("");
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

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

      // 預設使用課程難度
      if (data.level) {
        setAiGenerateLevel(data.level);
      }

      // Convert items to rows format
      if (data.items && Array.isArray(data.items)) {
        const convertedRows = data.items.map((item, index) =>
          mapApiItemToRow(item as ApiContentItem, index),
        );
        setRows(convertedRows);

        // 從既有資料初始化翻譯語言，避免儲存時被預設的 "chinese" 覆蓋（#366）
        const firstLang = convertedRows[0]?.selectedWordLanguage;
        if (firstLang) {
          setLastSelectedWordLang(firstLang);
        }
      }
    } catch (error) {
      console.error("Failed to load content:", error);
      toast.error(t("contentEditor.messages.loadingContentFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (content?.id) {
      loadContentData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.id]);

  // Update parent when data changes
  useEffect(() => {
    if (!onUpdateContent) return;

    const items = rows.map((row) => ({
      text: row.text,
      definition: row.definition, // 中文翻譯
      translation: row.translation, // 英文釋義
      audio_url: row.audioUrl,
      image_url: row.imageUrl || "", // 圖片 URL
      selectedWordLanguage: row.selectedWordLanguage, // 記錄最後選擇的語言
      example_sentence: row.example_sentence,
      example_sentence_translation: row.example_sentence_translation,
      cloze_answer: row.cloze_answer || "",
      parts_of_speech: row.partsOfSpeech || [],
      ...(row.distractors ? { distractors: row.distractors } : {}),
    }));

    onUpdateContent({
      ...editingContent,
      title,
      items,
    });
  }, [rows, title]);

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
    if (rows.length >= BATCH_PASTE_MAX) {
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
      imageUrl: "",
      selectedWordLanguage: "chinese",
      example_sentence: "",
      example_sentence_translation: "",
    };
    setRows([...rows, newRow]);
  };

  // 魔術貼上（issue #891）：把 AI 擷取的項目併入現有行。
  // 先把右側「空白列」（含初始的預設空行）填滿，剩餘的再往下新增。
  const handleMagicPasteInsert = (pastedItems: MagicPasteItem[]) => {
    if (!pastedItems.length) return;

    const isEmptyRow = (r: ContentRow) =>
      !r.text.trim() && !r.definition.trim();
    // 例句是否包含該單字或其變化形（run→running/runs、happy→happier、study→studies…）。
    // 片語用子字串比對；單字用「整字 / 前綴關係 / 共同字首 ≥4」的啟發式。
    const exampleContainsWord = (word: string, example: string): boolean => {
      const w = (word || "").trim().toLowerCase();
      const s = (example || "").toLowerCase();
      if (!w || !s) return false;
      if (w.includes(" ")) return s.includes(w);
      const tokens = s.match(/[a-z]+(?:['-][a-z]+)*/g) || [];
      return tokens.some((tk) => {
        if (tk === w) return true;
        if (tk.startsWith(w) || w.startsWith(tk))
          return Math.min(tk.length, w.length) >= 3;
        let common = 0;
        const n = Math.min(tk.length, w.length);
        while (common < n && tk[common] === w[common]) common++;
        return common >= 4;
      });
    };
    // 克漏字答案：把單字設為例句中的挖空詞（整字比對、保留例句原始大小寫）。
    // 單字沒完整出現在例句中就不預設（例如變化形，交給老師手動挑）。
    const deriveClozeAnswer = (word: string, example: string): string => {
      const w = (word || "").trim();
      if (!w || !example) return "";
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = example.match(new RegExp(`\\b${escaped}\\b`, "i"));
      return m ? m[0] : "";
    };
    // 偵測擷取到的翻譯是哪種語言（韓文 Hangul / 日文假名 / 中文漢字 / 英文），
    // 用來決定放進哪個翻譯欄位。無翻譯回 ""。
    const detectLang = (s: string): WordTranslationLanguage | "" => {
      const v = (s || "").trim();
      if (!v) return "";
      if (/[가-힣]/.test(v)) return "korean";
      if (/[぀-ヿ]/.test(v)) return "japanese";
      if (/[一-鿿]/.test(v)) return "chinese";
      if (/[A-Za-z]/.test(v)) return "english";
      return "chinese";
    };
    const makeRow = (item: MagicPasteItem, id: string | number): ContentRow => {
      // 例句沒有對應到該單字（或變化形）→ 留空，不硬塞不相干的句子。
      const example =
        item.example_sentence &&
        exampleContainsWord(item.text, item.example_sentence)
          ? item.example_sentence
          : "";
      const trans = item.translation || "";
      // 一律擷取：把翻譯放進「它自己語言」的欄位（英文釋義→translation、中文→definition…）
      const captured = detectLang(trans) || "chinese";
      // 顯示語言：勾了 AI 自動翻譯 → 顯示使用者選的語言（讓 AI 補該語言翻譯）；
      // 沒勾 → 顯示擷取到的語言與內容。
      const displayLang = (
        batchPasteAutoTranslate ? lastSelectedWordLang || captured : captured
      ) as WordTranslationLanguage;
      return {
        id,
        text: item.text,
        definition: captured === "chinese" || captured === "other" ? trans : "",
        translation: captured === "english" ? trans : "",
        japanese_translation: captured === "japanese" ? trans : "",
        korean_translation: captured === "korean" ? trans : "",
        imageUrl: "",
        selectedWordLanguage: displayLang,
        partsOfSpeech: item.part_of_speech ? [item.part_of_speech] : undefined,
        example_sentence: example,
        example_sentence_translation: example
          ? item.example_sentence_translation || ""
          : "",
        cloze_answer: deriveClozeAnswer(item.text, example),
      };
    };

    const filledCount = rows.filter((r) => !isEmptyRow(r)).length;
    const capacity = BATCH_PASTE_MAX - filledCount;
    if (capacity <= 0) {
      toast.error(t("contentEditor.messages.maxRowsReached"));
      return;
    }
    const toAdd = pastedItems.slice(0, capacity);

    let maxId = Math.max(0, ...rows.map((r) => parseInt(String(r.id)) || 0));
    let idx = 0;
    // 1) 先填滿現有空白列（保留原 id）
    const filled = rows.map((r) => {
      if (isEmptyRow(r) && idx < toAdd.length) {
        return makeRow(toAdd[idx++], r.id);
      }
      return r;
    });
    // 2) 剩餘的往下新增
    const appended: ContentRow[] = [];
    while (idx < toAdd.length) {
      maxId += 1;
      appended.push(makeRow(toAdd[idx++], maxId.toString()));
    }

    setRows([...filled, ...appended]);
    // 插入時補洞：詞性一律補齊；翻譯/例句翻譯只在勾了「AI 自動翻譯」時補。
    // 勾了就把所有缺「選定語言」翻譯的列補上（擷取到的可能是別的語言，例如英文釋義，
    // handleBatchGenerateDefinitions 只翻缺選定語言欄位的列，已有者略過）。
    if (batchPasteAutoTranslate) {
      magicGapFillRef.current = true;
    }
    magicPosFillRef.current = true;
    // 勾了 AI 自動翻譯、且有例句缺翻譯 → 插入時翻譯例句
    if (
      batchPasteAutoTranslate &&
      toAdd.some(
        (it) =>
          it.example_sentence?.trim() &&
          !it.example_sentence_translation?.trim(),
      )
    ) {
      magicExampleFillRef.current = true;
    }
    // 勾了 AI 生成語音 → 插入時補單字與例句音檔
    if (batchPasteAutoTTS) {
      magicTtsFillRef.current = true;
    }

    if (pastedItems.length > toAdd.length) {
      toast.warning(
        t("contentEditor.messages.batchPasteLimit", { max: BATCH_PASTE_MAX }),
      );
    } else {
      toast.success(
        t("contentEditor.magicPaste.insertedN", { count: toAdd.length }),
      );
    }
  };

  const handleDeleteRow = (index: number) => {
    if (rows.length <= 1) {
      toast.error(t("contentEditor.messages.minRowsRequired"));
      return;
    }
    const newRows = rows.filter((_, i) => i !== index);
    setRows(newRows);
  };

  const handleCopyRow = (index: number) => {
    if (rows.length >= BATCH_PASTE_MAX) {
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
    value: string | string[] | Distractor[],
  ) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    setRows(newRows);
  };

  // 共用 helper：將 ContentRow 轉成完整的 API payload，避免次要儲存路徑遺漏欄位 (#366)
  const buildItemPayload = (row: ContentRow) => {
    const wordLang = row.selectedWordLanguage || "chinese";
    let vocabularyTranslation = "";
    if (wordLang === "chinese") {
      vocabularyTranslation = row.definition || "";
    } else if (wordLang === "english") {
      vocabularyTranslation = row.translation || "";
    } else if (wordLang === "japanese") {
      vocabularyTranslation = row.japanese_translation || "";
    } else if (wordLang === "korean") {
      vocabularyTranslation = row.korean_translation || "";
    }

    const sentenceLang = row.selectedSentenceLanguage || "chinese";
    let exampleTranslation = "";
    if (sentenceLang === "chinese") {
      exampleTranslation = row.example_sentence_translation || "";
    } else if (sentenceLang === "japanese") {
      exampleTranslation = row.example_sentence_japanese || "";
    } else if (sentenceLang === "korean") {
      exampleTranslation = row.example_sentence_korean || "";
    }

    return {
      // #861: 既有題目帶回真實 DB id，後端據此原地更新（保留學生作答）；
      // 新題目沒有 dbId，不帶 id，後端會 INSERT。
      ...(row.dbId != null ? { id: row.dbId } : {}),
      text: (row.text || "").trim(),
      vocabulary_translation: vocabularyTranslation,
      vocabulary_translation_lang: wordLang,
      definition:
        wordLang === "chinese" ? vocabularyTranslation : row.definition || "",
      audio_url: row.audioUrl || row.audio_url || "",
      image_url: row.imageUrl || "",
      example_sentence: row.example_sentence || "",
      example_sentence_translation: exampleTranslation,
      example_sentence_translation_lang: sentenceLang,
      example_sentence_audio_url: row.example_sentence_audio_url || "",
      cloze_answer: row.cloze_answer || "",
      parts_of_speech: row.partsOfSpeech || [],
      ...(row.audioSettings ? { audio_settings: row.audioSettings } : {}),
      ...(row.distractors ? { distractors: row.distractors } : {}),
    };
  };

  const handleRemoveAudio = async (index: number) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], audioUrl: "" };
    setRows(newRows);

    // 如果是編輯模式，立即更新到後端
    if (!isCreating && editingContent?.id) {
      try {
        const items = newRows.map(buildItemPayload);

        await apiClient.updateContent(editingContent.id, {
          title: title || editingContent.title,
          items,
        });

        toast.success(t("contentEditor.messages.audioRemoved"));
      } catch (error) {
        console.error("Failed to remove audio:", error);
        toast.error(t("contentEditor.messages.removeAudioFailed"));
        // 恢復原始狀態
        const originalRows = [...rows];
        setRows(originalRows);
      }
    } else {
      toast.info(t("contentEditor.messages.audioRemoved"));
    }
  };

  // 圖片上傳狀態
  const [imageUploading, setImageUploading] = useState(false);

  // 圖片上傳處理
  const handleImageUpload = async (index: number, file: File) => {
    // 檢查檔案大小 (2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("vocabularySet.image.tooLarge"));
      return;
    }

    // 檢查檔案類型
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      toast.error(t("vocabularySet.image.invalidType"));
      return;
    }

    setImageUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (editingContent?.id) {
        formData.append("content_id", editingContent.id.toString());
        formData.append("item_index", index.toString());
      }

      const response = await apiClient.uploadImage(formData);
      const imageUrl = response.image_url;

      // 更新本地狀態
      const newRows = [...rows];
      newRows[index] = { ...newRows[index], imageUrl };
      setRows(newRows);

      toast.success(t("vocabularySet.image.uploadSuccess"));
    } catch (error) {
      console.error("Image upload failed:", error);
      toast.error(t("vocabularySet.image.uploadFailed"));
    } finally {
      setImageUploading(false);
    }
  };

  // 移除圖片
  const handleRemoveImage = (index: number) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], imageUrl: "" };
    setRows(newRows);
    toast.info(t("vocabularySet.image.removed"));
  };

  // 剪貼簿貼上圖片功能
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // 從剪貼簿獲取圖片
      const items = e.clipboardData?.items;
      const files = e.clipboardData?.files;

      let imageBlob: Blob | null = null;

      // 方法 1: 從 DataTransferItemList 獲取（適用於複製圖檔）
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === "file" && items[i].type.startsWith("image/")) {
            imageBlob = items[i].getAsFile();
            break;
          }
        }
      }

      // 方法 2: 從 FileList 獲取（適用於 macOS 截圖）
      if (!imageBlob && files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith("image/")) {
            imageBlob = files[i];
            break;
          }
        }
      }

      // 如果沒有圖片，讓預設行為處理（文字貼上）
      if (!imageBlob) return;

      // 檢查是否有選中的行
      if (activeRowIndex === null) {
        toast.info(t("vocabularySet.image.pasteSelectRow"));
        return;
      }

      // 檢查該行是否已有圖片
      if (rows[activeRowIndex].imageUrl) {
        toast.info(t("vocabularySet.image.pasteHasImage"));
        return;
      }

      // 阻止預設行為
      e.preventDefault();

      // 轉換為 File 並上傳
      const ext = imageBlob.type.split("/")[1] || "png";
      const file = new File([imageBlob], `pasted-image.${ext}`, {
        type: imageBlob.type,
      });
      await handleImageUpload(activeRowIndex, file);
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [activeRowIndex, rows, t]);

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
        const items = newRows.map(buildItemPayload);

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
              const updatedRows = response.items.map((item, index) =>
                mapApiItemToRow(item as ApiContentItem, index),
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
          } catch (error) {
            console.error("Failed to update content:", error);
            toast.error(
              t("contentEditor.messages.updateFailedButAudioGenerated"),
            );
          }
        }

        // 關閉 modal 但不要關閉 panel
        setTtsModalOpen(false);
        setSelectedRow(null);
      }
    }
  };

  // ========== 靜默自動生成函數（用於儲存時自動補齊）==========

  /**
   * 靜默批次生成翻譯（成功不跳 toast，失敗才跳）
   * @returns 是否成功
   */
  const autoGenerateTranslationsSilently = async (
    currentRows: ContentRow[],
  ): Promise<{ success: boolean; updatedRows: ContentRow[] }> => {
    const batchLang = lastSelectedWordLang;
    const langConfig = WORD_TRANSLATION_LANGUAGES.find(
      (l) => l.value === batchLang,
    );
    const langCode = langConfig?.code || "zh-TW";

    // 收集需要翻譯的項目（依語言檢查對應欄位）
    const itemsToTranslate: { index: number; text: string }[] = [];

    currentRows.forEach((row, index) => {
      if (row.text && row.text.trim()) {
        let hasTranslation = false;
        if (batchLang === "chinese" && row.definition) hasTranslation = true;
        else if (batchLang === "english" && row.translation)
          hasTranslation = true;
        else if (batchLang === "japanese" && row.japanese_translation)
          hasTranslation = true;
        else if (batchLang === "korean" && row.korean_translation)
          hasTranslation = true;

        if (!hasTranslation) {
          itemsToTranslate.push({ index, text: row.text });
        }
      }
    });

    if (itemsToTranslate.length === 0) {
      return { success: true, updatedRows: currentRows };
    }

    const newRows = [...currentRows];

    try {
      const needsPOS = itemsToTranslate.filter(
        (item) =>
          !newRows[item.index].partsOfSpeech ||
          newRows[item.index].partsOfSpeech!.length === 0,
      );
      const hasPOS = itemsToTranslate.filter(
        (item) =>
          newRows[item.index].partsOfSpeech &&
          newRows[item.index].partsOfSpeech!.length > 0,
      );

      // 需要辨識詞性：中文用 batchTranslateWithPos，其他用 batchTranslate
      if (needsPOS.length > 0) {
        const texts = needsPOS.map((item) => item.text);
        if (batchLang === "chinese") {
          const posResponse = await apiClient.batchTranslateWithPos(
            texts,
            langCode,
          );
          const results = posResponse.results || [];
          needsPOS.forEach((item, idx) => {
            if (results[idx]) {
              const parsed = extractFirstDefinition(results[idx].translation);
              newRows[item.index].definition = parsed.text;
              if (
                results[idx].parts_of_speech &&
                results[idx].parts_of_speech.length > 0
              ) {
                newRows[item.index].partsOfSpeech = convertAbbreviatedPOS(
                  results[idx].parts_of_speech,
                );
              } else if (parsed.pos) {
                newRows[item.index].partsOfSpeech = convertAbbreviatedPOS([
                  parsed.pos,
                ]);
              }
              if (batchLang)
                newRows[item.index].selectedWordLanguage = batchLang;
            }
          });
        } else {
          const translateResponse = await apiClient.batchTranslate(
            texts,
            langCode,
          );
          const translations =
            (translateResponse as { translations?: string[] }).translations ||
            [];
          needsPOS.forEach((item, idx) => {
            const raw = translations[idx] || item.text;
            const parsed = extractFirstDefinition(raw);
            if (batchLang === "english") {
              newRows[item.index].translation = parsed.text;
            } else if (batchLang === "japanese") {
              newRows[item.index].japanese_translation = parsed.text;
            } else if (batchLang === "korean") {
              newRows[item.index].korean_translation = parsed.text;
            }
            if (parsed.pos) {
              newRows[item.index].partsOfSpeech = convertAbbreviatedPOS([
                parsed.pos,
              ]);
            }
            if (batchLang) newRows[item.index].selectedWordLanguage = batchLang;
          });
        }
      }

      // 已有詞性的項目只翻譯
      if (hasPOS.length > 0) {
        const texts = hasPOS.map((item) => item.text);
        const translateResponse = await apiClient.batchTranslate(
          texts,
          langCode,
        );
        const translations =
          (translateResponse as { translations?: string[] }).translations || [];

        hasPOS.forEach((item, idx) => {
          const raw = translations[idx] || item.text;
          const parsed = extractFirstDefinition(raw);
          if (batchLang === "chinese") {
            newRows[item.index].definition = parsed.text;
          } else if (batchLang === "english") {
            newRows[item.index].translation = parsed.text;
          } else if (batchLang === "japanese") {
            newRows[item.index].japanese_translation = parsed.text;
          } else if (batchLang === "korean") {
            newRows[item.index].korean_translation = parsed.text;
          }
          if (parsed.pos) {
            newRows[item.index].partsOfSpeech = convertAbbreviatedPOS([
              parsed.pos,
            ]);
          }
          if (batchLang) newRows[item.index].selectedWordLanguage = batchLang;
        });
      }

      return { success: true, updatedRows: newRows };
    } catch (error) {
      console.error("Auto translation error:", error);
      toast.error(t("contentEditor.messages.batchTranslationFailed"));
      return { success: false, updatedRows: currentRows };
    }
  };

  /**
   * 靜默批次生成音檔（成功不跳 toast，失敗才跳）
   * 為每個有 text 但沒有 audioUrl 的單字生成音檔
   * @returns 是否成功
   */
  const autoGenerateAudioSilently = async (
    currentRows: ContentRow[],
  ): Promise<{ success: boolean; updatedRows: ContentRow[] }> => {
    // 收集需要生成 TTS 的單字（有 text 但沒有 audioUrl）
    const textsToGenerate = currentRows
      .filter((row) => row.text && row.text.trim() && !row.audioUrl)
      .map((row) => row.text.trim());

    if (textsToGenerate.length === 0) {
      return { success: true, updatedRows: currentRows };
    }

    try {
      const isRandom =
        batchTTSAccent === "Random" || batchTTSGender === "Random";
      const newRows = [...currentRows];

      if (isRandom) {
        // Per-item TTS with different random voices
        for (let i = 0; i < newRows.length; i++) {
          if (
            newRows[i].text &&
            newRows[i].text.trim() &&
            !newRows[i].audioUrl
          ) {
            const { voice, rate } = getVoiceAndRate(
              batchTTSAccent,
              batchTTSGender,
              batchTTSSpeed,
            );
            const ttsResult = await apiClient.generateTTS(
              newRows[i].text.trim(),
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
            if (
              newRows[i].text &&
              newRows[i].text.trim() &&
              !newRows[i].audioUrl
            ) {
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

      return { success: true, updatedRows: newRows };
    } catch (error) {
      console.error("Auto TTS generation failed:", error);
      toast.error(t("contentEditor.messages.batchGenerationFailed"));
      return { success: false, updatedRows: currentRows };
    }
  };

  // Save handler - extracted for useImperativeHandle
  const handleSave = async () => {
    let validRows = rows.filter((row) => row.text && row.text.trim());

    if (validRows.length < 5) {
      toast.error(t("contentEditor.messages.addAtLeastFiveItems"));
      return;
    }

    if (!title || title.trim() === "") {
      toast.error(t("contentEditor.messages.enterTitle"));
      return;
    }

    const dupes = findDuplicates(validRows);
    if (dupes.size > 0) {
      setDuplicateMap(dupes);
      toast.error(t("contentEditor.messages.duplicateItems"));
      return;
    }

    setIsSaving(true);

    try {
      const translationResult =
        await autoGenerateTranslationsSilently(validRows);
      if (!translationResult.success) {
        return;
      }
      validRows = translationResult.updatedRows;

      const audioResult = await autoGenerateAudioSilently(validRows);
      if (!audioResult.success) {
        return;
      }
      validRows = audioResult.updatedRows;

      setRows(
        rows.map((row) => {
          const updated = validRows.find((v) => v.id === row.id);
          return updated || row;
        }),
      );

      const saveData = {
        title: title,
        items: validRows.map(buildItemPayload),
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
            await onSave({
              id: existingContentId,
              title: saveData.title,
              items: saveData.items,
            });
          }
        } catch (error) {
          console.error("Failed to update content:", error);
          toast.error(t("contentEditor.messages.savingFailed"));
        }
      } else if (isCreating && (lessonId || programId)) {
        try {
          // Issue #587: programId-only means create program-direct content.
          // The program-direct endpoint takes type+title only — items are
          // saved via a follow-up updateContent call.
          const newContent = programId
            ? await apiClient.createProgramContent(programId, {
                type: "VOCABULARY_SET",
                title: saveData.title,
              })
            : await apiClient.createContent(lessonId!, {
                type: "VOCABULARY_SET",
                ...saveData,
              });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let savedContent = newContent as any;
          if (programId && saveData.items && saveData.items.length > 0) {
            try {
              await apiClient.updateContent(savedContent.id, {
                title: saveData.title,
                items: saveData.items,
              });
            } catch (updateError) {
              // Issue #587: roll back the empty content created in step 1 if
              // the items update fails, so a retry doesn't leave an orphaned
              // 0-item record behind.
              try {
                await apiClient.deleteContent(savedContent.id);
              } catch (rollbackError) {
                console.error(
                  "Failed to roll back orphaned content:",
                  rollbackError,
                );
              }
              throw updateError;
            }
            // Issue #587: merge items back so the content card doesn't show
            // "0 items" until a full page refresh.
            savedContent = {
              ...savedContent,
              items: saveData.items,
              items_count: saveData.items.length,
            };
          }

          toast.success(t("contentEditor.messages.contentCreatedSuccess"));
          if (onSave) {
            await onSave(savedContent);
          }
        } catch (error) {
          console.error("Failed to create content:", error);
          toast.error(t("contentEditor.messages.creatingContentFailed"));
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    get isBusy() {
      return isSaving || isBatchPasting;
    },
  }));

  // ========== 原有函數 ==========

  const handleBatchGenerateTTS = async () => {
    try {
      // 收集需要生成 TTS 的單字（不是例句）
      const textsToGenerate = rows
        .filter((row) => row.text && row.text.trim() && !row.audioUrl)
        .map((row) => row.text.trim());

      if (textsToGenerate.length === 0) {
        toast.info(t("vocabularySet.messages.allItemsHaveAudioOrEmpty"));
        return;
      }

      toast.info(
        t("vocabularySet.messages.generatingWordAudio", {
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
          if (
            newRows[i].text &&
            newRows[i].text.trim() &&
            !newRows[i].audioUrl
          ) {
            const { voice, rate } = getVoiceAndRate(
              batchTTSAccent,
              batchTTSGender,
              batchTTSSpeed,
            );
            const ttsResult = await apiClient.generateTTS(
              newRows[i].text.trim(),
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
            if (
              newRows[i].text &&
              newRows[i].text.trim() &&
              !newRows[i].audioUrl
            ) {
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
      const items = newRows.map(buildItemPayload);

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
        } catch (error) {
          console.error("Failed to save TTS:", error);
          toast.error(
            t("contentEditor.messages.savingFailedButAudioGenerated"),
          );
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
    }
  };

  const handleGenerateSingleDefinition = async (index: number) => {
    const currentLang = rows[index].selectedWordLanguage || "chinese";
    return handleGenerateSingleDefinitionWithLang(index, currentLang);
  };

  const handleGenerateSingleDefinitionWithLang = async (
    index: number,
    targetLang: WordTranslationLanguage,
  ) => {
    const newRows = [...rows];
    if (!newRows[index].text) {
      toast.error(t("contentEditor.messages.enterTextFirst"));
      return;
    }

    // 檢查是否需要自動辨識詞性（詞性陣列為空且翻譯成中文）
    const needAutoDetectPOS =
      targetLang === "chinese" &&
      (!newRows[index].partsOfSpeech ||
        newRows[index].partsOfSpeech.length === 0);

    const langConfig = WORD_TRANSLATION_LANGUAGES.find(
      (l) => l.value === targetLang,
    );
    toast.info(t("contentEditor.messages.generatingTranslation"));

    try {
      if (needAutoDetectPOS) {
        // 使用新的 API 同時翻譯和辨識詞性（僅中文）
        const response = await apiClient.translateWithPos(
          newRows[index].text,
          langConfig?.code || "zh-TW",
        );

        // 自動填入詞性（轉換縮寫為完整名稱）
        if (response.parts_of_speech && response.parts_of_speech.length > 0) {
          newRows[index].partsOfSpeech = convertAbbreviatedPOS(
            response.parts_of_speech,
          );
        }

        // 中文多義檢查
        const multiDefs = parseMultipleDefinitions(response.translation);
        if (multiDefs.length > 1) {
          setDefinitionPicker({
            rowIndex: index,
            word: newRows[index].text,
            options: multiDefs,
            targetLang: "chinese",
          });
          newRows[index].selectedWordLanguage = targetLang;
          setRows(newRows);
          return;
        }

        // 單個定義：去掉編號前綴，提取詞性
        const parsed = extractPosFromTranslation(response.translation);
        if (parsed.pos) {
          newRows[index].partsOfSpeech = convertAbbreviatedPOS([parsed.pos]);
        }
        newRows[index].definition = parsed.text;
      } else {
        // 已有詞性或非中文，只翻譯不改變詞性
        const response = (await apiClient.translateText(
          newRows[index].text,
          langConfig?.code || "zh-TW",
        )) as { translation: string };

        // 多義檢查：所有語言，若有多個定義則彈出選擇器
        {
          const multiDefs = parseMultipleDefinitions(response.translation);
          if (multiDefs.length > 1) {
            setDefinitionPicker({
              rowIndex: index,
              word: newRows[index].text,
              options: multiDefs,
              targetLang,
            });
            newRows[index].selectedWordLanguage = targetLang;
            setRows(newRows);
            return;
          }
        }

        // 根據目標語言寫入對應欄位
        {
          const parsed = extractPosFromTranslation(response.translation);
          if (parsed.pos) {
            newRows[index].partsOfSpeech = convertAbbreviatedPOS([parsed.pos]);
          }
          if (targetLang === "chinese") {
            newRows[index].definition = parsed.text;
          } else if (targetLang === "english") {
            newRows[index].translation = parsed.text;
          } else if (targetLang === "japanese") {
            newRows[index].japanese_translation = parsed.text;
          } else if (targetLang === "korean") {
            newRows[index].korean_translation = parsed.text;
          }
        }
      }

      // 記錄最後選擇的語言
      newRows[index].selectedWordLanguage = targetLang;
      setRows(newRows);
      toast.success(
        needAutoDetectPOS
          ? t("vocabularySet.messages.translationAndPOSComplete")
          : t("contentEditor.messages.translationComplete"),
      );
    } catch (error) {
      console.error("Translation error:", error);
      toast.error(t("contentEditor.messages.translationFailed"));
    }
  };

  const handleBatchGenerateDefinitions = async () => {
    const batchLang = lastSelectedWordLang;
    const langConfig = WORD_TRANSLATION_LANGUAGES.find(
      (l) => l.value === batchLang,
    );
    const langCode = langConfig?.code || "zh-TW";

    // 依語言判斷哪些項目缺少翻譯
    const getTranslationField = (row: ContentRow) => {
      if (batchLang === "chinese") return row.definition;
      if (batchLang === "english") return row.translation;
      if (batchLang === "japanese") return row.japanese_translation;
      if (batchLang === "korean") return row.korean_translation;
      return row.definition;
    };

    const itemsToTranslate: { index: number; text: string }[] = [];
    rows.forEach((row, index) => {
      if (row.text && !getTranslationField(row)) {
        itemsToTranslate.push({ index, text: row.text });
      }
    });

    if (itemsToTranslate.length === 0) {
      toast.info(t("contentEditor.messages.noItemsNeedTranslation"));
      return;
    }

    toast.info(t("contentEditor.messages.startingBatchTranslation"));
    const newRows = [...rows];

    try {
      // 分類：需要辨識詞性的項目 vs 已有詞性的項目
      const needsPOS = itemsToTranslate.filter(
        (item) =>
          !newRows[item.index].partsOfSpeech ||
          newRows[item.index].partsOfSpeech!.length === 0,
      );
      const hasPOS = itemsToTranslate.filter(
        (item) =>
          newRows[item.index].partsOfSpeech &&
          newRows[item.index].partsOfSpeech!.length > 0,
      );

      // 對需要辨識詞性的項目：中文用 batchTranslateWithPos，其他用 batchTranslate
      if (needsPOS.length > 0) {
        const texts = needsPOS.map((item) => item.text);
        if (batchLang === "chinese") {
          const posResponse = await apiClient.batchTranslateWithPos(
            texts,
            langCode,
          );
          const results = posResponse.results || [];
          needsPOS.forEach((item, idx) => {
            if (results[idx]) {
              const parsed = extractFirstDefinition(results[idx].translation);
              newRows[item.index].definition = parsed.text;
              if (
                results[idx].parts_of_speech &&
                results[idx].parts_of_speech.length > 0
              ) {
                newRows[item.index].partsOfSpeech = convertAbbreviatedPOS(
                  results[idx].parts_of_speech,
                );
              } else if (parsed.pos) {
                newRows[item.index].partsOfSpeech = convertAbbreviatedPOS([
                  parsed.pos,
                ]);
              }
            }
            if (batchLang) newRows[item.index].selectedWordLanguage = batchLang;
          });
        } else {
          const translateResponse = await apiClient.batchTranslate(
            texts,
            langCode,
          );
          const translations =
            (translateResponse as { translations?: string[] }).translations ||
            [];
          needsPOS.forEach((item, idx) => {
            const raw = translations[idx] || item.text;
            const parsed = extractFirstDefinition(raw);
            if (batchLang === "english") {
              newRows[item.index].translation = parsed.text;
            } else if (batchLang === "japanese") {
              newRows[item.index].japanese_translation = parsed.text;
            } else if (batchLang === "korean") {
              newRows[item.index].korean_translation = parsed.text;
            }
            if (parsed.pos) {
              newRows[item.index].partsOfSpeech = convertAbbreviatedPOS([
                parsed.pos,
              ]);
            }
            if (batchLang) newRows[item.index].selectedWordLanguage = batchLang;
          });
        }
      }

      // 對已有詞性的項目只翻譯
      if (hasPOS.length > 0) {
        const texts = hasPOS.map((item) => item.text);
        const translateResponse = await apiClient.batchTranslate(
          texts,
          langCode,
        );
        const translations =
          (translateResponse as { translations?: string[] }).translations || [];

        hasPOS.forEach((item, idx) => {
          const raw = translations[idx] || item.text;
          const parsed = extractFirstDefinition(raw);
          if (batchLang === "chinese") {
            newRows[item.index].definition = parsed.text;
          } else if (batchLang === "english") {
            newRows[item.index].translation = parsed.text;
          } else if (batchLang === "japanese") {
            newRows[item.index].japanese_translation = parsed.text;
          } else if (batchLang === "korean") {
            newRows[item.index].korean_translation = parsed.text;
          }
          if (parsed.pos) {
            newRows[item.index].partsOfSpeech = convertAbbreviatedPOS([
              parsed.pos,
            ]);
          }
          if (batchLang) newRows[item.index].selectedWordLanguage = batchLang;
        });
      }

      setRows(newRows);
      toast.success(
        t("vocabularySet.messages.batchTranslationSuccess", {
          total: itemsToTranslate.length,
          posCount: needsPOS.length > 0 ? needsPOS.length : 0,
        }),
      );
    } catch (error) {
      console.error("Batch translation error:", error);
      toast.error(t("contentEditor.messages.batchTranslationFailed"));
    }
  };

  // 只補「詞性」：對有單字但沒詞性的列，用 batchTranslateWithPos 取詞性（忽略其翻譯，
  // 保留圖上/既有的翻譯）。functional setRows + 再次判空，避免覆蓋翻譯補洞的結果。
  const fillMissingPosForWords = async () => {
    const targets = rows
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r }) =>
          r.text?.trim() && (!r.partsOfSpeech || r.partsOfSpeech.length === 0),
      );
    if (!targets.length) return;
    try {
      const resp = (await apiClient.batchTranslateWithPos(
        targets.map((tg) => tg.r.text.trim()),
        "zh-TW",
      )) as { results?: { parts_of_speech?: string[] }[] };
      const results = resp.results || [];
      setRows((prev) => {
        const nr = [...prev];
        targets.forEach((tg, k) => {
          const pos = results[k]?.parts_of_speech;
          const cur = nr[tg.i];
          if (
            pos?.length &&
            cur &&
            (!cur.partsOfSpeech || cur.partsOfSpeech.length === 0)
          ) {
            nr[tg.i] = { ...cur, partsOfSpeech: convertAbbreviatedPOS(pos) };
          }
        });
        return nr;
      });
    } catch (e) {
      console.error("POS fill error:", e);
    }
  };

  // 只補「例句翻譯」：對有例句但沒例句翻譯的列，用 batchTranslate 翻譯例句本身
  // （對應圖上已有例句、但沒有例句翻譯的情境）。目標語言取「翻譯成」設定，
  // 未設定則沿用單字翻譯語言，最後 fallback 中文；english/other 不適用例句翻譯故用中文。
  const fillMissingExampleTranslations = async () => {
    let target = (aiGenerateTranslateLang ||
      lastSelectedWordLang ||
      "chinese") as string;
    if (target !== "japanese" && target !== "korean") target = "chinese";
    const langCode =
      SENTENCE_TRANSLATION_LANGUAGES.find((l) => l.value === target)?.code ||
      "zh-TW";
    const getField = (r: ContentRow) =>
      target === "japanese"
        ? r.example_sentence_japanese
        : target === "korean"
          ? r.example_sentence_korean
          : r.example_sentence_translation;
    const targets = rows
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r }) => r.example_sentence?.trim() && !(getField(r) || "").trim(),
      );
    if (!targets.length) return;
    try {
      const resp = (await apiClient.batchTranslate(
        targets.map((tg) => tg.r.example_sentence!.trim()),
        langCode,
      )) as { translations?: string[] };
      const translations = resp.translations || [];
      setRows((prev) => {
        const nr = [...prev];
        targets.forEach((tg, k) => {
          const tr = translations[k];
          const cur = nr[tg.i];
          if (!tr || !cur || !cur.example_sentence?.trim()) return;
          if ((getField(cur) || "").trim()) return; // 已有翻譯就不覆蓋
          if (target === "japanese") {
            nr[tg.i] = {
              ...cur,
              example_sentence_japanese: tr,
              selectedSentenceLanguage: "japanese",
            };
          } else if (target === "korean") {
            nr[tg.i] = {
              ...cur,
              example_sentence_korean: tr,
              selectedSentenceLanguage: "korean",
            };
          } else {
            nr[tg.i] = {
              ...cur,
              example_sentence_translation: tr,
              selectedSentenceLanguage: "chinese",
            };
          }
        });
        return nr;
      });
    } catch (e) {
      console.error("example translation fill error:", e);
    }
  };

  // 只補「音檔」：勾了 AI 生成語音時，對缺單字音檔、缺例句音檔的列各自產生 TTS。
  // 沿用左側語音設定（口音/性別/語速）；Random 時逐題不同語音，否則批次同一語音。
  const fillMissingAudio = async () => {
    const toFullUrl = (u: string) =>
      u.startsWith("http") ? u : `${import.meta.env.VITE_API_URL}${u}`;
    const wordTargets = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.text?.trim() && !r.audioUrl && !r.audio_url);
    const exampleTargets = rows
      .map((r, i) => ({ r, i }))
      .filter(
        ({ r }) => r.example_sentence?.trim() && !r.example_sentence_audio_url,
      );
    if (!wordTargets.length && !exampleTargets.length) return;

    const isRandom = batchTTSAccent === "Random" || batchTTSGender === "Random";
    const genOne = async (text: string): Promise<string> => {
      const { voice, rate } = getVoiceAndRate(
        batchTTSAccent,
        batchTTSGender,
        batchTTSSpeed,
      );
      const r = await apiClient.generateTTS(text, voice, rate, "+0%");
      return r && typeof r === "object" && "audio_url" in r
        ? toFullUrl((r as { audio_url: string }).audio_url)
        : "";
    };
    const genBatch = async (texts: string[]): Promise<string[]> => {
      const { voice, rate } = getVoiceAndRate(
        batchTTSAccent,
        batchTTSGender,
        batchTTSSpeed,
      );
      const r = await apiClient.batchGenerateTTS(texts, voice, rate, "+0%");
      return r &&
        typeof r === "object" &&
        "audio_urls" in r &&
        Array.isArray((r as { audio_urls: string[] }).audio_urls)
        ? (r as { audio_urls: string[] }).audio_urls.map(toFullUrl)
        : [];
    };

    const wordUrls: Record<number, string> = {};
    const exampleUrls: Record<number, string> = {};
    try {
      if (isRandom) {
        for (const t of wordTargets) {
          const u = await genOne(t.r.text!.trim());
          if (u) wordUrls[t.i] = u;
        }
        for (const t of exampleTargets) {
          const u = await genOne(t.r.example_sentence!.trim());
          if (u) exampleUrls[t.i] = u;
        }
      } else {
        if (wordTargets.length) {
          const urls = await genBatch(wordTargets.map((t) => t.r.text!.trim()));
          wordTargets.forEach((t, k) => {
            if (urls[k]) wordUrls[t.i] = urls[k];
          });
        }
        if (exampleTargets.length) {
          const urls = await genBatch(
            exampleTargets.map((t) => t.r.example_sentence!.trim()),
          );
          exampleTargets.forEach((t, k) => {
            if (urls[k]) exampleUrls[t.i] = urls[k];
          });
        }
      }
      setRows((prev) => {
        const nr = [...prev];
        Object.entries(wordUrls).forEach(([i, url]) => {
          const idx = Number(i);
          if (nr[idx] && !nr[idx].audioUrl)
            nr[idx] = { ...nr[idx], audioUrl: url };
        });
        Object.entries(exampleUrls).forEach(([i, url]) => {
          const idx = Number(i);
          if (nr[idx] && !nr[idx].example_sentence_audio_url)
            nr[idx] = { ...nr[idx], example_sentence_audio_url: url };
        });
        return nr;
      });
    } catch (e) {
      console.error("audio fill error:", e);
    }
  };

  // 魔術貼上插入後補洞：rows 更新後依旗標依序補齊「翻譯 → 詞性 → 例句翻譯 → 語音」。
  // 依序 await（各步之間 tick 讓 setRows 提交），避免 setRows 互相覆蓋。
  useEffect(() => {
    const needTranslate = magicGapFillRef.current;
    const needPos = magicPosFillRef.current;
    const needExample = magicExampleFillRef.current;
    const needTts = magicTtsFillRef.current;
    if (!needTranslate && !needPos && !needExample && !needTts) return;
    magicGapFillRef.current = false;
    magicPosFillRef.current = false;
    magicExampleFillRef.current = false;
    magicTtsFillRef.current = false;
    void (async () => {
      if (needTranslate) await handleBatchGenerateDefinitions();
      if (needPos) {
        await new Promise((r) => setTimeout(r, 0));
        await fillMissingPosForWords();
      }
      if (needExample) {
        await new Promise((r) => setTimeout(r, 0));
        await fillMissingExampleTranslations();
      }
      if (needTts) {
        await new Promise((r) => setTimeout(r, 0));
        await fillMissingAudio();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Example sentence translation functions
  const handleGenerateExampleTranslation = async (index: number) => {
    const currentLang = rows[index].selectedSentenceLanguage || "chinese";
    return handleGenerateExampleTranslationWithLang(index, currentLang);
  };

  const handleGenerateExampleTranslationWithLang = async (
    index: number,
    targetLang: SentenceTranslationLanguage,
  ) => {
    const newRows = [...rows];
    if (!newRows[index].example_sentence) {
      toast.error(t("vocabularySet.messages.enterExampleFirst"));
      return;
    }

    const langConfig = SENTENCE_TRANSLATION_LANGUAGES.find(
      (l) => l.value === targetLang,
    );
    toast.info(t("vocabularySet.messages.generatingExampleTranslation"));

    try {
      const response = (await apiClient.translateText(
        newRows[index].example_sentence!,
        langConfig?.code || "zh-TW",
      )) as { translation: string };

      // 根據目標語言寫入對應欄位
      if (targetLang === "chinese") {
        newRows[index].example_sentence_translation = response.translation;
      } else if (targetLang === "japanese") {
        newRows[index].example_sentence_japanese = response.translation;
      } else if (targetLang === "korean") {
        newRows[index].example_sentence_korean = response.translation;
      }

      // 記錄最後選擇的語言
      newRows[index].selectedSentenceLanguage = targetLang;
      setRows(newRows);
      toast.success(t("vocabularySet.messages.exampleTranslationComplete"));
    } catch (error) {
      console.error("Example sentence translation error:", error);
      toast.error(t("vocabularySet.messages.exampleTranslationFailed"));
    }
  };

  // 打開 AI 生成例句對話框
  const handleOpenAIGenerateModal = (index: number | null) => {
    setAiGenerateTargetIndex(index);
    // 每次打開 modal 都重設為 Program level
    setAiGenerateLevel(programLevel || "A1");
    // 預選左側 AI Generate Examples 的翻譯語言
    // 英英翻譯時不預選
    if (lastSelectedWordLang === "english") {
      setAiGenerateTranslateLang("");
    } else if (lastSelectedWordLang === "other") {
      setAiGenerateTranslateLang("other");
      setCustomSentenceTranslationLang(customTranslationLang);
    } else {
      setAiGenerateTranslateLang(lastSelectedWordLang);
    }
    setAiGenerateModalOpen(true);
  };

  // AI 生成例句
  const handleAIGenerateSentences = async () => {
    setIsGeneratingAI(true);

    try {
      // 確定要生成的目標
      const targetIndices: number[] = [];
      if (aiGenerateTargetIndex !== null) {
        // 單個生成：只處理該項目
        targetIndices.push(aiGenerateTargetIndex);
      } else {
        // 批次生成：只處理有單字且尚無例句的項目（跳過已有例句的）
        rows.forEach((row, index) => {
          if (row.text && row.text.trim() && !row.example_sentence?.trim()) {
            targetIndices.push(index);
          }
        });
      }

      if (targetIndices.length === 0) {
        toast.info(t("vocabularySet.messages.noItemsForExampleGeneration"));
        setIsGeneratingAI(false);
        return;
      }

      // 收集需要生成的單字、翻譯和詞性
      const wordsToGenerate = targetIndices.map((idx) => ({
        word: rows[idx].text,
        definition: rows[idx].definition || "",
        partsOfSpeech: rows[idx].partsOfSpeech || [],
      }));

      // 根據例句翻譯語言決定 target_language
      let targetLanguage = "";
      if (aiGenerateTranslateLang === "other") {
        targetLanguage = customSentenceTranslationLang || "";
      } else if (aiGenerateTranslateLang) {
        targetLanguage =
          SENTENCE_TRANSLATION_LANGUAGES.find(
            (l) => l.value === aiGenerateTranslateLang,
          )?.code || "";
      }

      toast.info(
        t("vocabularySet.messages.generatingExamples", {
          count: wordsToGenerate.length,
        }),
      );

      // 呼叫 API 生成例句（後端會同步跑 TTS，audio_url 一起回來；Issue #757）
      const firstAudioSettings = rows[targetIndices[0]]?.audioSettings;
      const response = await apiClient.generateSentences({
        words: wordsToGenerate.map((w) => w.word),
        definitions: wordsToGenerate.map((w) => w.definition),
        lesson_id: lessonId,
        level: aiGenerateLevel,
        prompt: aiGeneratePrompt || undefined,
        translate_to: targetLanguage || undefined,
        parts_of_speech: wordsToGenerate.map((w) => w.partsOfSpeech),
        audio_settings: firstAudioSettings
          ? {
              accent: firstAudioSettings.accent,
              gender: firstAudioSettings.gender,
              speed: firstAudioSettings.speed,
            }
          : undefined,
      });

      // 更新 rows
      const newRows = [...rows];
      const sentencesData = response.sentences;

      if (!sentencesData || !Array.isArray(sentencesData)) {
        toast.error(
          t("vocabularySet.messages.exampleGenerationFailed") ||
            "例句生成失敗，請稍後再試",
        );
        return;
      }
      const results = sentencesData;

      // 驗證陣列長度是否匹配，防止錯位
      if (results.length !== targetIndices.length) {
        console.error(
          `Array mismatch: expected ${targetIndices.length} sentences, got ${results.length}`,
        );
        toast.warning(
          t("vocabularySet.messages.exampleGenerationPartialFailure") ||
            "部分單字造句可能失敗，請檢查結果",
        );
        // 繼續處理，但已警告用戶部分可能失敗
      }

      // 使用 Map 優化查找效率，防止 O(n²) 複雜度
      const resultMap = new Map(results.map((r) => [r.word, r]));

      // 使用 word 欄位進行匹配，而非依賴索引，以防止錯位
      targetIndices.forEach((idx) => {
        const targetWord = newRows[idx].text;

        // 先清空現有的例句、翻譯、音檔與克漏字答案，避免殘留舊資料
        newRows[idx].example_sentence = "";
        newRows[idx].example_sentence_translation = "";
        newRows[idx].example_sentence_audio_url = "";
        newRows[idx].cloze_answer = "";

        // 使用 Map 查找對應的句子（O(1) 複雜度）
        const matchedResult = resultMap.get(targetWord);

        if (matchedResult) {
          newRows[idx].example_sentence = matchedResult.sentence;
          if (matchedResult.translation) {
            newRows[idx].example_sentence_translation =
              matchedResult.translation;
          }
          if (matchedResult.audio_url) {
            newRows[idx].example_sentence_audio_url = matchedResult.audio_url;
          }
          // Issue #632: AI 生成例句後立即帶入抽取的克漏字答案供老師確認
          newRows[idx].cloze_answer = matchedResult.cloze_answer || "";
        } else {
          console.warn(
            `No sentence found for word: ${targetWord} at index ${idx}`,
          );
        }
      });

      setRows(newRows);
      toast.success(
        t("vocabularySet.messages.examplesGeneratedSuccess", {
          count: results.length,
        }),
      );
      setAiGenerateModalOpen(false);
    } catch (error) {
      console.error("AI generate sentences error:", error);
      toast.error(t("vocabularySet.messages.exampleGenerationFailed"));
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleBatchPaste = async (autoTTS: boolean, autoTranslate: boolean) => {
    // 分割文字，去重
    const rawLines = batchPasteText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // 1. 貼上框內部去重
    const uniqueLines = [...new Set(rawLines.map((l) => l.toLowerCase()))];
    const deduped = uniqueLines.map(
      (lower) => rawLines.find((l) => l.toLowerCase() === lower)!,
    );
    const internalDupes = rawLines.length - deduped.length;

    // 2. 跟右側已有單字去重
    const existingWords = new Set(
      rows
        .filter((r) => r.text && r.text.trim())
        .map((r) => r.text.trim().toLowerCase()),
    );
    const lines = deduped.filter((l) => !existingWords.has(l.toLowerCase()));
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

    // 貼上框空白時，改為對右側已有單字補齊缺少的項目
    const isBackfillMode = lines.length === 0 && rawLines.length === 0;

    if (isBackfillMode) {
      const existingRows = rows.filter((r) => r.text && r.text.trim());
      if (existingRows.length === 0) {
        toast.error(t("contentEditor.messages.enterContent"));
        return;
      }
    }

    // 檢查：勾選翻譯但沒選語言
    if (autoTranslate && !lastSelectedWordLang) {
      toast.error(t("contentEditor.labels.selectLanguage"));
      return;
    }

    // 檢查：勾選翻譯但選了「其他」卻沒輸入語言
    if (
      autoTranslate &&
      lastSelectedWordLang === "other" &&
      !customTranslationLang.trim()
    ) {
      toast.error(t("contentEditor.labels.enterCustomLanguage"));
      return;
    }

    // 批次新增上限 (#422)
    if (lines.length > BATCH_PASTE_MAX) {
      toast.error(
        t("contentEditor.messages.batchPasteLimit", {
          count: BATCH_PASTE_MAX,
        }),
      );
      return;
    }

    // 檢查：勾選 AI 例句但沒選翻譯語言（僅在有需要生成例句時檢查）
    const hasItemsNeedingExamples = rows.some(
      (r) => r.text?.trim() && !r.example_sentence?.trim(),
    );
    if (
      aiGenerateExpanded &&
      hasItemsNeedingExamples &&
      !aiGenerateTranslateLang
    ) {
      toast.error(t("contentEditor.labels.selectExampleLanguage"));
      return;
    }

    // 檢查：AI 例句選了「其他」卻沒輸入語言
    if (
      aiGenerateExpanded &&
      hasItemsNeedingExamples &&
      aiGenerateTranslateLang === "other" &&
      !customSentenceTranslationLang.trim()
    ) {
      toast.error(t("contentEditor.labels.enterCustomLanguage"));
      return;
    }

    // 檢查：單字翻譯語言一致性（已有翻譯的單字不可更改語言）
    if (autoTranslate) {
      const existingWithTranslation = rows.find((r) => {
        if (!r.text?.trim()) return false;
        return (
          r.selectedWordLanguage &&
          r.selectedWordLanguage !== lastSelectedWordLang &&
          (r.definition ||
            r.translation ||
            r.japanese_translation ||
            r.korean_translation)
        );
      });
      if (existingWithTranslation) {
        const existingLangLabel =
          WORD_TRANSLATION_LANGUAGES.find(
            (l) => l.value === existingWithTranslation.selectedWordLanguage,
          )?.label || existingWithTranslation.selectedWordLanguage;
        toast.error(
          t("contentEditor.labels.translationLanguageMismatch", {
            lang: existingLangLabel,
          }),
        );
        return;
      }
    }

    // 檢查：例句翻譯語言一致性（已有例句翻譯的不可更改語言）
    // 跳過條件：沒選例句語言、或單字翻譯選英文（英文沒有例句翻譯）
    if (
      aiGenerateExpanded &&
      aiGenerateTranslateLang &&
      lastSelectedWordLang !== "english"
    ) {
      const existingWithExampleTranslation = rows.find((r) => {
        if (!r.text?.trim() || !r.example_sentence_translation?.trim())
          return false;
        // Skip check when "other" is selected — custom languages can't be compared
        if (aiGenerateTranslateLang === "other") return false;
        const existingSentenceLang = r.selectedSentenceLanguage || "chinese";
        return existingSentenceLang !== aiGenerateTranslateLang;
      });
      if (existingWithExampleTranslation) {
        const existingLangLabel =
          SENTENCE_TRANSLATION_LANGUAGES.find(
            (l) =>
              l.value ===
              (existingWithExampleTranslation.selectedSentenceLanguage ||
                "chinese"),
          )?.label || existingWithExampleTranslation.selectedSentenceLanguage;
        toast.error(
          t("contentEditor.labels.exampleTranslationLanguageMismatch", {
            lang: existingLangLabel,
          }),
        );
        return;
      }
    }

    setIsBatchPasting(true);
    batchPauseRef.current = false;

    try {
      // === 補齊模式：對右側已有單字補齊缺少的項目 ===
      if (isBackfillMode) {
        const batchLang = lastSelectedWordLang;
        const batchLangCode =
          batchLang === "other"
            ? customTranslationLang || ""
            : WORD_TRANSLATION_LANGUAGES.find((l) => l.value === batchLang)
                ?.code || "zh-TW";

        if (autoTTS) {
          saveBatchTTSSettings();
        }

        const shouldGenerateExamples = aiGenerateExpanded;
        let exampleTargetLang = "";
        if (shouldGenerateExamples) {
          if (aiGenerateTranslateLang === "other") {
            exampleTargetLang = customSentenceTranslationLang || "";
          } else if (aiGenerateTranslateLang) {
            exampleTargetLang =
              SENTENCE_TRANSLATION_LANGUAGES.find(
                (l) => l.value === aiGenerateTranslateLang,
              )?.code || "";
          }
        }

        const currentRows = [...rows];
        let completedItems = 0;
        let completedSteps = 0;
        const itemsToProcess = rows
          .map((r, idx) => ({ r, idx }))
          .filter(({ r }) => r.text && r.text.trim())
          .map(({ idx }) => idx);

        // 計算每個單字的實際步驟數
        const getStepsForRow = (row: ContentRow) => {
          let steps = 0;
          if (autoTranslate) {
            const hasTranslation = (() => {
              if (batchLang === "chinese") return !!row.definition;
              if (batchLang === "english") return !!row.translation;
              if (batchLang === "japanese") return !!row.japanese_translation;
              if (batchLang === "korean") return !!row.korean_translation;
              return !!row.definition;
            })();
            if (!hasTranslation) steps++;
          }
          if (autoTTS && !row.audioUrl && !row.audio_url) steps++;
          if (shouldGenerateExamples && !row.example_sentence?.trim()) steps++;
          if (shouldGenerateExamples && row.example_sentence?.trim()) {
            const sentenceLang =
              row.selectedSentenceLanguage ||
              aiGenerateTranslateLang ||
              "chinese";
            const hasExampleTranslation = (() => {
              if (sentenceLang === "japanese")
                return !!row.example_sentence_japanese?.trim();
              if (sentenceLang === "korean")
                return !!row.example_sentence_korean?.trim();
              return !!row.example_sentence_translation?.trim();
            })();
            if (!hasExampleTranslation) steps++;
            // Issue #757: 例句已存在但缺音檔（舊資料常見情境）
            // 也算一步要補，否則「無需補齊」會誤報而漏掉聽力派發要用的 TTS。
            if (!row.example_sentence_audio_url) steps++;
          }
          return steps;
        };

        const { totalSteps, totalItems } = itemsToProcess.reduce(
          (acc, idx) => {
            const steps = getStepsForRow(currentRows[idx]);
            return {
              totalSteps: acc.totalSteps + steps,
              totalItems: acc.totalItems + (steps > 0 ? 1 : 0),
            };
          },
          { totalSteps: 0, totalItems: 0 },
        );

        if (totalSteps === 0) {
          toast.info(
            t("contentEditor.messages.noItemsNeedProcessing", {
              defaultValue: "所有項目已完成，無需補齊",
            }),
          );
          setIsBatchPasting(false);
          return;
        }

        setBatchProgress({
          completedItems: 0,
          totalItems,
          completedSteps: 0,
          totalSteps,
        });

        // --- Helper: retry with backoff ---
        const withRetry = async <T,>(
          fn: () => Promise<T>,
          retries = 2,
          delays = [1000, 3000],
        ): Promise<T> => {
          for (let attempt = 0; ; attempt++) {
            try {
              return await fn();
            } catch (err) {
              if (attempt >= retries) throw err;
              await new Promise((r) => setTimeout(r, delays[attempt] || 3000));
            }
          }
        };

        // --- Classify items by what they need ---
        const needsTranslation: number[] = [];
        const needsTTS: number[] = [];
        const needsExamples: number[] = [];
        const needsExampleTranslation: number[] = [];
        // Issue #757: 例句已存在但缺音檔的舊資料 → 單獨跑 TTS 補上。
        // 與 needsExamples 互斥（needsExamples 是「沒例句」的，
        // 走 /generate-sentences 後端會順便產 audio_url）。
        const needsExampleAudio: number[] = [];

        for (const idx of itemsToProcess) {
          const row = currentRows[idx];
          if (autoTranslate) {
            const hasTranslation = (() => {
              if (batchLang === "chinese") return !!row.definition;
              if (batchLang === "english") return !!row.translation;
              if (batchLang === "japanese") return !!row.japanese_translation;
              if (batchLang === "korean") return !!row.korean_translation;
              return !!row.definition;
            })();
            if (!hasTranslation) needsTranslation.push(idx);
          }
          if (autoTTS && !row.audioUrl && !row.audio_url) needsTTS.push(idx);
          if (shouldGenerateExamples && !row.example_sentence?.trim())
            needsExamples.push(idx);
          if (shouldGenerateExamples && row.example_sentence?.trim()) {
            const sentenceLang =
              row.selectedSentenceLanguage ||
              aiGenerateTranslateLang ||
              "chinese";
            const hasExampleTranslation = (() => {
              if (sentenceLang === "japanese")
                return !!row.example_sentence_japanese?.trim();
              if (sentenceLang === "korean")
                return !!row.example_sentence_korean?.trim();
              return !!row.example_sentence_translation?.trim();
            })();
            if (!hasExampleTranslation) needsExampleTranslation.push(idx);
            if (!row.example_sentence_audio_url) {
              needsExampleAudio.push(idx);
            }
          }
        }

        // --- Phase 1: Translation (parallel batch) ---
        if (needsTranslation.length > 0 && !batchPauseRef.current) {
          const textsToTranslate = needsTranslation.map(
            (idx) => currentRows[idx].text,
          );

          try {
            if (batchLang === "chinese") {
              const posResponse = await withRetry(() =>
                apiClient.batchTranslateWithPos(
                  textsToTranslate,
                  batchLangCode,
                ),
              );
              const results = posResponse.results || [];
              results.forEach(
                (
                  result: {
                    translation?: string;
                    parts_of_speech?: string[];
                  },
                  i: number,
                ) => {
                  if (!result) return;
                  const idx = needsTranslation[i];
                  const parsed = extractFirstDefinition(
                    result.translation || "",
                  );
                  currentRows[idx].definition = parsed.text;
                  if (
                    result.parts_of_speech &&
                    result.parts_of_speech.length > 0
                  ) {
                    currentRows[idx].partsOfSpeech = convertAbbreviatedPOS(
                      result.parts_of_speech,
                    );
                  } else if (parsed.pos) {
                    currentRows[idx].partsOfSpeech = convertAbbreviatedPOS([
                      parsed.pos,
                    ]);
                  }
                },
              );
            } else if (batchLang !== "other") {
              const translateResponse = await withRetry(() =>
                apiClient.batchTranslate(textsToTranslate, batchLangCode),
              );
              const translations =
                (translateResponse as { translations?: string[] })
                  .translations || [];
              translations.forEach((trans: string, i: number) => {
                if (!trans) return;
                const idx = needsTranslation[i];
                const parsed = extractFirstDefinition(trans);
                if (batchLang === "english")
                  currentRows[idx].translation = parsed.text;
                else if (batchLang === "japanese")
                  currentRows[idx].japanese_translation = parsed.text;
                else if (batchLang === "korean")
                  currentRows[idx].korean_translation = parsed.text;
                if (parsed.pos)
                  currentRows[idx].partsOfSpeech = convertAbbreviatedPOS([
                    parsed.pos,
                  ]);
              });
            }
          } catch (error) {
            console.error("Batch translation failed:", error);
          }

          completedSteps += needsTranslation.length;
          setRows([...currentRows]);
          setBatchProgress({
            completedItems,
            totalItems,
            completedSteps,
            totalSteps,
          });
        }

        // --- Phase 2: TTS (parallel per-item) ---
        if (needsTTS.length > 0 && !batchPauseRef.current) {
          const ttsResults = await Promise.allSettled(
            needsTTS.map((idx) => {
              const text = currentRows[idx].text;
              const { voice, rate } = getVoiceAndRate(
                batchTTSAccent,
                batchTTSGender,
                batchTTSSpeed,
              );
              return withRetry(() =>
                apiClient.generateTTS(text, voice, rate, "+0%"),
              );
            }),
          );

          ttsResults.forEach((result, i) => {
            if (result.status === "fulfilled") {
              const ttsResult = result.value;
              if (
                ttsResult &&
                typeof ttsResult === "object" &&
                "audio_url" in ttsResult
              ) {
                const audioUrl = (ttsResult as { audio_url: string }).audio_url;
                const fullUrl = audioUrl?.startsWith("http")
                  ? audioUrl
                  : `${import.meta.env.VITE_API_URL}${audioUrl}`;
                const idx = needsTTS[i];
                currentRows[idx].audioUrl = fullUrl;
                currentRows[idx].audio_url = fullUrl;
              }
            } else {
              console.error(
                `TTS failed for "${currentRows[needsTTS[i]].text}":`,
                result.reason,
              );
            }
          });

          completedSteps += needsTTS.length;
          setRows([...currentRows]);
          setBatchProgress({
            completedItems,
            totalItems,
            completedSteps,
            totalSteps,
          });
        }

        // --- Phase 3: Example sentences (parallel batch) ---
        if (needsExamples.length > 0 && !batchPauseRef.current) {
          const exWords = needsExamples.map((idx) => currentRows[idx].text);
          const exDefs = needsExamples.map(
            (idx) => currentRows[idx].definition || "",
          );
          const exPOS = needsExamples.map(
            (idx) => currentRows[idx].partsOfSpeech || [],
          );

          try {
            // Issue #757: backend co-generates TTS, so audio_url comes back
            // here and is persisted on save — no dispatch-time backfill.
            const firstSettings = currentRows[needsExamples[0]]?.audioSettings;
            const response = await withRetry(() =>
              apiClient.generateSentences({
                words: exWords,
                definitions: exDefs,
                lesson_id: lessonId,
                level: aiGenerateLevel,
                prompt: aiGeneratePrompt || undefined,
                translate_to: exampleTargetLang || undefined,
                parts_of_speech: exPOS,
                audio_settings: firstSettings
                  ? {
                      accent: firstSettings.accent,
                      gender: firstSettings.gender,
                      speed: firstSettings.speed,
                    }
                  : undefined,
              }),
            );
            const sentencesData = response.sentences || [];
            sentencesData.forEach((s, i: number) => {
              if (!s) return;
              const idx = needsExamples[i];
              currentRows[idx].example_sentence = s.sentence || "";
              currentRows[idx].cloze_answer = s.cloze_answer || "";
              if (s.translation) {
                currentRows[idx].example_sentence_translation = s.translation;
              }
              if (s.audio_url) {
                currentRows[idx].example_sentence_audio_url = s.audio_url;
              }
            });
          } catch (error) {
            console.error("Batch example sentence generation failed:", error);
          }

          completedSteps += needsExamples.length;
          setRows([...currentRows]);
          setBatchProgress({
            completedItems,
            totalItems,
            completedSteps,
            totalSteps,
          });
        }

        // --- Phase 4: Translate existing example sentences missing translation ---
        if (
          needsExampleTranslation.length > 0 &&
          !batchPauseRef.current &&
          exampleTargetLang
        ) {
          const textsToTranslate = needsExampleTranslation.map(
            (idx) => currentRows[idx].example_sentence || "",
          );

          try {
            const translateResponse = await withRetry(() =>
              apiClient.batchTranslate(textsToTranslate, exampleTargetLang),
            );
            const translations =
              (translateResponse as { translations?: string[] }).translations ||
              [];
            translations.forEach((trans: string, i: number) => {
              if (!trans) return;
              const idx = needsExampleTranslation[i];
              const sentenceLang =
                currentRows[idx].selectedSentenceLanguage ||
                aiGenerateTranslateLang ||
                "chinese";
              if (sentenceLang === "japanese") {
                currentRows[idx].example_sentence_japanese = trans;
              } else if (sentenceLang === "korean") {
                currentRows[idx].example_sentence_korean = trans;
              } else {
                currentRows[idx].example_sentence_translation = trans;
              }
            });
          } catch (error) {
            console.error("Batch example translation failed:", error);
          }

          completedSteps += needsExampleTranslation.length;
          setRows([...currentRows]);
          setBatchProgress({
            completedItems,
            totalItems,
            completedSteps,
            totalSteps,
          });
        }

        // --- Phase 5 (Issue #757): Backfill example sentence audio ---
        // 對「已經有例句但缺音檔」的項目跑 TTS，讓魔術貼上補完整。
        // 沒這個 phase 的話，這些 row 永遠帶不到例句音檔，使用者派發
        // reading / rearrangement+audio / word_cloze+audio 時會被擋下。
        if (needsExampleAudio.length > 0 && !batchPauseRef.current) {
          const audioResults = await Promise.allSettled(
            needsExampleAudio.map((idx) => {
              const row = currentRows[idx];
              const { voice, rate } = getVoiceAndRate(
                row.audioSettings?.accent || batchTTSAccent,
                row.audioSettings?.gender || batchTTSGender,
                row.audioSettings?.speed || batchTTSSpeed,
              );
              return withRetry(() =>
                apiClient.generateTTS(
                  row.example_sentence || "",
                  voice,
                  rate,
                  "+0%",
                ),
              );
            }),
          );
          audioResults.forEach((result, i) => {
            if (result.status === "fulfilled") {
              const url = (result.value as { audio_url?: string })?.audio_url;
              if (url) {
                const fullUrl = url.startsWith("http")
                  ? url
                  : `${import.meta.env.VITE_API_URL}${url}`;
                const idx = needsExampleAudio[i];
                currentRows[idx].example_sentence_audio_url = fullUrl;
              }
            } else {
              console.error(
                `Example sentence TTS failed for "${currentRows[needsExampleAudio[i]].example_sentence}":`,
                result.reason,
              );
            }
          });

          completedSteps += needsExampleAudio.length;
          setRows([...currentRows]);
          setBatchProgress({
            completedItems,
            totalItems,
            completedSteps,
            totalSteps,
          });
        }

        completedItems = totalItems;

        toast.success(
          t("vocabularySet.messages.itemsAdded", {
            added: completedItems,
            total: totalItems,
          }),
        );
        setIsBatchPasting(false);
        setBatchProgress(null);
        return;
      }

      // === 貼上模式 ===
      // 清除空白 items
      const nonEmptyRows = rows.filter((row) => row.text && row.text.trim());
      const remaining = BATCH_PASTE_MAX - nonEmptyRows.length;

      if (remaining <= 0) {
        toast.error(
          t("contentEditor.messages.batchPasteLimit", {
            count: BATCH_PASTE_MAX,
          }),
        );
        setIsBatchPasting(false);
        return;
      }

      // 只取剩餘空間能容納的數量，剩下的留在輸入框
      const linesToPaste = lines.slice(0, remaining);
      const leftoverLines = lines.slice(remaining);

      const batchLang = lastSelectedWordLang;
      const batchLangCode =
        batchLang === "other"
          ? customTranslationLang || ""
          : WORD_TRANSLATION_LANGUAGES.find((l) => l.value === batchLang)
              ?.code || "zh-TW";

      // TTS settings — 每題在迴圈內重新解析 Random
      if (autoTTS) {
        saveBatchTTSSettings();
      }

      // AI 例句設定
      const shouldGenerateExamples = aiGenerateExpanded;
      let exampleTargetLang = "";
      if (shouldGenerateExamples) {
        if (aiGenerateTranslateLang === "other") {
          exampleTargetLang = customSentenceTranslationLang || "";
        } else if (aiGenerateTranslateLang) {
          exampleTargetLang =
            SENTENCE_TRANSLATION_LANGUAGES.find(
              (l) => l.value === aiGenerateTranslateLang,
            )?.code || "";
        }
      }

      let currentRows = [...nonEmptyRows];
      let completedItems = 0;
      let completedSteps = 0;

      // 每個新單字的步驟數
      const stepsPerItem =
        (autoTranslate ? 1 : 0) +
        (autoTTS ? 1 : 0) +
        (shouldGenerateExamples ? 1 : 0);
      const totalSteps = linesToPaste.length * stepsPerItem;
      const totalItems = linesToPaste.length;

      setBatchProgress({
        completedItems: 0,
        totalItems,
        completedSteps: 0,
        totalSteps,
      });

      for (let i = 0; i < linesToPaste.length; i++) {
        // 檢查是否暫停
        if (batchPauseRef.current) {
          const unprocessed = linesToPaste.slice(i);
          setBatchPasteText([...unprocessed, ...leftoverLines].join("\n"));
          toast.info(
            `${t("contentEditor.messages.batchPaused")} (${completedItems}/${totalItems})`,
          );
          break;
        }

        const text = linesToPaste[i];

        // 建立新 item
        const newItem: ContentRow = {
          id: `batch-${Date.now()}-${i}`,
          text,
          definition: "",
          translation: "",
          selectedWordLanguage: lastSelectedWordLang || undefined,
          example_sentence: "",
          example_sentence_translation: "",
        };

        try {
          // Step 1: 翻譯
          if (autoTranslate) {
            if (batchLang === "chinese") {
              const posResponse = await apiClient.batchTranslateWithPos(
                [text],
                batchLangCode,
              );
              const results = posResponse.results || [];
              if (results[0]) {
                const parsed = extractFirstDefinition(
                  results[0].translation || "",
                );
                newItem.definition = parsed.text;
                if (results[0].parts_of_speech?.length > 0) {
                  newItem.partsOfSpeech = convertAbbreviatedPOS(
                    results[0].parts_of_speech,
                  );
                } else if (parsed.pos) {
                  newItem.partsOfSpeech = convertAbbreviatedPOS([parsed.pos]);
                }
              }
            } else if (batchLang !== "other") {
              const translateResponse = await apiClient.batchTranslate(
                [text],
                batchLangCode,
              );
              const translations =
                (translateResponse as { translations?: string[] })
                  .translations || [];
              if (translations[0]) {
                const parsed = extractFirstDefinition(translations[0]);
                if (batchLang === "english") newItem.translation = parsed.text;
                else if (batchLang === "japanese")
                  newItem.japanese_translation = parsed.text;
                else if (batchLang === "korean")
                  newItem.korean_translation = parsed.text;
                if (parsed.pos)
                  newItem.partsOfSpeech = convertAbbreviatedPOS([parsed.pos]);
              }
            } else {
              // 自訂語言：使用 batchTranslate with custom lang
              const customCode = customTranslationLang || "zh-TW";
              const translateResponse = await apiClient.batchTranslate(
                [text],
                customCode,
              );
              const translations =
                (translateResponse as { translations?: string[] })
                  .translations || [];
              if (translations[0]) {
                newItem.definition = translations[0];
              }
            }
            completedSteps++;
            setBatchProgress({
              completedItems,
              totalItems,
              completedSteps,
              totalSteps,
            });
          }

          // Step 2: TTS — 每題重新解析 Random
          if (autoTTS) {
            const { voice, rate } = getVoiceAndRate(
              batchTTSAccent,
              batchTTSGender,
              batchTTSSpeed,
            );
            const ttsResult = await apiClient.generateTTS(
              text,
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
              const fullUrl = audioUrl?.startsWith("http")
                ? audioUrl
                : `${import.meta.env.VITE_API_URL}${audioUrl}`;
              newItem.audioUrl = fullUrl;
              newItem.audio_url = fullUrl;
            }
            completedSteps++;
            setBatchProgress({
              completedItems,
              totalItems,
              completedSteps,
              totalSteps,
            });
          }

          // Step 3: AI 例句（Issue #757：audio_url 隨 sentence 一起回來）
          if (shouldGenerateExamples) {
            const response = await apiClient.generateSentences({
              words: [text],
              definitions: [newItem.definition || ""],
              lesson_id: lessonId,
              level: aiGenerateLevel,
              prompt: aiGeneratePrompt || undefined,
              translate_to: exampleTargetLang || undefined,
              parts_of_speech: [newItem.partsOfSpeech || []],
              audio_settings: newItem.audioSettings
                ? {
                    accent: newItem.audioSettings.accent,
                    gender: newItem.audioSettings.gender,
                    speed: newItem.audioSettings.speed,
                  }
                : undefined,
            });
            const sentencesData = response.sentences || [];
            if (sentencesData[0]) {
              newItem.example_sentence = sentencesData[0].sentence || "";
              newItem.cloze_answer = sentencesData[0].cloze_answer || "";
              if (sentencesData[0].translation) {
                newItem.example_sentence_translation =
                  sentencesData[0].translation;
              }
              if (sentencesData[0].audio_url) {
                newItem.example_sentence_audio_url = sentencesData[0].audio_url;
              }
            }
            completedSteps++;
            setBatchProgress({
              completedItems,
              totalItems,
              completedSteps,
              totalSteps,
            });
          }
        } catch (error) {
          console.error(`Error processing word "${text}":`, error);
        }

        // 即時更新 UI
        currentRows = [...currentRows, newItem];
        setRows(currentRows);
        completedItems++;
        setBatchProgress({
          completedItems,
          totalItems,
          completedSteps,
          totalSteps,
        });
      }

      // 處理完成或暫停後
      if (!batchPauseRef.current) {
        setBatchPasteText(leftoverLines.join("\n"));
        toast.success(
          t("vocabularySet.messages.itemsAdded", {
            added: completedItems,
            total: currentRows.length,
          }),
        );
        if (leftoverLines.length === 0) {
          setBatchPasteDialogOpen(false);
        }
      }
    } finally {
      setIsBatchPasting(false);
      setBatchProgress(null);
    }
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
    // 不鎖高度：根容器隨內容長高，捲動交給外層（Dialog 的 overflow 區）。
    // 若在此鎖 max-h，中間 flex row 會被壓死，左側 sticky 面板只能在那段高度內
    // 移動、捲過就被帶走 —— 這正是左側區塊會「被上面吃掉」的原因。
    <div className="flex flex-col">
      {/* Fixed Header Section */}
      <div className="flex-shrink-0 space-y-4 pb-4">
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

        {/* Mobile only: Batch Actions buttons */}
        <div className="flex flex-wrap gap-2 md:hidden">
          {/* 魔術貼上（issue #891）— 作業副本不提供 */}
          {!isAssignmentCopy && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMagicPasteOpen(true)}
              className="bg-purple-100 hover:bg-purple-200 border-purple-300"
              title="從圖片 / PDF 擷取教材"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              魔術貼上
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBatchPasteDialogOpen(true)}
            className="bg-blue-100 hover:bg-blue-200 border-blue-300"
            title={t("readingAssessmentPanel.batchActions.batchPasteTooltip")}
          >
            <Clipboard className="h-4 w-4 mr-1" />
            {t("readingAssessmentPanel.batchActions.batchPaste")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBatchGenerateTTS}
            className="bg-yellow-100 hover:bg-yellow-200 border-yellow-300"
            title={t(
              "readingAssessmentPanel.batchActions.batchGenerateTTSTooltip",
            )}
          >
            <Volume2 className="h-4 w-4 mr-1" />
            {t("readingAssessmentPanel.batchActions.batchGenerateTTS")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBatchGenerateDefinitions()}
            className="bg-green-100 hover:bg-green-200 border-green-300"
            title={t(
              "readingAssessmentPanel.batchActions.batchGenerateTranslationTooltip",
            )}
          >
            <Globe className="h-4 w-4 mr-1" />
            {t("readingAssessmentPanel.batchActions.batchGenerateTranslation")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenAIGenerateModal(null)}
            className="bg-purple-100 hover:bg-purple-200 border-purple-300"
            title={t("vocabularySet.tooltips.batchAIGenerateExamples")}
          >
            <Globe className="h-4 w-4 mr-1" />
            {t("vocabularySet.buttons.batchAIGenerateExamples")}
          </Button>
        </div>
      </div>

      {/* Desktop: Side-by-side layout / Mobile: Editor only */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Left: Batch Work Area (Desktop only) — hidden for assignment copy */}
        {!isAssignmentCopy && (
          <BatchWorkPanel
            text={batchPasteText}
            onTextChange={setBatchPasteText}
            maxItems={BATCH_PASTE_MAX}
            placeholder="apple&#10;banana&#10;orange"
            autoTranslate={batchPasteAutoTranslate}
            onAutoTranslateChange={setBatchPasteAutoTranslate}
            selectedLanguage={lastSelectedWordLang}
            onLanguageChange={(lang) => {
              const newLang = lang as WordTranslationLanguage;
              setLastSelectedWordLang(newLang);
              setRows((prev) =>
                prev.map((row) => ({ ...row, selectedWordLanguage: newLang })),
              );
            }}
            translationLanguages={WORD_TRANSLATION_LANGUAGES}
            customLanguage={customTranslationLang}
            onCustomLanguageChange={setCustomTranslationLang}
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
            onPause={() => {
              batchPauseRef.current = true;
            }}
            isBusy={isBatchPasting}
            progress={batchProgress}
            imageTab={
              <MagicPasteInput
                extractMode="vocabulary"
                level={aiGenerateLevel}
                onInsert={handleMagicPasteInsert}
                validateBeforeExtract={() => {
                  // 勾了翻譯但沒選語言 → 擋下（避免白白消耗配額）
                  if (batchPasteAutoTranslate && !lastSelectedWordLang)
                    return t("contentEditor.labels.selectLanguage");
                  if (
                    batchPasteAutoTranslate &&
                    lastSelectedWordLang === "other" &&
                    !customTranslationLang.trim()
                  )
                    return t("contentEditor.labels.enterCustomLanguage");
                  // 勾了 AI 生成例句但沒選例句翻譯語言 → 擋下
                  if (aiGenerateExpanded && !aiGenerateTranslateLang)
                    return t("contentEditor.labels.selectExampleLanguage");
                  if (
                    aiGenerateExpanded &&
                    aiGenerateTranslateLang === "other" &&
                    !customSentenceTranslationLang.trim()
                  )
                    return t("contentEditor.labels.enterCustomLanguage");
                  return null;
                }}
              />
            }
          >
            {/* AI Generate Examples（緊湊版）*/}
            <div className="mt-3 bg-purple-50/60 rounded-lg border border-purple-200">
              <div className="flex items-center gap-2 p-2.5">
                <input
                  type="checkbox"
                  checked={aiGenerateExpanded}
                  onChange={(e) => setAiGenerateExpanded(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="text-sm font-semibold text-gray-800">
                  {t("vocabularySet.modals.aiGenerateExamplesTitle")}
                </span>
                <span className="text-[10px] font-bold text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded">
                  Beta
                </span>
                {aiGenerateExpanded && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <label className="text-[11px] text-gray-500 shrink-0">
                      {t("vocabularySet.labels.translateTo")}
                    </label>
                    <select
                      value={aiGenerateTranslateLang}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAiGenerateTranslateLang(val);
                        if (val !== "other")
                          setCustomSentenceTranslationLang("");
                        // 切換語言時清空所有例句翻譯欄位
                        setRows((prev) =>
                          prev.map((row) => ({
                            ...row,
                            example_sentence_translation: "",
                            example_sentence_japanese: "",
                            example_sentence_korean: "",
                            selectedSentenceLanguage: (val || undefined) as
                              | SentenceTranslationLanguage
                              | undefined,
                          })),
                        );
                      }}
                      className="max-w-[130px] px-2 py-1 border border-gray-300 rounded text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">
                        {t("contentEditor.labels.selectLanguage")}
                      </option>
                      {SENTENCE_TRANSLATION_LANGUAGES.map((lang) => (
                        <option key={lang.value} value={lang.value}>
                          {lang.label}
                        </option>
                      ))}
                      <option value="other">
                        {t("contentEditor.labels.otherLanguage")}
                      </option>
                    </select>
                  </div>
                )}
              </div>
              {aiGenerateExpanded && (
                <div className="px-2.5 pb-2.5 space-y-2">
                  {/* Difficulty Level — 標籤與 chips 同一行 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-[11px] text-gray-500 shrink-0">
                      {t("vocabularySet.labels.difficultyLevel")}
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => (
                        <button
                          key={level}
                          onClick={() => setAiGenerateLevel(level)}
                          className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
                            aiGenerateLevel === level
                              ? "bg-gradient-to-r from-cyan-400 to-teal-400 text-white shadow-sm"
                              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* AI Prompt */}
                  <textarea
                    value={aiGeneratePrompt}
                    onChange={(e) => setAiGeneratePrompt(e.target.value)}
                    placeholder={t(
                      "vocabularySet.placeholders.aiPromptExample",
                    )}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm resize-none"
                    rows={2}
                  />

                  {/* 「翻譯成」語言選單已移至標題行右上角；此處僅保留自訂語言輸入 */}
                  {aiGenerateTranslateLang === "other" && (
                    <input
                      type="text"
                      value={customSentenceTranslationLang}
                      onChange={(e) =>
                        setCustomSentenceTranslationLang(e.target.value)
                      }
                      placeholder={t("contentEditor.labels.enterLanguage")}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                </div>
              )}
            </div>
          </BatchWorkPanel>
        )}

        {/* Right: Word Editor Area */}
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
              {/* 小題清單自然增長、跟著頁面往下滑；左側批次區改用定高 + sticky 固定 */}
              <div className="flex-1 space-y-3 pr-2">
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
                      handleImageUpload={handleImageUpload}
                      handleRemoveImage={handleRemoveImage}
                      handleGenerateSingleDefinition={
                        handleGenerateSingleDefinition
                      }
                      handleGenerateSingleDefinitionWithLang={
                        handleGenerateSingleDefinitionWithLang
                      }
                      handleGenerateExampleTranslation={
                        handleGenerateExampleTranslation
                      }
                      handleGenerateExampleTranslationWithLang={
                        handleGenerateExampleTranslationWithLang
                      }
                      handleOpenAIGenerateModal={handleOpenAIGenerateModal}
                      rowsLength={rows.length}
                      imageUploading={imageUploading}
                      isActive={activeRowIndex === index}
                      onRowFocus={() => setActiveRowIndex(index)}
                      onWordLanguageChange={setLastSelectedWordLang}
                      isAssignmentCopy={isAssignmentCopy}
                      showOptionImages={showOptionImages}
                      duplicateReasons={duplicateMap.get(index)}
                      customTranslationLang={customTranslationLang}
                      sentenceTranslationLang={aiGenerateTranslateLang}
                      customSentenceTranslationLang={
                        customSentenceTranslationLang
                      }
                    />
                  );
                })}

                {/* Add Row Button — hidden for assignment copy */}
                {!isAssignmentCopy && (
                  <button
                    onClick={handleAddRow}
                    className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 flex items-center justify-center gap-2 text-gray-600 hover:text-blue-600"
                    disabled={rows.length >= BATCH_PASTE_MAX}
                  >
                    <Plus className="h-5 w-5" />
                    {t("contentEditor.buttons.addItem")}
                  </button>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        {/* End Right: Word Editor Area */}
      </div>
      {/* End Desktop side-by-side / Mobile layout */}

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

      {/* 多義 Picker Dialog（英英釋義 / 中文翻譯） */}
      <Dialog
        open={definitionPicker !== null}
        onOpenChange={(open) => {
          if (!open) setDefinitionPicker(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(() => {
                const lang = definitionPicker?.targetLang;
                const word = definitionPicker?.word;
                if (lang === "chinese") return `選擇「${word}」的中文翻譯`;
                if (lang === "japanese") return `選擇「${word}」的日文翻譯`;
                if (lang === "korean") return `選擇「${word}」的韓文翻譯`;
                return `選擇「${word}」的英英釋義`;
              })()}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {definitionPicker?.options.map((def, i) => (
              <button
                key={i}
                onClick={() => {
                  const parsed = extractPosFromTranslation(def);
                  const newRows = [...rows];
                  const ri = definitionPicker.rowIndex;
                  if (parsed.pos) {
                    newRows[ri].partsOfSpeech = convertAbbreviatedPOS([
                      parsed.pos,
                    ]);
                  }
                  const tLang = definitionPicker.targetLang;
                  if (tLang === "chinese") {
                    newRows[ri].definition = parsed.text;
                  } else if (tLang === "english") {
                    newRows[ri].translation = parsed.text;
                  } else if (tLang === "japanese") {
                    newRows[ri].japanese_translation = parsed.text;
                  } else if (tLang === "korean") {
                    newRows[ri].korean_translation = parsed.text;
                  }
                  setRows(newRows);
                  setDefinitionPicker(null);
                  toast.success(
                    t("contentEditor.messages.translationComplete"),
                  );
                }}
                className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all text-sm"
              >
                {def}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 魔術貼上 Dialog（issue #891）*/}
      <MagicPasteDialog
        open={magicPasteOpen}
        onClose={() => setMagicPasteOpen(false)}
        onInsert={handleMagicPasteInsert}
        level={aiGenerateLevel}
        extractMode="vocabulary"
      />

      {/* Batch Paste Dialog (Mobile only - desktop uses inline left panel) */}
      <Dialog
        open={batchPasteDialogOpen}
        onOpenChange={(open) => {
          if (!isBatchPasting) setBatchPasteDialogOpen(open);
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
              maxItems={BATCH_PASTE_MAX}
              placeholder="apple&#10;banana&#10;orange"
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
              disabled={isBatchPasting}
              className="px-6 py-2 text-base"
            >
              {t("contentEditor.buttons.cancel")}
            </Button>
            <Button
              onClick={() =>
                handleBatchPaste(batchPasteAutoTTS, batchPasteAutoTranslate)
              }
              disabled={isBatchPasting}
              className="px-6 py-2 text-base bg-blue-600 hover:bg-blue-700"
            >
              {isBatchPasting
                ? t("contentEditor.buttons.generating")
                : t("contentEditor.buttons.confirmPaste")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI 生成例句對話框 */}
      <Dialog open={aiGenerateModalOpen} onOpenChange={setAiGenerateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {t("vocabularySet.modals.aiGenerateExamplesTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* 難度等級選擇 */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                {t("vocabularySet.labels.difficultyLevel")}
              </label>
              <div className="flex flex-wrap gap-2">
                {["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => (
                  <button
                    key={level}
                    onClick={() => setAiGenerateLevel(level)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      aiGenerateLevel === level
                        ? "bg-gradient-to-r from-cyan-400 to-teal-400 text-white shadow-sm"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Prompt 輸入 */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                {t("vocabularySet.labels.aiPrompt")}
              </label>
              <textarea
                value={aiGeneratePrompt}
                onChange={(e) => setAiGeneratePrompt(e.target.value)}
                placeholder={t("vocabularySet.placeholders.aiPromptExample")}
                className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
                rows={3}
              />
            </div>

            {/* 翻譯選項 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t("vocabularySet.labels.translateTo")}
              </label>
              <select
                value={aiGenerateTranslateLang}
                onChange={(e) => {
                  const val = e.target.value;
                  setAiGenerateTranslateLang(val);
                  if (val !== "other") setCustomSentenceTranslationLang("");
                }}
                className="w-full px-3 py-1.5 border rounded-md text-sm"
              >
                <option value="">
                  {t("contentEditor.labels.selectLanguage")}
                </option>
                {SENTENCE_TRANSLATION_LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>
                    {lang.label}
                  </option>
                ))}
                <option value="other">
                  {t("contentEditor.labels.otherLanguage")}
                </option>
              </select>
              {aiGenerateTranslateLang === "other" && (
                <input
                  type="text"
                  value={customSentenceTranslationLang}
                  onChange={(e) =>
                    setCustomSentenceTranslationLang(e.target.value)
                  }
                  placeholder={t("contentEditor.labels.enterLanguage")}
                  className="w-full px-3 py-1.5 border rounded-md text-sm"
                />
              )}
            </div>

            {/* 生成目標提示 */}
            <div className="text-sm bg-amber-50 border border-amber-200 p-3 rounded-lg">
              {aiGenerateTargetIndex !== null ? (
                <div>
                  <span className="text-amber-700">
                    {t("vocabularySet.messages.willRegenerateFor", {
                      word: rows[aiGenerateTargetIndex]?.text || "",
                    })}
                  </span>
                  {rows[aiGenerateTargetIndex]?.example_sentence && (
                    <div className="text-amber-600 text-xs mt-1">
                      {t("vocabularySet.messages.existingWillBeOverwritten")}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {(() => {
                    const total = rows.filter(
                      (r) => r.text && r.text.trim(),
                    ).length;
                    const skipped = rows.filter(
                      (r) =>
                        r.text && r.text.trim() && r.example_sentence?.trim(),
                    ).length;
                    const toGenerate = total - skipped;
                    return (
                      <>
                        <span className="text-amber-700">
                          {t("vocabularySet.messages.wordsWillRegenerate", {
                            count: toGenerate,
                          })}
                        </span>
                        {skipped > 0 && (
                          <div className="text-muted-foreground text-xs mt-1">
                            {t(
                              "vocabularySet.messages.existingSentencesSkipped",
                              { count: skipped },
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAiGenerateModalOpen(false)}
            >
              {t("contentEditor.buttons.cancel")}
            </Button>
            <Button
              onClick={handleAIGenerateSentences}
              disabled={isGeneratingAI}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isGeneratingAI
                ? t("vocabularySet.buttons.generating")
                : t("vocabularySet.buttons.generate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Button */}
    </div>
  );
});

export default VocabularySetPanel;
