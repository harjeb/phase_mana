import { activateLocale } from "@/i18n/i18n";
import { APP_LOCALES, resolveLanguagePreference } from "@/i18n/locales";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useScryfallStore } from "@/stores/useScryfallStore";

let initialized = false;
let appliedCardLanguage = usePreferencesStore.getState().cardLanguage;
let appliedUiLanguage = usePreferencesStore.getState().uiLanguage;
let appliedOnlineLocalization = usePreferencesStore.getState().onlineCardLocalizationEnabled;

// Card text is resolved by Scryfall/MTGCH, not Lingui: the locale only selects which
// printing's name/type line/rules text we ask for.
function applyCardLanguage(): void {
  const locale = resolveLanguagePreference(usePreferencesStore.getState().cardLanguage);
  useScryfallStore.getState().setLocale(APP_LOCALES[locale].scryfallLanguage);
}

async function applyUiLanguage(): Promise<void> {
  const locale = resolveLanguagePreference(usePreferencesStore.getState().uiLanguage);
  await activateLocale(locale);
}

export async function initializeLocalization(): Promise<void> {
  if (!initialized) {
    initialized = true;
    usePreferencesStore.subscribe((state) => {
      if (state.cardLanguage !== appliedCardLanguage) {
        appliedCardLanguage = state.cardLanguage;
        applyCardLanguage();
      }
      if (state.uiLanguage !== appliedUiLanguage) {
        appliedUiLanguage = state.uiLanguage;
        void applyUiLanguage();
      }
      if (state.onlineCardLocalizationEnabled !== appliedOnlineLocalization) {
        appliedOnlineLocalization = state.onlineCardLocalizationEnabled;
        useScryfallStore.getState().clearCardCache();
      }
    });
    window.addEventListener("languagechange", () => {
      const state = usePreferencesStore.getState();
      if (state.cardLanguage === "system") applyCardLanguage();
      if (state.uiLanguage === "system") void applyUiLanguage();
    });
  }
  applyCardLanguage();
  await applyUiLanguage();
}
