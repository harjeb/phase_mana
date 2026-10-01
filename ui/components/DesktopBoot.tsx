import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { I18nProvider } from "@lingui/react";
import { ThemeProvider } from "next-themes";
import { AppInitGate, type DesktopBootStage } from "@/components/AppInitGate";
import { i18n } from "@/i18n/i18n";
import { useApplyTheme } from "@/hooks/useTheme";

interface BootProgress {
  stage: DesktopBootStage;
  received: number;
  total: number | null;
}

function DesktopBootContent() {
  // The boot page mounts without App, so it must apply the theme itself.
  // ThemeProvider only sets light/dark; useApplyTheme supplies actual CSS colors.
  useApplyTheme();
  const [progress, setProgress] = useState<BootProgress>({ stage: "checking", received: 0, total: null });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    async function boot() {
      try {
        // Subscribe before invoking so even the first progress event is visible.
        unlisten = await listen<BootProgress>("desktop-boot-progress", ({ payload }) => {
          if (!cancelled) setProgress(payload);
        });
        if (cancelled) {
          unlisten();
          return;
        }
        await invoke("boot_desktop");
      } catch (cause) {
        if (!cancelled) setError(String(cause));
      }
    }
    void boot();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [attempt]);

  const retry = () => {
    setError(null);
    setProgress({ stage: "checking", received: 0, total: null });
    setAttempt((current) => current + 1);
  };

  return (
    <AppInitGate desktopBoot={{ ...progress, error, retry }}>
      {null}
    </AppInitGate>
  );
}

export function DesktopBoot() {
  return (
    <I18nProvider i18n={i18n}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <DesktopBootContent />
      </ThemeProvider>
    </I18nProvider>
  );
}
