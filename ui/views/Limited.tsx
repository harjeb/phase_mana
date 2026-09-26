import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, Crown, Dice5, Hourglass, Layers, Package, Shuffle, Swords, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SetPicker } from "@/components/limited/SetPicker";
import { SetSymbol } from "@/components/limited/SetSymbol";
import { PickAPackDialog } from "@/components/limited/PickAPackDialog";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { fetchEditionInfo, fetchLocalSets, fetchSetPool, type EditionInfo } from "@/api/limitedEdition";
import { cn } from "@/lib/utils";
import type { DraftCard, PickAPackView } from "@/types/limited";
import type { ScryfallSet } from "@/types/scryfall";
export default function Limited() {
  const navigate = useNavigate();
  const startSealed = useLimitedStore((s) => s.startSealed);
  const startBoosterDraft = useLimitedStore((s) => s.startBoosterDraft);
  const startWinston = useLimitedStore((s) => s.startWinston);
  const startCommanderDraft = useLimitedStore((s) => s.startCommanderDraft);
  const startVariant = useLimitedStore((s) => s.startVariant);
  const startPickAPack = useLimitedStore((s) => s.startPickAPack);
  const pickPack = useLimitedStore((s) => s.pickPack);
  const importCube = useLimitedStore((s) => s.importCubeFromCubeCobra);
  const isStarting = useLimitedStore((s) => s.isStarting);
  const lastError = useLimitedStore((s) => s.lastError);
  const fetchSealedTemplates = useLimitedStore((s) => s.fetchSealedTemplates);
  const fetchChaosThemes = useLimitedStore((s) => s.fetchChaosThemes);
  const sealedTemplates = useLimitedStore((s) => s.sealedTemplates);
  const chaosThemes = useLimitedStore((s) => s.chaosThemes);
  const lastImportedCube = useLimitedStore((s) => s.lastImportedCube);
  const [draftableSets, setDraftableSets] = useState<ScryfallSet[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [setsError, setSetsError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLocalSets()
      .then((sets) => { if (!cancelled) setDraftableSets(sets); })
      .catch((err: unknown) => { if (!cancelled) setSetsError(String(err)); })
      .finally(() => { if (!cancelled) setSetsLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const [numBoosters, setNumBoosters] = useState(6);
  const [podSize, setPodSize] = useState(8);
  const [winstonPacks, setWinstonPacks] = useState(6);
  const [cubeInput, setCubeInput] = useState("");
  const [selectedSetCode, setSelectedSetCode] = useState("");
  const [fetchingPool, setFetchingPool] = useState(false);
  const [editionInfo, setEditionInfo] = useState<EditionInfo | null>(null);
  const [editionInfoLoading, setEditionInfoLoading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<string>("");
  const [seedInput, setSeedInput] = useState("");
  const [picksPerPass, setPicksPerPass] = useState(1);
  const [rejectRarity, setRejectRarity] = useState("rare");
  const [pickView, setPickView] = useState<PickAPackView | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const seedOpt = useMemo(() => {
    const trimmed = seedInput.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
  }, [seedInput]);
  useEffect(() => {
    if (!selectedSetCode) {
      setEditionInfo(null);
      setSelectedVariant("");
      return;
    }
    let cancelled = false;
    setEditionInfoLoading(true);
    fetchEditionInfo(selectedSetCode)
      .then((info) => {
        if (cancelled) return;
        setEditionInfo(info);
        setSelectedVariant("");
      })
      .finally(() => {
        if (!cancelled) setEditionInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSetCode]);
  useEffect(() => {
    fetchSealedTemplates();
    fetchChaosThemes();
  }, [fetchSealedTemplates, fetchChaosThemes]);
  const fetchPool = async (): Promise<DraftCard[]> => {
    if (!selectedSetCode) {
      throw new Error(t`Pick a set to draft first.`);
    }
    setFetchingPool(true);
    try {
      return await fetchSetPool(selectedSetCode);
    } finally {
      setFetchingPool(false);
    }
  };
  const variantOpt = selectedVariant || undefined;
  const handleStartSealed = async () => {
    try {
      const pool = await fetchPool();
      const result = await startSealed({
        poolType: "Full",
        numBoosters,
        pool,
        variant: variantOpt,
        seed: seedOpt,
      });
      navigate(`/sealed/${result.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartDraft = async () => {
    try {
      const pool = await fetchPool();
      const state = await startBoosterDraft({
        podSize,
        rounds: 3,
        pool,
        variant: variantOpt,
        seed: seedOpt,
        picksPerPass,
      });
      navigate(`/draft/${state.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartWinston = async () => {
    try {
      const pool = await fetchPool();
      const state = await startWinston({
        poolPacks: winstonPacks,
        pool,
        variant: variantOpt,
        seed: seedOpt,
      });
      navigate(`/winston/${state.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartCommanderDraft = async () => {
    try {
      const pool = await fetchPool();
      const state = await startCommanderDraft({
        podSize: Math.max(4, podSize),
        rounds: 3,
        pool,
        seed: seedOpt,
        picksPerPass: 2,
      });
      navigate(`/draft/${state.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartPackWars = async () => {
    try {
      const pool = await fetchPool();
      const result = await startSealed({
        poolType: "Full",
        numBoosters: 1,
        pool,
        variant: "pack_wars",
        seed: seedOpt,
      });
      navigate(`/sealed/${result.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartPackWarsHand = async () => {
    try {
      const pool = await fetchPool();
      const result = await startSealed({
        poolType: "Full",
        numBoosters: 1,
        pool,
        variant: "pack_wars_hand",
        seed: seedOpt,
      });
      navigate(`/sealed/${result.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartPickAPack = async () => {
    try {
      const pool = await fetchPool();
      const response = await startPickAPack({
        pool,
        variant: "pick_a_pack",
        seed: seedOpt,
        podSize: 2,
      });
      if (response.kind === "draft") {
        navigate(`/draft/${response.state.sessionId}`);
        return;
      }
      setPickView(response.state);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handlePickPack = async (index: number) => {
    if (!pickView) return;
    try {
      const response = await pickPack(pickView.sessionId, index);
      if (response.kind === "draft") {
        setPickView(null);
        navigate(`/draft/${response.state.sessionId}`);
        return;
      }
      setPickView(response.state);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartDuplicateSealed = async () => {
    try {
      const pool = await fetchPool();
      const result = await startSealed({
        poolType: "Full",
        numBoosters: 5,
        pool,
        variant: "duplicate_sealed",
        seed: seedOpt,
      });
      navigate(`/sealed/${result.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartBackDraft = async () => {
    try {
      const pool = await fetchPool();
      const evenPod = podSize % 2 === 0 ? podSize : podSize + 1;
      const state = await startBoosterDraft({
        podSize: evenPod,
        rounds: 3,
        pool,
        variant: "back_draft",
        seed: seedOpt,
        picksPerPass,
      });
      navigate(`/draft/${state.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartRejectRare = async () => {
    try {
      const pool = await fetchPool();
      const state = await startBoosterDraft({
        podSize,
        rounds: 3,
        pool,
        variant: "reject_rare",
        rarity: rejectRarity,
        seed: seedOpt,
        picksPerPass,
      });
      navigate(`/draft/${state.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleStartVariant = async (variant: string) => {
    try {
      const pool = await fetchPool();
      const state = await startVariant({ pool, variant, seed: seedOpt });
      navigate(`/draft/${state.sessionId}`);
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleImportCube = async () => {
    if (!cubeInput.trim()) return;
    try {
      const result = await importCube(cubeInput.trim());
      setNumBoosters(Math.max(3, Math.min(12, result.numPacks)));
    } catch {
      /* surfaced via lastError */
    }
  };
  const handleLoadPoolFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as
        | {
            name?: string;
            pool?: DraftCard[];
          }
        | DraftCard[];
      const pool = Array.isArray(parsed) ? parsed : (parsed.pool ?? []);
      if (!Array.isArray(pool) || pool.length === 0) {
        throw new Error(t`Pool file must contain a non-empty \`pool\` array of DraftCards.`);
      }
      const name =
        (Array.isArray(parsed) ? null : parsed.name) ?? file.name.replace(/\.json$/i, "");
      useLimitedStore.setState({
        lastImportedCube: {
          cubeId: `local:${name}`,
          name,
          cardCount: pool.length,
          numPacks: 3,
          singleton: false,
          pool,
          playableCardCount: pool.length,
          rejectedCardCount: 0,
        },
        lastError: null,
      });
    } catch (err) {
      useLimitedStore.setState({ lastError: t`Failed to load pool: ${String(err)}` });
    }
  };
  const startBlocked = isStarting || fetchingPool || !selectedSetCode;
  const selectedSet = draftableSets.find((s) => s.code === selectedSetCode) ?? null;
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex items-end justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          <Trans>Local play supports six-pack Sealed and three-pack Booster Draft against AI, with one card per pick. Only playable downloaded pools are listed (see README).</Trans>
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{setsLoading ? t`Loading local sets…` : t`${draftableSets.length} local sets listed`}</span>
        </div>
      </header>

      {setsError && (
        <p role="alert" className="rounded-md border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {setsError}
        </p>
      )}
      <SetPicker
        sets={draftableSets}
        selectedCode={selectedSetCode}
        onSelect={setSelectedSetCode}
      />

      {selectedSet && (
        <SelectedSetSummary
          set={selectedSet}
          info={editionInfo}
          loading={editionInfoLoading}
          selectedVariant={selectedVariant}
          onVariantChange={setSelectedVariant}
          onClear={() => setSelectedSetCode("")}
        />
      )}

      <AdvancedToggle
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((v) => !v)}
        seed={seedInput}
        onSeedChange={setSeedInput}
        picksPerPass={picksPerPass}
        onPicksPerPassChange={setPicksPerPass}
      />

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Choose a mode</Trans>
        </h2>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          <Trans>Standard Modes</Trans>
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ModeCard
            icon={<Boxes className="h-5 w-5" />}
            title={t`Sealed`}
            description={t`Open packs, build a 40-card deck, run an AI gauntlet.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Start Sealed`)}
            disabled={startBlocked}
            onStart={handleStartSealed}
          >
            <NumberField
              id="numBoosters"
              label={t`Packs`}
              value={numBoosters}
              min={6}
              max={6}
              onChange={setNumBoosters}
            />
          </ModeCard>

          <ModeCard
            icon={<Swords className="h-5 w-5" />}
            title={t`Booster Draft`}
            description={t`Pod draft against AI seats — 3 packs each.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Start Draft`)}
            disabled={startBlocked}
            onStart={handleStartDraft}
          >
            <NumberField
              id="podSize"
              label={t`Pod size`}
              value={podSize}
              min={2}
              max={8}
              onChange={setPodSize}
            />
          </ModeCard>
        </div>

        <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
          <Trans>Casual Modes</Trans>
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ModeCard
            icon={<Crown className="h-5 w-5" />}
            title={t`Commander Draft`}
            description={t`Four-seat, two-card picks (CR 903.13), then a 4-player Commander game.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Start Commander Draft`)}
            disabled={startBlocked}
            onStart={handleStartCommanderDraft}
          >
            <NumberField
              id="commanderPodSize"
              label={t`Pod size`}
              value={podSize}
              min={4}
              max={8}
              onChange={setPodSize}
            />
          </ModeCard>

          <ModeCard
            icon={<Layers className="h-5 w-5" />}
            title={t`Winston Draft`}
            description={t`Two-seat shared-stack pile draft against the AI.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Dealing piles…`, t`Start Winston`)}
            disabled={startBlocked}
            onStart={handleStartWinston}
          >
            <NumberField
              id="winstonPacks"
              label={t`Packs`}
              value={winstonPacks}
              min={6}
              max={6}
              onChange={setWinstonPacks}
            />
          </ModeCard>

          <ModeCard
            icon={<Wand2 className="h-5 w-5" />}
            title={t`CubeCobra Import`}
            description={t`Paste a cube id or url, or load a saved pool .json file.`}
            ctaLabel={isStarting ? t`Importing…` : t`Import Cube`}
            disabled={isStarting || !cubeInput.trim()}
            onStart={handleImportCube}
            footnote={
              lastImportedCube ? (
                <>
                  <Trans>Loaded: <span className="text-foreground/90">{lastImportedCube.name}</span> — {lastImportedCube.cardCount} cards</Trans>
                  {lastImportedCube.rejectedCardCount > 0 &&
                    t` · ${lastImportedCube.rejectedCardCount} without local engine data`}
                </>
              ) : null
            }
          >
            <Input
              type="text"
              value={cubeInput}
              onChange={(e) => setCubeInput(e.target.value)}
              placeholder={t`cubeid or cubecobra.com/…`}
              className="h-8 text-xs"
            />
            <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:border-primary/60 hover:text-foreground/90">
              <input
                type="file"
                accept="application/json,.json,.draft"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleLoadPoolFile(file);
                  e.target.value = ""; // allow re-upload of same file
                }}
              />
              <span><Trans>or load saved pool…</Trans></span>
            </label>
          </ModeCard>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Pack &amp; Draft Variants</Trans>
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ModeCard
            icon={<Boxes className="h-5 w-5" />}
            title={t`Pack Wars (Mini-Master)`}
            description={t`Open one booster, add 15 basic lands and play the whole pack.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Start Pack Wars`)}
            disabled={startBlocked}
            onStart={handleStartPackWars}
          />

          <ModeCard
            icon={<Boxes className="h-5 w-5" />}
            title={t`Pack Wars — Pack in Hand`}
            description={t`The whole pack starts in your hand; each turn you may play a basic from outside the game.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Start Pack-in-Hand`)}
            disabled={startBlocked}
            onStart={handleStartPackWarsHand}
          />

          <ModeCard
            icon={<Package className="h-5 w-5" />}
            title={t`Pick-a-Pack`}
            description={t`Snake-pick which unopened boosters you and the AI will draft from, then draft normally.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Choose packs`)}
            disabled={startBlocked}
            onStart={handleStartPickAPack}
          />

          <ModeCard
            icon={<Layers className="h-5 w-5" />}
            title={t`Duplicate Sealed (Mirror)`}
            description={t`Everyone opens the same five packs and builds from identical pools.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Start Mirror Sealed`)}
            disabled={startBlocked}
            onStart={handleStartDuplicateSealed}
          />

          <ModeCard
            icon={<Shuffle className="h-5 w-5" />}
            title={t`Back Draft`}
            description={t`Draft normally, then swap pools with the seat across from you.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Start Back Draft`)}
            disabled={startBlocked}
            onStart={handleStartBackDraft}
          />

          <ModeCard
            icon={<Wand2 className="h-5 w-5" />}
            title={t`Reject Rare`}
            description={t`Boosters of nothing but rares — or the silver/iron sub-variant.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Opening packs…`, t`Start Reject Rare`)}
            disabled={startBlocked}
            onStart={handleStartRejectRare}
          >
            <label htmlFor="rejectRarity" className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground"><Trans>Rarity</Trans></span>
              <select
                id="rejectRarity"
                value={rejectRarity}
                onChange={(e) => setRejectRarity(e.target.value)}
                className="h-7 rounded border border-border/70 bg-background px-1 text-xs"
              >
                <option value="rare">{t`Rare + Mythic`}</option>
                <option value="mythic">{t`Mythic only`}</option>
                <option value="uncommon">{t`Uncommon (silver)`}</option>
                <option value="common">{t`Common (iron)`}</option>
              </select>
            </label>
          </ModeCard>

          <ModeCard
            icon={<Crown className="h-5 w-5" />}
            title={t`Solomon Draft`}
            description={t`Split 8-card batches into two piles; your opponent chooses one.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Dealing cards…`, t`Start Solomon`)}
            disabled={startBlocked}
            onStart={() => handleStartVariant("solomon")}
          />

          <ModeCard
            icon={<Hourglass className="h-5 w-5" />}
            title={t`Rotisserie Draft`}
            description={t`One shared pool, snake order, one card at a time.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Dealing cards…`, t`Start Rotisserie`)}
            disabled={startBlocked}
            onStart={() => handleStartVariant("rotisserie")}
          />

          <ModeCard
            icon={<Dice5 className="h-5 w-5" />}
            title={t`Continuous Draft`}
            description={t`Reveal four, take 1-2-1; the first chooser alternates each batch.`}
            ctaLabel={ctaLabel(fetchingPool, isStarting, t`Dealing cards…`, t`Start Continuous`)}
            disabled={startBlocked}
            onStart={() => handleStartVariant("continuous")}
          />
        </div>
      </section>

      {lastImportedCube && lastImportedCube.pool && lastImportedCube.pool.length > 0 && (
        <CubeStartActions
          cube={lastImportedCube}
          numBoosters={numBoosters}
          podSize={podSize}
          winstonPacks={winstonPacks}
          seed={seedOpt}
          isStarting={isStarting}
          onStartSealed={async () => {
            try {
              const result = await startSealed({
                poolType: "Custom",
                numBoosters,
                pool: lastImportedCube.pool!,
                seed: seedOpt,
                singleton: lastImportedCube.singleton,
              });
              navigate(`/sealed/${result.sessionId}`);
            } catch {
              /* surfaced via lastError */
            }
          }}
          onStartDraft={async () => {
            try {
              const state = await startBoosterDraft({
                podSize,
                rounds: 3,
                pool: lastImportedCube.pool!,
                seed: seedOpt,
                picksPerPass,
                customPool: true,
              });
              navigate(`/draft/${state.sessionId}`);
            } catch {
              /* surfaced via lastError */
            }
          }}
          onStartWinston={async () => {
            try {
              const state = await startWinston({
                poolPacks: winstonPacks,
                pool: lastImportedCube.pool!,
                seed: seedOpt,
                customPool: true,
              });
              navigate(`/winston/${state.sessionId}`);
            } catch {
              /* surfaced via lastError */
            }
          }}
        />
      )}

      {lastError && (
        <p className="rounded-md border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}

      <CollapsibleSection
        icon={<Hourglass className="h-4 w-4" />}
        title={t`Sealed templates`}
        count={sealedTemplates.length}
      >
        <ul className="grid gap-1.5 text-sm md:grid-cols-2">
          {sealedTemplates.map((t) => (
            <li
              key={t.id}
              className="rounded border border-border/40 bg-card/30 px-3 py-2 transition hover:border-border"
            >
              <div className="font-medium">{t.label}</div>
              <div className="text-xs text-muted-foreground">{t.description}</div>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Shuffle className="h-4 w-4" />}
        title={t`Themed Chaos Draft`}
        count={chaosThemes.length}
      >
        <p className="mb-2 text-xs text-muted-foreground">
          <Trans>Pick a theme. We'll merge pools from the most recent draftable sets that match its rotation window and start a normal pod draft against AI seats.</Trans>
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {chaosThemes.map((theme) => {
            const matched = matchSetsForTheme(theme.tag, draftableSets);
            return (
              <li key={theme.tag}>
                <button
                  type="button"
                  disabled={isStarting || fetchingPool || matched.length === 0}
                  onClick={async () => {
                    try {
                      setFetchingPool(true);
                      const merged: DraftCard[] = [];
                      for (const s of matched) {
                        merged.push(...(await fetchSetPool(s.code)));
                      }
                      const state = await startBoosterDraft({
                        podSize,
                        rounds: 3,
                        pool: merged,
                        seed: seedOpt,
                        picksPerPass,
                      });
                      navigate(`/draft/${state.sessionId}`);
                    } catch {
                      /* surfaced via lastError */
                    } finally {
                      setFetchingPool(false);
                    }
                  }}
                  className="group flex w-full items-center justify-between gap-2 rounded border border-border/40 bg-card/30 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-card/60 disabled:cursor-not-allowed disabled:opacity-60"
                  title={
                    matched.length === 0
                      ? t`No matching local sets`
                      : t`${matched.length} sets · ${matched
                          .slice(0, 6)
                          .map((s) => s.code.toUpperCase())
                          .join(", ")}${matched.length > 6 ? "…" : ""}`
                  }
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{theme.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      <Trans>{matched.length} sets · pod {podSize}</Trans>
                    </div>
                  </div>
                  <Shuffle className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                </button>
              </li>
            );
          })}
        </ul>
      </CollapsibleSection>

      <PickAPackDialog
        view={pickView}
        pending={isStarting || fetchingPool}
        onPick={handlePickPack}
        onOpenChange={(open) => {
          if (!open) setPickView(null);
        }}
      />
    </div>
  );
}
interface SelectedSetSummaryProps {
  set: ScryfallSet;
  info: EditionInfo | null;
  loading: boolean;
  selectedVariant: string;
  onVariantChange: (v: string) => void;
  onClear: () => void;
}
function SelectedSetSummary({
  set,
  info,
  loading,
  selectedVariant,
  onVariantChange,
  onClear,
}: SelectedSetSummaryProps) {
  const foilPct = info ? Math.round(info.foilChance * 100) : null;
  const totalSlots = info ? info.slots.reduce((acc, s) => acc + s.count, 0) : null;
  return (
    <section className="rounded-lg border border-primary/40 bg-gradient-to-br from-primary/5 via-card/30 to-card/40 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="shrink-0 rounded-lg border border-primary/40 bg-primary/10 p-2.5">
            <SetSymbol setCode={set.code} className="h-10 w-10 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-lg font-semibold leading-tight">{set.name}</h3>
            <p className="mt-0.5 break-words text-xs text-muted-foreground">
              <span className="font-mono">{set.code.toUpperCase()}</span>
              {info?.alias && (
                <span className="ml-1 font-mono text-muted-foreground/70">/{info.alias}</span>
              )}{" "}
              · {set.set_type} · {set.released_at ?? "—"} · <Trans>{set.card_count} cards</Trans>
              {info?.boosterCovers && info.boosterCovers > 1 && (
                <span className="ml-1"><Trans>· {info.boosterCovers} cover arts</Trans></span>
              )}
            </p>
            {info?.prerelease && (
              <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                <Trans>Prerelease: <span className="text-foreground/80">{info.prerelease}</span></Trans>
              </p>
            )}
          </div>
        </div>

        <Button size="sm" variant="ghost" onClick={onClear} className="h-7 shrink-0 px-2 text-xs">
          <X className="mr-1 h-3 w-3" /> <Trans>Clear</Trans>
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="min-w-0 rounded-md border border-border/50 bg-card/40 p-3 md:col-span-2 lg:col-span-1">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Trans>Booster recipe</Trans>
          </div>
          {loading ? (
            <div className="text-xs text-muted-foreground"><Trans>Loading…</Trans></div>
          ) : info ? (
            <div className="flex flex-wrap items-center gap-1">
              {info.slots.map((slot, i) => (
                <span
                  key={`${slot.label}-${i}`}
                  className="max-w-full break-words rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground/90"
                  title={slot.label}
                >
                  {slot.count}× {slot.label}
                </span>
              ))}
              {totalSlots !== null && (
                <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">
                  <Trans>{totalSlots} cards / pack</Trans>
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-yellow-100">
              <span aria-hidden>⚠</span>
              <span className="min-w-0 break-words">
                <Trans>Local booster information could not be loaded. No substitute recipe will be used.</Trans>
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-md border border-border/50 bg-card/40 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Trans>Foil</Trans>
          </div>
          {info ? (
            foilPct !== null && info.foilType !== "NotSupported" ? (
              <div>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{foilPct}%</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {info.foilType}
                  </span>
                </div>
                <div className="h-1.5 rounded bg-muted/60">
                  <div
                    className="h-full rounded bg-primary/70"
                    style={{ width: `${Math.min(100, foilPct)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground"><Trans>Not supported</Trans></div>
            )
          ) : (
            <div className="text-xs text-muted-foreground">—</div>
          )}
        </div>

        <div className="min-w-0 rounded-md border border-border/50 bg-card/40 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Trans>Booster variant</Trans>
          </div>
          {info && info.variants.length > 0 ? (
            <select
              value={selectedVariant}
              onChange={(e) => onVariantChange(e.target.value)}
              className="w-full rounded border border-border/70 bg-background px-2 py-1 text-xs pointer-coarse:text-base"
            >
              <option value=""><Trans>Default</Trans></option>
              {info.variants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-muted-foreground"><Trans>Single recipe</Trans></div>
          )}
          {info?.hasReplacementHooks && (
            <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-200">
              <Crown className="h-3 w-3 shrink-0" />
              <span className="truncate"><Trans>guaranteed slot active</Trans></span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
interface AdvancedToggleProps {
  open: boolean;
  onToggle: () => void;
  seed: string;
  onSeedChange: (v: string) => void;
  picksPerPass: number;
  onPicksPerPassChange: (n: number) => void;
}
function AdvancedToggle({
  open,
  onToggle,
  seed,
  onSeedChange,
  picksPerPass,
  onPicksPerPassChange,
}: AdvancedToggleProps) {
  return (
    <details
      className="rounded-md border border-border/40 bg-card/20 px-3 py-2 text-xs"
      open={open}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open !== open) onToggle();
      }}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-muted-foreground">
        <Dice5 className="h-3.5 w-3.5" />
        <span><Trans>Advanced</Trans></span>
        {seed.trim() && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            <Trans>seed = {seed.trim()}</Trans>
          </span>
        )}
        {picksPerPass > 1 && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            <Trans>{picksPerPass}× pick</Trans>
          </span>
        )}
      </summary>
      <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2">
            <span><Trans>RNG seed</Trans></span>
            <Input
              type="text"
              inputMode="numeric"
              value={seed}
              onChange={(e) => onSeedChange(e.target.value)}
              placeholder={t`random`}
              className="h-7 w-32 font-mono text-xs"
              title={t`Optional integer for reproducible opens. Leave blank for random.`}
            />
            {seed && (
              <button
                type="button"
                onClick={() => onSeedChange("")}
                className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                <Trans>clear</Trans>
              </button>
            )}
          </label>
          <span className="text-[10px] text-muted-foreground">
            <Trans>Same seed + same pool → identical packs every open.</Trans>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="picksPerPass" className="flex items-center gap-2">
            <span><Trans>Picks per pass</Trans></span>
            <Input
              id="picksPerPass"
              type="number"
              min={1}
              max={4}
              value={picksPerPass}
              onChange={(e) =>
                onPicksPerPassChange(Math.max(1, Math.min(4, Number(e.target.value) || 1)))
              }
              className="h-7 w-16 text-xs"
              title={t`Booster Draft only. 1 = vanilla MTG. 2+ = each seat picks N cards before passing.`}
            />
          </label>
          <span className="text-[10px] text-muted-foreground">
            <Trans>Booster Draft only. With 4-player pods, raise to 2 so each seat ends with ~30 picks.</Trans>
          </span>
        </div>
      </div>
    </details>
  );
}
interface ModeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  disabled: boolean;
  onStart: () => void;
  children?: React.ReactNode;
  footnote?: React.ReactNode;
}
function ModeCard({
  icon,
  title,
  description,
  ctaLabel,
  disabled,
  onStart,
  children,
  footnote,
}: ModeCardProps) {
  return (
    <div
      className={cn(
        "group flex flex-col gap-3 rounded-lg border border-border/60 bg-card/40 p-4 transition",
        disabled
          ? "opacity-90"
          : "hover:border-primary/60 hover:bg-card/70 hover:shadow-[0_0_0_1px_var(--color-primary)]/20",
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "rounded-md border border-border/50 bg-card p-1.5 transition",
            "group-hover:border-primary/40 group-hover:text-primary",
          )}
        >
          {icon}
        </div>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <div className="flex flex-col gap-2">
        {children}
        <Button variant="primary" onClick={onStart} disabled={disabled} className="w-full">
          {ctaLabel}
        </Button>
        {footnote && <p className="truncate text-[10px] text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  );
}
interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}
function NumberField({ id, label, value, min, max, onChange }: NumberFieldProps) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
        className="h-7 w-16 text-xs"
      />
    </label>
  );
}
function ctaLabel(
  fetching: boolean,
  starting: boolean,
  busyLabel: string,
  defaultLabel: string,
): string {
  if (fetching) return t`Fetching set…`;
  if (starting) return busyLabel;
  return defaultLabel;
}
interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}
function CollapsibleSection({ icon, title, count, children }: CollapsibleSectionProps) {
  if (count === 0) return null;
  return (
    <details className="rounded-md border border-border/40 bg-card/20 px-3 py-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground/90">
        {icon}
        <span className="font-semibold uppercase tracking-wide text-xs">{title}</span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px]">{count}</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
function matchSetsForTheme(tag: string, sets: ScryfallSet[]): ScryfallSet[] {
  // Local pools report `set_type: "local"`; treat them as expansion-like so the
  // themed windows still select from downloaded sets.
  const isExpansionLike = (s: ScryfallSet) =>
    s.set_type === "expansion" || s.set_type === "local" || s.set_type === "core";
  const sorted = [...sets].sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""));
  switch (tag.toUpperCase()) {
    case "STANDARD": {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 3);
      const stamp = cutoff.toISOString().slice(0, 10);
      return sorted
        .filter((s) => isExpansionLike(s) && (s.released_at ?? "") >= stamp)
        .slice(0, 8);
    }
    case "PIONEER": {
      const cutoff = "2012-10-05"; // Return to Ravnica era.
      return sorted
        .filter((s) => isExpansionLike(s) && (s.released_at ?? "") >= cutoff)
        .slice(0, 8);
    }
    case "MODERN": {
      const cutoff = "2003-07-28"; // Eighth Edition era.
      return sorted
        .filter((s) => isExpansionLike(s) && (s.released_at ?? "") >= cutoff)
        .slice(0, 8);
    }
    case "DEFAULT":
    default:
      return sorted.slice(0, 6);
  }
}
interface CubeStartActionsProps {
  cube: {
    name: string;
    cardCount: number;
    playableCardCount: number;
    rejectedCardCount: number;
    numPacks: number;
    singleton: boolean;
  };
  numBoosters: number;
  podSize: number;
  winstonPacks: number;
  seed: number | undefined;
  isStarting: boolean;
  onStartSealed: () => void | Promise<void>;
  onStartDraft: () => void | Promise<void>;
  onStartWinston: () => void | Promise<void>;
}
function CubeStartActions({
  cube,
  numBoosters,
  podSize,
  winstonPacks,
  seed,
  isStarting,
  onStartSealed,
  onStartDraft,
  onStartWinston,
}: CubeStartActionsProps) {
  return (
    <section className="rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="h-4 w-4 text-primary" />
            <Trans>Start from imported cube</Trans>
          </h3>
          <p className="text-xs text-muted-foreground">
            <Trans><span className="font-medium text-foreground/90">{cube.name}</span> · {cube.cardCount} cards · {cube.numPacks} packs/player</Trans>{" "}
            {cube.singleton && <span className="text-muted-foreground"><Trans>· singleton</Trans></span>}
            {cube.rejectedCardCount > 0 && (
              <span className="ml-2 text-muted-foreground">
                <Trans>{cube.playableCardCount} locally recognized · {cube.rejectedCardCount} name-only</Trans>
              </span>
            )}
            {seed !== undefined && (
              <span className="ml-2 font-mono text-[10px] text-primary"><Trans>seed {seed}</Trans></span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={isStarting} onClick={onStartSealed}>
            <Boxes className="mr-1.5 h-4 w-4" />
            <Trans>Sealed ({numBoosters} packs)</Trans>
          </Button>
          <Button size="sm" variant="outline" disabled={isStarting} onClick={onStartDraft}>
            <Swords className="mr-1.5 h-4 w-4" />
            <Trans>Draft (pod {podSize})</Trans>
          </Button>
          <Button size="sm" variant="outline" disabled={isStarting} onClick={onStartWinston}>
            <Layers className="mr-1.5 h-4 w-4" />
            <Trans>Winston ({winstonPacks} packs)</Trans>
          </Button>
        </div>
      </div>
    </section>
  );
}
