/** Normalize the engine's current Debug-form Kicker(Cost {...}) DTO as well as
 * printed mana notation. Unknown/non-mana costs must not acquire a false price.
 * This is presentation-only; engine ability identities are never modified.
 */
export function keywordManaCost(keyword: string): { ability: "kicker" | "warp"; cost: string } | undefined {
  const prefix = /^(kicker|warp)(?=[\s:({])/i.exec(keyword);
  if (!prefix) return undefined;
  const ability = prefix[1]!.toLowerCase() as "kicker" | "warp";
  const cost = parseManaSuffix(keyword.slice(prefix[1]!.length));
  return cost ? { ability, cost } : undefined;
}

function parseManaSuffix(suffix: string): string | undefined {
  const printed = /^\s*:?\s*((?:\{(?:\d+|[WUBRGCSX]|[WUBRG2]\/[WUBRGP])\})+)$/i.exec(suffix);
  if (printed) return printed[1]!.toUpperCase();
  const debug = /^\(cost\s*\{\s*shards:\s*\[([^\]]*)\],\s*generic:\s*(\d+)\s*\}\)$/i.exec(suffix);
  if (!debug) return undefined;
  const symbols: Record<string, string> = {
    white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C', snow: 'S', x: 'X',
  };
  const shards = debug[1]!.trim() ? debug[1]!.split(',').map(s => s.trim().toLowerCase()) : [];
  if (shards.some(s => !Object.hasOwn(symbols, s))) return undefined;
  const generic = Number(debug[2]);
  if (!Number.isSafeInteger(generic)) return undefined;
  return (generic > 0 ? `{${generic}}` : '') + shards.map(s => `{${symbols[s]}}`).join('') || '{0}';
}
