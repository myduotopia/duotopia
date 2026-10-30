/**
 * AudioRecorder chat variant 的錄音區四種狀態（#1158 E3）：只用圖示按鈕，每顆都有 aria-label。
 * A 待錄＝藍色大麥克風；B 錄音中＝紅色停止＋秒數；C 錄完＝重錄／送出／試聽；D 停用＝灰色麥克風＋原因。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AudioRecorderChatControls from "../AudioRecorderChatControls";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));

const base = {
  isRecording: false,
  isStopping: false,
  recordingTimeLabel: "0:07 / 2:00",
  recordedTimeLabel: "0:12",
  audioUrl: null,
  showError: false,
  readOnly: false,
  disabled: false,
  onStart: vi.fn(),
  onStop: vi.fn(),
  onReRecord: vi.fn(),
};

const buttons = () => screen.getAllByRole("button");

describe("AudioRecorderChatControls — 四種狀態", () => {
  it("A 待錄：只有一顆藍色大麥克風，沒有說明文字", () => {
    const onStart = vi.fn();
    render(<AudioRecorderChatControls {...base} onStart={onStart} />);
    expect(buttons()).toHaveLength(1);
    const mic = screen.getByRole("button", {
      name: "audioRecorder.ui.startRecording",
    });
    expect(mic.className).toContain("bg-blue-600");
    expect(mic.className).toContain("h-[72px]");
    expect(screen.queryByText("audioRecorder.ui.tapToRecord")).toBeNull();
    fireEvent.click(mic);
    expect(onStart).toHaveBeenCalled();
  });

  it("B 錄音中：紅色停止鈕＋左側秒數（含上限）", () => {
    const onStop = vi.fn();
    render(<AudioRecorderChatControls {...base} isRecording onStop={onStop} />);
    const stop = screen.getByRole("button", {
      name: "audioRecorder.ui.stopRecording",
    });
    expect(stop.className).toContain("bg-red-600");
    expect(screen.getByText("0:07 / 2:00")).toBeInTheDocument();
    expect(screen.queryByText("audioRecorder.ui.tapToStop")).toBeNull();
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalled();
  });

  it("C 錄完：重錄（左）／送出（中，大）／試聽（右），全是圖示按鈕", () => {
    const onSend = vi.fn();
    const onReRecord = vi.fn();
    render(
      <AudioRecorderChatControls
        {...base}
        audioUrl="blob:x"
        onSend={onSend}
        onReRecord={onReRecord}
      />,
    );
    const labels = buttons().map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual([
      "audioRecorder.ui.reRecord",
      "audioRecorder.ui.send",
      "audioRecorder.ui.playRecording:0:12",
    ]);
    // 按鈕裡沒有文字，只有圖示
    for (const b of buttons()) expect(b.textContent).toBe("");
    const send = screen.getByRole("button", { name: "audioRecorder.ui.send" });
    expect(send.className).toContain("h-[72px]");
    expect(send.className).toContain("bg-blue-600");
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "audioRecorder.ui.reRecord" }),
    );
    expect(onReRecord).toHaveBeenCalled();
    expect(screen.getByText("0:12")).toBeInTheDocument();
  });

  it("D 停用：灰色麥克風，aria-label／title 帶原因", () => {
    const onStart = vi.fn();
    render(
      <AudioRecorderChatControls
        {...base}
        disabled
        disabledReason="請在上方選擇"
        onStart={onStart}
      />,
    );
    const mic = screen.getByRole("button", {
      name: "audioRecorder.ui.startRecordingDisabled:請在上方選擇",
    });
    expect(mic).toBeDisabled();
    expect(mic).toHaveAttribute(
      "title",
      "audioRecorder.ui.startRecordingDisabled:請在上方選擇",
    );
    expect(mic.className).toContain("bg-gray-200");
    fireEvent.click(mic);
    expect(onStart).not.toHaveBeenCalled();
  });
});
