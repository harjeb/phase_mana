import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { TrendChart, type TrendPointView } from "@/components/stats/TrendChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cardRecords,
  clearMatches,
  dailySeries,
  deckRecords,
  filterMatches,
  formatRecords,
  loadMatches,
  localSeat,
  matchResult,
  opponentRecords,
  summarize,
  type MatchResult,
  type RecordRow,
} from "@/lib/matchHistory";
import type { OfflinePlayGame } from "@/lib/offlinePlayRecord";
import { cn } from "@/lib/utils";

const CARD_ROW_LIMIT = 40;
function ranges() { return [
  { value: 7, label: t`Last 7 days` },
  { value: 30, label: t`Last 30 days` },
  { value: 90, label: t`Last 90 days` },
  { value: 0, label: t`All time` },
] as const; }
function results(): { value: MatchResult | "all"; label: string }[] { return [
  { value: "all", label: t`All results` },
  { value: "win", label: t`Wins` },
  { value: "loss", label: t`Losses` },
  { value: "draw", label: t`Draws` },
  { value: "unfinished", label: t`Unfinished` },
]; }

function formatLabel(value: string): string {
  const labels: Record<string, string> = {
    standard: t`Standard`, pioneer: t`Pioneer`, modern: t`Modern`, legacy: t`Legacy`,
    vintage: t`Vintage`, pauper: t`Pauper`, premodern: t`Premodern`, commander: t`Commander`,
    oathbreaker: t`Oathbreaker`, tiny_leaders: t`Tiny Leaders`, duel_commander: t`Duel Commander`,
    pauper_commander: t`Pauper Commander`, archenemy: t`Archenemy`, planechase: t`Planechase`,
    two_headed_giant: t`Two-Headed Giant`, draft: t`Draft`, sealed: t`Sealed`,
    brawl: t`Brawl`, historicBrawl: t`Brawl`, Unknown: t`Unknown`,
  };
  return labels[value] ?? value;
}

function deckLabel(value: string): string {
  if (value === "Unknown deck") return t`Unknown deck`;
  if (value.endsWith(" (commander)")) {
    const commander = value.slice(0, -12);
    return t`${commander} (commander)`;
  }
  return value;
}
const RESULT_TONE: Record<MatchResult, string> = {
  win: "border-transparent bg-primary text-primary-foreground",
  loss: "border-transparent bg-destructive text-destructive-foreground",
  draw: "border-transparent bg-secondary text-secondary-foreground",
  unfinished: "text-muted-foreground",
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? t`${minutes}m ${rest}s` : t`${rest}s`;
}

function resultLabel(result: MatchResult): string {
  if (result === "win") return t`Win`;
  if (result === "loss") return t`Loss`;
  if (result === "draw") return t`Draw`;
  return t`Unfinished`;
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatTable({
  title,
  rows,
  nameHeader,
  empty,
  nameLabel = (value: string) => value,
}: {
  title: string;
  rows: RecordRow[];
  nameHeader: string;
  empty: string;
  nameLabel?: (value: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-2 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{nameHeader}</TableHead>
                <TableHead className="text-right"><Trans>Games</Trans></TableHead>
                <TableHead className="text-right"><Trans>Wins</Trans></TableHead>
                <TableHead className="text-right"><Trans>Losses</Trans></TableHead>
                <TableHead className="text-right"><Trans>Win rate</Trans></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="max-w-[18rem] truncate capitalize">{nameLabel(row.key)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.games}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.wins}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.losses}</TableCell>
                  <TableCell className="text-right tabular-nums">{percent(row.winRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function MatchHistory() {
  const { i18n } = useLingui();
  const [matches, setMatches] = useState<OfflinePlayGame[]>(() => loadMatches());
  const [confirmClear, setConfirmClear] = useState(false);
  const [days, setDays] = useState(30);
  const [format, setFormat] = useState("");
  const [deck, setDeck] = useState("");
  const [result, setResult] = useState<MatchResult | "all">("all");
  const [search, setSearch] = useState("");

  const formatOptions = useMemo(
    () => [...new Set(matches.map((match) => match.format ?? "Unknown"))].sort(),
    [matches],
  );
  const deckOptions = useMemo(
    () => [...new Set(matches.map((match) => localSeat(match)?.deckName ?? "Unknown deck"))].sort(),
    [matches],
  );

  const filtered = useMemo(
    () => filterMatches(matches, { days, format, deck, result, search }),
    [matches, days, format, deck, result, search],
  );
  const summary = useMemo(() => summarize(filtered), [filtered]);
  const decks = useMemo(() => deckRecords(filtered), [filtered]);
  const cards = useMemo(() => cardRecords(filtered), [filtered]);
  const formats = useMemo(() => formatRecords(filtered), [filtered]);
  const opponents = useMemo(() => opponentRecords(filtered), [filtered]);
  const series = useMemo(() => dailySeries(filtered, days), [filtered, days]);

  const decided = summary.wins + summary.losses;
  const gamesPoints: TrendPointView[] = series.map((point) => ({
    label: i18n.date(point.dayMs),
    value: point.games,
    detail: `${i18n.date(point.dayMs)}: ${point.wins}–${point.losses}`,
  }));
  const winRatePoints: TrendPointView[] = series.map((point) => {
    const date = i18n.date(point.dayMs);
    const rate = percent(point.cumulativeWinRate);
    return {
      label: date,
      value: point.cumulativeWinRate,
      detail: t`${date}: ${rate} cumulative`,
    };
  });

  function clear() {
    clearMatches();
    setMatches([]);
    setConfirmClear(false);
  }

  return (
    <div className="space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold"><Trans>Match History</Trans></h1>
          <p className="text-sm text-muted-foreground">
            <Trans>Win rates, trends, and results from games played on this device.</Trans>
          </p>
        </div>
        {matches.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <>
                <span className="text-sm text-muted-foreground"><Trans>Delete all history?</Trans></span>
                <Button variant="destructive" size="sm" onClick={clear}>
                  <Trans>Delete</Trans>
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>
                  <Trans>Cancel</Trans>
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)}>
                <Trash2 className="h-4 w-4" />
                <Trans>Clear history</Trans>
              </Button>
            )}
          </div>
        )}
      </header>

      {matches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <Trans>No games recorded yet. Finish a game to start building stats.</Trans>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="flex flex-wrap items-end gap-3" aria-label={t`Filters`}>
            <FilterSelect
              label={t`Range`}
              value={String(days)}
              onChange={(value) => setDays(Number(value))}
              options={ranges().map((range) => ({ value: String(range.value), label: range.label }))}
            />
            <FilterSelect
              label={t`Format`}
              value={format}
              onChange={setFormat}
              options={[{ value: "", label: t`All formats` }, ...formatOptions.map((value) => ({ value, label: formatLabel(value) }))]}
            />
            <FilterSelect
              label={t`Deck`}
              value={deck}
              onChange={setDeck}
              options={[{ value: "", label: t`All decks` }, ...deckOptions.map((value) => ({ value, label: deckLabel(value) }))]}
            />
            <FilterSelect
              label={t`Result`}
              value={result}
              onChange={(value) => setResult(value as MatchResult | "all")}
              options={results()}
            />
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              <Trans>Search</Trans>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t`Deck, opponent, or card`}
                className="h-9"
              />
            </label>
          </section>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { key: "games", label: t`Games`, value: String(summary.games) },
              { key: "wins", label: t`Wins`, value: String(summary.wins) },
              { key: "losses", label: t`Losses`, value: String(summary.losses) },
              { key: "winrate", label: t`Win rate`, value: decided > 0 ? percent(summary.winRate) : "—" },
              {
                key: "duration",
                label: t`Avg game`,
                value: decided > 0 ? duration(summary.totalSeconds / decided) : "—",
              },
            ].map((stat) => (
              <Card key={stat.key}>
                <CardContent className="py-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TrendChart
              title={t`Games per day`}
              points={gamesPoints}
              variant="bar"
              formatValue={(value) => String(Math.round(value))}
            />
            <TrendChart
              title={t`Win rate over time`}
              points={winRatePoints}
              variant="line"
              max={1}
              formatValue={percent}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <StatTable title={t`Decks`} nameHeader={t`Deck`} rows={decks} nameLabel={deckLabel} empty={t`No decided games in this range.`} />
            <StatTable title={t`Formats`} nameHeader={t`Format`} rows={formats} nameLabel={formatLabel} empty={t`No decided games in this range.`} />
            <StatTable
              title={t`Opponents`}
              nameHeader={t`Opponent deck`}
              rows={opponents}
              empty={t`No decided games in this range.`}
            />
            <StatTable
              title={t`Cards`}
              nameHeader={t`Card`}
              rows={cards.slice(0, CARD_ROW_LIMIT)}
              empty={t`No decided games in this range.`}
            />
          </div>
          {cards.length > CARD_ROW_LIMIT && (
            <p className="-mt-3 text-xs text-muted-foreground">
              <Trans>
                Showing the {CARD_ROW_LIMIT} most-played cards. Win rate counts a card whenever it
                was in your deck in a decided game.
              </Trans>
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium"><Trans>Matches</Trans></CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><Trans>When</Trans></TableHead>
                    <TableHead><Trans>Deck</Trans></TableHead>
                    <TableHead><Trans>Opponents</Trans></TableHead>
                    <TableHead><Trans>Format</Trans></TableHead>
                    <TableHead className="text-right"><Trans>Duration</Trans></TableHead>
                    <TableHead className="text-right"><Trans>Result</Trans></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        <Trans>No games match these filters.</Trans>
                      </TableCell>
                    </TableRow>
                  )}
                  {[...filtered].reverse().map((match) => {
                    const outcome = matchResult(match);
                    const seat = localSeat(match);
                    const opponents = match.players
                      .filter((player) => player !== seat)
                      .map((player) => player.deckName || player.username)
                      .join(", ");
                    return (
                      <TableRow key={match.reportId}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {i18n.date(new Date(match.startedAt))}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">
                          {seat?.deckName || t`Unknown deck`}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate">{opponents || "—"}</TableCell>
                        <TableCell className="capitalize">{match.format ? formatLabel(match.format) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{duration(match.durationS)}</TableCell>
                        <TableCell className="text-right">
                          <Badge className={cn("whitespace-nowrap", RESULT_TONE[outcome])}>
                            {resultLabel(outcome)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
