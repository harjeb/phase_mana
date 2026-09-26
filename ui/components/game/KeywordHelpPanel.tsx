import { DynamicTextRender } from "./DynamicTextRender";
import { Trans } from "@lingui/react/macro";
import type { getKeywordHelp } from "@/i18n/keywordHelp";

/** Automatically visible alongside the printed preview, not another hover target. */
export function KeywordHelpPanel({
  entries,
  maxHeight,
}: {
  entries: ReturnType<typeof getKeywordHelp>;
  maxHeight: number;
}) {
  if (!entries.length) return null;
  return (
    <dl
      data-keyword-help
      className="m-0 min-h-0 overflow-y-auto overscroll-contain always-scrollbar rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      style={{ maxHeight }}
      onWheel={(event) => event.stopPropagation()}
    >
      {entries.map((entry) => (
        <div key={entry.key} className="text-[13px] leading-relaxed break-words">
          <dt className="mb-2 w-fit max-w-full rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-sm font-bold tracking-wide text-primary">
            <DynamicTextRender text={entry.name} />
          </dt>
          <dd className="m-0 whitespace-pre-line text-popover-foreground/85">
            {entry.example && (
              <span className="mb-1 block text-xs text-muted-foreground">
                <Trans>Printed example: {entry.example}</Trans>
              </span>
            )}
            <DynamicTextRender text={entry.description} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
