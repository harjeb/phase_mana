import { msg, t } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import { Trans } from "@lingui/react/macro";
import {
  Github,
  Globe,
  HeartPulse,
  Info,
  LineChart,
  PackageOpen,
  Palette,
  Search,
  Settings,
} from "lucide-react";
import { Link } from "react-router-dom";
import { DiscordIcon } from "@/components/icons/DiscordIcon";
import { FeatureTile } from "@/components/play/FeatureTile";
import { Button } from "@/components/ui/button";
import { DESIGN_SYSTEM_ENABLED } from "@/config/designSystem";
import { isFeatureEnabled } from "@/featureFlags";
import {
  APP_VERSION,
  DISCORD_INVITE_URL,
  GITHUB_REPO_URL,
  ROUTES,
  WEBSITE_URL,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/useAuthStore";
const TOOL_GRID_BY_COUNT: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};
const UTILITY_ROW_CLASS =
  "flex min-w-0 items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 motion-safe:transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const TOOLS = [
  {
    to: ROUTES.SEARCH,
    label: msg`Card Search`,
    desc: msg`Every card, printing, and ruling at your fingertips.`,
    icon: Search,
    tone: "blue",
  },
  {
    to: ROUTES.MATCH_HISTORY,
    label: msg`Match History`,
    desc: msg`Win rates and results from your finished games.`,
    icon: LineChart,
    tone: "amber",
  },
  {
    to: ROUTES.COMPANION,
    label: msg`Life Tracker`,
    desc: msg`Life, poison, and commander damage for paper nights.`,
    icon: HeartPulse,
    tone: "rose",
  },
];
export function PlayHomeLinks() {
  const signedIn = useAuthStore((state) => state.status === "signedIn");
  const tools =
    signedIn && isFeatureEnabled("accounts")
      ? [
          {
            to: ROUTES.MY_COLLECTION,
            label: msg`My Collection`,
            desc: msg`Track the cards you own and import or export your collection.`,
            icon: PackageOpen,
            tone: "amber",
          },
          ...TOOLS,
        ]
      : TOOLS;
  return (
    <>
      <section aria-label={t`More ways to play and tools`}>
        <div className={cn("grid gap-4", TOOL_GRID_BY_COUNT[tools.length] ?? "sm:grid-cols-3")}>
          {tools.map(({ to, label, desc, icon, tone }, index) => (
            <FeatureTile
              key={to}
              to={to}
              label={i18n._(label)}
              desc={i18n._(desc)}
              icon={icon}
              tone={tone}
              className={cn(
                tools.length % 2 === 1 && index === tools.length - 1 && "max-sm:col-span-2",
              )}
            />
          ))}
        </div>
      </section>

      <section
        aria-label={t`Utilities`}
        className="overflow-hidden rounded-xl border border-border/60 bg-background/60 backdrop-blur-md"
      >
        <ul className="divide-y divide-border/50 pb-1">
          <li>
            <Link to={ROUTES.SETTINGS} className={UTILITY_ROW_CLASS}>
              <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Trans>Preferences</Trans>
            </Link>
          </li>
          <li>
            <Link to={ROUTES.ABOUT} className={UTILITY_ROW_CLASS}>
              <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Trans>About Manabrew</Trans>
            </Link>
          </li>
          {DESIGN_SYSTEM_ENABLED && (
            <li>
              <Link to={ROUTES.DESIGN_SYSTEM} className={UTILITY_ROW_CLASS}>
                <Palette className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Trans>Design System</Trans>
              </Link>
            </li>
          )}
        </ul>
      </section>

      <footer className="flex flex-col gap-3 border-t border-border/50 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground"><Trans>Manabrew v{APP_VERSION}</Trans></span>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="icon-sm" title={t`Discord`}>
              <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
                <DiscordIcon className="h-4 w-4" />
                <span className="sr-only"><Trans>Discord</Trans></span>
              </a>
            </Button>
            <Button asChild variant="ghost" size="icon-sm" title={t`GitHub`}>
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                <Github className="h-4 w-4" />
                <span className="sr-only"><Trans>GitHub</Trans></span>
              </a>
            </Button>
            <Button asChild variant="ghost" size="icon-sm" title={t`Website`}>
              <a href={WEBSITE_URL} target="_blank" rel="noreferrer">
                <Globe className="h-4 w-4" />
                <span className="sr-only"><Trans>Website</Trans></span>
              </a>
            </Button>
          </div>
        </div>
      </footer>
    </>
  );
}
