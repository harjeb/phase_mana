// Real two-browser waiting room + native Phase engine. All processes/data belong to this test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const suffix = process.platform === 'win32' ? '.exe' : '';
const work = await mkdtemp(join(tmpdir(), 'phase-room-browser-'));
const child = spawn(resolve(root, `server/target/debug/phase-mana-server${suffix}`), [], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PHASE_MANA_PORT: '0', PHASE_MANA_CLIENT_PORT: undefined, PHASE_MANA_WEB_ROOT: undefined, PHASE_MANA_STATE_DIR: work,
    PHASE_CARD_DB: resolve(root, '../phase/data/mtgjson/test_fixture.json'),
    PHASE_DEV_FIXTURE: '0', PHASE_HOST_LAN: '0', PHASE_HOST_PORT: undefined, PHASE_HOST_PUBLIC_URL: '',
    PHASE_SERVER_BIN: resolve(root, `.phase-host/target/debug/phase-server${suffix}`),
    PHASE_HOST_DATA_DIR: resolve(root, '.phase-host/data'), },
});
let diagnostics = '';
child.stderr.on('data', chunk => { diagnostics += chunk; console.error(String(chunk).trimEnd()); });
console.log('Started isolated API', child.pid);
let api;
let browser;
try {
  api = await new Promise((resolveReady, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Backend startup timeout: ${diagnostics}`)), 60000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited ${code}: ${diagnostics}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      for (const line of output.split('\n')) {
        try { const value = JSON.parse(line); if (value.event === 'ready') { clearTimeout(timer); resolveReady(`http://127.0.0.1:${value.port}`); return; } } catch {}
      }
    });
  });
  console.log('API ready', api);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const nativeCreates = [];
  const publicFrames = [];
  const pages = [];
  for (const name of ['Room owner', 'Room guest']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(); pages.push(page);
    page.setDefaultTimeout(20000);
    await page.addInitScript(() => {
      localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({version:'1.5.0',acceptedAt:new Date().toISOString()}));
      localStorage.setItem('manabrew.onboarding', JSON.stringify({version:'1.0',acceptedAt:new Date().toISOString()}));
      localStorage.setItem('manabrew-preferences', JSON.stringify({state:{uiLanguage:'zh-Hans'},version:1}));
    });
    await page.route('**/api/host/*', async route => {
      const request = route.request();
      const response = await fetch(api + new URL(request.url()).pathname, { method: request.method(), headers: { 'X-Phase-Host':'1' } });
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    const uris = Object.fromEntries(['small','normal','large','png','art_crop','border_crop'].map(key=>[key,'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=']));
    await page.route('**/preset_decks/*.json', route => route.fulfill({ json: route.request().url().endsWith('/index.json') ? ['room_fixture'] : {
      id:'room_fixture',label:'Room test deck',desc:'Fixture only',format:'standard',color:'text-foreground',
      cards:[{name:'Forest',count:60,set:'lea',cardNumber:'1',manaCost:'',cmc:0,types:['Land'],subtypes:['Forest'],supertypes:['Basic'],colorIdentity:['G'],colors:[],uris}],sideboard:[],
    } }));
    page.on('websocket', ws => {
      ws.on('framesent', ({payload}) => { try { const frame=JSON.parse(String(payload)); if(frame.type==='CreateGameWithSettings') nativeCreates.push(frame.data); } catch {} });
      ws.on('framereceived', ({payload}) => { try {
        const frame=JSON.parse(String(payload));
        if(frame.type==='RoomState') publicFrames.push(frame.data);
        if(['GameCreated','SessionAttached','GameStarted','RoomLaunch','RoomLaunchJoin','RoomStartEngine'].includes(frame.type)) console.log(name,frame.type);
        if(['RoomError','Error','RequestRejected'].includes(frame.type)) console.error(name,frame.type,frame.data);
      } catch {} });
    });
    await page.goto((process.env.SMOKE_BASE_URL || 'http://127.0.0.1:1420') + '/#/play/online');
    await page.getByLabel('你的名字', {exact:true}).fill(name);
  }
  console.log('Browsers ready; creating empty room');
  const [host, guest] = pages;
  await host.getByRole('button', {name:'主持并创建邀请',exact:true}).click();
  await Promise.race([
    host.getByRole('heading', {name:'等待房间',exact:true}).waitFor({timeout:120000}),
    host.getByRole('alert').first().waitFor({timeout:120000}).then(async()=>{ throw new Error(await host.getByRole('alert').first().innerText()); }),
  ]);
  assert.equal(nativeCreates.length,0,'Creating a waiting room must not create a native game');
  const invitation = await host.getByLabel('房间邀请', {exact:true}).inputValue();
  assert.match(invitation,/^PMH1-/);
  await guest.getByLabel('粘贴邀请', {exact:true}).fill(invitation);
  await guest.getByRole('button', {name:'使用邀请加入',exact:true}).click();
  await guest.getByRole('heading', {name:'等待房间',exact:true}).waitFor();
  assert.equal(nativeCreates.length,0,'Joining the room must not submit a deck');
  // Deliberately choose opposite membership order; native seat0 belongs to the guest.
  await host.getByRole('button', {name:'坐这里',exact:true}).nth(1).click();
  await guest.getByText('Room owner',{exact:false}).first().waitFor();
  await guest.getByRole('button', {name:'坐这里',exact:true}).click();
  for (const page of pages) {
    await page.getByLabel('你的套牌',{exact:true}).selectOption({label:'Room test deck'});
    await page.getByRole('button',{name:'使用这副套牌',exact:true}).click();
    await page.getByRole('button',{name:'就绪',exact:true}).click();
  }
  // A settings change clears everybody's readiness, and cannot launch a game.
  await host.getByLabel('赛制',{exact:true}).selectOption('modern');
  await guest.getByRole('button',{name:'就绪',exact:true}).waitFor();
  assert.equal(await host.getByRole('button',{name:'开始游戏',exact:true}).isEnabled(),false);
  await host.getByLabel('赛制',{exact:true}).selectOption('standard');
  for(const page of pages) await page.getByRole('button',{name:'就绪',exact:true}).click();
  await host.screenshot({path:'tools/waiting-room-smoke.png'});
  assert.equal(nativeCreates.length,0);
  for(const state of publicFrames) {
    const json = JSON.stringify(state);
    assert.ok(!json.includes('main_deck') && !json.includes('Forest') && !json.includes('password') && !json.includes('token'));
  }
  await host.getByRole('button',{name:'开始游戏',exact:true}).click();
  for(const page of pages) await page.waitForFunction(()=>window.__pm?.getState().isGameActive && window.__pm.getState().gameView,undefined,{timeout:60000});
  assert.equal(nativeCreates.length,1);
  assert.equal(nativeCreates[0].start_when_full,false);
  assert.equal(nativeCreates[0].display_name,'Room guest');
  const seats = await Promise.all(pages.map(page=>page.evaluate(()=>{
    const state=window.__pm.getState();
    for(const zone of state.gameView.zones.filter(zone=>zone.zone==='hand')) {
      if(zone.ownerId !== state.myPlayerSlot && zone.cards.length) throw new Error('Opponent hand leaked');
    }
    return state.myPlayerSlot;
  })));
  assert.deepEqual(seats,['player-1','player-0']);
  await guest.reload();
  await guest.getByRole('button',{name:'重新连接等待房间',exact:true}).click();
  await guest.waitForFunction(()=>window.__pm?.getState().isGameActive && window.__pm.getState().myPlayerSlot==='player-0',undefined,{timeout:30000});
  console.log('PASS: real empty room, invitation join, chosen seats, deck selection, readiness reset, private state, native game start and reconnect with matching seats.');
} catch(error) {
  for (const [index, context] of (browser?.contexts() ?? []).entries()) {
    const page = context.pages()[0];
    if (page) {
      console.error(`Browser ${index}:`, (await page.locator('body').innerText().catch(()=>'' )).slice(-9000));
      await page.screenshot({path:`tools/waiting-room-debug-${index}.png`}).catch(()=>{});
    }
  }
  console.error(diagnostics.slice(-12000));
  throw error;
} finally {
  if(api) await fetch(api+'/api/host/stop',{method:'POST',headers:{'X-Phase-Host':'1'}}).catch(()=>{});
  await browser?.close();
  child.kill();
  await new Promise(resolveExit=>{ if(child.exitCode!==null || child.signalCode!==null) resolveExit(); else { child.once('exit',resolveExit); setTimeout(resolveExit,3000).unref(); } });
  await rm(work,{recursive:true,force:true});
}
