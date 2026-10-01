#!/usr/bin/env node
/** Public ordinary HTML acquisition only. Node fetch; no download/challenge bypass.
 * Usage: node tools/fetch-mtggoldfish-decks.mjs [--formats vintage,pauper] [--delay 1200]
 * Caches parsed public data only, never authentication forms or tokens.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.mtggoldfish.com';
export function decodeHtml(s) {
  return String(s).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, v) => {
    if (v[0] === '#') { const n = v[1].toLowerCase() === 'x' ? parseInt(v.slice(2),16) : Number(v.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all; }
    return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[v.toLowerCase()];
  });
}
const text = s => decodeHtml(s.replace(/<[^>]*>/g, '')).replace(/\s+/g,' ').trim();
export function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], decodeHtml(m[2] ?? m[3])]));
}
export function parseDeck(html, source, budget = false) {
  const fields = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) { const a=attributes(m[0]); if(a.id?.startsWith('deck_input_')) fields[a.id.slice(11)] = a.value ?? ''; }
  if (!fields.name || !fields.deck || !fields.format) throw new Error('Missing public deck inputs (possibly challenge or non-deck page)');
  const sections = {Main:[],Sideboard:[],Commander:[]}; let section='Main';
  for(const raw of fields.deck.split(/\r?\n/)) {
    const line=raw.trim(); if(!line) continue;
    if (/^(sideboard|commander|mainboard|main)$/i.test(line)) { section=({sideboard:'Sideboard',commander:'Commander',mainboard:'Main',main:'Main'})[line.toLowerCase()]; continue; }
    const m=/^(\d+)\s+(.+)$/.exec(line); if(!m) throw new Error(`Unrecognized deck line: ${line}`);
    sections[section].push({count:Number(m[1]),name:m[2]});
  }
  for(const name of [fields.commander,fields.commander_alt].filter(Boolean)) {
    if(!sections.Commander.some(c=>c.name===name)) sections.Commander.push({count:1,name});
    for(const zone of ['Main','Sideboard']) {const i=sections[zone].findIndex(c=>c.name===name); if(i>=0) {if(--sections[zone][i].count===0) sections[zone].splice(i,1); break;}}
  }
  const author = text(html.match(/<span[^>]*class=['"]author['"][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
  const event = text(html.match(/<a[^>]*href=['"]\/tournament\/[^'"]+['"][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '');
  return {name:fields.name,format:fields.format.toLowerCase(),source,budget,author,event,sections};
}
export function parseCandidates(html, format, forceBudget=false) {
  const found=new Map();
  const budgetHeader=/<h[1-6]\b[^>]*>\s*Budget Decks\s*<\/h[1-6]>/i.exec(html);
  const budgetStart=budgetHeader?.index ?? -1;
  const afterHeader=budgetStart<0 ? '' : html.slice(budgetStart+budgetHeader[0].length);
  const sectionEnd=/<a\b[^>]*href=['"]\/decks\/budget\/|<h[1-6]\b/i.exec(afterHeader);
  const budgetEnd=sectionEnd ? budgetStart+budgetHeader[0].length+sectionEnd.index : html.length;
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a=attributes(m[1]); const href=a.href?.split('#')[0];
    if(!href || !/^\/(?:archetype\/[^/?]+|deck\/\d+)$/.test(href)) continue;
    const name=text(m[2]); if(!name || /^(view|edit|download|image of)/i.test(name) || m[2].includes('sr-only')) continue;
    const source=BASE+href; if(!found.has(source)) found.set(source,{source,name,format,budget:forceBudget || (budgetStart>=0 && m.index>budgetStart && m.index<budgetEnd)});
  }
  return [...found.values()];
}
export function toDck(deck) {
  const clean=s=>String(s).replace(/[\r\n]+/g,' ');
  const description=['MTGGoldfish',deck.budget?'Budget Decks':'Metagame/tournament',deck.author,deck.event].filter(Boolean).join(' · ');
  return `[metadata]\nName=${clean(deck.name)}\nFormat=${clean(deck.format)}\nSource=${deck.source}\nDescription=${clean(description)}\n${deck.budget?'Budget=true\n':''}\n`+Object.entries(deck.sections).map(([zone,cards])=>`[${zone}]\n${cards.map(c=>`${c.count} ${c.name}`).join('\n')}\n`).join('\n');
}
export async function acquire(options={}) {
  const cache=path.join(ROOT,'tools/deck-import-cache'); const dataDir=path.join(cache,'goldfish-data'); const out=path.join(cache,'goldfish-dck');
  await fs.mkdir(dataDir,{recursive:true}); await fs.mkdir(out,{recursive:true});
  const report={startedAt:new Date().toISOString(),counts:{},failures:[],skipped:[],discovery:[]}; let manifest=[]; const names=new Set();
  try { manifest=JSON.parse(await fs.readFile(path.join(cache,'goldfish-manifest.json'),'utf8')); const prior=JSON.parse(await fs.readFile(path.join(cache,'goldfish-report.json'),'utf8')); Object.assign(report,prior); delete report.finishedAt; } catch {}
  const key=s=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  for(const entry of JSON.parse(await fs.readFile(path.join(ROOT,'public/preset_decks/index.json'),'utf8'))) {
    const id=typeof entry==='string'?entry:entry.id; try {const d=JSON.parse(await fs.readFile(path.join(ROOT,'public/preset_decks',id+'.json'),'utf8')); if(d.label || d.name) names.add(key(d.label || d.name));}catch{}
  }
  for (const d of manifest) names.add(key(d.name));
  let deckForbidden=0;
  const targets={vintage:40,pauper:35,standard:15,pioneer:15,modern:15,legacy:15,commander:15};
  let last=0;
  async function cached(url,kind,parse) {
    const filename=path.join(dataDir,createHash('sha256').update(kind+url).digest('hex')+'.json');
    try{return JSON.parse(await fs.readFile(filename,'utf8'));}catch{}
    await new Promise(r=>setTimeout(r,Math.max(0,(options.delay??1200)-(Date.now()-last)))); last=Date.now();
    const response=await fetch(url,{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'phase-mana-public-deck-import/1.0','Accept':'text/html'}});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const result=parse(await response.text()); await fs.writeFile(filename,JSON.stringify(result,null,2)); return result;
  }
  async function save() {await fs.writeFile(path.join(cache,'goldfish-manifest.json'),JSON.stringify(manifest,null,2));await fs.writeFile(path.join(cache,'goldfish-report.json'),JSON.stringify(report,null,2));}
  for(const format of options.formats ?? Object.keys(targets)) {
    let count=manifest.filter(d=>d.format===format).length,budgets=manifest.filter(d=>d.format===format&&d.budget).length; const seen=new Set(); const candidates=[];
    // Full metagame includes less-common archetypes; budget listing supplies named source decks.
    for(const [route,budget] of [[`/metagame/${format}`,false],[`/metagame/${format}/full`,false],[`/decks/budget/${format}`,true]]) {
      const url=BASE+route; try {const list=await cached(url,'listing-v2',h=>parseCandidates(h,format,budget)); candidates.push(...list); report.discovery.push({url,candidates:list.length});}catch(e){report.failures.push({source:url,error:e.message});}
    }
    // Guarantee budget opportunities before filling the target with tournament archetypes.
    candidates.sort((a,b)=>Number(b.budget)-Number(a.budget));
    for(const candidate of candidates) {
      if(count>=(targets[format]??15)) break;
      if(seen.has(candidate.source)) continue; seen.add(candidate.source);
      if(deckForbidden>=3 && candidate.source.includes('/deck/')) {report.skipped.push({...candidate,reason:'deck route circuit open after three HTTP 403 responses; no bypass attempted'});continue;}
      if(names.has(key(candidate.name))) {report.skipped.push({...candidate,reason:'existing global name'}); continue;}
      try {
        const deck=await cached(candidate.source,'deck',h=>parseDeck(h,candidate.source,candidate.budget)); deck.budget=candidate.budget;
        if(deck.format!==format) {report.skipped.push({...candidate,reason:`source format ${deck.format}`});continue;}
        if(names.has(key(deck.name))) {report.skipped.push({...candidate,reason:'existing global actual name',actualName:deck.name});continue;}
        const filename=`${format}-${createHash('sha256').update(deck.source).digest('hex').slice(0,12)}.dck`;
        await fs.writeFile(path.join(out,filename),toDck(deck)); names.add(key(deck.name));manifest.push({...deck,file:filename});count++;if(deck.budget)budgets++;
        console.log(`${format} ${count}/${targets[format]} ${deck.budget?'[budget] ':''}${deck.name}`);
      }catch(e){if(e.message==='HTTP 403' && candidate.source.includes('/deck/')) deckForbidden++;report.failures.push({...candidate,error:e.message});console.error(candidate.source,e.message);}
      report.counts[format]={acquired:count,budget:budgets,target:targets[format]};await save();
    }
    report.counts[format]={acquired:count,budget:budgets,target:targets[format],candidateURLs:new Set(candidates.map(c=>c.source)).size}; await save();
  }
  report.finishedAt=new Date().toISOString();await save();return report;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);const value=k=>args[args.indexOf(k)+1];
  acquire({formats:args.includes('--formats')?value('--formats').split(','):undefined,delay:args.includes('--delay')?Number(value('--delay')):1200}).then(r=>console.log(JSON.stringify(r.counts,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
}
