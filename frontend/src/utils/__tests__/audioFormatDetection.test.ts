import { describe, it, expect } from "vitest";
import {
  detectAudioFormat,
  getUploadFileMetadata,
} from "../audioFormatDetection";

const makeBlob = (head: number[], extra = 64, mimeType = ""): Blob => {
  const bytes = new Uint8Array(head.length + extra);
  bytes.set(head, 0);
  return new Blob([bytes], { type: mimeType });
};

describe("detectAudioFormat", () => {
  it("detects webm from EBML magic (0x1a 0x45 0xdf 0xa3)", async () => {
    const blob = makeBlob([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
    expect(await detectAudioFormat(blob)).toBe("webm");
  });

  it("detects mp4/m4a from ftyp box at bytes 4-8", async () => {
    const blob = makeBlob([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x35,
    ]);
    expect(await detectAudioFormat(blob)).toBe("mp4");
  });

  it("detects mp4 regardless of brand code", async () => {
    // 'ftypM4A '
    const blob = makeBlob([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
    ]);
    expect(await detectAudioFormat(blob)).toBe("mp4");
  });

  it("detects wav from RIFF...WAVE", async () => {
    const blob = makeBlob([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(await detectAudioFormat(blob)).toBe("wav");
  });

  it("detects mp3 from ID3 tag", async () => {
    const blob = makeBlob([0x49, 0x44, 0x33, 0x04]);
    expect(await detectAudioFormat(blob)).toBe("mp3");
  });

  it("detects mp3 from MPEG-1/2 Layer III sync frame", async () => {
    for (const second of [0xfb, 0xfa, 0xf3, 0xf2]) {
      const blob = makeBlob([0xff, second, 0x90, 0x00]);
      expect(await detectAudioFormat(blob)).toBe("mp3");
    }
  });

  it("does not misdetect other MPEG layers as mp3 (matches backend)", async () => {
    // 0xFF 0xE0–0xF1 has sync bits set but is Layer I/II or reserved.
    for (const second of [0xe0, 0xe1, 0xf0, 0xf1]) {
      const blob = makeBlob([0xff, second, 0x90, 0x00]);
      expect(await detectAudioFormat(blob)).toBe("unknown");
    }
  });

  it("returns 'unknown' for unrecognised bytes", async () => {
    const blob = makeBlob([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(await detectAudioFormat(blob)).toBe("unknown");
  });

  it("returns 'unknown' for very short blobs", async () => {
    const blob = new Blob([new Uint8Array([0x1a, 0x45])]);
    expect(await detectAudioFormat(blob)).toBe("unknown");
  });

  it("does not throw on empty blob", async () => {
    const blob = new Blob([]);
    await expect(detectAudioFormat(blob)).resolves.toBe("unknown");
  });
});

describe("getUploadFileMetadata", () => {
  it("iOS Safari case: M4A bytes even though blob.type says webm → returns mp4 metadata", async () => {
    const blob = makeBlob(
      [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x35],
      64,
      "audio/webm",
    );
    const meta = await getUploadFileMetadata(blob);
    expect(meta.filename).toBe("recording.mp4");
    expect(meta.contentType).toBe("audio/mp4");
  });

  it("valid webm blob → webm metadata", async () => {
    const blob = makeBlob(
      [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81],
      64,
      "audio/webm",
    );
    const meta = await getUploadFileMetadata(blob);
    expect(meta.filename).toBe("recording.webm");
    expect(meta.contentType).toBe("audio/webm");
  });

  it("unknown bytes but blob.type=audio/mp4 → falls back to blob.type", async () => {
    const blob = makeBlob(
      [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      64,
      "audio/mp4",
    );
    const meta = await getUploadFileMetadata(blob);
    expect(meta.filename).toBe("recording.mp4");
    expect(meta.contentType).toBe("audio/mp4");
  });

  it("unknown bytes and no blob.type → generic fallback", async () => {
    const blob = makeBlob(
      [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      64,
      "",
    );
    const meta = await getUploadFileMetadata(blob);
    expect(meta.filename).toBe("recording.audio");
    expect(meta.contentType).toBe("application/octet-stream");
  });
});
