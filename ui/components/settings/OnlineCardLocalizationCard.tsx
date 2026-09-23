import { t } from "@lingui/core/macro";
import { Button } from "@/components/ui/button";
import { PreferenceCard } from "@/components/settings/PreferenceCard";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function OnlineCardLocalizationCard() {
  const enabled = usePreferencesStore((state) => state.onlineCardLocalizationEnabled);
  const setEnabled = usePreferencesStore((state) => state.setOnlineCardLocalizationEnabled);

  return (
    <PreferenceCard
      title={t`Online card localization`}
      description={t`Default is off to read local card data directly without online requests. When enabled, Chinese card names and rules text are fetched online via MTGCH.`}
      value={enabled ? t`Enabled` : t`Disabled`}
    >
      <div className="flex gap-2">
        <Button
          variant={!enabled ? "selected" : "outline"}
          size="sm"
          onClick={() => setEnabled(false)}
        >
          {t`Off (Local only)`}
        </Button>
        <Button
          variant={enabled ? "selected" : "outline"}
          size="sm"
          onClick={() => setEnabled(true)}
        >
          {t`On (MTGCH)`}
        </Button>
      </div>
    </PreferenceCard>
  );
}
