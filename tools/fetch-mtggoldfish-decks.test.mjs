import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeHtml,parseDeck,parseCandidates,toDck} from './fetch-mtggoldfish-decks.mjs';
const input=(id,value)=>`<input value="${value}" id="deck_input_${id}">`;
test('entities including numeric Unicode decode once',()=>assert.equal(decodeHtml('A &amp; B &#39; &#x1F600; &quot; &amp;lt;'), 'A & B \' 😀 " &lt;'));
test('hidden multiline list, metadata and commander separation',()=>{
 const html=input('name','Real &amp; Name')+input('format','commander')+input('deck','1 Leader\n2 Island\nsideboard\n1 Negate\n')+input('commander','Leader')+input('commander_alt','Partner')+"<span class='author'>by Someone</span>";
 const d=parseDeck(html,'https://www.mtggoldfish.com/deck/123',true);
 assert.equal(d.name,'Real & Name');assert.deepEqual(d.sections.Main,[{count:2,name:'Island'}]);assert.equal(d.sections.Sideboard[0].name,'Negate');assert.equal(d.sections.Commander.length,2);
 assert.match(toDck(d),/Budget=true/);
 assert.match(toDck(d),/Description=MTGGoldfish · Budget Decks · by Someone/);assert.match(toDck(d),/\[Commander\]\n1 Leader\n1 Partner/);
});
test('reject challenge or malformed public deck',()=>{assert.throws(()=>parseDeck('<h1>Forbidden</h1>','x'));assert.throws(()=>parseDeck(input('name','x')+input('format','modern')+input('deck','not a list'),'x'));});
test('candidate names, budget markers, fragments and irrelevant links',()=>{
 const list=parseCandidates(`<a href='/archetype/modern-real#paper'>Real &amp; Good</a><a href='/archetype/modern-real#online'>Real &amp; Good</a><h1>Budget Decks</h1><a href='/deck/12'>Budget Name</a><a href='/deck/12/edit'>Edit</a><a href='/decks/budget/modern'>View More</a><a href='/deck/13'>Tournament Deck</a>`, 'modern');
 assert.equal(list.length,3);assert.equal(list[2].budget,false);assert.equal(list[0].name,'Real & Good');assert.equal(list[0].budget,false);assert.equal(list[1].budget,true);
});
