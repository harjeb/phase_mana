import { createRoot } from "react-dom/client";
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

async function start(): Promise<void> {
  initAndroidSafeArea();
  registerConsoleHooks();
  await initializeLocalization();

  const root = createRoot(document.getElementById("root")!);
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

void start();
