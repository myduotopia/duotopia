/**
 * Chrome Handwriting Recognition API — Ambient Type Declarations
 *
 * 此 API 為實驗性功能，目前僅 Chrome 支援（需開啟 flag）。
 * 官方規格：https://github.com/WICG/handwriting-recognition
 *
 * 使用前請先 feature-detect：
 *   "createHandwritingRecognizer" in navigator
 */

interface HandwritingPoint {
  x: number;
  y: number;
  /** 時間戳記（毫秒），用於提升辨識準確度 */
  t?: number;
}

declare class HandwritingStroke {
  addPoint(point: HandwritingPoint): void;
}

interface HandwritingPrediction {
  text: string;
}

interface HandwritingDrawingHints {
  /** 輸入語言（如 ["en"]）*/
  languages?: string[];
  /** 辨識類型：drawing / text / email / number / per-character */
  recognitionType?: string;
  /** 輸入類型：mouse / touch / pen */
  inputType?: string;
  /** 提示文字，可提升準確度（例如：單字集中的所有單字） */
  textContext?: string;
}

interface HandwritingDrawing {
  addStroke(stroke: HandwritingStroke): void;
  getPrediction(): Promise<HandwritingPrediction[]>;
  clear(): void;
}

interface HandwritingRecognizerConstraints {
  languages: string[];
}

interface HandwritingRecognizer {
  startDrawing(hints?: HandwritingDrawingHints): HandwritingDrawing;
  finish(): void;
}

interface Navigator {
  createHandwritingRecognizer(
    constraints: HandwritingRecognizerConstraints,
  ): Promise<HandwritingRecognizer>;
}
