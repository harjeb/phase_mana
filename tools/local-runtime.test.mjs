import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('name-only missing art selects the requested face and preserves shared scans', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'phase-art-'));
  const saved = { state: process.env.PHASE_MANA_STATE_DIR, images: process.env.PHASE_MANA_CARD_IMAGES };
  process.env.PHASE_MANA_STATE_DIR = dir;
  process.env.PHASE_MANA_CARD_IMAGES = dir;
  try {
    const { cardImagesPlugin } = await import('./local-runtime.ts');
    const handlers = [];
    cardImagesPlugin().configureServer({ middlewares: { use: handler => handlers.push(handler) } });
    const handler = handlers[1];
    const card = { card_faces: [
      { name: 'Front', image_uris: { normal: 'https://cards.scryfall.io/front.jpg' } },
      { name: '  Back’s Name  ', image_uris: { normal: 'https://cards.scryfall.io/back.jpg' } },
    ] };
    let metadata = card;
    const fetchMock = t.mock.method(globalThis, 'fetch', async url => {
      assert.equal(new URL(url).origin, 'https://api.scryfall.com');
      return { ok: true, json: async () => metadata };
    });
    const request = name => new Promise((resolve, reject) => {
      const headers = {};
      const res = { setHeader: (key, value) => { headers[key] = value; }, end: () => resolve({ status: res.statusCode, location: headers.Location }) };
      handler({ url: `/card-images/missing.webp?name=${encodeURIComponent(name)}` }, res, reject);
    });
    for (const [name, image] of [
      [' back’s NAME ', 'back'],
      ['Front', 'front'],
      ['Front // Back’s Name', 'front'],
      ['Unknown', 'front'],
    ]) {
      assert.deepEqual(await request(name), { status: 302, location: `https://cards.scryfall.io/${image}.jpg` });
    }
    metadata = { ...card, image_uris: { normal: 'https://cards.scryfall.io/shared.jpg' } };
    assert.deepEqual(await request('Back’s Name'), { status: 302, location: 'https://cards.scryfall.io/shared.jpg' });
    metadata = {};
    assert.deepEqual(await request('Missing'), { status: 404, location: undefined });
    assert.equal(fetchMock.mock.callCount(), 6);
  } finally {
    if (saved.state === undefined) delete process.env.PHASE_MANA_STATE_DIR; else process.env.PHASE_MANA_STATE_DIR = saved.state;
    if (saved.images === undefined) delete process.env.PHASE_MANA_CARD_IMAGES; else process.env.PHASE_MANA_CARD_IMAGES = saved.images;
    await rm(dir, { recursive: true, force: true });
  }
});
