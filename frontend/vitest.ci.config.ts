import { mergeConfig } from "vite";
import baseConfig from "./vite.config";

/**
 * CI 專用 vitest 設定（Issue #1008）
 *
 * 背景：CI 長期只跑 2 個 API 測試檔（test:replace-e2e → test:api:ci），
 * 其餘 60+ 個測試檔從來沒被跑過，於是累積了一批對不上現況的過期測試。
 *
 * 這份設定讓 CI 跑「除了下列隔離名單以外的全部單元測試」，
 * 先把還健康的測試納入保護，再由後續 issue 逐檔修復隔離名單。
 *
 * ⚠️ 隔離（quarantine）不是永久豁免。修好一個就從名單移掉一個。
 *
 * 注意：這裡刻意不把名單寫進 vite.config.ts 的 test.exclude，
 * 否則本機連 `npx vitest run <該檔>` 都跑不起來，反而無法修它。
 */

/**
 * 會「無限跑不完」的測試檔 —— 絕對不能讓 CI 跑到，否則每個 PR 都卡到 timeout。
 *
 * CopyProgramDialog.test.tsx：多個測試在 `waitFor()` callback 裡面呼叫
 * `fireEvent.click()`。斷言用的是寫死中文（元件已改用 t()）所以永遠不成立，
 * waitFor 於是不斷重試 → 每次重試又點擊 checkbox 造成 DOM mutation →
 * MutationObserver 立刻再觸發一次 callback，事件迴圈被同步佔滿，
 * 連 vitest 的 testTimeout 都沒機會觸發（實測 --testTimeout=3000 仍卡住 >120s）。
 *
 * 逐個測試 bisect（vitest -t，每個 40s 上限）確認卡住的是這 3 個：
 *   - should display selected count
 *   - should copy selected programs on submit
 *   - should handle copy error
 * 其餘 11 個是單純失敗或通過，會正常結束。
 */
/**
 * 在 CI 環境下才會失敗的時間敏感測試（本機穩定通過，CI 偶發失敗）。
 *
 * StudentActivityPageContent.iosSafari.test.tsx：
 *   "requestData() is called BEFORE stop() when student stops recording"
 *   斷言 requestData 的呼叫順序早於 stop。實測本機單獨跑 4/4 通過、
 *   全 suite 590/590 通過，但 CI 上出現 `expected 34 to be less than 25`
 *   —— 也就是量到 stop() 反而先被呼叫。
 *
 *   該檔 beforeEach 有 vi.clearAllMocks()，所以不是 mock 狀態殘留，
 *   是真的在 CI 的較慢／較競爭環境下順序跑掉了。可疑的鄰居是
 *   retryHelper.integration.test.ts —— 它用真實計時器睡了 27 秒
 *   （單一檔案就佔掉 CI 總時間的一半），在核心數少的 runner 上與它併發的
 *   時間敏感測試容易被餓到。
 *
 * ⚠️ 這一項跟其他隔離不同：它守的是 iOS Safari「先 requestData 再 stop」
 *    的真實錄音正確性（漏掉最後一段音訊會變成 recording_too_small）。
 *    隔離它等於暫時失去那個保護，**必須優先處理**，不要跟過期測試一起排。
 *    可能的方向：CI 降低併發、或把 retryHelper 的真實 sleep 改成 fake timers。
 */
const FLAKY_IN_CI_TESTS = [
  "**/src/pages/student/__tests__/StudentActivityPageContent.iosSafari.test.tsx",
];

const HANGING_TESTS = [
  "**/src/components/__tests__/CopyProgramDialog.test.tsx",
];

/**
 * 會失敗但會正常結束的過期測試檔（Issue #1008 盤點結果）。
 * 每一項後面是實測的主要失敗原因。
 */
const FAILING_TESTS = [
  // 斷言 API 呼叫參數與現況不符
  "**/src/components/__tests__/RequestRevisionModal.test.tsx",
  // 斷言 i18n key 對不上（labels.uploadAndAnalyze 找不到）
  "**/src/components/activities/__tests__/GroupedQuestionsTemplate.autoAnalysis.test.tsx",
  // 斷言寫死中文 + [data-testid="barchart"] 已不存在
  "**/src/components/grading/__tests__/ClassQuizStats.test.tsx",
  // 斷言寫死中文百分比字串，元件已改用 t()
  "**/src/components/grading/__tests__/QuizGradingPanel.test.tsx",
  // 缺 SidebarProvider wrapper + spy 未被呼叫
  "**/src/components/shared/__tests__/ProgramTreeView.test.tsx",
  // userEvent 撞上 pointer-events: none
  "**/src/components/teachingTools/__tests__/DigitalTeachingToolbar.test.tsx",
  // hook 回傳結構已擴充，測試仍用舊 shape 做 deep equal
  "**/src/hooks/__tests__/useAzurePronunciation.test.ts",
  // createContent request body 已變更
  "**/src/lib/__tests__/api.createContent.test.ts",
  // 登入/認證流程已調整，次數與旗標斷言過期
  "**/src/lib/__tests__/auth-consistency.test.ts",
  // 背景分析流程已重寫，spy 呼叫次數歸零
  "**/src/pages/student/__tests__/StudentActivityPageContent.backgroundAnalysis.test.tsx",
  // 大量文案/role 查詢過期（11/15 失敗）
  "**/src/pages/student/__tests__/StudentActivityPageContent.issue75.test.tsx",
  // 同上，提交流程文案已變更
  "**/src/pages/student/__tests__/StudentActivityPageContent.submit.test.tsx",
  // 錄音格式策略已改（實際回 audio/mp4，測試期待 audio/webm）
  "**/src/utils/__tests__/audioRecordingStrategy.test.ts",
  // 卡片畫面重複渲染 VISA 字樣，getByText 撞到多筆
  "**/tests/unit/payment-card-display.test.tsx",
];

export default mergeConfig(baseConfig, {
  test: {
    exclude: [...HANGING_TESTS, ...FLAKY_IN_CI_TESTS, ...FAILING_TESTS],
    // 一般 async 測試的上限。注意：這擋不住上面那種「同步佔住事件迴圈」的卡死
    // （testTimeout 本身也是 timer，事件迴圈被佔住就不會觸發），
    // 真正的保險是 workflow 上的 timeout-minutes。
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
