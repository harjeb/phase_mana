import { t } from "@lingui/core/macro";
import { PreferenceCard } from "@/components/settings/PreferenceCard";
import { LocaleSelect } from "@/components/settings/LocaleSelect";
import { APP_LOCALES, resolveLanguagePreference } from "@/i18n/locales";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

/**
 * Interface language: translates the app's own copy (menus, buttons, messages)
 * through Lingui. Independent of the card text language.
 */
export function InterfaceLanguagePreferenceCard() {
  const uiLanguage = usePreferencesStore((state) => state.uiLanguage);
  const setUiLanguage = usePreferencesStore((state) => state.setUiLanguage);
  const activeLocale = resolveLanguagePreference(uiLanguage);

  return (
    <PreferenceCard
      title={t`Interface language`}
      description={t`Language for menus, buttons and messages. Untranslated text falls back to English.`}
      value={APP_LOCALES[activeLocale].label}
    >
      <LocaleSelect
        value={uiLanguage}
        onChange={setUiLanguage}
        ariaLabel={t`Interface language`}
      />
      {uiLanguage === "system" && (
        <p className="text-xs text-muted-foreground">
          {t`Currently using ${APP_LOCALES[activeLocale].label}`}
        </p>
      )}
    </PreferenceCard>
  );
}
