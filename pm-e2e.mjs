import { chromium } from 'playwright';
import fs from 'node:fs';
const log = [];
const say = (...a) => { const line = a.join(' '); log.push(line); console.log(line); };
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1600,height:1000}});
page.on('pageerror',e=>say('PAGEERROR', e.message));
page.on('console',m=>{ const t=m.text(); if (m.type()==='error' && !t.includes('script tag')) say('CONSOLE-ERR', t.slice(0,200)); });
const api = [];
page.on('request',r=>{ if(r.url().includes('/api/respond')) api.push((r.postData()??'').slice(0,160)); });
page.on('response',async r=>{ if(r.url().includes('/api/respond') && r.status()>=400) say('HTTP-ERR', r.status(), (await r.text().catch(()=>'')).slice(0,200)); });
const NEVER_CAST = process.env.PM_NEVER_CAST === '1';
const snap = () => page.evaluate(() => {
  const s = window.__pm.getState();
  const p = s.currentPrompt;
  const gv = s.gameView;
  const mine = gv?.players?.find(x => x.id === s.myPlayerSlot);
  return {
    type: p?.input?.type ?? null,
    actions: (p?.input?.actions ?? []).map(a => `${a.id}:${a.label}`),
    turn: gv?.turn, step: gv?.step, over: gv?.gameOver, winner: gv?.winnerId,
    life: gv?.players?.map(x => `${x.id}=${x.life}`).join(','),
    hand: mine?.hand?.length, bf: gv?.battlefield?.filter(c => c.controllerId === s.myPlayerSlot).map(c => c.identity?.name),
    oppBf: gv?.battlefield?.filter(c => c.controllerId !== s.myPlayerSlot).map(c => c.identity?.name),
    wait: s.isWaitingForResponse,
    cards: (p?.input?.cards ?? []).map(c => c.id),
    min: p?.input?.min,
  };
});
const answer = (output) => page.evaluate((o) => window.__pm.getState().respond(o), output);
// ManaBrew's shell is the only entry: Play -> Offline -> a deck for each seat
// -> Fight. Both presets must share a format or the Fight button stays
// disabled. The terms gate and the onboarding nickname step call ManaBrew's
// online service, so they are pre-accepted here.
await page.addInitScript(() => {
  localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
  localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
});
await page.goto('http://127.0.0.1:1420/#/play/offline');
await page.getByRole('button', { name: 'Pauper Mono Red Madness' }).click();
await page.locator('button[aria-label^="Pauper Elves"]').click();
await page.getByRole('button', { name: 'Fight!', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Fight', exact: true }).click();
await page.waitForTimeout(5000);
let shot = 0;
for (let i = 0; i < 140; i++) {
  const s = await snap();
  if (s.over) { say('GAME OVER', JSON.stringify(s)); await page.screenshot({path:'/tmp/pm-e2e-over.png'}); break; }
  if (s.wait) { await page.waitForTimeout(1200); continue; }
  say(`#${i}`, JSON.stringify(s));
  if (i % 12 === 0) await page.screenshot({path:`/tmp/pm-e2e-${shot++}.png`});
  const land = s.actions.find(a => /:Play land$/i.test(a));
  const cast = NEVER_CAST ? undefined : s.actions.find(a => /^Cast$/i.test(a));
  if (s.type === 'mulligan') await answer({ type: 'mulliganDecision', keep: true });
  else if (s.type === 'payManaCost') await answer({ type: 'pay', auto: true });
  else if (s.type === 'chooseAction' && land) await answer({ type: 'act', actionId: land.split(':')[0] });
  else if (s.type === 'chooseAction' && cast) await answer({ type: 'act', actionId: cast.split(':')[0] });
  else if (s.type === 'chooseCards') { const ids = s.cards.slice(0, s.min ?? 1); say('DISCARD', s.min, ids.join(',')); await page.screenshot({path:'/tmp/pm-e2e-discard.png'}); await answer({ type: 'chooseCardsDecision', chosenCardIds: ids }); }
  else if (s.type === 'chooseFromSelection') await answer({ type: 'selectionDecision', chosenIndices: [0] });
  else if (s.type === 'revealCards') await answer({ type: 'revealCardsAcknowledged' });
  else if (s.type === 'chooseBoardTargets') await answer({ type: 'cancel' });
  else if (s.type === 'chooseAction' || s.type === 'chooseAttackers' || s.type === 'chooseBlockers') await page.keyboard.press('Shift+Space');
  else { say('UNHANDLED PROMPT', s.type, JSON.stringify(s.actions)); await page.screenshot({path:'/tmp/pm-e2e-unhandled.png'}); break; }
  await page.waitForTimeout(1400);
}
say('respond requests:', api.length);
say(api.slice(-12).join('\n'));
fs.writeFileSync('/tmp/pm-e2e.log', log.join('\n'));
await browser.close();
