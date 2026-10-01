import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const converter = path.resolve('tools/dck-to-preset-decks.mjs');
test('converter preserves unique names, source, types and complete legal lists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-import-'));
  try {
    const src = path.join(tmp, 'src'), out = path.join(tmp, 'out'), dbPath = path.join(tmp, 'cards.db');
    fs.mkdirSync(src); fs.mkdirSync(out);
    const db = new DatabaseSync(dbPath);
    db.exec('create table cards (name text, set_code text, collector_number text, json text)');
    const uris = Object.fromEntries(['small','normal','large','png','art_crop','border_crop'].map(k => [k, `https://example.com/${k}.jpg`]));
    for (const [name, type, legality] of [['Forest', 'Basic Land — Forest','legal'], ['Lórien Revealed','Sorcery','legal'], ['Black Lotus','Artifact','restricted']]) {
      const card = {name, set:'tst', collector_number:'1', type_line:type, image_uris:uris, image_status:'highres_scan', legalities:{vintage:legality}, color_identity:[], released_at:'2026-01-01'};
      db.prepare('insert into cards values (?,?,?,?)').run(name,'tst','1',JSON.stringify(card));
    }
    // Newer tokens with an identical name must not replace playable cards.
    db.prepare('insert into cards values (?,?,?,?)').run('Lórien Revealed','tok','2',JSON.stringify({name:'Lórien Revealed',set:'tok',collector_number:'2',layout:'token',type_line:'Token',image_uris:uris,image_status:'highres_scan',released_at:'2027-01-01',legalities:{vintage:'not_legal'}}));
    db.close();
    const deck = (file, name, main) => fs.writeFileSync(path.join(src, file+'.dck'), `[metadata]\nName=${name}\nFormat=vintage\nSource=https://www.mtggoldfish.com/deck/123\nDescription=MTGGoldfish · Budget Decks\nBudget=true\n[Main]\n${main}\n`);
    deck('a','Existing Deck','60 Forest');
    deck('b','New Budget','56 Forest\n4 Lorien Revealed');
    deck('c','Too Small','59 Forest');
    deck('d','Restricted Invalid','58 Forest\n2 Black Lotus');
    deck('e','Unresolved','59 Forest\n1 Missing Card');
    fs.writeFileSync(path.join(out,'index.json'), JSON.stringify(['existing']));
    fs.writeFileSync(path.join(out,'existing.json'), JSON.stringify({label:' existing deck '}));
    const report = path.join(tmp,'report.json');
    const result = spawnSync(process.execPath, [converter,'--src',src,'--out',out,'--db',dbPath,'--id-prefix','test','--require-legal','--report-file',report,'--write'], {encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'index.json'))), ['existing','test_b']);
    const imported = JSON.parse(fs.readFileSync(path.join(out,'test_b.json')));
    assert.equal(imported.source,'https://www.mtggoldfish.com/deck/123');
    assert.equal(imported.budget,true);
    assert.match(imported.desc,/Budget Decks/);
    assert.deepEqual(imported.cards[0].types,['Land']);
    assert.deepEqual(imported.cards[0].supertypes,['Basic']);
    assert.equal(imported.cards[1].name,'Lórien Revealed');
    assert.deepEqual(imported.cards[1].types,['Sorcery']);
    const audit = JSON.parse(fs.readFileSync(report));
    assert.equal(audit.duplicateNames.length,1);
    assert.equal(audit.decks.filter(d => d.errors).length,3);
    assert.ok(audit.decks.find(d => d.label === 'Restricted Invalid').errorDetails.some(e => e.includes('restricted')));
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
