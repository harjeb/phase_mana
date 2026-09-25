import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

const NAVIGATION = msg`Navigation`;
const DECK_EDITOR = msg`Deck editor`;
const HELP = msg`Help`;
const CARD_SEARCH = msg`Card search`;
const GAME = msg`Game`;
const BATTLEFIELD = msg`Battlefield`;

export interface KeyCombo {
  key: string;
  mod?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}
export interface KeybindingDef {
  id: string;
  label: MessageDescriptor;
  category: MessageDescriptor;
  defaultCombo: KeyCombo;
  allowInEditable?: boolean;
}
function defineKeybindings<const T extends readonly KeybindingDef[]>(
  definitions: T,
): readonly (T[number] & KeybindingDef)[] {
  return definitions;
}

export const KEYBINDINGS = defineKeybindings([
  {
    id: "nav-prev-page",
    label: msg`Previous page`,
    category: NAVIGATION,
    defaultCombo: { key: "arrowup", alt: true },
  },
  {
    id: "nav-next-page",
    label: msg`Next page`,
    category: NAVIGATION,
    defaultCombo: { key: "arrowdown", alt: true },
  },
  {
    id: "go-back",
    label: msg`Go back`,
    category: NAVIGATION,
    defaultCombo: { key: "arrowleft", alt: true },
  },
  {
    id: "deck-editor-focus-filter",
    label: msg`Focus the card filter`,
    category: DECK_EDITOR,
    defaultCombo: { key: "f", mod: true },
  },
  {
    id: "deck-editor-focus-quick-add",
    label: msg`Focus quick-add card`,
    category: DECK_EDITOR,
    defaultCombo: { key: "a", alt: true },
  },
  {
    id: "deck-editor-toggle-search",
    label: msg`Toggle card search`,
    category: DECK_EDITOR,
    defaultCombo: { key: "s", alt: true },
  },
  {
    id: "deck-editor-toggle-preview",
    label: msg`Toggle preview panel`,
    category: DECK_EDITOR,
    defaultCombo: { key: "p", alt: true },
  },
  {
    id: "deck-editor-save",
    label: msg`Save deck`,
    category: DECK_EDITOR,
    defaultCombo: { key: "s", mod: true },
  },
  {
    id: "deck-editor-export",
    label: msg`Export deck`,
    category: DECK_EDITOR,
    defaultCombo: { key: "e", mod: true },
  },
  {
    id: "deck-editor-undo",
    label: msg`Undo deck edit`,
    category: DECK_EDITOR,
    defaultCombo: { key: "z", mod: true },
  },
  {
    id: "deck-editor-redo",
    label: msg`Redo deck edit`,
    category: DECK_EDITOR,
    defaultCombo: { key: "z", mod: true, shift: true },
  },
  {
    id: "deck-editor-command-palette",
    label: msg`Open deck command palette`,
    category: DECK_EDITOR,
    defaultCombo: { key: "p", mod: true, shift: true },
    allowInEditable: true,
  },
  {
    id: "deck-editor-collapse-sections",
    label: msg`Collapse all deck sections`,
    category: DECK_EDITOR,
    defaultCombo: { key: "-", alt: true, shift: true },
  },
  {
    id: "deck-editor-expand-sections",
    label: msg`Expand all deck sections`,
    category: DECK_EDITOR,
    defaultCombo: { key: "=", alt: true, shift: true },
  },
  {
    id: "deck-editor-next-section",
    label: msg`Jump to next editor section`,
    category: DECK_EDITOR,
    defaultCombo: { key: "3", alt: true },
  },
  {
    id: "deck-editor-tag-selection",
    label: msg`Tag selected cards`,
    category: DECK_EDITOR,
    defaultCombo: { key: "t" },
  },
  {
    id: "deck-editor-select-all",
    label: msg`Select all deck cards`,
    category: DECK_EDITOR,
    defaultCombo: { key: "a", mod: true },
  },
  {
    id: "deck-editor-copy-selection",
    label: msg`Copy selected cards`,
    category: DECK_EDITOR,
    defaultCombo: { key: "c", mod: true },
  },
  {
    id: "deck-editor-paste-cards",
    label: msg`Paste cards into deck`,
    category: DECK_EDITOR,
    defaultCombo: { key: "v", mod: true },
  },
  {
    id: "deck-editor-remove-selection",
    label: msg`Remove selected cards`,
    category: DECK_EDITOR,
    defaultCombo: { key: "delete" },
  },
  {
    id: "deck-editor-move-main",
    label: msg`Move selected cards to main deck`,
    category: DECK_EDITOR,
    defaultCombo: { key: "m" },
  },
  {
    id: "deck-editor-move-side",
    label: msg`Move selected cards to sideboard`,
    category: DECK_EDITOR,
    defaultCombo: { key: "s" },
  },
  {
    id: "deck-editor-move-maybe",
    label: msg`Move selected cards to maybeboard`,
    category: DECK_EDITOR,
    defaultCombo: { key: "b" },
  },
  {
    id: "deck-editor-toggle-foil-selection",
    label: msg`Toggle foil for selected cards`,
    category: DECK_EDITOR,
    defaultCombo: { key: "f" },
  },
  {
    id: "deck-editor-remove-one-selection",
    label: msg`Remove one copy of selected cards`,
    category: DECK_EDITOR,
    defaultCombo: { key: "-" },
  },
  {
    id: "deck-editor-add-one-selection",
    label: msg`Add one copy of selected cards`,
    category: DECK_EDITOR,
    defaultCombo: { key: "=" },
  },
  {
    id: "open-settings",
    label: msg`Open preferences / board settings`,
    category: NAVIGATION,
    defaultCombo: { key: ",", mod: true },
  },
  {
    id: "show-shortcuts",
    label: msg`Show keyboard shortcuts`,
    category: HELP,
    defaultCombo: { key: "?", shift: true },
  },
  {
    id: "card-search-focus",
    label: msg`Focus search`,
    category: CARD_SEARCH,
    defaultCombo: { key: "/" },
  },
  {
    id: "flip-card",
    label: msg`Flip double-faced card (preview / hand)`,
    category: GAME,
    defaultCombo: { key: "f" },
  },
  {
    id: "toggle-card-view",
    label: msg`Toggle card rules / printed view`,
    category: GAME,
    defaultCombo: { key: "r" },
  },
  {
    id: "preview-prev-action",
    label: msg`Previous preview action`,
    category: GAME,
    defaultCombo: { key: "arrowup" },
  },
  {
    id: "preview-next-action",
    label: msg`Next preview action`,
    category: GAME,
    defaultCombo: { key: "arrowdown" },
  },
  {
    id: "preview-activate-action",
    label: msg`Activate focused preview action`,
    category: GAME,
    defaultCombo: { key: "enter" },
  },
  {
    id: "preview-dismiss",
    label: msg`Close card preview`,
    category: GAME,
    defaultCombo: { key: "escape" },
  },
  {
    id: "pass-priority",
    label: msg`Pass priority / confirm`,
    category: BATTLEFIELD,
    defaultCombo: { key: " " },
  },
  {
    id: "pass-end-of-turn",
    label: msg`Pass until end of turn / resolve stack`,
    category: BATTLEFIELD,
    defaultCombo: { key: " ", shift: true },
  },
  {
    id: "toggle-stack",
    label: msg`Collapse / expand the stack`,
    category: BATTLEFIELD,
    defaultCombo: { key: "s", mod: true },
  },
  {
    id: "open-graveyard",
    label: msg`Open your graveyard`,
    category: BATTLEFIELD,
    defaultCombo: { key: "g" },
  },
  {
    id: "open-exile",
    label: msg`Open your exile`,
    category: BATTLEFIELD,
    defaultCombo: { key: "x" },
  },
  {
    id: "toggle-combat-breakdown",
    label: msg`Toggle combat breakdown`,
    category: BATTLEFIELD,
    defaultCombo: { key: "c" },
  },
  {
    id: "toggle-priority-mode",
    label: msg`Toggle autopass / full control`,
    category: BATTLEFIELD,
    defaultCombo: { key: "tab" },
  },
  {
    id: "cycle-hand-order",
    label: msg`Cycle hand order`,
    category: BATTLEFIELD,
    defaultCombo: { key: "h", shift: true },
  },
  {
    id: "focus-next-field",
    label: msg`Focus next opponent field`,
    category: BATTLEFIELD,
    defaultCombo: { key: "]" },
  },
  {
    id: "focus-prev-field",
    label: msg`Focus previous opponent field`,
    category: BATTLEFIELD,
    defaultCombo: { key: "[" },
  },
  ...(import.meta.env.DEV
    ? [
        {
          id: "toggle-dev-panel",
          label: msg`Toggle the dev panel`,
          category: BATTLEFIELD,
          defaultCombo: { key: "d", mod: true, shift: true },
          allowInEditable: true,
        } satisfies KeybindingDef,
      ]
    : []),
  {
    id: "toggle-fullscreen",
    label: msg`Toggle fullscreen`,
    category: BATTLEFIELD,
    defaultCombo: { key: "f", mod: true },
  },
]);

export type KeybindingId = (typeof KEYBINDINGS)[number]["id"];

export const IS_APPLE =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
export function normalizeCombo(c: KeyCombo): KeyCombo {
  if (!c.mod) return c;
  return IS_APPLE ? { ...c, mod: undefined, meta: true } : { ...c, mod: undefined, ctrl: true };
}
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  // Derive the key from the physical `code` so it stays stable when Option/Alt
  // produces a different character on macOS (Option+P → "π").
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) {
    key = e.code.slice(3).toLowerCase();
  } else if (/^Digit[0-9]$/.test(e.code)) {
    key = e.code.slice(5);
  } else {
    key = e.key.toLowerCase();
  }
  if (key === "control" || key === "meta" || key === "alt" || key === "shift") return null;
  return { key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
}
export function combosMatch(a: KeyCombo, b: KeyCombo): boolean {
  const na = normalizeCombo(a);
  const nb = normalizeCombo(b);
  return (
    na.key === nb.key &&
    !!na.meta === !!nb.meta &&
    !!na.ctrl === !!nb.ctrl &&
    !!na.alt === !!nb.alt &&
    !!na.shift === !!nb.shift
  );
}
const KEY_LABELS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  get " "() {
    return `Space`;
  },
  escape: `Esc`,
  enter: "↵",
};
function keyLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}
const KEY_SYMBOLS: Record<string, string> = {
  " ": "␣",
  enter: "↵",
  tab: "⇥",
  escape: "⎋",
};
export function comboSymbols(combo: KeyCombo): string {
  const c = normalizeCombo(combo);
  const parts: string[] = [];
  if (c.ctrl) parts.push("⌃");
  if (c.alt) parts.push("⌥");
  if (c.shift) parts.push("⇧");
  if (c.meta) parts.push("⌘");
  parts.push(KEY_SYMBOLS[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key));
  return parts.join("");
}
export function formatCombo(combo: KeyCombo): string {
  const c = normalizeCombo(combo);
  const mods: string[] = [];
  if (c.ctrl) mods.push(IS_APPLE ? "⌃" : "Ctrl");
  if (c.alt) mods.push(IS_APPLE ? "⌥" : "Alt");
  if (c.shift) mods.push(IS_APPLE ? "⇧" : "Shift");
  if (c.meta) mods.push(IS_APPLE ? "⌘" : "Super");
  return [...mods, keyLabel(c.key)].join(IS_APPLE ? " " : "+");
}
