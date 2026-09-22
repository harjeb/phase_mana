import { t } from "@lingui/core/macro";
import { ActionPickerModal } from "@/components/game/modals/AbilityPickerModal";
import type { ActionPickerModalProps } from "@/components/game/modals/AbilityPickerModal";

export function PlayModePicker(props: Omit<ActionPickerModalProps, "title">) {
  return <ActionPickerModal {...props} title={t`Choose how to play this card`} />;
}
