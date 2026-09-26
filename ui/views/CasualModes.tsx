import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Boxes, Crown, Dice5, Hourglass, Layers, Shuffle, Sparkles, Swords, Wand2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";

interface CasualCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
}

function CasualCard({ icon, title, description, cta, onClick, disabled }: CasualCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-muted/40">
          {icon}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="flex-1 text-xs leading-snug text-muted-foreground">{description}</p>
      <Button size="sm" variant="primary" className="h-8 text-xs" onClick={onClick} disabled={disabled}>
        {cta}
      </Button>
    </div>
  );
}

export default function CasualModes() {
  const navigate = useNavigate();
  // Constructed casual formats reuse the deck-vs-AI setup, preselected here.
  const openConstructed = (formatId: string) =>
    navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, { state: { preSelectedFormatId: formatId } });
  // Limited casual variants live on the Limited page, which owns the set picker.
  const openLimited = () => navigate(ROUTES.PLAY_OFFLINE_LIMITED);
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <header className="max-w-2xl">
        <h1 className="font-serif text-2xl font-light tracking-[0.02em]"><Trans>Casual Modes</Trans></h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <Trans>Local play against the AI. Draft variants, Commander offshoots and retro rulesets that don't fit the standard formats.</Trans>
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Draft variants</Trans>
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <CasualCard
            icon={<Crown className="h-4 w-4" />}
            title={t`Commander Draft`}
            description={t`Four-seat, two-card picks (CR 903.13), then a four-player Commander game.`}
            cta={t`Open Commander Draft`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Layers className="h-4 w-4" />}
            title={t`Winston Draft`}
            description={t`Two-seat shared-stack pile draft: take a pile or decline it.`}
            cta={t`Open Winston Draft`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Wand2 className="h-4 w-4" />}
            title={t`Cube / local pool`}
            description={t`Paste a CubeCobra id or load a saved pool, then draft or seal it.`}
            cta={t`Open cube import`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Boxes className="h-4 w-4" />}
            title={t`Pack Wars (Mini-Master)`}
            description={t`Open one booster, add 15 basic lands and play the whole pack.`}
            cta={t`Open Pack Wars`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Layers className="h-4 w-4" />}
            title={t`Duplicate Sealed (Mirror)`}
            description={t`Everyone opens the same five packs and builds from identical pools.`}
            cta={t`Open Mirror Sealed`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Shuffle className="h-4 w-4" />}
            title={t`Back Draft`}
            description={t`Draft normally, then swap pools with the seat across from you.`}
            cta={t`Open Back Draft`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Wand2 className="h-4 w-4" />}
            title={t`Reject Rare`}
            description={t`Boosters of nothing but rares — or the silver/iron sub-variant.`}
            cta={t`Open Reject Rare`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Crown className="h-4 w-4" />}
            title={t`Solomon Draft`}
            description={t`Split 8-card batches into two piles; your opponent chooses one.`}
            cta={t`Open Solomon Draft`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Hourglass className="h-4 w-4" />}
            title={t`Rotisserie Draft`}
            description={t`One shared pool, snake order, one card at a time.`}
            cta={t`Open Rotisserie`}
            onClick={openLimited}
          />
          <CasualCard
            icon={<Dice5 className="h-4 w-4" />}
            title={t`Continuous Draft`}
            description={t`Reveal four, take 1-2-1; the first chooser alternates each batch.`}
            cta={t`Open Continuous Draft`}
            onClick={openLimited}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Constructed formats</Trans>
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <CasualCard
            icon={<Sparkles className="h-4 w-4" />}
            title={t`Oathbreaker`}
            description={t`60-card singleton, 20 life, a planeswalker plus its signature spell.`}
            cta={t`Build / play Oathbreaker`}
            onClick={() => openConstructed("oathbreaker")}
          />
          <CasualCard
            icon={<Swords className="h-4 w-4" />}
            title={t`Tiny Leaders`}
            description={t`50-card singleton, 20 life, a legendary commander with mana value 3 or less.`}
            cta={t`Build / play Tiny Leaders`}
            onClick={() => openConstructed("tiny_leaders")}
          />
          <CasualCard
            icon={<Swords className="h-4 w-4" />}
            title={t`Duel Commander`}
            description={t`100-card singleton, 30 life, tuned for 1v1.`}
            cta={t`Build / play Duel Commander`}
            onClick={() => openConstructed("duel_commander")}
          />
          <CasualCard
            icon={<Swords className="h-4 w-4" />}
            title={t`Pauper Commander`}
            description={t`100-card singleton, 40 life, an uncommon creature commander, commons only.`}
            cta={t`Build / play Pauper Commander`}
            onClick={() => openConstructed("pauper_commander")}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Special tables</Trans>
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <CasualCard
            icon={<Crown className="h-4 w-4" />}
            title={t`Four-player Commander`}
            description={t`One human plus three AI at 40 life each; add opponents in the setup screen.`}
            cta={t`Set up four-player table`}
            onClick={() => openConstructed("commander")}
          />
          <CasualCard
            icon={<Sparkles className="h-4 w-4" />}
            title={t`Archenemy`}
            description={t`You at 40 life against the heroes at 20, with the engine-managed scheme deck.`}
            cta={t`Set up Archenemy`}
            onClick={() => openConstructed("archenemy")}
          />
          <CasualCard
            icon={<Dice5 className="h-4 w-4" />}
            title={t`Planechase`}
            description={t`A shared planar deck and the planar die; roll it from the active plane card.`}
            cta={t`Set up Planechase`}
            onClick={() => openConstructed("planechase")}
          />
          <CasualCard
            icon={<Swords className="h-4 w-4" />}
            title={t`Two-Headed Giant`}
            description={t`Two teams of two share a 30-life total and take their turns together.`}
            cta={t`Set up Two-Headed Giant`}
            onClick={() => openConstructed("two_headed_giant")}
          />
        </div>
      </section>
    </div>
  );
}
