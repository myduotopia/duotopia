/**
 * VirtualKeyboard - on-screen QWERTY for spelling/cloze on touch devices.
 *
 * Why this exists: phones/tablets show a system-keyboard suggestion bar
 * that lets students tap the answer instead of spelling it. Suppressing
 * the system keyboard (`inputMode="none"` on the <input>) plus driving
 * input from this component closes that loophole.
 *
 * Layout: QWERTY rows + shift + backspace + enter. Letters only — no
 * digits, no symbols (caller-specified scope). Holds its own `shifted`
 * state; a tap on a letter auto-releases shift (one-shot capitalisation).
 *
 * The component is layout-agnostic: caller positions it (mobile = fixed
 * bottom overlay, tablet = right-side panel).
 */

import { useState } from "react";
import Keyboard from "react-simple-keyboard";
import "react-simple-keyboard/build/css/index.css";
import { cn } from "@/lib/utils";

interface VirtualKeyboardProps {
  onKey: (char: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  className?: string;
}

const LAYOUT = {
  default: ["q w e r t y u i o p", "a s d f g h j k l", "{shift} z x c v b n m {bksp}", "{enter}"],
  shift: ["Q W E R T Y U I O P", "A S D F G H J K L", "{shift} Z X C V B N M {bksp}", "{enter}"],
};

const DISPLAY = {
  "{shift}": "⇧",
  "{bksp}": "⌫",
  "{enter}": "Enter",
};

export default function VirtualKeyboard({
  onKey,
  onBackspace,
  onEnter,
  className,
}: VirtualKeyboardProps) {
  const [shifted, setShifted] = useState(false);

  const handleKeyPress = (button: string) => {
    if (button === "{shift}") {
      setShifted((s) => !s);
      return;
    }
    if (button === "{bksp}") {
      onBackspace();
      return;
    }
    if (button === "{enter}") {
      onEnter();
      return;
    }
    onKey(button);
    if (shifted) setShifted(false);
  };

  return (
    <div className={cn("vk-wrapper bg-white p-2 rounded-md", className)}>
      <Keyboard
        layoutName={shifted ? "shift" : "default"}
        layout={LAYOUT}
        display={DISPLAY}
        onKeyPress={handleKeyPress}
        physicalKeyboardHighlight={false}
        preventMouseDownDefault
        buttonTheme={[
          {
            class: "vk-shift",
            buttons: "{shift}",
          },
        ]}
      />
    </div>
  );
}
