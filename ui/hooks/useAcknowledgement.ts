import { useCallback, useMemo, useSyncExternalStore } from "react";

export interface AcknowledgementRecord {
  version: string;
  acceptedAt: string;
}

function writeRecord(storageKey: string, record: AcknowledgementRecord | null): void {
  try {
    if (record === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(record));
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
  } catch {
    // ignore
  }
}

export interface UseAcknowledgement {
  record: AcknowledgementRecord | null;
  accepted: boolean;
  accept: () => void;
  reset: () => void;
}

export function useAcknowledgement(storageKey: string, version: string): UseAcknowledgement {
  const subscribe = useMemo(
    () => (callback: () => void) => {
      const handler = (event: StorageEvent) => {
        if (event.key === storageKey || event.key === null) callback();
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },
    [storageKey],
  );

  const getSnapshot = useCallback(() => localStorage.getItem(storageKey), [storageKey]);
  const getServerSnapshot = useCallback(() => null, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const parsed = useMemo<AcknowledgementRecord | null>(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AcknowledgementRecord;
    } catch {
      return null;
    }
  }, [raw]);

  const accepted = parsed?.version === version;

  const accept = useCallback(() => {
    writeRecord(storageKey, { version, acceptedAt: new Date().toISOString() });
  }, [storageKey, version]);

  const reset = useCallback(() => {
    writeRecord(storageKey, null);
  }, [storageKey]);

  return { record: parsed, accepted, accept, reset };
}
