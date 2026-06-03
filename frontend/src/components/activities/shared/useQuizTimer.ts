/**
 * useQuizTimer — 小考整卷倒數計時 hook
 *
 * 問題：把 `onExpire` 直接放進 useEffect deps 會在每次 typedByItem 改變時
 * 重建 callback、重置 setTimeout，導致學生連續打字時倒數實質暫停。
 *
 * 解法：把最新 onExpire 收進 ref，setTimeout 內呼叫 ref，useEffect deps
 * 只看 `remaining` / `paused`。
 *
 * 用法：
 *   const remaining = useQuizTimer(initialRemaining, handleSubmitAll, alreadySubmitted);
 */

import { useEffect, useRef, useState } from "react";

export function useQuizTimer(
  initialRemaining: number | null,
  onExpire: () => void,
  paused: boolean,
): number | null {
  const [remaining, setRemaining] = useState<number | null>(initialRemaining);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const firedRef = useRef(false);

  useEffect(() => {
    setRemaining(initialRemaining);
    firedRef.current = false;
  }, [initialRemaining]);

  useEffect(() => {
    if (paused || remaining === null) return;
    if (remaining <= 0) {
      if (!firedRef.current) {
        firedRef.current = true;
        expireRef.current();
      }
      return;
    }
    const t = setTimeout(
      () => setRemaining((s) => (s == null ? null : Math.max(0, s - 1))),
      1000,
    );
    return () => clearTimeout(t);
  }, [paused, remaining]);

  return remaining;
}
