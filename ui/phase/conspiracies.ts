import { t } from "@lingui/core/macro";
export interface ConspiracyChoice {
  player: number;
  index: number;
  choices: { type: "CardName"; value: string }[];
}

/** The local host owns all AI seats; only human choices require interaction. */
export async function prepareConspiracyChoices(
  seats: { conspiracies: string[]; deck: string[] }[],
): Promise<ConspiracyChoice[]> {
  const names = seats.flatMap((seat) => seat.conspiracies);
  if (!names.length) return [];
  const response = await fetch("/api/conspiracy/prepare", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(names),
  });
  if (!response.ok) throw new Error(await response.text());
  const counts: unknown = await response.json();
  if (!Array.isArray(counts) || counts.length !== names.length || counts.some((count) => count !== 0 && count !== 1)) {
    throw new Error(t`Unsupported conspiracy preparation response`);
  }
  const choices: ConspiracyChoice[] = [];
  let offset = 0;
  for (const [player, seat] of seats.entries()) {
    for (const [index, name] of seat.conspiracies.entries()) {
      if (!counts[offset++]) continue;
      const selected = player === 0
        ? window.prompt(`Secretly choose an Oracle card name for ${name} (copy ${index + 1}).`, seat.deck[0] ?? "")
        : seat.deck[0];
      if (!selected?.trim()) throw new Error(t`A secret card name is required; game was not started.`);
      choices.push({ player, index, choices: [{ type: "CardName", value: selected.trim() }] });
    }
  }
  return choices;
}
