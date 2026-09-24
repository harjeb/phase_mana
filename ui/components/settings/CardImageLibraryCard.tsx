import { useEffect, useState } from "react";
import { t } from "@lingui/core/macro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PreferenceCard } from "@/components/settings/PreferenceCard";

interface CardImagesStatus {
  dir: string;
  exists: boolean;
  count: number;
  fromEnv: boolean;
}

/**
 * The folder is read by the vite server that serves this page, not the browser,
 * so the path is sent to it over `/card-images-config` (see `cardImagesPlugin`
 * in vite.config.ts); "Browse…" asks that same server to open the OS picker.
 *
 * A static `dist/` has no such endpoint and `status` stays null, which hides the
 * card rather than showing a control that cannot work.
 */
export function CardImageLibraryCard() {
  const [status, setStatus] = useState<CardImagesStatus | null>(null);
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState<null | "browse" | "save">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/card-images-config")
      .then((response) => (response.ok ? (response.json() as Promise<CardImagesStatus>) : null))
      .then((next) => {
        if (!cancelled && next) {
          setStatus(next);
          setDir(next.dir);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  async function post(mode: "browse" | "save", path: string, body?: unknown) {
    setBusy(mode);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/card-images-config${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await response.json()) as Partial<CardImagesStatus> & {
        error?: string;
        cancelled?: boolean;
      };
      if (!response.ok) {
        if (payload.error === "picker_failed") throw new Error(t`Could not open the folder picker. Paste the folder path instead.`);
        if (payload.error === "folder_missing") throw new Error(t`Folder not found. Check the path and try again.`);
        throw new Error(t`Could not save the folder. Check write permissions and try again.`);
      }
      if (payload.dir) setDir(payload.dir);
      if (mode === "browse") {
        // The picker opens on the server; the user finishes it there. Never get
        // stuck on "Working…" just because browse returns no `exists` field.
        if (!payload.cancelled) setNotice(t`Choose a folder in the dialog that opened.`);
        return;
      }
      if (typeof payload.exists === "boolean") {
        setStatus({
          dir: payload.dir ?? dir,
          exists: payload.exists,
          count: payload.count ?? 0,
          fromEnv: !!payload.fromEnv,
        });
        // Reload so card textures already decoded from the old library are dropped.
        window.location.reload();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PreferenceCard
      title={t`Card image library`}
      description={t`The folder the server reads card scans from. Pick the root that holds the letter folders (a, b, …); cards it does not hold fall back to Scryfall.`}
      value={status.fromEnv ? status.dir : undefined}
    >
      <div className="flex flex-wrap gap-2">
        <Input
          value={dir}
          disabled={busy !== null || status.fromEnv}
          onChange={(event) => setDir(event.target.value)}
          placeholder={t`Folder with Forge-named card images`}
          aria-label={t`Card image library`}
          className="min-w-0 flex-1"
        />
        <Button variant="outline" size="sm" disabled={busy !== null || status.fromEnv} onClick={() => void post("browse", "/browse")}>
          {t`Browse…`}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy !== null || status.fromEnv || !dir.trim() || dir === status.dir}
          onClick={() => void post("save", "", { dir })}
        >
          {t`Use folder`}
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {busy === "save" ? t`Working…`
          : status.fromEnv
            ? t`Pinned by PHASE_MANA_CARD_IMAGES.`
            : status.exists
              ? t`${status.count} card images found.`
              : t`Folder not found. Cards fall back to Scryfall.`}
      </p>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
    </PreferenceCard>
  );
}
