/**
 * Magic-byte detection for audio blobs.
 *
 * iOS Safari MediaRecorder sometimes produces M4A (ISO BMFF) bytes even when
 * the MediaRecorder was created with mimeType='audio/webm'. Relying on
 * `blob.type` for the upload filename/content-type causes the backend to
 * reject M4A bytes labelled as webm.
 *
 * Reading the first 16 bytes and matching container magic is the reliable
 * signal — backend also does the same sniff (defense in depth).
 *
 * See issue #677 and #646.
 */

export type AudioFormat = "webm" | "mp4" | "wav" | "mp3" | "unknown";

const FORMAT_TO_EXT: Record<Exclude<AudioFormat, "unknown">, string> = {
  webm: "recording.webm",
  mp4: "recording.mp4",
  wav: "recording.wav",
  mp3: "recording.mp3",
};

const FORMAT_TO_MIME: Record<Exclude<AudioFormat, "unknown">, string> = {
  webm: "audio/webm",
  mp4: "audio/mp4",
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

async function readHead(blob: Blob, n: number): Promise<Uint8Array> {
  const slice = blob.slice(0, n);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) {
        resolve(new Uint8Array(result));
      } else {
        resolve(new Uint8Array(0));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsArrayBuffer(slice);
  });
}

function sniff(head: Uint8Array): AudioFormat {
  if (head.length < 12) {
    return "unknown";
  }
  // Matroska/WebM — EBML header
  if (
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  ) {
    return "webm";
  }
  // ISO Base Media (MP4 / M4A) — 'ftyp' box at bytes 4..8
  if (
    head[4] === 0x66 &&
    head[5] === 0x74 &&
    head[6] === 0x79 &&
    head[7] === 0x70
  ) {
    return "mp4";
  }
  // RIFF / WAVE
  if (
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x41 &&
    head[10] === 0x56 &&
    head[11] === 0x45
  ) {
    return "wav";
  }
  // MP3 — ID3 tag
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    return "mp3";
  }
  // MP3 — MPEG audio sync frame (11-bit sync: FF Ex ...)
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    return "mp3";
  }
  return "unknown";
}

export async function detectAudioFormat(blob: Blob): Promise<AudioFormat> {
  if (blob.size === 0) {
    return "unknown";
  }
  try {
    const head = await readHead(blob, 16);
    return sniff(head);
  } catch {
    return "unknown";
  }
}

/**
 * Decide the filename and content-type for a recording upload based on the
 * blob's actual bytes (not just `blob.type`, which is unreliable on some
 * iOS Safari builds).
 */
export async function getUploadFileMetadata(
  blob: Blob,
): Promise<{ filename: string; contentType: string }> {
  const detected = await detectAudioFormat(blob);
  if (detected !== "unknown") {
    return {
      filename: FORMAT_TO_EXT[detected],
      contentType: FORMAT_TO_MIME[detected],
    };
  }

  // Magic bytes inconclusive — fall back to MediaRecorder's reported type.
  const fallbackType = (blob.type || "").toLowerCase();
  if (fallbackType.includes("webm")) {
    return { filename: FORMAT_TO_EXT.webm, contentType: FORMAT_TO_MIME.webm };
  }
  if (
    fallbackType.includes("mp4") ||
    fallbackType.includes("m4a") ||
    fallbackType.includes("aac")
  ) {
    return { filename: FORMAT_TO_EXT.mp4, contentType: FORMAT_TO_MIME.mp4 };
  }
  if (fallbackType.includes("wav")) {
    return { filename: FORMAT_TO_EXT.wav, contentType: FORMAT_TO_MIME.wav };
  }
  if (fallbackType.includes("mpeg") || fallbackType.includes("mp3")) {
    return { filename: FORMAT_TO_EXT.mp3, contentType: FORMAT_TO_MIME.mp3 };
  }

  return { filename: "recording.audio", contentType: "application/octet-stream" };
}

/**
 * Append an audio blob to FormData with the correct filename and
 * content-type derived from the actual bytes. Returns the metadata used,
 * so callers can log/telemetry the detected format if needed.
 */
export async function appendAudioToFormData(
  formData: FormData,
  key: string,
  blob: Blob,
): Promise<{ filename: string; contentType: string }> {
  const meta = await getUploadFileMetadata(blob);
  const retyped =
    blob.type === meta.contentType ? blob : new Blob([blob], { type: meta.contentType });
  formData.append(key, retyped, meta.filename);
  return meta;
}
