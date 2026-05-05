/**
 * SentenceMakingActivity - 造句練習主組件
 *
 * 功能：
 * - 獲取練習題目（根據艾賓浩斯記憶曲線選擇）
 * - 根據 answer_mode 決定使用 ListeningMode 或 WritingMode
 * - 管理答題狀態和進度
 * - 檢查達標狀態
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { Loader2 } from "lucide-react";
import WritingModeTemplate from "./WritingModeTemplate";
import ListeningModeTemplate from "./ListeningModeTemplate";

interface PracticeWord {
  content_item_id: number;
  text: string;
  translation: string;
  example_sentence: string;
  example_sentence_translation: string;
  audio_url?: string;
  memory_strength: number;
  priority_score: number;
}

interface AnswerRecord {
  content_item_id: number;
  is_correct: boolean;
  time_spent_seconds: number;
  answer_data: {
    selected_words: string[];
    attempts: number;
  };
}

interface MasteryStatus {
  current_mastery: number;
  target_mastery: number;
  achieved: boolean;
  words_mastered: number;
  total_words: number;
}

interface SentenceMakingState {
  sessionId: number | null;
  answerMode: "listening" | "writing";
  words: PracticeWord[];
  currentIndex: number;
  answers: AnswerRecord[];
  loading: boolean;
  masteryStatus: MasteryStatus | null;
  completing: boolean;
}

interface WordItem {
  word?: string;
  text?: string;
  translation?: string;
  example_sentence?: string;
  example_sentence_translation?: string;
}

interface ActivityContent {
  words?: WordItem[];
}

interface SentenceMakingActivityProps {
  assignmentId?: number; // Optional: undefined in organization material context
  onComplete?: () => void;
  activityContent?: ActivityContent; // Optional: provide content for preview mode
  // 老師預覽示範模式：用 /api/teachers/.../preview/practice-words 端點，
  // 不建立 PracticeSession，submit/mastery 都不會打（讓老師看題目就好）
  isPreviewMode?: boolean;
}

const SentenceMakingActivity: React.FC<SentenceMakingActivityProps> = ({
  assignmentId,
  onComplete,
  activityContent,
  isPreviewMode = false,
}) => {
  const [state, setState] = useState<SentenceMakingState>({
    sessionId: null,
    answerMode: "writing",
    words: [],
    currentIndex: 0,
    answers: [],
    loading: true,
    masteryStatus: null,
    completing: false,
  });

  // 初始化：獲取練習題目 (only if assignmentId is provided)
  useEffect(() => {
    if (assignmentId) {
      loadPracticeWords();
    } else {
      // Organization material preview mode - no API call needed
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [assignmentId]);

  const loadPracticeWords = async () => {
    try {
      setState((prev) => ({ ...prev, loading: true }));

      // 老師預覽模式打 teachers/preview 端點（assignment_id），不建 session
      const apiUrl = isPreviewMode
        ? `/api/teachers/assignments/${assignmentId}/preview/practice-words`
        : `/api/students/assignments/${assignmentId}/practice-words`;

      const response = (await apiClient.get(apiUrl)) as {
        session_id: number | null;
        answer_mode: "listening" | "writing";
        words: PracticeWord[];
      };

      setState((prev) => ({
        ...prev,
        sessionId: response.session_id,
        answerMode: response.answer_mode,
        words: response.words,
        currentIndex: 0,
        loading: false,
      }));
    } catch (error) {
      console.error("Failed to load practice words:", error);
      toast.error("無法載入練習題目");
      setState((prev) => ({ ...prev, loading: false }));
    }
  };

  // 提交答案
  const submitAnswer = async (answer: AnswerRecord) => {
    // 預覽模式（session_id=null）：純前端推進，不打 submit/mastery API
    if (isPreviewMode) {
      setState((prev) => ({ ...prev, answers: [...prev.answers, answer] }));
      if (state.currentIndex < state.words.length - 1) {
        setState((prev) => ({ ...prev, currentIndex: prev.currentIndex + 1 }));
      } else {
        toast.success("預覽完成");
        if (onComplete) onComplete();
      }
      return;
    }

    if (!state.sessionId) {
      toast.error("練習 session 不存在");
      return;
    }

    try {
      await apiClient.post(
        `/api/students/practice-sessions/${state.sessionId}/submit-answer`,
        answer,
      );

      // 記錄答案
      setState((prev) => ({
        ...prev,
        answers: [...prev.answers, answer],
      }));

      // 移動到下一題
      if (state.currentIndex < state.words.length - 1) {
        setState((prev) => ({ ...prev, currentIndex: prev.currentIndex + 1 }));
      } else {
        // 完成本輪練習，檢查達標狀態
        await checkMasteryStatus();
      }
    } catch (error) {
      console.error("Failed to submit answer:", error);
      toast.error("提交答案失敗");
    }
  };

  // 檢查達標狀態
  const checkMasteryStatus = async () => {
    try {
      setState((prev) => ({ ...prev, completing: true }));

      const status = (await apiClient.get(
        `/api/students/assignments/${assignmentId}/mastery-status`,
      )) as MasteryStatus;

      setState((prev) => ({
        ...prev,
        masteryStatus: status,
        completing: false,
      }));

      if (status.achieved) {
        toast.success("🎉 恭喜！您已達成目標熟悉度！");
        // 等待 2 秒後執行 onComplete
        setTimeout(() => {
          if (onComplete) {
            onComplete();
          }
        }, 2000);
      } else {
        const masteryPercent = (status.current_mastery * 100).toFixed(0);
        toast.info(
          `當前熟悉度：${masteryPercent}%，繼續加油！已掌握 ${status.words_mastered}/${status.total_words} 個單字`,
        );
        // 重新載入下一輪題目
        setTimeout(() => {
          loadPracticeWords();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to check mastery status:", error);
      toast.error("無法檢查作業完成度");
      setState((prev) => ({ ...prev, completing: false }));
    }
  };

  // Loading 狀態
  if (state.loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-600">正在載入練習題目...</p>
      </div>
    );
  }

  // Completing 狀態（檢查達標中）
  if (state.completing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-12 w-12 animate-spin text-green-600 mb-4" />
        <p className="text-gray-600">正在計算您的學習進度...</p>
      </div>
    );
  }

  // 沒有題目
  if (state.words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-gray-600 mb-4">目前沒有需要練習的單字</p>
      </div>
    );
  }

  // Organization material preview mode (no assignmentId)
  if (!assignmentId && activityContent) {
    const words = activityContent.words || [];
    return (
      <div className="border rounded-lg p-6 bg-gray-50">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">
          單字列表預覽
        </h3>
        <div className="space-y-4">
          {words.map((word: WordItem, index: number) => (
            <div key={index} className="p-4 bg-white rounded-lg border">
              <div className="font-semibold text-lg text-gray-900">
                {word.word || word.text || "(未填寫)"}
              </div>
              <div className="text-gray-600 mt-1">
                {word.translation || "(未填寫)"}
              </div>
              {word.example_sentence && (
                <div className="mt-2 text-sm text-gray-500">
                  <div className="font-medium">例句：</div>
                  <div>{word.example_sentence}</div>
                  {word.example_sentence_translation && (
                    <div className="text-gray-400 mt-1">
                      {word.example_sentence_translation}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {words.length === 0 && (
            <div className="text-center text-gray-500 py-8">
              尚未新增任何單字
            </div>
          )}
        </div>
      </div>
    );
  }

  // Student assignment mode (requires assignmentId)
  const currentWord = state.words[state.currentIndex];
  const progress = {
    current: state.currentIndex + 1,
    total: state.words.length,
  };

  // 根據 answer_mode 渲染對應的 Template
  return (
    <div className="sentence-making-activity">
      {state.answerMode === "listening" ? (
        <ListeningModeTemplate
          word={currentWord}
          onSubmit={submitAnswer}
          progress={progress}
        />
      ) : (
        <WritingModeTemplate
          word={currentWord}
          onSubmit={submitAnswer}
          progress={progress}
        />
      )}
    </div>
  );
};

export default SentenceMakingActivity;
