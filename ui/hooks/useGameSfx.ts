import { useEffect } from "react";
import { deriveSfx } from "@/audio/deriveSfx";
import { sfx } from "@/audio/sfxPlayer";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

/**
 * Plays sound effects for what changes on the board. Reads the game store
 * directly (rather than a rendered view) so a state applied while the tab is
 * busy still sounds exactly once, in order.
 */
export function useGameSfx(): void {
  const enabled = usePreferencesStore((s) => s.sfxEnabled);
  const volume = usePreferencesStore((s) => s.sfxVolume);

  useEffect(() => {
    sfx.configure({ enabled, volume });
  }, [enabled, volume]);

  useEffect(() => {
    sfx.init();
    let previous = useGameStore.getState().gameView;
    return useGameStore.subscribe((state) => {
      const next = state.gameView;
      if (next === previous) return;
      const before = previous;
      previous = next;
      if (next) sfx.playAll(deriveSfx(before, next, state.myPlayerSlot));
    });
  }, []);
}
