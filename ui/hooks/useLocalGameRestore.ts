import { useEffect, useRef } from "react";
import { peekActiveGameSession } from "@/lib/activeGameSession";
import {
  clearActiveLocalGame,
  isActiveLocalGame,
} from "@/lib/activeLocalGame";
import { acceptSnapshot } from "@/phase/transport";
import { useGameStore } from "@/stores/useGameStore";

/**
 * Reattach to a local game after a page refresh.
 *
 * The local Phase host keeps its session in memory when the page reloads, so
 * the game is still there — only the React store forgot it. If this tab left a
 * marker behind, pull the host's current snapshot and adopt it. A missing or
 * replaced host session (409) drops the marker silently; a multiplayer resume
 * owns this page load instead, so defer to it.
 */
export function useLocalGameRestore() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (!isActiveLocalGame()) return;
    if (peekActiveGameSession()) return;
    if (useGameStore.getState().isGameActive) return;
    void (async () => {
      try {
        const response = await fetch("/api/state");
        if (!response.ok) {
          clearActiveLocalGame();
          return;
        }
        acceptSnapshot(await response.json());
      } catch (error) {
        console.warn("[local-resume] failed to restore the local game:", error);
        clearActiveLocalGame();
      }
    })();
  }, []);
}
