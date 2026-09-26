// Fresh browser storage and fixture decks: never alters an existing game/history.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const origin = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:1420';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({version:'1.5.0',acceptedAt:new Date().toISOString()}));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({version:'1.0',acceptedAt:new Date().toISOString()}));
    localStorage.setItem('manabrew-preferences', JSON.stringify({state:{uiLanguage:'zh-Hans',aiDifficulty:'Hard'},version:1}));
    if (!localStorage.getItem('smoke.historyInitialized')) {
      localStorage.setItem('manabrew-match-history', JSON.stringify([{
        reportId:'translation-smoke', startedAt:new Date().toISOString(), endedAt:new Date().toISOString(), durationS:125,
        format:'tiny_leaders',engine:'Manabrew',startingLife:20,endReason:'gameOver',gameOver:true,winner:'You',conceded:[],clientVersion:'test',platform:'test',
        players:[{username:'You',isBot:false,isLocal:true,deckName:'Smoke Bookworm',sideboardCount:0,cards:[{name:'Oblivious Bookworm',setCode:'dsk',count:4}]},
          {username:'AI',isBot:true,deckName:'Smoke Opponent',sideboardCount:0,cards:[]}],
      }]));
      localStorage.setItem('smoke.historyInitialized','1');
    }
  });
  const uris=Object.fromEntries(['small','normal','large','png','art_crop','border_crop'].map(k=>[k,'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=']));
  await page.route('**/preset_decks/*.json',route=>route.fulfill({json:route.request().url().endsWith('/index.json')?['smoke_bookworm']: {
    label:'Smoke Bookworm',desc:'Test only',format:'standard',color:'text-foreground',cards:[
      {name:'Forest',count:24,set:'lea',cardNumber:'1',types:['Land'],subtypes:['Forest'],supertypes:['Basic'],manaCost:'',colors:[],colorIdentity:['G'],cmc:0,uris},
      {name:'Oblivious Bookworm',count:36,set:'dsk',cardNumber:'1',types:['Creature'],subtypes:[],supertypes:[],manaCost:'{G}{U}',colors:['G','U'],colorIdentity:['G','U'],cmc:2,uris},
    ],sideboard:[],
  }}));
  let engineCalls=0;
  await page.route('**/api/tournament/simulate',route=>{engineCalls++;return route.fulfill({status:422,json:{error:'Unexpected engine call'}});});
  await page.goto(origin+'/#/play/history');
  await page.getByRole('heading',{name:'对局记录',exact:true}).waitFor();
  assert.ok(await page.getByText('查看本设备上的对局结果、胜率与变化趋势。',{exact:true}).isVisible());
  assert.ok(await page.getByText('胜率趋势',{exact:true}).isVisible());
  assert.ok(await page.getByText('2分5秒',{exact:true}).first().isVisible());
  assert.ok(await page.getByRole('option',{name:'小小指挥官',exact:true}).count());
  assert.equal(await page.getByRole('option',{name:'Last 30 days',exact:true}).count(),0);
  await page.screenshot({path:'tools/localized-history-smoke.png'});
  await page.goto(origin+'/#/play/offline/constructed');
  for(const name of ['小小指挥官','单挑指挥官','老学派 93/94','老学派 95']) {
    await page.getByRole('button',{name,exact:true}).click();
    await page.getByText('此赛制暂无入门套牌。',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/Smoke Bookworm/}).count(),0);
  }
  await page.screenshot({path:'tools/format-filter-smoke.png'});
  await page.goto(origin+'/#/play/tournaments');
  await page.getByRole('button',{name:'创建本地锦标赛',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('phase.localTournament.v1') !== null);
  const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('phase.localTournament.v1')));
  const event=await snapshot();
  const aiMatch=event.rounds[0].findIndex(match=>!match.players.includes(0));
  const humanMatch=event.rounds[0].findIndex(match=>match.players.includes(0));
  let games=0;
  while((await snapshot()).rounds[0][aiMatch].winner===null) {
    await page.getByRole('button',{name:/^模拟(?:下一局)? AI 对局/}).click();
    games++;
    await page.waitForFunction(({aiMatch,games})=>JSON.parse(localStorage.getItem('phase.localTournament.v1')).rounds[0][aiMatch].gameWins.reduce((a,b)=>a+b,0)===games,{aiMatch,games});
    const pairing=(await snapshot()).rounds[0][aiMatch];
    assert.equal(pairing.gameWins[0]+pairing.gameWins[1],games);
    assert.equal(pairing.activeGame,null);
    if(games===1) assert.equal(pairing.winner,null,'BO3 must remain open after one win');
    assert.ok(games<=3,'BO3 ends within three decisive draws');
  }
  assert.equal(engineCalls,0);
  assert.deepEqual((await snapshot()).rounds[0][humanMatch].gameWins,[0,0]);
  const saved=await snapshot();
  await page.reload();
  await page.waitForFunction(()=>document.body.textContent.includes('冠军') || document.body.textContent.includes('获胜者'));
  assert.deepEqual((await snapshot()).rounds,saved.rounds);
  await page.screenshot({path:'tools/local-tournament-weighted-smoke.png'});
  let hostCalls=0;
  const socketMessages=[];
  await page.route('**/api/host/stop',route=>route.fulfill({json:{running:false}}));
  await page.route('**/api/host/status',route=>route.fulfill({json:{running:false}}));
  await page.route('**/api/host/start',route=>{
    hostCalls++;
    return hostCalls===1
      ? route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Missing proxy</title>'})
      : route.fulfill({json:{endpoint:'ws://127.0.0.1:19474/ws',lanEndpoints:['ws://192.168.0.2:19474/ws'],binary:'mock',port:19474}});
  });
  page.on('console',message=>{if(message.type()==='error' && message.text().includes('19474')) console.error(message.text());});
  await page.context().routeWebSocket(/19474/,socket=>{
    socketMessages.push('intercepted');
    socket.onMessage(message=>{
      const frame=JSON.parse(String(message));
      socketMessages.push(frame.type);
      if(frame.type==='CreateGameWithSettings') {
        assert.equal(frame.data.public,false);
        assert.ok(frame.data.password);
        socket.send(JSON.stringify({type:'GameCreated',data:{game_code:'ABC123',player_token:'mock-seat',full_key:{game_code:'ABC123',generation:1}}}));
      }
    });
    socket.send(JSON.stringify({type:'ServerHello',data:{mode:'Full',protocol_version:76,manabrew_version:2}}));
  });
  await page.goto(origin+'/#/play/online');
  // Hash navigation reuses the document; reload to install WebSocket interception.
  await page.reload();
  const hostButton=page.getByRole('button',{name:'主持并创建邀请',exact:true});
  await hostButton.click();
  await page.getByRole('alert').filter({hasText:'请输入牌数有效的牌表'}).waitFor();
  assert.equal(hostCalls,0,'invalid decks must not start hosting');
  await page.locator('textarea').first().fill('24 Forest\n36 Oblivious Bookworm');
  await hostButton.click();
  await page.getByRole('alert').filter({hasText:'本地主持服务返回了无效响应'}).waitFor();
  assert.ok(await hostButton.isEnabled());
  await hostButton.click();
  await page.waitForFunction(()=>[...document.querySelectorAll('input[readonly]')].some(input=>input.value.startsWith('PMH1-')),null,{timeout:10000}).catch(async error=>{
    console.error('Hosting state',socketMessages,await page.getByRole('alert').allTextContents(),await page.getByRole('status').allTextContents());
    await page.screenshot({path:'tools/host-room-debug.png'});
    throw error;
  });
  assert.equal(hostCalls,2);
  assert.equal(await page.getByRole('alert').count(),0);
  await page.screenshot({path:'tools/host-room-smoke.png'});
  console.log('PASS: Chinese history, strict format filters, weighted AI BO3, persistence, and visible hosting validation/failure plus mocked invitation creation.');
} finally { await browser.close(); }
