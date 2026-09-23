import type { PromptPresentation } from "./common";

/** Phase native extension: registered cards have quantities, not object IDs. */
export interface DeckCardCount { name: string; count: number }
export interface SideboardInput {
  presentation: PromptPresentation;
  main: DeckCardCount[];
  sideboard: DeckCardCount[];
  minMainDeckSize: number;
  maxSideboardSize: number | null;
}
export interface SideboardOutput {
  type: "submitSideboard";
  main: DeckCardCount[];
  sideboard: DeckCardCount[];
}
