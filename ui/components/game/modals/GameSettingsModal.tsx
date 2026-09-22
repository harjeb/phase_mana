import { useId, type ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import {
  CARD_SIZE_MULTIPLIER_MAX,
  CARD_SIZE_MULTIPLIER_MIN,
  usePreferencesStore,
} from "@/stores/usePreferencesStore";
import {
  HOVER_DELAY_MAX,
  HOVER_DELAY_MIN,
  HOVER_DELAY_STEP,
} from "@/components/game/game.constants";
import { battlefieldCardStyleOptions } from "@/components/game/battlefieldCardStyles";
import {
  inlineCardStyleOptions,
  inGameCardPreviewStyleOptions,
} from "@/components/game/cardPreviewStyles";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { handOrderOptions } from "@/lib/handOrder";
import { TableSetupTableCard } from "@/components/lobby/TableSetupTableCard";
import { useServerStore } from "@/stores/useServerStore";

function Choice<T extends string | boolean>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={String(option.value)}
            size="sm"
            variant="outline"
            className="aria-pressed:border-accent"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-5 rounded-xl border bg-muted/10 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
function onOffOptions(): readonly { value: boolean; label: string }[] {
  return [
    { value: true, label: t`On` },
    { value: false, label: t`Off` },
  ];
}

export function GameSettingsModal({ onClose }: { onClose: () => void }) {
  const prefs = usePreferencesStore();
  const fullControl = usePromptPreferencesStore((s) => s.fullControl);
  const setFullControl = usePromptPreferencesStore((s) => s.setFullControl);
  const id = useId();
  const roomTableStyle = useServerStore((s) => s.currentRoom?.table_style);
  const tableBackgroundLocked = roomTableStyle != null;
  return (
    <Modal onClose={onClose} maxWidth="max-w-xl">
      <Modal.CloseShortcut keybinding="open-settings" onClose={onClose} />
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">{t`Board settings`}</h2>
        <p className="text-xs text-muted-foreground">
          {t`Changes apply immediately. Card view and front/back face are separate controls.`}
        </p>
      </Modal.Header>
      <Modal.Body className="space-y-4">
        <Section title={t`Cards and previews`}>
          <Choice
            label={t`Sort hand`}
            value={prefs.handOrderMode}
            options={handOrderOptions()}
            onChange={prefs.setHandOrderMode}
            hint={t`Manual preserves your placement; automatic modes arrange new cards.`}
          />
          <Choice
            label={t`Hand default view`}
            value={prefs.handCardStyle}
            options={inlineCardStyleOptions()}
            onChange={prefs.setHandCardStyle}
          />
          <Choice
            label={t`Stack default view`}
            value={prefs.stackCardStyle}
            options={inlineCardStyleOptions()}
            onChange={prefs.setStackCardStyle}
          />
          <Choice
            label={t`Prompt and dialog default view`}
            value={prefs.promptCardStyle}
            options={inlineCardStyleOptions()}
            onChange={prefs.setPromptCardStyle}
            hint={t`Realistic uses printed art. Rules shows card rules and current game information. Individual cards can still be switched.`}
          />
          <Choice
            label={t`Board hover preview view`}
            value={prefs.inGameCardPreviewStyle}
            options={inGameCardPreviewStyleOptions()}
            onChange={prefs.setInGameCardPreviewStyle}
          />
        </Section>
        <Section title={t`Priority and prompts`}>
          <Choice
            label={t`Priority windows`}
            value={fullControl}
            options={[
              { value: false, label: t`Autopass` },
              { value: true, label: t`Full control` },
            ]}
            onChange={setFullControl}
            hint={t`Full control stops at every window. Autopass skips windows with only mana abilities after a short delay.`}
          />
          <Choice
            label={t`Choose simultaneous trigger order`}
            value={prefs.chooseOrderOnMultipleTriggers}
            options={onOffOptions()}
            onChange={prefs.setChooseOrderOnMultipleTriggers}
            hint={t`When off, simultaneous triggers are ordered automatically.`}
          />
        </Section>
        <Section title={t`Board appearance`}>
          <div className="space-y-2">
            <label htmlFor={`${id}-size`} className="text-sm font-medium">
              {t`Card size · ${Math.round(prefs.cardSizeMultiplier * 100)}%`}
            </label>
            <input
              id={`${id}-size`}
              type="range"
              min={CARD_SIZE_MULTIPLIER_MIN * 100}
              max={CARD_SIZE_MULTIPLIER_MAX * 100}
              step={5}
              value={prefs.cardSizeMultiplier * 100}
              onChange={(e) => prefs.setCardSizeMultiplier(Number(e.target.value) / 100)}
              className="w-full accent-primary"
            />
          </div>
          <Choice
            label={t`Battlefield card style`}
            value={prefs.battlefieldCardStyle}
            options={battlefieldCardStyleOptions()}
            onChange={prefs.setBattlefieldCardStyle}
            hint={t`Applies to battlefield cards. Hand, stack and dialog view settings are independent.`}
          />
          <Choice
            label={t`Battlefield arrangement`}
            value={prefs.battlefieldAutoSort}
            options={[
              { value: false, label: t`Free placement` },
              { value: true, label: t`Auto-arrange` },
            ]}
            onChange={prefs.setBattlefieldAutoSort}
          />
          <Choice
            label={t`Opponent layout`}
            value={prefs.opponentLayout}
            options={[
              { value: "focused", label: t`Focused` },
              { value: "overview", label: t`Overview` },
            ]}
            onChange={prefs.setOpponentLayout}
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">{t`Table background`}</p>
            <TableSetupTableCard
              background={prefs.boardBackgroundId}
              onBackgroundChange={prefs.setBoardBackgroundId}
              columns={4}
              className=""
              disabled={tableBackgroundLocked}
            />
            <p className="text-xs text-muted-foreground">
              {tableBackgroundLocked
                ? t`The host picked this table's background when creating it.`
                : t`Used when a table does not provide its own background, including offline games.`}
            </p>
          </div>
          <Choice
            label={t`Zone piles`}
            value={prefs.lockZoneTiles}
            options={[
              { value: false, label: t`Movable` },
              { value: true, label: t`Locked` },
            ]}
            onChange={prefs.setLockZoneTiles}
            hint={t`Locking prevents dragging piles; viewing their cards remains available.`}
          />
          <Choice
            label={t`Decorative animations`}
            value={prefs.inGameAnimations}
            options={onOffOptions()}
            onChange={prefs.setInGameAnimations}
          />
        </Section>
        <Section title={t`Inspection input`}>
          <Choice
            label={t`Board preview trigger`}
            value={prefs.cardPreviewMode}
            options={[
              { value: "hover", label: t`Hover` },
              { value: "right-click", label: t`Right click` },
            ]}
            onChange={prefs.setCardPreviewMode}
            hint={t`Zone explorers support persistent tap and keyboard inspection independently.`}
          />
          <div className="space-y-2">
            <label htmlFor={`${id}-delay`} className="text-sm font-medium">
              {t`Hover delay · ${prefs.cardHoverDelayMs}ms`}
            </label>
            <input
              id={`${id}-delay`}
              type="range"
              min={HOVER_DELAY_MIN}
              max={HOVER_DELAY_MAX}
              step={HOVER_DELAY_STEP}
              value={prefs.cardHoverDelayMs}
              onChange={(e) => prefs.setCardHoverDelayMs(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </Section>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close onClose={onClose} variant="ghost">
          {t`Done`}
        </Modal.Close>
      </Modal.Footer>
    </Modal>
  );
}
