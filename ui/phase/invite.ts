import { t } from "@lingui/core/macro";
import { normalizeServer } from "./endpoint";

/**
 * A shareable invitation to one room on one host.
 *
 * The host does not run a rendezvous service, so there is no short code to
 * resolve: the invitation has to carry the address itself. Keeping it
 * self-contained is what lets a guest join by pasting one string instead of
 * typing an IP and port.
 *
 * Deliberately not compressed. The payload is ~100–140 bytes of JSON, so
 * `deflate-raw` saves under 8% on the better case and is measurably *longer*
 * for a LAN address; the encoder stays dependency-free in exchange.
 *
 * `password` is the room's join password, never a seat credential: an invite
 * must not carry a `player_token` or a reconnect `full_key`, or forwarding it
 * would hand over the host's own seat.
 */
export const INVITE_PREFIX = "PMH1-";

/**
 * Refuse absurd input before parsing it. Chat clients that mangle a code this
 * long have already broken it, and this bounds the JSON parse.
 */
export const MAX_INVITE_LENGTH = 4096;

/** `server_core::generate_game_code`: six characters from `A–Z0–9`. */
const GAME_CODE = /^[A-Z0-9]{6}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** `lobby_broker::validation::MAX_PASSWORD_LEN`, in bytes. */
const MAX_PASSWORD_BYTES = 128;

export interface Invite {
  /** Format version. Unrelated to the game's wire protocol version. */
  v: 1;
  /** Complete WebSocket URL the guest should dial. */
  endpoint: string;
  /** The room code the server assigned. */
  gameCode: string;
  /** Private-room password. */
  password: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 16 random bytes → 22 base64url characters. */
export function randomPassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): string {
  if (!BASE64URL.test(text)) throw new Error(t`Invitation code is not valid base64url.`);
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(t`Invitation code is damaged.`);
  }
  return decoder.decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

/**
 * Validate and canonicalize an invitation. Shared by encode and decode so a
 * code the host produces is always one the guest accepts.
 */
function checked(value: unknown): Invite {
  if (typeof value !== "object" || value === null) throw new Error(t`Invitation is not an object.`);
  const { v, endpoint, gameCode, password } = value as Record<string, unknown>;
  if (v !== 1) throw new Error(t`This invitation was made by a newer version.`);
  if (typeof endpoint !== "string") throw new Error(t`Invitation is missing its server address.`);
  if (typeof gameCode !== "string" || !GAME_CODE.test(gameCode)) throw new Error(t`Invitation has no valid room code.`);
  if (typeof password !== "string" || !password) throw new Error(t`Invitation is missing its room password.`);
  if (encoder.encode(password).length > MAX_PASSWORD_BYTES) throw new Error(t`Invitation password is too long.`);
  // The canonical form is what the guest dials, so the host shares the exact
  // string this client would itself connect with.
  return { v: 1, endpoint: normalizeServer(endpoint), gameCode, password };
}

export function encodeInvite(invite: { endpoint: string; gameCode: string; password: string }): string {
  const value = checked({ ...invite, v: 1 });
  return INVITE_PREFIX + base64url(encoder.encode(JSON.stringify(value)));
}

/**
 * Parse a pasted invitation. Every failure is a distinct message: "wrong room
 * password" and "this invitation is damaged" send the user to different fixes.
 */
export function decodeInvite(code: string): Invite {
  if (typeof code !== "string") throw new Error(t`Paste an invitation code.`);
  const trimmed = code.trim();
  if (!trimmed) throw new Error(t`Paste an invitation code.`);
  if (trimmed.length > MAX_INVITE_LENGTH) throw new Error(t`That is too long to be an invitation code.`);
  if (!trimmed.startsWith(INVITE_PREFIX)) throw new Error(t`That is not an invitation code.`);
  const body = trimmed.slice(INVITE_PREFIX.length);
  if (!body) throw new Error(t`Invitation code is empty.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64url(body));
  } catch (error) {
    if (error instanceof Error && error.message && !error.message.includes("JSON")) throw error;
    throw new Error(t`Invitation code is damaged.`);
  }
  return checked(parsed);
}

/**
 * The address a guest should dial, from what the server advertises and what
 * the host can offer.
 *
 * `ServerHello.public_url` is the upstream field for exactly this, and is set
 * by `--public-url` or the embedded tunnel. Only when it is absent does the
 * host fall back to an address of its own, which is correct on a LAN and
 * unreachable across NAT — the invite then says "local network only".
 */
export function inviteEndpoint(publicUrl: string | null | undefined, fallback: string): { endpoint: string; scope: "advertised" | "lan" | "loopback" } {
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.pathname === "/") url.pathname = "/ws";
    const endpoint = normalizeServer(url.href);
    return { endpoint, scope: isLoopback(endpoint) ? "loopback" : "advertised" };
  }
  const endpoint = normalizeServer(fallback);
  return { endpoint, scope: isLoopback(endpoint) ? "loopback" : "lan" };
}
function isLoopback(endpoint: string): boolean {
  const host = new URL(endpoint).hostname;
  return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host);
}
export function browserEndpointWarning(endpoint: string, protocol: string): string | null {
  if (protocol === "https:" && new URL(normalizeServer(endpoint)).protocol === "ws:") {
    return t`This HTTPS page may block an insecure ws:// connection. Use a secure wss:// tunnel or open the host's HTTP page on your local network.`;
  }
  return null;
}
