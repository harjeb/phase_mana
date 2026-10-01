import { createRoot } from "react-dom/client";
import { t } from "@lingui/core/macro";
import "@fontsource/alegreya-sans/400.css";
import "@fontsource/alegreya-sans/500.css";
import "@fontsource/alegreya-sans/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "./index.css";
import { registerConsoleHooks } from "./lib/consoleHooks";
import { initAndroidSafeArea } from "./platform/androidSafeArea";
import { initializeLocalization } from "./i18n/runtime";

const root = createRoot(document.getElementById("root")!);

async function start(): Promise<void> {
  initAndroidSafeArea();
  registerConsoleHooks();
  await initializeLocalization();

  const local = window.location;
  const desktopBoot = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined &&
    ((local.protocol === "tauri:" && local.hostname === "localhost") ||
      (local.protocol === "http:" && local.hostname === "tauri.localhost"));
  if (desktopBoot) {
    const { DesktopBoot } = await import("./components/DesktopBoot");
    root.render(<DesktopBoot />);
  } else {
    const { default: App } = await import("./App");
    root.render(<App />);
  }
}

void start().catch((error: unknown) => {
  console.error("Application startup failed", error);
  // Keep this fallback independent of App and its imports: a stale Vite chunk
  // (or a failed locale download) must not leave the page blank. Reload the
  // document, rather than retrying a rejected import cached by the browser.
  root.render(
    <main className="flex h-dvh flex-col items-center justify-center gap-4 overflow-auto p-6">
      <h1 className="text-xl font-semibold">{t`Something went wrong`}</h1>
      <pre role="alert" className="max-w-full whitespace-pre-wrap break-words text-sm">
        {error instanceof Error ? error.message : String(error)}
      </pre>
      <button
        type="button"
        className="rounded-md border px-4 py-2 focus-visible:outline focus-visible:outline-2"
        onClick={() => window.location.reload()}
      >
        {t`Refresh`}
      </button>
    </main>,
  );
});
