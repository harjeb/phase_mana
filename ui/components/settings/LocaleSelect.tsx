import { t } from "@lingui/core/macro";
import { APP_LOCALES, type AppLanguagePreference } from "@/i18n/locales";

interface LocaleSelectProps {
  value: AppLanguagePreference;
  onChange: (value: AppLanguagePreference) => void;
  ariaLabel: string;
}

/**
 * Shared language picker for the two independent language preferences:
 * interface copy (Lingui) and card text (Scryfall printings).
 */
export function LocaleSelect({ value, onChange, ariaLabel }: LocaleSelectProps) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as AppLanguagePreference)}
      aria-label={ariaLabel}
      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
    >
      <option value="system">{t`Use system language`}</option>
      {Object.entries(APP_LOCALES).map(([locale, { label }]) => (
        <option key={locale} value={locale}>
          {label}
        </option>
      ))}
    </select>
  );
}
