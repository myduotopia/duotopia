/**
 * useHighlightGuide (#989)
 *
 * A thin wrapper over driver.js that walks a teacher through a short sequence
 * of real UI elements, advancing when they actually click the highlighted
 * thing rather than a "Next" button — the point is to teach the path, not to
 * narrate it.
 *
 * Used after a demo visitor registers and their material is auto-copied: the
 * new material card is highlighted, then its first lesson, then the orange
 * 即刻練習 button, which starts the practice they came for.
 *
 * Steps point at `data-guide-id` attributes rather than class names, so
 * restyling a card cannot silently break the guide. Each step waits for its
 * element to exist (the lesson row only appears once the program card is
 * opened) and gives up quietly after a short timeout instead of stranding the
 * user behind an overlay pointing at nothing.
 */

import { useCallback, useEffect, useRef } from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

export interface HighlightStep {
  /** Value of the target's `data-guide-id` attribute. */
  guideId: string;
  title: string;
  description: string;
}

/** How long to wait for a step's element to appear before abandoning the guide. */
const ELEMENT_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 120;

function selectorFor(guideId: string): string {
  return `[data-guide-id="${CSS.escape(guideId)}"]`;
}

/** Resolve once the element exists, or null once the timeout elapses. */
function waitForElement(
  guideId: string,
  signal: { cancelled: boolean },
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + ELEMENT_TIMEOUT_MS;

    const poll = () => {
      if (signal.cancelled) return resolve(null);
      const el = document.querySelector<HTMLElement>(selectorFor(guideId));
      if (el) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      window.setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
  });
}

export interface HighlightGuideController {
  /** Start (or restart) the guide with the given steps. */
  start: (steps: HighlightStep[]) => void;
  /** Tear the guide down — safe to call when nothing is running. */
  stop: () => void;
}

export function useHighlightGuide(): HighlightGuideController {
  const driverRef = useRef<Driver | null>(null);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const stop = useCallback(() => {
    cancelRef.current.cancelled = true;
    driverRef.current?.destroy();
    driverRef.current = null;
  }, []);

  const start = useCallback(
    (steps: HighlightStep[]) => {
      if (steps.length === 0) return;

      stop();
      const signal = { cancelled: false };
      cancelRef.current = signal;

      const instance = driver({
        showButtons: [],
        allowClose: true,
        overlayOpacity: 0.6,
        popoverClass: "duotopia-guide-popover",
        onDestroyed: () => {
          signal.cancelled = true;
        },
      });
      driverRef.current = instance;

      const run = async () => {
        for (const step of steps) {
          const element = await waitForElement(step.guideId, signal);
          if (signal.cancelled) return;
          if (!element) {
            // The UI never got to this state (teacher navigated away, view
            // switched). Better to end quietly than to point at nothing.
            stop();
            return;
          }

          let highlighted = element;
          instance.highlight({
            element,
            popover: {
              title: step.title,
              description: step.description,
              side: "bottom",
              align: "center",
            },
          });

          // The visitor advances by doing the thing, not by clicking "Next".
          //
          // The listener goes on `document` rather than on the resolved node:
          // the list behind these steps refetches (a demo copy just ran) and
          // re-sorting or filtering can hand React a brand-new DOM node for the
          // same `data-guide-id`. A listener bound to the captured element
          // would be orphaned by that remount and never fire, stranding the
          // visitor under an overlay until they closed it. Matching by
          // `closest()` at click time survives any number of remounts, and the
          // poll below re-points the highlight at whatever node is current.
          await new Promise<void>((resolve) => {
            let poll = 0;
            const finish = () => {
              window.clearInterval(poll);
              document.removeEventListener("click", onClick, true);
              resolve();
            };
            const onClick = (event: MouseEvent) => {
              const target = event.target as Element | null;
              if (target?.closest(selectorFor(step.guideId))) finish();
            };

            document.addEventListener("click", onClick, true);
            poll = window.setInterval(() => {
              // Also finish if the visitor closes the guide mid-step.
              if (signal.cancelled) return finish();
              // Follow the target across remounts so the overlay never sits on
              // a detached node.
              const current = document.querySelector<HTMLElement>(
                selectorFor(step.guideId),
              );
              if (current && current !== highlighted) {
                highlighted = current;
                instance.highlight({
                  element: current,
                  popover: {
                    title: step.title,
                    description: step.description,
                    side: "bottom",
                    align: "center",
                  },
                });
              }
            }, POLL_INTERVAL_MS);
          });

          if (signal.cancelled) return;
        }

        stop();
      };

      void run();
    },
    [stop],
  );

  // Never leave an overlay behind when the page unmounts.
  useEffect(() => stop, [stop]);

  return { start, stop };
}
