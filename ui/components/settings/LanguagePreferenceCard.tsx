import { t } from "@lingui/core/macro";
import { PreferenceCard } from "@/components/settings/PreferenceCard";
import { LocaleSelect } from "@/components/settings/LocaleSelect";
import { APP_LOCALES, resolveLanguagePreference } from "@/i18n/locales";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

/**
 * Card text language: only controls the Scryfall printing used for names, type
 * lines and printed rules text. Interface copy is owned by
 * `InterfaceLanguagePreferenceCard`.
 */
export function LanguagePreferenceCard() {
  const cardLanguage = usePreferencesStore((state) => state.cardLanguage);
  const setCardLanguage = usePreferencesStore((state) => state.setCardLanguage);
  const activeLocale = resolveLanguagePreference(cardLanguage);

  return (
    <PreferenceCard
      title={t`Card text language`}
      description={t`Language for card names, type lines and printed rules text. Falls back to English when a localized printing is unavailable.`}
      value={APP_LOCALES[activeLocale].label}
    >
      <LocaleSelect
        value={cardLanguage}
        onChange={setCardLanguage}
        ariaLabel={t`Card text language`}
      />
      {cardLanguage === "system" && (
        <p className="text-xs text-muted-foreground">
          {t`Currently using ${APP_LOCALES[activeLocale].label}`}
        </p>
      )}
    </PreferenceCard>
  );
}
