import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { STORAGE_KEYS } from "@/lib/constants";

interface PreferredPrint {
  set: string;
  collectorNumber: string;
  imageUrl?: string;
}

interface PreferredPrintsState {
  preferredPrints: Record<string, PreferredPrint>;
  setPreferredPrint: (oracleId: string, print: PreferredPrint) => void;
  getPreferredPrint: (oracleId: string) => PreferredPrint | undefined;
  clearPreferredPrint: (oracleId: string) => void;
}

export const usePreferredPrintsStore = create<PreferredPrintsState>()(
  devtools(
    persist(
      (set, get) => ({
        preferredPrints: {},
        setPreferredPrint: (oracleId, print) =>
          set((state) => ({
            preferredPrints: { ...state.preferredPrints, [oracleId]: print },
          })),
        getPreferredPrint: (oracleId) => get().preferredPrints[oracleId],
        clearPreferredPrint: (oracleId) =>
          set((state) => {
            const { [oracleId]: _, ...rest } = state.preferredPrints;
            return { preferredPrints: rest };
          }),
      }),
      { name: STORAGE_KEYS.PREFERRED_PRINTS },
    ),
    { name: "preferredPrints", enabled: import.meta.env.DEV },
  ),
);
