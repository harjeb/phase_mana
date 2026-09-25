import { t } from "@lingui/core/macro";

/**
 * The canonical WebSocket endpoint for a Phase server.
 *
 * A bare `host:port` gains the server's `/ws` route, and anything a WebSocket
 * URL cannot carry — userinfo, a query, a fragment — is refused rather than
 * silently dropped, because each of those has been used to smuggle credentials
 * or a second address past a client that only ever connects to one server.
 * Lives apart from `online.ts` so pure modules (invite codes) can validate an
 * endpoint without pulling in the store, the game transport, and toasts.
 */
export function normalizeServer(endpoint: string): string {
  const url = new URL(endpoint);
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(t`Enter a ws:// or wss:// server URL without credentials or query parameters.`);
  }
  if (url.pathname === "/") url.pathname = "/ws";
  return url.href;
}
