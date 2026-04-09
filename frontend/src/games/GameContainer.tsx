/**
 * GameContainer - React 與 Phaser 的橋接元件
 *
 * 負責掛載/銷毀 Phaser Game instance。
 * React 負責 UI（計分板、題目），Phaser 負責遊戲動畫場景。
 */

import { useRef, useEffect } from "react";
import Phaser from "phaser";

interface GameContainerProps {
  config: Phaser.Types.Core.GameConfig;
  className?: string;
  style?: React.CSSProperties;
}

export function GameContainer({
  config,
  className,
  style,
}: GameContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create Phaser game instance
    const game = new Phaser.Game({
      ...config,
      parent: containerRef.current,
    });
    gameRef.current = game;

    return () => {
      // Destroy on unmount
      game.destroy(true);
      gameRef.current = null;
    };
    // Only run once on mount - config changes require remount via key prop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className={className} style={style} />;
}
