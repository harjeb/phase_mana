import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function validateApiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PHASE_MANA_API_URL must be an http://127.0.0.1:<port> origin');
  }
  return url.origin;
}

// Resolve per request, so starting/restarting the backend after Vite works too.
export function resolveApiTarget(env = process.env) {
  if (env.PHASE_MANA_API_URL) return validateApiUrl(env.PHASE_MANA_API_URL);
  const file = env.PHASE_MANA_ENDPOINT_FILE || resolve(env.PHASE_MANA_STATE_DIR || '.phase-mana', 'server.json');
  try {
    const endpoint = JSON.parse(readFileSync(file, 'utf8'));
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || !Number.isInteger(endpoint.pid) || endpoint.pid <= 0) throw new Error('Invalid endpoint');
    process.kill(endpoint.pid, 0);
    return `http://127.0.0.1:${endpoint.port}`;
  } catch {
    const port = env.PHASE_MANA_PORT || '3001';
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid PHASE_MANA_PORT');
    return `http://127.0.0.1:${port}`;
  }
}

export function createProxy() {
  let apiProxy;
  return {
    '/api': {
      target: resolveApiTarget(),
      configure(proxy) { apiProxy = proxy; },
      bypass(_req, _res, options) {
        const target = resolveApiTarget();
        options.target = target;
        // Vite keeps its config copy separate from http-proxy's live options.
        if (apiProxy) apiProxy.options.target = target;
      },
    },
    '/scryfall-symbols': {
      target: 'https://svgs.scryfall.io', changeOrigin: true,
      rewrite: path => path.replace(/^\/scryfall-symbols/, '/card-symbols'),
    },
    '/hub-api/api/scryfall': {
      target: 'https://api.scryfall.com', changeOrigin: true,
      rewrite: path => path.replace(/^\/hub-api\/api\/scryfall/, ''),
    },
  };
}
