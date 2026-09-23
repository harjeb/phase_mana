import type { ScryfallCard } from "@/types/scryfall";

interface MTGCHFace {
  name?: string | null;
  face_name?: string | null;
  zhs_name?: string | null;
  zhs_face_name?: string | null;
  atomic_official_name?: string | null;
  atomic_translated_name?: string | null;
  type_line?: string | null;
  zhs_type_line?: string | null;
  atomic_translated_type?: string | null;
  oracle_text?: string | null;
  zhs_text?: string | null;
  atomic_translated_text?: string | null;
}

interface MTGCHCardResponse extends MTGCHFace {
  other_faces?: MTGCHFace[];
}

const mtgchPromiseCache = new Map<string, Promise<MTGCHCardResponse | null>>();

// Maximum concurrent outgoing requests to mtgch to avoid overloading their server
const CONCURRENCY_LIMIT = 5;
let activeRequests = 0;
const waitingQueue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeRequests < CONCURRENCY_LIMIT) {
    activeRequests += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitingQueue.push(() => {
      activeRequests += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = waitingQueue.shift();
  if (next) next();
}

/**
 * Fetch Chinese card localization metadata from mtgch (大学院废墟).
 * Supports official translations and community translations (e.g. Marvel Super Heroes).
 */
export async function fetchMtgchCard(
  setCode: string,
  collectorNumber: string,
  signal?: AbortSignal,
): Promise<MTGCHCardResponse | null> {
  const set = setCode.toLowerCase();
  const cn = collectorNumber.trim();
  const key = `${set}::${cn}`;

  const cached = mtgchPromiseCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    await acquireSlot();
    try {
      if (signal?.aborted) return null;
      const response = await fetch(
        `https://mtgch.com/api/v1/card/${encodeURIComponent(set)}/${encodeURIComponent(cn)}/`,
        { signal },
      );
      if (!response.ok) return null;
      return (await response.json()) as MTGCHCardResponse;
    } catch {
      return null;
    } finally {
      releaseSlot();
    }
  })();

  mtgchPromiseCache.set(key, promise);
  return promise;
}

function resolveFaceName(
  data: MTGCHFace,
  fullData?: MTGCHCardResponse,
  faceIndex: number = 0,
): string | undefined {
  if (data.zhs_face_name) return data.zhs_face_name;
  if (data.zhs_name?.includes(" // ")) {
    return data.zhs_name.split(" // ")[faceIndex]?.trim();
  }
  if (data.atomic_official_name?.includes(" // ")) {
    return data.atomic_official_name.split(" // ")[faceIndex]?.trim();
  }
  if (fullData?.atomic_official_name?.includes(" // ")) {
    return fullData.atomic_official_name.split(" // ")[faceIndex]?.trim();
  }
  return data.zhs_name ?? data.atomic_official_name ?? data.atomic_translated_name ?? undefined;
}

export function applyMtgchLocalization(
  card: ScryfallCard,
  data: MTGCHCardResponse,
): ScryfallCard {
  const chineseName =
    data.zhs_name || data.atomic_official_name || data.atomic_translated_name || undefined;
  const chineseType =
    data.zhs_type_line || data.atomic_translated_type || undefined;
  const chineseText =
    data.zhs_text || data.atomic_translated_text || undefined;

  const cloned: ScryfallCard = { ...card };

  if (chineseName) cloned.printed_name = chineseName;
  if (chineseType) cloned.printed_type_line = chineseType;
  if (chineseText) cloned.printed_text = chineseText;

  if (cloned.card_faces && cloned.card_faces.length > 0) {
    const frontFace = { ...cloned.card_faces[0] };
    const frontName = resolveFaceName(data, data, 0) ?? chineseName;
    if (frontName) frontFace.printed_name = frontName;
    if (chineseType) frontFace.printed_type_line = chineseType;
    if (chineseText) frontFace.printed_text = chineseText;

    const nextFaces = [frontFace];

    if (cloned.card_faces.length > 1 && data.other_faces && data.other_faces.length > 0) {
      const backData = data.other_faces[0];
      const backFace = { ...cloned.card_faces[1] };
      const backName = resolveFaceName(backData, data, 1);
      const backType = backData.zhs_type_line || backData.atomic_translated_type || undefined;
      const backText = backData.zhs_text || backData.atomic_translated_text || undefined;

      if (backName) backFace.printed_name = backName;
      if (backType) backFace.printed_type_line = backType;
      if (backText) backFace.printed_text = backText;
      nextFaces.push(backFace);
    } else if (cloned.card_faces.length > 1) {
      nextFaces.push(cloned.card_faces[1]);
    }

    cloned.card_faces = nextFaces;
  }

  return cloned;
}

export async function localizeWithMtgch(
  card: ScryfallCard,
  signal?: AbortSignal,
): Promise<ScryfallCard> {
  if (!card.set || !card.collector_number) return card;
  const data = await fetchMtgchCard(card.set, card.collector_number, signal);
  if (!data) return card;
  return applyMtgchLocalization(card, data);
}
