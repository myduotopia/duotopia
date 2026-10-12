/**
 * 舊名相容（Issue #1082）：面板已改為題型無關的 `QuestionSheet`（依單元 kind 分流）。
 * 既有 import 不用改；新程式請直接用 `./QuestionSheet`。
 */

export { default } from "./QuestionSheet";
export type { QuestionSheetProps as MultipleChoiceQuestionSheetProps } from "./QuestionSheet";
