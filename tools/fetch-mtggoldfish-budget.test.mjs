import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeWidget, parseListing, parseWidget, toDck, nameKey } from './fetch-mtggoldfish-budget.mjs';
const c={id:'123',name:'Listing name',format:'standard',sourceURL:'https://www.mtggoldfish.com/deck/123',listingURL:'https://www.mtggoldfish.com/decks/budget/standard'};
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
function widget(fields) {
  const html=Object.entries({name:'Actual & Real',format:'standard',deck:'60 Island\nsideboard\n2 Negate',...fields}).map(([k,v])=>`<input id="deck_input_${k}" value="${escape(v)}">`).join('');
  return `elem.innerHTML = ${JSON.stringify(html)}; globalThis.DO_NOT_RUN = true;`;
}
test('literal decoder never executes wrapper, handles Rails JS escapes',()=>{
  assert.equal(decodeWidget(String.raw`elem.innerHTML = "\'\/$\$\n\u0041\x42"; throw Error();`),"'/$$\nAB");
  assert.throws(()=>decodeWidget('elem.innerHTML = getHtml();'));
  parseWidget(widget({}),c);assert.equal(globalThis.DO_NOT_RUN,undefined);
});
test('only literal budget listing deck links, not article/upgrades/archetype links',()=>{
  const html='<h1>Budget Decks</h1><a href="/deck/123#paper">A &amp; B</a><a href="/deck/123#online">A &amp; B</a><a href="/deck/456"><span class="sr-only">Image</span></a><a href="/articles/upgrades">Upgrade</a><a href="/archetype/example">Example</a>';
  assert.deepEqual(parseListing(html,'standard').map(x=>[x.id,x.name]),[['123','A & B']]);
  assert.throws(()=>parseListing('<h1>Metagame</h1>','standard'));
});
test('exact full main and sideboard, actual name, metadata',()=>{
  const d=parseWidget(widget({}),c);
  assert.equal(d.name,'Actual & Real');
  assert.deepEqual(d.sections,{Main:[{count:60,name:'Island'}],Sideboard:[{count:2,name:'Negate'}],Commander:[]});
  assert.match(toDck(d),/SourceURL=https:\/\/www.mtggoldfish.com\/deck\/123\nDescription=MTGGoldfish · Budget Decks\nBudget=true/);
  assert.throws(()=>parseWidget(widget({format:'modern'}),c),/format mismatch/);
  assert.throws(()=>parseWidget(widget({deck:'59 Island'}),c),/Incomplete/);
  assert.throws(()=>parseWidget(widget({deck:'60 Island\nbad line'}),c),/Unrecognized/);
});
test('commander moved exactly once; explicit section preserved; partners rejected',()=>{
  const cc={...c,format:'commander'};
  const d=parseWidget(widget({format:'commander',deck:'1 Talrand, Sky Summoner\n99 Island',commander:'Talrand, Sky Summoner'}),cc);
  assert.deepEqual(d.sections.Main,[{count:99,name:'Island'}]);
  assert.deepEqual(d.sections.Commander,[{count:1,name:'Talrand, Sky Summoner'}]);
  assert.deepEqual(parseWidget(widget({format:'commander',deck:'99 Island\ncommander\n1 Talrand, Sky Summoner',commander:'Talrand, Sky Summoner'}),cc).sections,d.sections);
  assert.throws(()=>parseWidget(widget({format:'commander',commander_alt:'Partner'}),cc),/Multiple commanders/);
});
test('global dedup normalization',()=>assert.equal(nameKey('  Ｂurn  '),nameKey('burn')));
test('saved evidence round trips to exact emitted decks without HTML or tokens',async()=>{
  const report=JSON.parse(await fs.readFile(new URL('./deck-import-cache/budget-report.json',import.meta.url),'utf8'));
  const names=new Set();
  for(const d of report.decks) {
    assert.equal(names.has(nameKey(d.name)),false);names.add(nameKey(d.name));
    assert.ok(report.discovery.some(l=>l.url===d.listingURL && l.candidates.some(c=>c.id===d.id)));
    assert.equal(await fs.readFile(new URL(`./deck-import-cache/budget-dck/${d.file}`,import.meta.url),'utf8'),toDck(d));
  }
  assert.doesNotMatch(JSON.stringify(report),/authenticity_token|<input|innerHTML/);
});
