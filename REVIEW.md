# 審查清單

> 由 `CLAUDE.md` 匯入，CI 上的 Claude 審查不用讀其他檔案就看得到（#1116）。本機實作完成前也照這份自我檢查。
> 完整規範：`docs/design/ui-style-guide.md`。規範改了，這份要同步。

## UI 規範（前端改動才看）

只看這次 PR **新增或修改**的程式。

**重複元件**
- 新增的元件和下列標準元件重複或高度相似，或是複製標準元件後改一份：列為問題，建議改用或擴充（加 prop）標準元件。
  - `components/ui/`（shadcn）：Accordion、Alert、Badge、Button、Calendar、Card、Checkbox、Dialog、DropdownMenu、Input、Label、Popover、Progress、ScrollArea、Select、Separator、Sheet、Switch、Table、Tabs、TagInput、Textarea、Tooltip
  - `components/shared/`：AIScoreDisplay、AudioPlayer、AudioRecorder、BatchPasteArea、BatchTranslateSettings、BatchTTSSettings、BatchWorkPanel、BatchSettingCard、**BulkActionBar**（列表勾選後的批次操作列）、CreatableCombobox、ExamPointPicker、GradeRangeSlider、LabeledSwitch、MagicPasteDialog、MagicPasteInput、MaterialsPageTabs、MaterialsToolbar、ProgramFolderView、ProgramLessonPicker、ProgramTreeView、RecursiveTreeAccordion、RefSaveButton、ResourceFolderView、SchoolProgramCreateDialog、TTSSettingsDialog、VisibilitySelect
  - `components/activities/shared/`：ActivitySettingsPanel、CardNavArrow、ClozeBlankText、CountdownRing、DrawingCanvas、HandwritingCanvas、MultipleChoiceOptions、PreviewDemoDoneView、PrintPdfSheet、ProgressIndicator、PronunciationScoreChart、QuizAnswerInput、QuizOptionChip、QuizReviewView、ScoreOverlay、VirtualKeyboard、WordActivityCard、WordCard、WordChoicePanel、WordSelectionOptionButton
  - 其他跨功能元件：AssignmentDialog、ProgramVisibilitySelector、AdjustGradeDialog、GradeFilterSelect、GradeSelect、LevelBadge、MissingGradeBanner、MissingGradeDialog、ConfirmDialog、OneCampusBindSection、StudentLoginQRShare、ZoomableImage
- 改了標準元件的外觀或用法：提醒作者確認產品負責人已同意，並同步更新 `ui-style-guide.md` 第 6 節。

**顏色**
- 寫死的 hex 色碼由 ESLint 擋（`frontend/eslint.config.js`），審查不用重複報。白名單內的舊檔案新增 hex 時才提醒。
- 只報不在下列色系的新顏色：
  - 標準色系：`gray`、`blue`、`green`、`amber`、`red`。
  - 分類色：`lib/practiceMode.ts`、`lib/studentGroup.ts`、`WordSelectionOptionButton.tsx` 對照表裡的色系。
- 「待決定」的色系定案前**不算問題，不要報**：yellow、orange、emerald、rose、slate、purple、indigo、pink、violet、sky、teal、lime、cyan。

**按鈕層級**
1. 有明確下一步（例如表單送出、對話框確認）時，那一步用主按鈕（淺色畫面：藍底白字），其餘用次要；沒有明確下一步的並列操作（例如批次操作列）一律同一樣式。深藍膠囊（`BulkActionBar`）不分主次：一般＝半透明白底白字（`bg-white/15`，hover `bg-white/25`，無外框）。
2. 危險動作（例如刪除）永遠不當主按鈕。深藍膠囊上的危險＝同一般樣式＋紅色圖示（`text-red-200`）＋前面一條細分隔線，放在動作的最後一個（✕ 取消選取之前）。
3. 因權限、條件或功能未開放而停用的按鈕，一定要說明原因（tooltip、`title` 或旁邊小字）。處理中（busy）的暫時停用、表單驗證未通過的送出鈕不在此限。
