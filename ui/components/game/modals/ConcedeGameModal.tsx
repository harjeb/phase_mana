import { useRef, useState } from "react";
import { t } from "@lingui/core/macro";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
interface ConcedeGameModalProps {
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  hosting?: boolean;
}
export function ConcedeGameModal({ onConfirm, onCancel, hosting = false }: ConcedeGameModalProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <Modal maxWidth="max-w-md" onClose={pending ? undefined : onCancel}>
      <Modal.Header>
        <h2 className="text-base font-semibold">{t`Concede the game?`}</h2>
      </Modal.Header>
      <Modal.Body className="space-y-3 text-sm">
        <p>{t`You forfeit the game. This cannot be undone.`}</p>
        {hosting && (
          <p className="text-muted-foreground">
            {t`This app hosts the table. After conceding, stay connected so the remaining players can finish. Leaving later will end their game.`}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">
            {t`Concession could not be delivered: ${error}. You can retry or cancel.`}
          </p>
        )}
        {pending && (
          <p role="status" className="text-muted-foreground">
            {t`Sending concession…`}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Modal.Close data-autofocus variant="ghost" disabled={pending} onClose={onCancel}>
          {t`Cancel`}
        </Modal.Close>
        <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>
          {pending ? t`Conceding…` : t`Concede`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
