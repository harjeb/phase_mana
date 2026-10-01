// Local weighted AI draws + real human BO3 games, using isolated seven-Plains fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const binary = resolve(process.env.PHASE_TOURNAMENT_TEST_BINARY || `server/target/debug/phase-mana-server${process.platform === 'win32' ? '.exe' : ''}`);
const env = {...process.env, PHASE_MANA_PORT:'0', PHASE_CARD_DB:resolve('../phase/data/mtgjson/test_fixture.json')};
delete env.PHASE_MANA_ENDPOINT_FILE; delete env.PHASE_MANA_CLIENT_PORT;
const backend = spawn(binary, [], {env,stdio:['ignore','pipe','inherit']});
let vite, browser;
try {
  const port = await new Promise((resolvePort,reject) => {
    const timer=setTimeout(()=>reject(new Error('backend timeout')),60000);
    backend.once('error',reject); backend.once('exit',code=>reject(new Error(`backend exited ${code}`)));
    createInterface({input:backend.stdout}).on('line',line=>{try {const ready=JSON.parse(line);if(ready.event==='ready'){clearTimeout(timer);resolvePort(ready.port);}}catch{}});
  });
  process.env.PHASE_MANA_API_URL=`http://127.0.0.1:${port}`;
  const {createServer}=await import('vite');
  vite=await createServer({server:{host:'127.0.0.1',port:0,open:false}});await vite.listen();
  const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  await page.addInitScript(()=>{
    localStorage.setItem('manabrew.termsAcceptance',JSON.stringify({version:'1.5.0',acceptedAt:new Date().toISOString()}));
    localStorage.setItem('manabrew.onboarding',JSON.stringify({version:'1.0',acceptedAt:new Date().toISOString()}));
    localStorage.setItem('manabrew-preferences',JSON.stringify({state:{uiLanguage:'en',aiDifficulty:'Hard'},version:1}));
  });
  const uris=Object.fromEntries(['small','normal','large','png','art_crop','border_crop'].map(k=>[k,'https://example.invalid/plains.jpg']));
  await page.route('**/preset_decks/*.json',route=>route.fulfill({json:route.request().url().endsWith('/index.json')?['smoke_plains']: {label:'Smoke Plains',desc:'Fixture only',format:'standard',color:'text-foreground',cards:[{name:'Plains',count:7,set:'lea',cardNumber:'1',types:['Land'],subtypes:['Plains'],supertypes:['Basic'],manaCost:'',colors:[],colorIdentity:['W'],cmc:0,uris}],sideboard:[{name:'Island',count:1,set:'lea',cardNumber:'2',types:['Land'],subtypes:['Island'],supertypes:['Basic'],manaCost:'',colors:[],colorIdentity:['U'],cmc:0,uris}]}}));
  await page.goto(origin+'/#/play/tournaments');
  await page.getByRole('button',{name:'Create local tournament',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('phase.localTournament.v1') !== null);
  const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('phase.localTournament.v1')));
  const event=await snapshot();
  assert.equal(event.entrants.length,4);
  assert.equal(event.matchType,'BO3');
  assert.ok(event.entrants.slice(1).every(e=>e.difficulty && e.deck.cards.length===7));
  const aiButton=()=>page.getByRole('button',{name:/^Simulate (?:next )?AI game(?: \/ replay)?$/});
  const humanButton=()=>page.getByRole('button',{name:/^Play (?:tournament game|next game(?: \/ replay)?)$/});
  await page.reload();await aiButton().waitFor();
  assert.deepEqual((await snapshot()).entrants,event.entrants,'reload rerolled entrants');
  let aiEngineRequests = 0;
  await page.route('**/api/tournament/simulate',route=>{
    aiEngineRequests++;
    return route.fulfill({status:422,json:{error:'AI-only results must not call the engine'}});
  });
  const runAi=async(round,match)=>{
    const before=(await snapshot()).rounds[round][match];
    await aiButton().click();
    await page.waitForFunction(({round,match,total})=>JSON.parse(localStorage.getItem('phase.localTournament.v1')).rounds[round][match].gameWins.reduce((a,b)=>a+b,0)===total+1,{round,match,total:before.gameWins[0]+before.gameWins[1]});
    const after=(await snapshot()).rounds[round][match];
    const winningSeat=after.gameWins.findIndex((value,index)=>value===before.gameWins[index]+1);
    assert.ok(winningSeat===0 || winningSeat===1);
    assert.equal(after.draws,before.draws);
    assert.equal(after.winner,Math.max(...after.gameWins)===2 ? after.players[winningSeat] : null);
    assert.equal(aiEngineRequests,0);
  };
  const aiIndex=event.rounds[0].findIndex(m=>!m.players.includes(0));
  await runAi(0,aiIndex);
  assert.equal((await snapshot()).rounds.length,1,'one AI game must not advance BO3');
  while((await snapshot()).rounds[0][aiIndex].winner===null) await runAi(0,aiIndex);
  const humanPairing=event.rounds[0].find(m=>m.players.includes(0));
  const opponentId=humanPairing.players.find(id=>id!==0);
  let firstPayload;
  for(let game=1;game<=2;game++) {
    if(game===1) assert.equal(await page.getByRole('button',{name:'Swap and save',exact:true}).count(),0,'no sideboarding before game one');
    if(game===2) {
      await page.getByLabel('Main-deck copy to remove',{exact:true}).selectOption('0');
      await page.getByLabel('Sideboard copy to add',{exact:true}).selectOption('0');
      await page.getByRole('button',{name:'Swap and save',exact:true}).click();
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('phase.localTournament.v1')).rounds[0].find(m=>m.players.includes(0)).decks?.some(d=>d.cards.some(c=>c.identity.name==='Island')));
      const swapped=await snapshot();
      assert.deepEqual(swapped.entrants,event.entrants,'sideboarding changed original entrants');
      const match=swapped.rounds[0].find(m=>m.players.includes(0));
      const humanDeck=match.decks[match.players.indexOf(0)];
      assert.equal(humanDeck.cards.length,7);assert.equal(humanDeck.sideboard.length,1);
      assert.equal(humanDeck.sideboard[0].identity.name,'Plains');
      await page.reload();await humanButton().waitFor();
      assert.deepEqual((await snapshot()).rounds,swapped.rounds,'saved sideboarding lost on reload');
    }
    const startRequest=page.waitForRequest(r=>r.url().endsWith('/api/start'));
    await humanButton().click();
    const payload=(await startRequest).postDataJSON();
    assert.equal(payload.difficulty,event.entrants[opponentId].difficulty);
    assert.ok(!payload.llm);
    if(firstPayload) {
      assert.notDeepEqual(payload.humanDeck,firstPayload.humanDeck,'next real game must use saved human swap');
      assert.equal(payload.humanDeck.filter(name=>name==='Island').length,1);
      assert.equal(payload.humanDeck.filter(name=>name==='Plains').length,6);
      assert.deepEqual(payload.aiDeck,firstPayload.aiDeck);
    } else {
      assert.deepEqual(payload.humanDeck,Array(7).fill('Plains'));
      assert.deepEqual(payload.aiDeck,Array(7).fill('Plains'));
      firstPayload=payload;
    }
    await page.waitForURL('**/#/game/local-tournament',{timeout:60000});
    await page.waitForFunction(()=>window.__pm?.getState().currentPrompt);
    await page.evaluate(async()=>{await window.__pm.getState().concede();});
    await page.waitForURL('**/#/play/tournaments',{timeout:30000});
    const after=await snapshot();
    const match=after.rounds[0].find(m=>m.players.includes(0));
    assert.equal(match.gameWins[match.players.indexOf(opponentId)],game);
    assert.equal(match.winner,game===2 ? opponentId : null);
    assert.equal(after.rounds.length,game===2 ? 2 : 1,'human BO3 advances only at two wins');
  }
  assert.equal((await snapshot()).rounds[1][0].decks,null,'round must start with original lists');
  await runAi(1,0);
  assert.equal((await snapshot()).rounds[1][0].winner,null,'one final win cannot crown champion');
  while((await snapshot()).rounds[1][0].winner===null) await runAi(1,0);
  await page.getByRole('status').filter({hasText:'Champion'}).waitFor();
  await page.reload();await page.getByRole('status').filter({hasText:'Champion'}).waitFor();
  assert.deepEqual((await snapshot()).entrants,event.entrants);
  await page.evaluate(async()=>{
    const moduleUrl=performance.getEntriesByType('resource').map(r=>r.name).find(url=>/\/ui\/i18n\/i18n\.ts(?:\?|$)/.test(url));
    if(!moduleUrl) throw new Error('Active i18n module not found');
    await (await import(moduleUrl)).activateLocale('zh-Hans');
  });
  await page.getByRole('status').filter({hasText:'冠军'}).waitFor();
  await page.getByRole('button',{name:'本地 AI 锦标赛',exact:true}).waitFor();
  console.log('PASS BO3 real AI games + two human concessions, legal human swap survives reload and changes actual next-game payload, advancement only at two wins, round reset, fixed assignments, retry, champion, Chinese UI');
} finally {await browser?.close();await vite?.close();backend.kill();}
