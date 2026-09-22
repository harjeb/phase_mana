import { useEffect } from "react";

interface ModalKeyboardHandlers {
  onEnter?: () => void;
  onSpace?: () => void;
  onEscape?: () => void;
}

/**
 * Attaches keyboard listeners for modal dialogs. Space defaults to the same
 * affirmative action as Enter unless a modal supplies a separate handler.
 * Automatically cleans up on unmount or dependency change.
 */
export function useModalKeyboard(handlers: ModalKeyboardHandlers, deps: unknown[] = []) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      if (e.key === "Enter" && handlers.onEnter) {
        e.preventDefault();
        handlers.onEnter();
      } else if (e.code === "Space") {
        const onSpace = handlers.onSpace ?? handlers.onEnter;
        if (!onSpace) return;
        e.preventDefault();
        onSpace();
      } else if (e.key === "Escape" && handlers.onEscape) {
        e.preventDefault();
        handlers.onEscape();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
