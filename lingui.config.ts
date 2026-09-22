import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "ru", "zh-Hans", "zh-Hant"],
  fallbackLocales: { default: "en" },
  // Bind the `t` macro to the app's own I18n instance (see ui/i18n/i18n.ts)
  // instead of @lingui/core's global singleton, which is never activated.
  runtimeConfigModule: {
    i18n: ["@/i18n/i18n", "i18n"],
  },
  catalogs: [
    {
      path: "<rootDir>/ui/i18n/locales/{locale}/messages",
      include: ["<rootDir>/ui"],
      exclude: ["<rootDir>/ui/**/*.d.ts"],
    },
  ],
});
