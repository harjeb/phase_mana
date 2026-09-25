/**
 * Preferences for the optional LLM opponent, and the `/api/start` payload they
 * produce.
 *
 * The games run on the local `phase-mana-server` (Rust), which builds the
 * engine-authored decision prompt and calls an OpenAI-compatible endpoint. The
 * base URL is required and the model is free text; the API key may be empty for
 * local servers (Ollama, LM Studio).
 */

export interface LlmSeatPreferences {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Free text so the field can be empty; parsed to a number at send time. */
  temperature: string;
}

export const DEFAULT_LLM_SEAT: LlmSeatPreferences = {
  enabled: false,
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: "",
};

/** The subset of `LlmSeatPreferences` the host understands (camelCase wire keys). */
export interface LlmSeatRequest {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

/**
 * The `/api/start` payload, or `undefined` when LLM mode is off or the settings
 * cannot produce a request. A half-filled block must not silently replace the
 * built-in AI with something that only errors.
 */
export function llmSeatRequest(preferences: LlmSeatPreferences): LlmSeatRequest | undefined {
  if (!preferences.enabled) return undefined;
  const baseUrl = preferences.baseUrl.trim();
  const model = preferences.model.trim();
  if (!baseUrl || !model) return undefined;
  const temperature = Number.parseFloat(preferences.temperature.trim());
  return {
    enabled: true,
    baseUrl,
    apiKey: preferences.apiKey.trim(),
    model,
    ...(Number.isFinite(temperature) ? { temperature } : {}),
  };
}

/** Whether the settings are complete enough to send. Used to warn in the UI. */
export function isLlmSeatUsable(preferences: LlmSeatPreferences): boolean {
  return llmSeatRequest(preferences) !== undefined;
}
