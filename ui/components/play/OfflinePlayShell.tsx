import { msg, t } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import type { ReactNode } from "react";
import { Boxes, Shuffle, Swords } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
interface OfflinePlayShellProps {
  children: ReactNode;
}
const TABS = [
  {
    to: ROUTES.PLAY_OFFLINE_CONSTRUCTED,
    label: msg`Constructed`,
    hint: msg`Deck vs AI`,
    icon: Swords,
  },
  {
    to: ROUTES.PLAY_OFFLINE_LIMITED,
    label: msg`Limited`,
    hint: msg`Draft & sealed`,
    icon: Boxes,
  },
  {
    to: ROUTES.PLAY_OFFLINE_CASUAL,
    label: msg`Casual`,
    hint: msg`Special modes`,
    icon: Shuffle,
  },
];
export function OfflinePlayShell({ children }: OfflinePlayShellProps) {
  const location = useLocation();
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <nav aria-label={t`Offline play type`} className="shrink-0 px-4 pt-4 sm:px-6 lg:px-8">
          <div className="mx-auto grid w-full max-w-2xl grid-cols-3 rounded-2xl border border-border/70 bg-background/80 p-1.5 shadow-xl backdrop-blur-md">
            {TABS.map(({ to, label, hint, icon: Icon }) => {
              const active = location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  replace
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 transition-[background-color,color,box-shadow] motion-reduce:transition-none sm:px-4",
                    active
                      ? "bg-selection/15 text-selection shadow-sm ring-1 ring-selection/30"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors motion-reduce:transition-none",
                      active
                        ? "border-selection/30 bg-selection/15"
                        : "border-border/60 bg-muted/40 group-hover:border-border",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-semibold">{i18n._(label)}</span>
                    <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                      {i18n._(hint)}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
