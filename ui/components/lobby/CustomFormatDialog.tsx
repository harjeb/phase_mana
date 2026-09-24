import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  deleteCustomFormat,
  describeCustomFormat,
  exportCustomFormat,
  fetchCustomFormatBase,
  importCustomFormat,
  listCustomFormats,
  newCustomFormatKey,
  upsertCustomFormat,
  requireValidCustomFormat,
  type CustomFormatRules,
  type SavedCustomFormat,
  type SideboardPolicy,
} from "@/lib/customFormats";

interface CustomFormatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start a game with the chosen format. Called after the dialog closes. */
  onPlay: (format: SavedCustomFormat) => void;
}

function emptyDraft(base: { label: string; shortLabel: string; rules: CustomFormatRules }): SavedCustomFormat {
  return {
    key: "",
    label: base.label,
    shortLabel: base.shortLabel,
    description: "",
    rules: base.rules,
    updatedAt: 0,
  };
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Local custom-format manager and editor (P5).
 *
 * Saving is local-first but never bypasses the host: `validateCustomFormat`
 * asks the server to rebuild the `FormatConfig` through the same
 * `for_custom_rules` + capability gate the game start applies, so an editor
 * draft cannot become a saved format that the engine would then reject.
 */
export function CustomFormatDialog({ open, onOpenChange, onPlay }: CustomFormatDialogProps) {
  const [formats, setFormats] = useState<SavedCustomFormat[]>([]);
  const [base, setBase] = useState<{ label: string; shortLabel: string; rules: CustomFormatRules } | null>(null);
  const [draft, setDraft] = useState<SavedCustomFormat | null>(null);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormats(listCustomFormats());
    setDraft(null);
    setShowImport(false);
    setImportText("");
    if (base) return;
    fetchCustomFormatBase()
      .then(setBase)
      .catch((error: unknown) =>
        setBaseError(error instanceof Error ? error.message : String(error)),
      );
  }, [open, base]);

  const startNew = useCallback(() => {
    if (!base) return;
    setDraft(emptyDraft(base));
  }, [base]);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const label = draft.label.trim();
    if (!label) {
      toast.error(t`Give the format a name.`);
      return;
    }
    const toSave: SavedCustomFormat = {
      ...draft,
      key: draft.key || newCustomFormatKey(label, formats),
      label,
    };
    try {
      setFormats(await upsertCustomFormat(toSave));
      setDraft(null);
      toast.success(t`Saved "${label}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the format.");
    }
  }, [draft, formats]);

  const duplicate = useCallback(
    (format: SavedCustomFormat) => {
      setDraft({
        ...format,
        key: newCustomFormatKey(`${format.label} copy`, formats),
        label: `${format.label} copy`,
      });
    },
    [formats],
  );

  const runImport = useCallback(async () => {
    try {
      const imported = importCustomFormat(importText, formats);
      setFormats(await upsertCustomFormat(imported));
      setImportText("");
      setShowImport(false);
      toast.success(t`Imported "${imported.label}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse that JSON.");
    }
  }, [importText, formats]);

  const sorted = useMemo(() => formats, [formats]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle><Trans>Custom formats</Trans></DialogTitle>
          <DialogDescription>
            Build a ruleset from the engine&apos;s structural and legacy axes. Saved formats are
            checked by the host before they can be played.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <CustomFormatEditor
            draft={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => void saveDraft()}
          />
        ) : (
          <div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto">
            {baseError ? (
              <p className="text-sm text-destructive">
                Could not load the editor base from the host: {baseError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={startNew} disabled={!base}>
                New format
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowImport((s) => !s)}>
                Import JSON
              </Button>
            </div>

            {showImport ? (
              <div className="flex flex-col gap-2 rounded-md border border-border/70 p-3">
                <textarea
                  aria-label={t`Paste an exported custom format`}
                  className="min-h-24 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  placeholder='{"label":"…","rules":{…}}'
                />
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={runImport} disabled={!importText.trim()}>
                    Import
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowImport(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {sorted.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No saved custom formats yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sorted.map((format) => (
                  <li
                    key={format.key}
                    className="flex flex-col gap-2 rounded-md border border-border/70 bg-card/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{format.label}</p>
                      <p className="text-xs text-muted-foreground">{describeCustomFormat(format)}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={async () => {
                          try {
                            await requireValidCustomFormat(format.rules);
                            onOpenChange(false);
                            onPlay(format);
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "Could not validate the format.");
                          }
                        }}
                      >
                        Play
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => setDraft({ ...format })}>
                        Edit
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => duplicate(format)}>
                        Duplicate
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText(exportCustomFormat(format))
                            .then(() => toast.success(t`Copied JSON to clipboard.`))
                            .catch(() => toast.error(t`Could not copy to the clipboard.`));
                        }}
                      >
                        Export
                      </Button>
                      <Button
                        variant="destructive-quiet"
                        size="xs"
                        onClick={() => {
                          try {
                            setFormats(deleteCustomFormat(format.key));
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "Could not delete the format.");
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface CustomFormatEditorProps {
  draft: SavedCustomFormat;
  onChange: (draft: SavedCustomFormat) => void;
  onCancel: () => void;
  onSave: () => void;
}

function CustomFormatEditor({ draft, onChange, onCancel, onSave }: CustomFormatEditorProps) {
  const { structural, legality } = draft.rules;
  const patch = (rules: CustomFormatRules) => onChange({ ...draft, rules });
  const setStructural = (next: Partial<typeof structural>) =>
    patch({ ...draft.rules, structural: { ...structural, ...next } });
  const setLegality = (next: Partial<typeof legality>) =>
    patch({ ...draft.rules, legality: { ...legality, ...next } });
  const setLegacy = (next: Partial<typeof legality.legacy>) =>
    setLegality({ legacy: { ...legality.legacy, ...next } });

  const deckMode = structural.deck_size.type;
  const deckValue = structural.deck_size.data;
  const copiesMode = structural.default_deck_copy_limit.type;
  const copiesValue =
    structural.default_deck_copy_limit.type === "Unlimited"
      ? 4
      : structural.default_deck_copy_limit.data;
  const sideboardMode = structural.sideboard_policy.type;
  const sideboardValue =
    structural.sideboard_policy.type === "Limited" ? structural.sideboard_policy.data : 15;

  return (
    <div className="flex max-h-[65dvh] flex-col gap-4 overflow-y-auto">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t`Name`}>
          <Input
            value={draft.label}
            onChange={(event) => onChange({ ...draft, label: event.target.value })}
          />
        </Field>
        <Field label={t`Short label`}>
          <Input
            value={draft.shortLabel}
            maxLength={8}
            onChange={(event) => onChange({ ...draft, shortLabel: event.target.value })}
          />
        </Field>
      </div>

      <Field label={t`Description`}>
        <Input
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
      </Field>

      <section className="flex flex-col gap-3 rounded-md border border-border/70 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Structure
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t`Minimum players`}>
            <NumberInput value={structural.min_players} min={2}
              onValue={(min_players) => setStructural({ min_players })} />
          </Field>
          <Field label={t`Maximum players`}>
            <NumberInput value={structural.max_players} min={2}
              onValue={(max_players) => setStructural({ max_players })} />
          </Field>
          <Field label={t`Starting life`}>
            <NumberInput
              value={structural.starting_life}
              min={1}
              onValue={(starting_life) => setStructural({ starting_life })}
            />
          </Field>
          <Field label={t`Deck size`}>
            <div className="flex gap-1.5">
              <select
                aria-label={t`Deck size rule`}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={deckMode}
                onChange={(event) =>
                  setStructural({
                    deck_size:
                      event.target.value === "Exactly"
                        ? { type: "Exactly", data: deckValue }
                        : { type: "Minimum", data: deckValue },
                  })
                }
              >
                <option value="Minimum"><Trans>At least</Trans></option>
                <option value="Exactly"><Trans>Exactly</Trans></option>
              </select>
              <NumberInput
                value={deckValue}
                min={1}
                onValue={(value) =>
                  setStructural({ deck_size: { type: deckMode, data: value } })
                }
              />
            </div>
          </Field>
          <Field label={t`Copies`}>
            <div className="flex gap-1.5">
              <select
                aria-label={t`Copy limit rule`}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={copiesMode}
                onChange={(event) =>
                  setStructural({
                    default_deck_copy_limit:
                      event.target.value === "Unlimited" ? { type: "Unlimited" } : { type: "UpTo", data: copiesValue },
                  })
                }
              >
                <option value="UpTo"><Trans>At most</Trans></option>
                <option value="Unlimited"><Trans>Unlimited</Trans></option>
              </select>
              <NumberInput
                value={copiesValue}
                min={1}
                disabled={copiesMode === "Unlimited"}
                onValue={(value) => setStructural({ default_deck_copy_limit: { type: "UpTo", data: value } })}
              />
            </div>
          </Field>
          <Field label={t`Sideboard`}>
            <div className="flex gap-1.5">
              <select
                aria-label={t`Sideboard policy`}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={sideboardMode}
                onChange={(event) => {
                  const mode = event.target.value as "Forbidden" | "Limited" | "Unlimited";
                  const policy: SideboardPolicy =
                    mode === "Limited" ? { type: "Limited", data: sideboardValue } : { type: mode };
                  setStructural({ sideboard_policy: policy });
                }}
              >
                <option value="Forbidden"><Trans>None</Trans></option>
                <option value="Limited"><Trans>Limited</Trans></option>
                <option value="Unlimited"><Trans>Unlimited</Trans></option>
              </select>
              <NumberInput
                value={sideboardValue}
                min={0}
                disabled={sideboardMode !== "Limited"}
                onValue={(value) => setStructural({ sideboard_policy: { type: "Limited", data: value } })}
              />
            </div>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={structural.singleton}
            onCheckedChange={(checked) => setStructural({ singleton: checked === true })}
          />
          Singleton (max one copy of each card)
        </label>
        <Field label={t`Legal sets (comma separated; empty = all sets)`}>
          <Input
            defaultValue={(legality.legal_sets ?? []).join(", ")}
            placeholder={t`LEA, LEB, ARN, …`}
            onBlur={(event) => {
              const list = splitList(event.target.value);
              setLegality({ legal_sets: list.length ? list : null });
            }}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border/70 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Legacy axes
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t`Mana burn`}>
            <select
              aria-label={t`Mana burn policy`}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={legality.legacy.mana_burn}
              onChange={(event) => setLegacy({ mana_burn: event.target.value as "Modern" | "Obsolete" })}
            >
              <option value="Modern"><Trans>Removed</Trans></option>
              <option value="Obsolete"><Trans>Mana burn</Trans></option>
            </select>
          </Field>
          <Field label={t`Wishes`}>
            <select
              aria-label={t`Wish scope`}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={legality.legacy.wish_scope}
              onChange={(event) =>
                setLegacy({
                  wish_scope: event.target.value as "PostM10SideboardOnly" | "PreM10ReachesExile",
                })
              }
            >
              <option value="PostM10SideboardOnly"><Trans>Sideboard only</Trans></option>
              <option value="PreM10ReachesExile"><Trans>Reach exile</Trans></option>
            </select>
          </Field>
          <Field label={t`Legend rule`}>
            <select
              aria-label={t`Legend rule scope`}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={legality.legacy.legend_rule_scope}
              onChange={(event) =>
                setLegacy({
                  legend_rule_scope: event.target.value as "Modern" | "PreM14AnyController",
                })
              }
            >
              <option value="Modern"><Trans>Modern</Trans></option>
              <option value="PreM14AnyController"><Trans>Pre-M14 (any controller)</Trans></option>
            </select>
          </Field>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t`Banned cards (one name per line)`}>
          <textarea
            className="rounded-md border border-input bg-background p-2 text-sm"
            defaultValue={legality.banned.join("\n")}
            onBlur={(event) => setLegality({ banned: event.target.value.split("\n").map((name) => name.trim()).filter(Boolean) })}
          />
        </Field>
        <Field label={t`Restricted cards (one name per line)`}>
          <textarea
            className="rounded-md border border-input bg-background p-2 text-sm"
            defaultValue={legality.restricted.join("\n")}
            onBlur={(event) => setLegality({ restricted: event.target.value.split("\n").map((name) => name.trim()).filter(Boolean) })}
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={onSave}>
          Validate &amp; save
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  min,
  disabled,
  onValue,
}: {
  value: number;
  min: number;
  disabled?: boolean;
  onValue: (value: number) => void;
}) {
  return (
    <Input
      type="number"
      min={min}
      disabled={disabled}
      value={value}
      onChange={(event) => {
        const parsed = Number(event.target.value);
        if (Number.isFinite(parsed)) onValue(parsed);
      }}
      className="h-9"
    />
  );
}