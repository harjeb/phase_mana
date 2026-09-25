import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ALL_BATTLEFIELD_STYLES,
  ALL_CARDS_ESTIMATE,
  cacheCardRecords,
  cancelCardArtDownload,
  cardArtCacheAvailable,
  cardArtCacheStats,
  cardDataCached,
  clearCardArtCache,
  deckArtUrls,
  deckCardNames,
  downloadAllCardArt,
  estimateBytes,
  preseedCardArt,
  variantsForStyles,
  type BulkProgress,
  type CardArtCacheStats,
} from "@/api/cardArtCache";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useScryfallStore } from "@/stores/useScryfallStore";
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
export function CardArtDownloadSection() {
  const decks = useOwnedDecks();
  const style = usePreferencesStore((state) => state.battlefieldCardStyle);
  const [stats, setStats] = useState<CardArtCacheStats | null>(null);
  const [cards, setCards] = useState(0);
  const [everyStyle, setEveryStyle] = useState(false);
  const [busy, setBusy] = useState<"decks" | "all" | "clearing" | null>(null);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [available, setAvailable] = useState(false);
  const variants = variantsForStyles(everyStyle ? ALL_BATTLEFIELD_STYLES : [style]);
  const refresh = useCallback(() => {
    cardArtCacheStats()
      .then(setStats)
      .catch(() => setStats(null));
    cardDataCached()
      .then(setCards)
      .catch(() => setCards(0));
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    const unlisten = listen<BulkProgress>("card-art:progress", (event) =>
      setProgress(event.payload),
    );
    return () => void unlisten.then((off) => off());
  }, []);
  useEffect(() => {
    void cardArtCacheAvailable().then(setAvailable);
  }, []);
  if (!available) return null;
  /** The picture alone cannot be drawn: a board offline reads the card's url
   *  out of its record. Failing to keep them does not fail the download. */
  async function keepRecordsFor(names: string[]) {
    try {
      const found = await useScryfallStore
        .getState()
        .fetchCardCollection(names.map((name) => ({ name })));
      await cacheCardRecords([...new Set(found.values())]);
    } catch (error) {
      console.warn("[card-art] could not keep the card records", error);
    }
  }
  async function downloadDecks() {
    setBusy("decks");
    try {
      const urls = [...new Set(decks.flatMap((saved) => deckArtUrls(saved.deck, variants)))];
      if (urls.length === 0) {
        toast.info(t`No decks to download art for yet.`);
        return;
      }
      const result = await preseedCardArt(urls);
      await keepRecordsFor([...new Set(decks.flatMap((saved) => deckCardNames(saved.deck)))]);
      const downloaded = result.fetched + result.alreadyCached;
      const summary =
        downloaded === 1 ? t`Art ready for one image` : t`Art ready for ${downloaded} images`;
      toast.success(
        result.failed > 0 ? t`${summary}, ${result.failed} could not be fetched` : summary,
      );
      refresh();
    } catch (error) {
      toast.error(t`Could not download art: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }
  async function downloadEverything() {
    setBusy("all");
    setProgress(null);
    try {
      const result = await downloadAllCardArt(variants);
      const summary = t`Downloaded ${result.fetched}, already had ${result.alreadyCached}`;
      toast.success(result.failed > 0 ? t`${summary}, ${result.failed} failed` : summary);
      refresh();
    } catch (error) {
      toast.error(t`Could not download every card: ${String(error)}`);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }
  async function clear(includeDownloaded: boolean) {
    setBusy("clearing");
    try {
      await clearCardArtCache(includeDownloaded);
      refresh();
    } catch (error) {
      toast.error(t`Could not clear the art cache: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }
  const deckCards = new Set(decks.flatMap((saved) => saved.deck.cards.map((c) => c.identity.name)));
  return (
    <div className="rounded-lg border bg-card/40 p-4 space-y-3 max-w-xl">
      <Label><Trans>Card Art On This Machine</Trans></Label>
      <p className="text-xs text-muted-foreground">
        <Trans>Art is kept on disk once drawn, so a board does not fetch it twice, and a deliberate
        download is never dropped when the cache is trimmed for space. Either download also keeps
        what each card <em>is</em>, which is what a board with no internet needs to know which
        picture to draw — pictures alone are not enough. Every card additionally keeps every card
        name, the set list and every ruling, so searching and pasting a decklist work offline too.</Trans>
      </p>
      <p className="text-xs text-muted-foreground">
        <Trans>Downloading for the <strong>{style}</strong> battlefield style. That style draws{" "}
        {variants.join(", ")}, so art downloaded for one style does not cover another.</Trans>
      </p>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={everyStyle}
          onChange={(event) => setEveryStyle(event.target.checked)}
        />
        <Trans>Cover every battlefield style (larger download)</Trans>
      </label>
      <p className="text-xs text-muted-foreground">
        {stats
          ? t`On disk: ${stats.files} images, ${formatBytes(stats.bytes)} — ${stats.pinnedFiles} of them downloaded on purpose (${formatBytes(stats.pinnedBytes)}).`
          : t`Reading the cache…`}
      </p>
      <p className="text-xs text-muted-foreground">
        {cards > 0
          ? t`Card data: ${cards.toLocaleString()} cards, so this machine can play and host those offline.`
          : t`No card data yet — without it a board with no internet stays blank however much art is cached.`}
      </p>
      {progress && (
        <p className="text-xs text-muted-foreground">
          <Trans>{progress.done} of {progress.total} — {formatBytes(progress.bytes)} downloaded.</Trans>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void downloadDecks()} disabled={busy !== null}>
          {busy === "decks"
            ? t`Downloading…`
            : t`My decks (${decks.length}) · ~${formatBytes(estimateBytes(variants, deckCards.size))}`}
        </Button>
        {busy === "all" ? (
          <Button variant="outline" onClick={() => void cancelCardArtDownload()}>
            <Trans>Stop</Trans>
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => void downloadEverything()}
            disabled={busy !== null}
          >
            {t`Every card · ~${formatBytes(estimateBytes(variants, ALL_CARDS_ESTIMATE))}`}
          </Button>
        )}
        <Button variant="outline" onClick={() => void clear(false)} disabled={busy !== null}>
          <Trans>Trim unused</Trans>
        </Button>
        <Button
          variant="destructive-quiet"
          onClick={() => void clear(true)}
          disabled={busy !== null}
        >
          <Trans>Delete all</Trans>
        </Button>
      </div>
    </div>
  );
}
