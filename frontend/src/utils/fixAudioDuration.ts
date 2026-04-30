/**
 * fixAudioDuration
 *
 * iOS Safari records fMP4 (fragmented MP4) and writes 0xFFFFFFFF into the
 * moov atom duration field.  The browser consequently reports
 * `HTMLAudioElement.duration === Infinity` until the entire file has been
 * scanned.  The seek-to-end trick forces the browser to scan the file and
 * update the duration metadata.
 *
 * Usage:
 *   fixAudioDuration(audioElement);
 *
 * Calling this function multiple times on the same element is safe; it
 * detaches its own listeners once the duration becomes finite.
 */
export function fixAudioDuration(audio: HTMLAudioElement | null): void {
  if (!audio) return;

  // Nothing to do if the duration is already a finite positive number.
  if (isFinite(audio.duration) && audio.duration > 0) return;

  let applied = false;

  const applyFix = () => {
    if (applied) return;
    // Only trigger the seek when the element still reports Infinity / NaN.
    if (!isFinite(audio.duration) || audio.duration === 0) {
      applied = true;
      // Seeking past the end triggers a full scan; 1e101 is safely beyond any
      // realistic media duration.
      audio.currentTime = 1e101;
    }
  };

  const onDurationChange = () => {
    if (isFinite(audio.duration) && audio.duration > 0) {
      // Duration is now valid — reset playhead and clean up.
      audio.currentTime = 0;
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("loadedmetadata", applyFix);
    }
  };

  audio.addEventListener("durationchange", onDurationChange);
  audio.addEventListener("loadedmetadata", applyFix);

  // If metadata is already loaded (e.g. cached audio), apply immediately.
  if (audio.readyState >= 1) {
    applyFix();
  }
}
