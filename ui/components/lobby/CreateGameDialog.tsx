import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useState, useEffect, useRef } from "react";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useDeckStore } from "@/stores/useDeckStore";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useGameDevStore } from "@/stores/useGameDevStore";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { EngineKind } from "@/protocol";
import {
  GAME_FORMATS,
  validateDeckSections,
  commanderPairLabel,
  type GameFormat,
} from "@/lib/formats";
import { PartnerBadge } from "@/components/deck/PartnerBadge";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckSelectionCard } from "./DeckSelectionCard";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { savePresetToAccountOnUse } from "@/lib/presetDeckAccount";
import {
  availableEngines,
  hubEntryEngines,
  supportsAvailableEngine,
  supportsEngine,
} from "@/lib/engines";
import { cn } from "@/lib/utils";
import { Loader2, Search, Shuffle, Swords } from "lucide-react";
import { getDeckFingerprint } from "@/lib/decks";
import { useHubDeckSearch } from "@/hooks/useHubDeckSearch";
import { useHubStore } from "@/stores/useHubStore";
import type { DeckHubEntryDetail, DeckHubEntrySummary } from "@/api/hubTypes";
const formatLabels = {
  standard: [msg`Standard`, msg`60+ cards, max 4 copies, 20 life, rotating sets`],
  pioneer: [msg`Pioneer`, msg`60+ cards, max 4 copies, 20 life, Return to Ravnica forward`],
  modern: [msg`Modern`, msg`60+ cards, max 4 copies, 20 life, 8th Edition forward`],
  legacy: [msg`Legacy`, msg`60+ cards, max 4 copies, 20 life, all sets, banned list`],
  vintage: [msg`Vintage`, msg`60+ cards, max 4 copies, 20 life, all sets, restricted list`],
  pauper: [msg`Pauper`, msg`60+ cards, max 4 copies, 20 life, commons only`],
  premodern: [msg`Premodern`, msg`60+ cards, max 4 copies, Fourth Edition through Scourge`],
  commander: [msg`Commander`, msg`100 cards, singleton, 40 life, requires commander`],
  oathbreaker: [msg`Oathbreaker`, msg`60 cards, singleton, 20 life, planeswalker + signature spell`],
  tiny_leaders: [msg`Tiny Leaders`, msg`50 cards, singleton, 20 life, legendary commander with mana value 3 or less`],
  duel_commander: [msg`Duel Commander`, msg`100 cards, singleton, 30 life, 1v1 commander`],
  pauper_commander: [msg`Pauper Commander`, msg`100 cards, singleton, 40 life, uncommon creature commander, commons only`],
  archenemy: [msg`Archenemy`, msg`One archenemy at 40 life against the heroes at 20, with a scheme deck`],
  planechase: [msg`Planechase`, msg`60-card decks, 20 life, a shared planar deck and the planar die`],
  two_headed_giant: [msg`Two-Headed Giant`, msg`Two teams of two share a 30-life total and take their turns together`],
  draft: [msg`Draft`, msg`40+ cards, no copy limit, 20 life`],
  sealed: [msg`Sealed`, msg`40+ cards, no copy limit, 20 life`],
};

interface CreateGameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "play" | "lobby";
  engineKind?: EngineKind;
  forcedFormatId?: string;
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  target?: "player" | "bot";
  onStart: (
    deck: Deck,
    formatId: string,
    commanderName?: string,
    playerCount?: number,
    publishedDeckId?: string,
  ) => void;
}
export function CreateGameDialog({
  open,
  onOpenChange,
  mode = "play",
  engineKind,
  forcedFormatId,
  preSelectedDeckId,
  preSelectedHubDeckId,
  target = "player",
  onStart,
}: CreateGameDialogProps) {
  const { i18n } = useLingui();
  const formatName = (format: GameFormat) => {
    const labels = formatLabels[format.id as keyof typeof formatLabels];
    return labels ? i18n._(labels[0]) : format.name;
  };
  const formatDescription = (format: GameFormat) => {
    const labels = formatLabels[format.id as keyof typeof formatLabels];
    return labels ? i18n._(labels[1]) : format.description;
  };
  const currentDeck = useDeckStore((state) => state.currentDeck);
  const ownedDecks = useOwnedDecks();
  const accountDeckDetails = useAccountDecksStore((state) => state.details);
  const allowIllegalDecks = useGameDevStore((s) => s.allowIllegalDecks);
  const isLobbyMode = mode === "lobby";
  const denseDecks = useIsShortScreen();
  const isTouch = useIsTouch();
  const initialFormat = GAME_FORMATS.find((f) => f.id === forcedFormatId) ?? GAME_FORMATS[0];
  const [selectedFormat, setSelectedFormat] = useState<GameFormat>(initialFormat);
  const [selectedDeck, setSelectedDeck] = useState<string>(preSelectedDeckId ?? "current");
  const [selectedCommander, setSelectedCommander] = useState<string>(
    currentDeck.commanders?.[0]?.identity.name ?? "",
  );
  const presetDecks = usePresetDecks(engineKind);
  const [playerCount, setPlayerCount] = useState(2);
  const [deckSearch, setDeckSearch] = useState("");
  const [loadedHubDecks, setLoadedHubDecks] = useState<Record<string, DeckHubEntryDetail>>({});
  const [loadingHubDeckId, setLoadingHubDeckId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const selectedFormatRef = useRef(selectedFormat);
  selectedFormatRef.current = selectedFormat;
  const hubDecks = useHubDeckSearch(
    deckSearch,
    selectedFormat.id,
    open,
    engineKind ? [engineKind] : availableEngines(),
    "community",
  );
  const hubSearchResults = hubDecks.decks.filter((entry) =>
    engineKind
      ? supportsEngine(hubEntryEngines(entry), engineKind)
      : supportsAvailableEngine(hubEntryEngines(entry)),
  );
  const loadHubDeck = useHubStore((state) => state.loadEntry);
  const restoredHubDeckRef = useRef<string | null>(null);
  const hubSelectionRequestIdRef = useRef(0);
  useEffect(() => {
    if (!forcedFormatId) return;
    const forced = GAME_FORMATS.find((f) => f.id === forcedFormatId);
    if (forced) {
      hubSelectionRequestIdRef.current += 1;
      setLoadingHubDeckId(null);
      setSelectedFormat(forced);
    }
  }, [forcedFormatId]);
  useEffect(() => {
    if (preSelectedDeckId) {
      hubSelectionRequestIdRef.current += 1;
      setLoadingHubDeckId(null);
      setSelectedDeck(preSelectedDeckId);
    }
  }, [preSelectedDeckId]);
  useEffect(() => {
    if (!open || !hubDecks.enabled) {
      hubSelectionRequestIdRef.current += 1;
      setLoadingHubDeckId(null);
      return;
    }
    if (!preSelectedHubDeckId || restoredHubDeckRef.current === preSelectedHubDeckId) return;
    restoredHubDeckRef.current = preSelectedHubDeckId;
    const requestId = ++hubSelectionRequestIdRef.current;
    setLoadingHubDeckId(preSelectedHubDeckId);
    void loadHubDeck(preSelectedHubDeckId)
      .then((detail) => {
        if (hubSelectionRequestIdRef.current !== requestId) return;
        const formatId = detail.deck.format ?? detail.format ?? "standard";
        if (formatId !== selectedFormat.id) {
          restoredHubDeckRef.current = null;
          toast.error(t`"${detail.title}" is not a ${formatName(selectedFormat)} deck`);
          return;
        }
        setLoadedHubDecks((current) => ({ ...current, [detail.id]: detail }));
        setSelectedDeck(`hub:${detail.id}`);
      })
      .catch((err) => {
        if (hubSelectionRequestIdRef.current !== requestId) return;
        restoredHubDeckRef.current = null;
        toast.error(err instanceof Error ? err.message : t`Failed to load Community deck`);
      })
      .finally(() => {
        if (hubSelectionRequestIdRef.current === requestId) setLoadingHubDeckId(null);
      });
  }, [
    hubDecks.enabled,
    loadHubDeck,
    open,
    preSelectedHubDeckId,
    selectedFormat.id,
    selectedFormat.name,
  ]);
  const currentDeckFingerprint = getDeckFingerprint(currentDeck);
  const distinctSavedDecks = ownedDecks.filter(
    (saved) =>
      saved.id === preSelectedDeckId || getDeckFingerprint(saved.deck) !== currentDeckFingerprint,
  );
  const currentDeckIsPlayable =
    currentDeck.cards.length > 0 || (currentDeck.commanders?.length ?? 0) > 0;
  const allDeckCards = (d: Deck): DeckCard[] => [
    ...d.cards,
    ...d.sideboard,
    ...(d.attractions ?? []),
    ...(d.contraptions ?? []),
    ...(d.schemes ?? []),
    ...(d.planes ?? []),
    ...(d.commanders ?? []),
  ];
  const currentDeckEntry = !currentDeckIsPlayable
    ? []
    : [
        {
          id: "current",
          name: currentDeck.name,
          badge: t`editing`,
          labels: currentDeck.labels,
          sourceDeck: currentDeck,
          isPreset: false as const,
          cover: resolveCoverCard(currentDeck),
          cards: allDeckCards(currentDeck),
          formatId: currentDeck.format ?? "standard",
          commanderName: currentDeck.commanders?.[0]?.identity.name,
        },
      ];
  const userDecks = [
    ...currentDeckEntry,
    ...distinctSavedDecks.map((s) => ({
      id: s.id,
      name: s.deck.name,
      badge: (s.deck.draft ? t`draft` : null) as string | null,
      labels: s.deck.labels,
      sourceDeck: s.deck,
      isPreset: false as const,
      cover: resolveCoverCard(s.deck),
      cards: allDeckCards(s.deck),
      formatId: s.deck.format ?? "standard",
      commanderName: s.deck.commanders?.[0]?.identity.name,
    })),
  ];
  const presetDeckEntries = presetDecks.map((deck) => ({
    id: `preset__${deck.id ?? deck.name}`,
    name: deck.name,
    desc: deck.description,
    color: deck.color,
    sourceDeck: deck,
    isPreset: true as const,
    cover: resolveCoverCard(deck),
    cards: [...deck.cards, ...(deck.commanders ?? [])],
    formatId: deck.format ?? "standard",
    commanderName: deck.commanders?.[0]?.identity.name,
  }));
  const hubDeckEntries = Object.values(loadedHubDecks).map((detail) => ({
    id: `hub:${detail.id}`,
    name: detail.title,
    desc: detail.summary,
    color: detail.colors,
    badge: t`Community`,
    sourceDeck: detail.deck,
    isPreset: false as const,
    cover: resolveCoverCard(detail.deck),
    cards: allDeckCards(detail.deck),
    formatId: detail.deck.format ?? detail.format ?? "standard",
    commanderName: detail.deck.commanders?.[0]?.identity.name,
  }));
  const allDecks = [...userDecks, ...hubDeckEntries, ...presetDeckEntries];
  const searchLower = deckSearch.toLowerCase();
  const formatPresetEntries = presetDeckEntries.filter((d) => d.formatId === selectedFormat.id);
  const filteredPresetEntries = searchLower
    ? formatPresetEntries.filter(
        (d) =>
          d.name.toLowerCase().includes(searchLower) || d.desc?.toLowerCase().includes(searchLower),
      )
    : formatPresetEntries;
  const formatUserDecks = userDecks.filter((d) => d.formatId === selectedFormat.id);
  const filteredUserDecks = searchLower
    ? formatUserDecks.filter((d) => d.name.toLowerCase().includes(searchLower))
    : formatUserDecks;
  useEffect(() => {
    const entry = allDecks.find((d) => d.id === selectedDeck);
    setSelectedCommander(entry?.commanderName ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeck]);
  const selectedDeckEntry = allDecks.find(
    (d) => d.id === selectedDeck && d.formatId === selectedFormat.id,
  );
  const selectedDeckCommanders = selectedDeckEntry?.sourceDeck.commanders ?? [];
  const selectedPartnerLabel = commanderPairLabel(
    selectedDeckCommanders,
    selectedDeckEntry?.sourceDeck.format,
  );
  const legendaryCreatures = selectedDeckEntry
    ? Array.from(
        new Map([
          ...(selectedDeckEntry.commanderName
            ? [
                [selectedDeckEntry.commanderName, selectedDeckEntry.commanderName] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...selectedDeckEntry.cards
            .filter((c) => c.supertypes?.includes("Legendary") && c.types?.includes("Creature"))
            .map((c) => [c.identity.name, c.identity.name] as [string, string]),
        ]).values(),
      )
    : [];
  const needsCommander = selectedFormat.deckRules.requiresCommander;
  const commanderValid = !needsCommander || selectedCommander !== "";
  const selectedDeckIsVisible =
    [...filteredUserDecks, ...filteredPresetEntries].some((entry) => entry.id === selectedDeck) ||
    hubSearchResults.some((entry) => `hub:${entry.id}` === selectedDeck) ||
    (selectedDeck.startsWith("hub:") && selectedDeckEntry !== undefined);
  const selectedDeckValidation = selectedDeckEntry
    ? selectedDeckEntry.isPreset
      ? { legal: true, errors: [] as string[] }
      : validateDeckSections(
          {
            deck: selectedDeckEntry.sourceDeck,
            commanderName: selectedCommander || selectedDeckEntry.commanderName,
          },
          selectedFormat,
        )
    : { legal: false, errors: [] as string[] };
  const isReady =
    selectedDeckIsVisible && (selectedDeckValidation.legal || allowIllegalDecks) && commanderValid;
  function invalidateHubSelection() {
    hubSelectionRequestIdRef.current += 1;
    setLoadingHubDeckId(null);
  }
  function selectDeck(deckId: string) {
    invalidateHubSelection();
    setSelectedDeck(deckId);
  }
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) invalidateHubSelection();
    onOpenChange(nextOpen);
  }
  async function selectHubDeck(summary: DeckHubEntrySummary, activate = false) {
    const requestId = ++hubSelectionRequestIdRef.current;
    setLoadingHubDeckId(summary.id);
    try {
      const detail = await loadHubDeck(summary.id);
      if (hubSelectionRequestIdRef.current !== requestId) return;
      setLoadedHubDecks((current) => ({ ...current, [detail.id]: detail }));
      const entry = {
        id: `hub:${detail.id}`,
        name: detail.title,
        desc: detail.summary,
        color: detail.colors,
        badge: t`Community`,
        sourceDeck: detail.deck,
        isPreset: false as const,
        cover: resolveCoverCard(detail.deck),
        cards: allDeckCards(detail.deck),
        formatId: detail.deck.format ?? detail.format ?? "standard",
        commanderName: detail.deck.commanders?.[0]?.identity.name,
      };
      const currentFormat = selectedFormatRef.current;
      if (entry.formatId !== currentFormat.id) {
        toast.error(t`"${detail.title}" is not a ${formatName(currentFormat)} deck`);
        return;
      }
      setSelectedDeck(entry.id);
      if (activate) handleCreate(entry, entry.commanderName);
    } catch (err) {
      if (hubSelectionRequestIdRef.current !== requestId) return;
      toast.error(err instanceof Error ? err.message : t`Failed to load Community deck`);
    } finally {
      if (hubSelectionRequestIdRef.current === requestId) setLoadingHubDeckId(null);
    }
  }
  async function handleCreate(
    entry: (typeof allDecks)[number] | undefined = selectedDeckIsVisible
      ? selectedDeckEntry
      : undefined,
    commanderOverride?: string,
  ) {
    if (starting) return;
    if (!entry) {
      toast.error(t`Please select a deck`);
      return;
    }
    if (entry.formatId !== selectedFormat.id) {
      toast.error(t`Please select a deck for this format`);
      return;
    }
    if (entry.sourceDeck.cards.length === 0 && (entry.sourceDeck.commanders?.length ?? 0) === 0) {
      toast.error(t`"${entry.name}" has no cards`);
      return;
    }
    const commander =
      commanderOverride ?? (needsCommander ? selectedCommander : entry.commanderName);
    const validation = entry.isPreset
      ? { legal: true, errors: [] as string[] }
      : validateDeckSections(
          { deck: entry.sourceDeck, commanderName: commander || entry.commanderName },
          selectedFormat,
        );
    if (!validation.legal && !allowIllegalDecks) {
      toast.warning(validation.errors[0] ?? t`Deck is not legal in this format`);
      return;
    }
    if (needsCommander && !(commander || entry.commanderName)) {
      toast.error(t`Please select a commander`);
      return;
    }
    setStarting(true);
    let publishedDeckId = entry.id.startsWith("hub:") ? entry.id.slice(4) : undefined;
    const savedEntry = ownedDecks.find((saved) => saved.id === entry.id);
    const rankingPresetKey = entry.isPreset
      ? entry.sourceDeck.id
      : savedEntry?.accountDeckId
        ? accountDeckDetails[savedEntry.accountDeckId]?.derivedFromPresetKey
        : undefined;
    if (isLobbyMode && target !== "bot" && rankingPresetKey && hubDecks.enabled) {
      try {
        const published = await loadHubDeck(rankingPresetKey);
        if (getDeckFingerprint(published.deck) === getDeckFingerprint(entry.sourceDeck)) {
          publishedDeckId = published.id;
        }
      } catch {
        publishedDeckId = undefined;
      }
    }
    handleOpenChange(false);
    if (entry.isPreset) savePresetToAccountOnUse(entry.sourceDeck.id);
    onStart(
      entry.sourceDeck,
      selectedFormat.id,
      selectedFormat.deckRules.requiresCommander ? commander || entry.commanderName : undefined,
      playerCount,
      publishedDeckId,
    );
    setStarting(false);
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[min(96vw,84rem)] max-w-6xl p-0 gap-0 overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto]"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const target = e.target as HTMLElement;
          if (
            target.closest(
              "input, button, a, textarea, [contenteditable='true'], [role='combobox'], [role='listbox']",
            )
          )
            return;
          e.preventDefault();
          handleCreate();
        }}
      >
        <div className="px-6 py-4 border-b">
          <DialogTitle className="text-lg font-semibold">
            {target === "bot" ? t`Choose Bot Deck` : isLobbyMode ? t`Choose Deck` : t`New Game`}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            {target === "bot"
              ? t`Select the deck the AI will play in this lobby.`
              : isLobbyMode
                ? t`Select the deck you will play in this lobby.`
                : t`Pick a deck and battle a random AI opponent`}
          </p>
        </div>

        <div className="flex min-h-0 overflow-hidden">
          {!isLobbyMode && (
            <div className="w-48 border-r flex-shrink-0 p-4 space-y-5 overflow-y-auto bg-muted/20">
              <div>
                <SectionLabel><Trans>Format</Trans></SectionLabel>
                <div className="mt-2 space-y-2">
                  {GAME_FORMATS.map((format) => (
                    <button
                      key={format.id}
                      type="button"
                      onClick={() => {
                        invalidateHubSelection();
                        setSelectedFormat(format);
                      }}
                      className={cn(
                        "w-full rounded-lg border p-2.5 text-left transition-colors",
                        selectedFormat.id === format.id
                          ? "border-selection bg-selection/10"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      <div className="mb-1">
                        <FormatBadge formatId={format.id} />
                      </div>
                      <p className="font-medium text-xs">{formatName(format)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                        {formatDescription(format)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel><Trans>Rules</Trans></SectionLabel>
                <div className="mt-2 space-y-1.5">
                  <RulePill
                    label={t`Deck`}
                    value={
                      t`${selectedFormat.deckRules.minDeckSize}${selectedFormat.deckRules.maxDeckSize ? `–${selectedFormat.deckRules.maxDeckSize}` : "+"} cards`
                    }
                  />
                  <RulePill
                    label={t`Copies`}
                    value={
                      selectedFormat.deckRules.maxCopies === 1
                        ? t`Singleton`
                        : t`Max ${selectedFormat.deckRules.maxCopies}`
                    }
                  />
                  <RulePill label={t`Life`} value={`${selectedFormat.deckRules.startingLife}`} />
                </div>
              </div>

              {needsCommander && (
                <div>
                  <SectionLabel><Trans>Commander</Trans></SectionLabel>
                  <div className="mt-2 space-y-1.5">
                    {selectedPartnerLabel ? (
                      <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-background px-2 py-1.5 text-xs">
                        <span className="truncate">{selectedDeckCommanders[0].identity.name}</span>
                        <span className="text-muted-foreground">+</span>
                        <span className="truncate">{selectedDeckCommanders[1].identity.name}</span>
                        <PartnerBadge label={selectedPartnerLabel} />
                      </div>
                    ) : (
                      <>
                        {legendaryCreatures.length === 0 && (
                          <p className="text-[10px] text-muted-foreground italic">
                            <Trans>No legendaries in deck — type a name below.</Trans>
                          </p>
                        )}
                        {legendaryCreatures.length > 0 ? (
                          <select
                            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs pointer-coarse:text-base"
                            value={selectedCommander}
                            onChange={(event) => setSelectedCommander(event.target.value)}
                          >
                            <option value=""><Trans>— Choose —</Trans></option>
                            {legendaryCreatures.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs pointer-coarse:text-base"
                            placeholder={t`Card name`}
                            value={selectedCommander}
                            onChange={(event) => setSelectedCommander(event.target.value)}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div>
                <SectionLabel>
                  <Trans>Opponents</Trans>
                  <span className="ml-1 text-[9px] font-mono text-warning bg-warning/10 px-1 rounded">
                    <Trans>DEV</Trans>
                  </span>
                </SectionLabel>
                <div className="mt-2 flex gap-1">
                  {[2, 3, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setPlayerCount(count)}
                      className={cn(
                        "flex-1 py-1 rounded border text-xs transition-colors",
                        playerCount === count
                          ? "border-warning bg-warning/10 text-warning font-semibold"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      <Trans>{count - 1}v1</Trans>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-4 pt-4 pb-2 bg-background">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  aria-label={t`Filter decks`}
                  placeholder={t`Filter decks...`}
                  value={deckSearch}
                  onChange={(e) => setDeckSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-md border bg-background text-sm pointer-coarse:h-10 pointer-coarse:text-base focus:outline-none focus:ring-1 focus:ring-primary"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="p-4 pt-2">
                <SectionLabel><Trans>Your Decks</Trans></SectionLabel>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                  <Trans>Decks you've built in the editor.</Trans>
                </p>
                {filteredUserDecks.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    {searchLower
                      ? t`No saved decks match your search.`
                      : t`No saved decks. Build one in the Deck Editor.`}
                  </p>
                ) : (
                  <div
                    className={cn(
                      "grid gap-3",
                      denseDecks
                        ? "grid-cols-2 md:grid-cols-3"
                        : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
                    )}
                  >
                    {filteredUserDecks.map((d) => {
                      const validation = validateDeckSections(
                        {
                          deck: d.sourceDeck,
                          commanderName: selectedFormat.deckRules.requiresCommander
                            ? d.id === selectedDeck
                              ? selectedCommander || d.commanderName
                              : d.commanderName
                            : undefined,
                        },
                        selectedFormat,
                      );
                      return (
                        <DeckSelectionCard
                          key={d.id}
                          name={d.name}
                          badge={d.badge}
                          labels={d.labels}
                          cards={d.cards}
                          cover={d.cover}
                          isPreset={d.isPreset}
                          isSelected={selectedDeck === d.id}
                          isLegal={validation.legal}
                          validationError={validation.errors[0]}
                          dense={denseDecks}
                          isTouch={isTouch}
                          onSelect={() => selectDeck(d.id)}
                          onActivate={() => handleCreate(d, d.commanderName)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mx-4 border-t" />

              {hubDecks.enabled &&
                (deckSearch.trim() !== "" ||
                  hubDecks.loading ||
                  hubDecks.error !== null ||
                  hubSearchResults.length > 0) && (
                  <div className="p-4">
                    <SectionLabel><Trans>Community</Trans></SectionLabel>
                    <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                      <Trans>Community decks are downloaded when selected.</Trans>
                    </p>
                    {hubDecks.error ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                        <span className="min-w-0 break-words">{hubDecks.error}</span>
                        <Button variant="outline" size="sm" onClick={hubDecks.retry}>
                          <Trans>Retry</Trans>
                        </Button>
                      </div>
                    ) : hubDecks.loading && hubSearchResults.length === 0 ? (
                      <div
                        className={cn(
                          "grid gap-3",
                          denseDecks
                            ? "grid-cols-2 md:grid-cols-3"
                            : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
                        )}
                      >
                        {Array.from({ length: 10 }, (_, index) => (
                          <div
                            key={index}
                            className={cn(
                              "animate-pulse rounded-lg bg-muted",
                              denseDecks ? "h-24" : "aspect-[4/3] sm:min-h-[172px]",
                            )}
                          />
                        ))}
                      </div>
                    ) : hubSearchResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        <Trans>No Community decks match your search.</Trans>
                      </p>
                    ) : (
                      <div
                        className={cn(
                          "grid gap-3",
                          denseDecks
                            ? "grid-cols-2 md:grid-cols-3"
                            : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
                        )}
                      >
                        {hubSearchResults.map((deck) => {
                          const loaded = loadedHubDecks[deck.id];
                          const format = loaded
                            ? GAME_FORMATS.find((item) => item.id === selectedFormat.id)
                            : null;
                          const validation =
                            loaded && format
                              ? validateDeckSections(
                                  {
                                    deck: loaded.deck,
                                    commanderName: loaded.deck.commanders?.[0]?.identity.name,
                                  },
                                  format,
                                )
                              : { legal: true, errors: [] as string[] };
                          return (
                            <DeckSelectionCard
                              key={deck.id}
                              name={
                                loadingHubDeckId === deck.id ? t`Loading ${deck.title}…` : deck.title
                              }
                              color={deck.colors}
                              author={deck.author}
                              cardCount={deck.cardCount + deck.commanders.length}
                              badge={t`Community`}
                              cards={[]}
                              cover={undefined}
                              coverImageUrl={deck.coverImageUrl}
                              isPreset={false}
                              isHub
                              isSelected={selectedDeck === `hub:${deck.id}`}
                              isLegal={validation.legal}
                              validationError={validation.errors[0]}
                              dense={denseDecks}
                              isTouch={isTouch}
                              loading={loadingHubDeckId === deck.id}
                              onSelect={() => void selectHubDeck(deck)}
                              onActivate={() => void selectHubDeck(deck, true)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

              <div className="mx-4 border-t" />

              <div className="p-4">
                <SectionLabel><Trans>Starter Decks</Trans></SectionLabel>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                  <Trans>Pre-built themed decks — always legal, great for testing mechanics.</Trans>
                </p>
                {filteredPresetEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    <Trans>No preset decks match your search.</Trans>
                  </p>
                ) : (
                  <div
                    className={cn(
                      "grid gap-3",
                      denseDecks
                        ? "grid-cols-2 md:grid-cols-3"
                        : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
                    )}
                  >
                    {filteredPresetEntries.map((deck) => (
                      <DeckSelectionCard
                        key={deck.id}
                        name={deck.name}
                        desc={deck.desc}
                        color={deck.color}
                        cards={deck.cards}
                        cover={deck.cover}
                        isPreset={deck.isPreset}
                        isSelected={selectedDeck === deck.id}
                        isLegal={true}
                        dense={denseDecks}
                        isTouch={isTouch}
                        onSelect={() => selectDeck(deck.id)}
                        onActivate={() => handleCreate(deck, deck.commanderName)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t flex items-center justify-between gap-4 bg-muted/10">
          <div className="flex items-center gap-2 text-sm min-w-0">
            {!isLobbyMode && selectedDeckEntry ? (
              <>
                <span className="text-muted-foreground shrink-0"><Trans>Playing</Trans></span>
                <span className="font-medium truncate">{selectedDeckEntry.name}</span>
                <span className="text-muted-foreground shrink-0"><Trans>vs</Trans></span>
                <span className="inline-flex items-center gap-1 text-muted-foreground shrink-0">
                  <Shuffle className="h-3 w-3" />
                  <Trans>Random AI</Trans>
                </span>
              </>
            ) : selectedDeckEntry ? (
              <div className="min-w-0">
                <span className="block truncate text-sm text-muted-foreground">
                  <Trans>Selected:</Trans>{" "}
                  <span className="font-medium text-foreground">{selectedDeckEntry.name}</span>
                </span>
                {!selectedDeckValidation.legal && (
                  <span className="block truncate text-xs text-warning">
                    {selectedDeckValidation.errors[0] ??
                      t`This deck is not legal in the room format.`}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground italic text-xs"><Trans>No deck selected</Trans></span>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleCreate()}
              disabled={!isReady || starting}
              className="gap-1.5"
            >
              {starting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                !isLobbyMode && <Swords className="h-3.5 w-3.5" />
              )}
              {starting
                ? t`Selecting…`
                : target === "bot"
                  ? t`Add Bot`
                  : isLobbyMode
                    ? t`Select Deck`
                    : t`Play`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
      {children}
    </Label>
  );
}
function RulePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
