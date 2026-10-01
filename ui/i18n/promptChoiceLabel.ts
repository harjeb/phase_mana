import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { i18n } from "@/i18n/i18n";

/**
 * Translate the fixed prompt text the host sends: UI titles/labels written by
 * the adapter and fixed-format phrases the engine generates ("Pay 2 life",
 * "Move to command zone"). Card effect text quoted from Oracle, card names and
 * bare numeric choices pass through unchanged.
 */
export function promptChoiceLabel(label: string): string {
  // choice_label joins backend presentation surfaces with this exact separator.
  return label.split(" — ").map(translateSurface).join(" — ");
}

// Exact host/engine strings. Built lazily so descriptors resolve in the active locale.
let exactLabels: Map<string, MessageDescriptor> | null = null;

function exact(): Map<string, MessageDescriptor> {
  exactLabels ??= new Map<string, MessageDescriptor>([
    // Adapter prompt titles.
    ["Pay the optional cost?", msg`Pay the optional cost?`],
    ["Pay the cost?", msg`Pay the cost?`],
    ["Use ability?", msg`Use ability?`],
    ["Exert this creature as it attacks?", msg`Exert this creature as it attacks?`],
    ["Choose", msg`Choose`],
    ["Choose X", msg`Choose X`],
    ["Choose mode", msg`Choose mode`],
    ["Choose a number", msg`Choose a number`],
    ["Choose an option", msg`Choose an option`],
    ["Choose cards", msg`Choose cards`],
    ["Choose target", msg`Choose target`],
    ["Choose a color", msg`Choose a color`],
    ["Choose colors", msg`Choose colors`],
    ["Choose the total cost to lock in", msg`Choose the total cost to lock in`],
    ["Order triggers", msg`Order triggers`],
    ["Pay mana cost", msg`Pay mana cost`],
    ["Scry", msg`Scry`],
    ["Surveil", msg`Surveil`],
    ["Discard", msg`Discard`],
    ["Dice roll", msg`Dice roll`],
    // Adapter button / option labels.
    ["Confirm payment", msg`Confirm payment`],
    ["Yes", msg`Yes`],
    ["No", msg`No`],
    ["Pay", msg`Pay`],
    ["Do not pay", msg`Do not pay`],
    ["Confirm", msg`Confirm`],
    ["Decline", msg`Decline`],
    ["Accept", msg`Accept`],
    // "Play"/"Draw" also mean "start game"/"tie" elsewhere; here they pick turn order.
    ["Play", msg({ message: "Play", context: "play or draw" })],
    ["Draw", msg({ message: "Draw", context: "play or draw" })],
    ["Cast", msg`Cast`],
    ["Exert", msg`Exert`],
    ["Cancel the cast", msg`Cancel the cast`],
    ["Pay nothing", msg`Pay nothing`],
    // Engine replacement-choice phrases.
    ["Move to command zone", msg`Move to command zone`],
    ["Put into hand", msg`Put into hand`],
    ["Put into library", msg`Put into library`],
    ["It enters tapped", msg`It enters tapped`],
    ["Enters tapped", msg`Enters tapped`],
    ["Exile it instead", msg`Exile it instead`],
    ["Skip combat phase", msg`Skip combat phase`],
    ["Remove a shield counter", msg`Remove a shield counter`],
    ["Prevent damage with shield counter", msg`Prevent damage with shield counter`],
    ["Replacement effect", msg`Replacement effect`],
    ["Use the original found-card destination", msg`Use the original found-card destination`],
    ["Umbra armor: destroy the Aura instead", msg`Umbra armor: destroy the Aura instead`],
    [
      "Compleated: enter with fewer loyalty counters",
      msg`Compleated: enter with fewer loyalty counters`,
    ],
    [
      "Sunburst: enter with counters for colors of mana spent",
      msg`Sunburst: enter with counters for colors of mana spent`,
    ],
    ["Bloodthirst: enter with +1/+1 counters", msg`Bloodthirst: enter with +1/+1 counters`],
    // Engine cost phrases.
    ["Pay no mana", msg`Pay no mana`],
    ["Pay its mana cost", msg`Pay its mana cost`],
    ["Pay its mana value", msg`Pay its mana value`],
    ["Pay life", msg`Pay life`],
    ["Pay cost", msg`Pay cost`],
    ["Sacrifice a permanent", msg`Sacrifice a permanent`],
    ["Discard a card", msg`Discard a card`],
  ]);
  return exactLabels;
}

// Mana symbols only, e.g. "{2}{R}" — never free text.
const MANA = "((?:\\{[^{}\\s]+\\})+)";
const EXILE_ZONES: Record<string, () => string> = {
  "from graveyards": () => i18n._(msg`from graveyards`),
  "from your graveyard": () => i18n._(msg`from your graveyard`),
  "from your hand": () => i18n._(msg`from your hand`),
  "from the battlefield": () => i18n._(msg`from the battlefield`),
};

type Pattern = [RegExp, (m: RegExpExecArray) => string | null];

let patterns: Pattern[] | null = null;

function patternTable(): Pattern[] {
  patterns ??= [
    [
      /^Confirm payment \(cost option (0|[1-9][0-9]*)\)$/,
      (m) => {
        // Keep the index as text: never renumber or reinterpret it.
        const option = m[1]!;
        return i18n._(msg`Confirm payment (cost option ${option})`);
      },
    ],
    [
      /^Pay ([1-9][0-9]*) life$/,
      (m) => {
        const amount = m[1]!;
        return i18n._(msg`Pay ${amount} life`);
      },
    ],
    [
      /^Do not pay ([1-9][0-9]*) life$/,
      (m) => {
        const amount = m[1]!;
        return i18n._(msg`Do not pay ${amount} life`);
      },
    ],
    [
      new RegExp(`^Pay ${MANA}$`),
      (m) => {
        const cost = m[1]!;
        return i18n._(msg`Pay ${cost}`);
      },
    ],
    [
      new RegExp(`^Do not pay ${MANA}$`),
      (m) => {
        const cost = m[1]!;
        return i18n._(msg`Do not pay ${cost}`);
      },
    ],
    [
      /^Do not pay (its mana cost|its mana value)$/,
      (m) =>
        m[1] === "its mana cost"
          ? i18n._(msg`Do not pay its mana cost`)
          : i18n._(msg`Do not pay its mana value`),
    ],
    [
      /^Pay its mana cost reduced by \{([0-9]+)\}$/,
      (m) => {
        // The braces are mana-symbol text, so they live in the value, not the ICU message.
        const reduction = `{${m[1]!}}`;
        return i18n._(msg`Pay its mana cost reduced by ${reduction}`);
      },
    ],
    [
      /^Sacrifice ([0-9]+) permanents$/,
      (m) => {
        const count = m[1]!;
        return i18n._(msg`Sacrifice ${count} permanents`);
      },
    ],
    [
      /^Exile a card (from [a-z ]+)$/,
      (m) => {
        const zone = EXILE_ZONES[m[1]!]?.();
        return zone ? i18n._(msg`Exile a card ${zone}`) : null;
      },
    ],
    [
      /^Exile ([0-9]+) cards (from [a-z ]+)$/,
      (m) => {
        const count = m[1]!;
        const zone = EXILE_ZONES[m[2]!]?.();
        return zone ? i18n._(msg`Exile ${count} cards ${zone}`) : null;
      },
    ],
    [
      /^Get a ([a-z0-9]+) counter$/,
      (m) => {
        const kind = m[1]!;
        return i18n._(msg`Get a ${kind} counter`);
      },
    ],
    [
      /^Get ([0-9]+) ([a-z0-9]+) counters$/,
      (m) => {
        const count = m[1]!;
        const kind = m[2]!;
        return i18n._(msg`Get ${count} ${kind} counters`);
      },
    ],
    [
      /^Umbra armor: destroy (.+) instead$/,
      (m) => {
        const aura = m[1]!;
        return i18n._(msg`Umbra armor: destroy ${aura} instead`);
      },
    ],
    [
      /^Cast for its miracle cost (.*)\?$/,
      (m) => {
        const cost = m[1]!;
        return i18n._(msg`Cast for its miracle cost ${cost}?`);
      },
    ],
    [
      /^Pay for (.+)$/,
      (m) => {
        const card = m[1]!;
        return i18n._(msg`Pay for ${card}`);
      },
    ],
    [
      /^Player ([0-9]+)$/,
      (m) => {
        const seat = m[1]!;
        return i18n._(msg`Player ${seat}`);
      },
    ],
    [
      /^(.+): choose an option$/,
      (m) => {
        const source = m[1]!;
        return i18n._(msg`${source}: choose an option`);
      },
    ],
    [
      /^Game ([0-9]+): play or draw\? · Match ([0-9]+)–([0-9]+) \(([0-9]+) draws\)$/,
      (m) => {
        const [, game, wins, losses, draws] = m;
        return i18n._(
          msg`Game ${game}: play or draw? · Match ${wins}–${losses} (${draws} draws)`,
        );
      },
    ],
    [
      /^Sideboard for game ([0-9]+) · Match ([0-9]+)–([0-9]+) \(([0-9]+) draws\)$/,
      (m) => {
        const [, game, wins, losses, draws] = m;
        return i18n._(msg`Sideboard for game ${game} · Match ${wins}–${losses} (${draws} draws)`);
      },
    ],
    [
      // Cost-reduction outcome tail: "apply A, then B".
      /^apply (.+)$/,
      (m) => {
        const effects = m[1]!.split(", then ").join(i18n._(msg`, then `));
        return i18n._(msg`apply ${effects}`);
      },
    ],
    [
      // A modal option the engine marked unavailable: translate only the suffix.
      /^(.+) \(unavailable\)$/,
      (m) => {
        const option = translateSurface(m[1]!);
        return i18n._(msg`${option} (unavailable)`);
      },
    ],
  ];
  return patterns;
}

function translateSurface(label: string): string {
  const exactMatch = exact().get(label);
  if (exactMatch) return i18n._(exactMatch);

  // "Pay {3}; announce {W/U} as {W}" — the announcement rides after a semicolon.
  const announce = /^(.+); announce (.+)$/.exec(label);
  if (announce) {
    const head = translateSurface(announce[1]!);
    const symbols = announce[2]!
      .split(", ")
      .map((part) => part.replace(/^(\{[^{}]+\}) as (\{[^{}]+\})$/, (_all, from, to) => {
        const original = from as string;
        const announced = to as string;
        return i18n._(msg`${original} as ${announced}`);
      }))
      .join(", ");
    return `${head}; ${i18n._(msg`announce ${symbols}`)}`;
  }

  // Only engine-typed shapes are translated; bare numbers and free text are kept.
  for (const [pattern, render] of patternTable()) {
    const match = pattern.exec(label);
    if (match && match[0] === label) {
      const translated = render(match);
      if (translated != null) return translated;
    }
  }
  return label;
}
