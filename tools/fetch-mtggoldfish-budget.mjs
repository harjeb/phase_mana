#!/usr/bin/env node
/** Public Budget Decks listings + their unauthenticated article widgets. No JS execution,
 * challenge handling, cookies, HTML or token persistence. Run: node tools/fetch-mtggoldfish-budget.mjs
 * Optional --target 8 --formats standard,pioneer,modern,legacy,commander,pauper,vintage
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.mtggoldfish.com';
export const nameKey = s => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export function decodeHtml(s) {
  return s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all,v) => v[0] === '#' ? String.fromCodePoint(v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1))) : ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[v.toLowerCase()]);
}
export function attributes(s) {
  return Object.fromEntries([...s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1],decodeHtml(m[2]??m[3])]));
}
/** Decode only the literal RHS, never evaluate wrapper or embedded script tags. */
export function decodeWidget(js) {
  const m=/\belem\.innerHTML\s*=\s*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')\s*;/.exec(js);
  if(!m) throw new Error('Missing literal widget HTML');
  return m[1].slice(1,-1).replace(/\\(u[\da-fA-F]{4}|x[\da-fA-F]{2}|\r\n|[\s\S])/g, (_,v)=>{
    if(v[0]==='u'||v[0]==='x') return String.fromCharCode(parseInt(v.slice(1),16));
    return ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','\n':'','\r\n':''})[v] ?? v;
  });
}
export function parseListing(html, format) {
  if(!/<h1\b[^>]*>[\s\S]*?Budget[\s\S]*?<\/h1>/i.test(html)) throw new Error('Not a Budget Decks listing');
  const found=new Map();
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href=attributes(m[1]).href; const id=/^\/deck\/(\d+)(?:#(?:paper|online))?$/.exec(href??'')?.[1];
    if(!id || /sr-only/.test(m[2])) continue;
    const name=decodeHtml(m[2].replace(/<[^>]*>/g,'')).trim();
    if(name) found.set(id,{id,name,format,sourceURL:`${BASE}/deck/${id}`,listingURL:`${BASE}/decks/budget/${format}`});
  }
  return [...found.values()];
}
export function parseWidget(js, candidate) {
  const fields={};
  for(const m of decodeWidget(js).matchAll(/<input\b[^>]*>/gi)) {
    const a=attributes(m[0]); if(a.id?.startsWith('deck_input_')) {
      const key=a.id.slice(11), value=a.value??'';
      if(key in fields && fields[key]!==value) throw new Error('Conflicting duplicate deck inputs');
      fields[key]=value;
    }
  }
  if(!fields.name || !fields.deck || fields.format?.toLowerCase()!==candidate.format) throw new Error('Missing deck or source format mismatch');
  if(fields.commander_alt) throw new Error('Multiple commanders unsupported');
  const sections={Main:[],Sideboard:[],Commander:[]}; let zone='Main';
  for(const raw of fields.deck.split(/\r?\n/)) {
    const line=raw.trim(); if(!line) continue;
    const heading=({main:'Main',mainboard:'Main',sideboard:'Sideboard',commander:'Commander'})[line.toLowerCase()];
    if(heading) {zone=heading;continue;}
    const m=/^([1-9]\d*)\s+(.+)$/.exec(line); if(!m) throw new Error('Unrecognized card line');
    sections[zone].push({count:Number(m[1]),name:m[2]});
  }
  if(fields.commander && !sections.Commander.length) {
    sections.Commander.push({count:1,name:fields.commander});
    for(const z of ['Main','Sideboard']) {
      const i=sections[z].findIndex(c=>c.name===fields.commander);
      if(i>=0) {if(--sections[z][i].count===0) sections[z].splice(i,1);break;}
    }
  }
  const total=z=>sections[z].reduce((n,c)=>n+c.count,0);
  if(candidate.format==='commander') {
    if(total('Commander')!==1 || total('Main')!==99 || sections.Main.some(c=>c.name===sections.Commander[0].name)) throw new Error('Unsupported or incomplete commander deck');
  } else if(total('Commander') || total('Main')<60 || total('Sideboard')>15) throw new Error('Incomplete or unsupported constructed deck');
  return {...candidate,listingName:candidate.name,name:fields.name,budget:true,sections};
}
export function toDck(d) {
  if(/[\r\n]/.test(d.name)) throw new Error('Invalid deck name');
  return `[metadata]\nName=${d.name}\nFormat=${d.format}\nSourceURL=${d.sourceURL}\nDescription=MTGGoldfish · Budget Decks\nBudget=true\n\n`+Object.entries(d.sections).map(([z,cards])=>`[${z}]\n${cards.map(c=>`${c.count} ${c.name}`).join('\n')}\n`).join('\n');
}
export async function acquire({target=8,formats=['standard','pioneer','modern','legacy','commander','pauper','vintage'],delay=1200}={}) {
  const cache=path.join(ROOT,'tools/deck-import-cache'),out=path.join(cache,'budget-dck');
  await fs.mkdir(out,{recursive:true});
  const names=new Set();
  for(const file of await fs.readdir(path.join(ROOT,'public/preset_decks'))) {
    if(!file.endsWith('.json')||file==='index.json') continue;
    const d=JSON.parse(await fs.readFile(path.join(ROOT,'public/preset_decks',file),'utf8'));
    if(d.label||d.name) names.add(nameKey(d.label||d.name));
  }
  async function mainNames() {
    for(const f of await fs.readdir(path.join(cache,'goldfish-dck')).catch(()=>[])) {
      if(!f.endsWith('.dck')) continue;
      const n=/^Name=(.+)$/m.exec(await fs.readFile(path.join(cache,'goldfish-dck',f),'utf8'))?.[1]; if(n) names.add(nameKey(n));
    }
  }
  await mainNames();
  const report={startedAt:new Date().toISOString(),counts:{},discovery:[],skipped:[],failures:[],decks:[]};
  const save=()=>fs.writeFile(path.join(cache,'budget-report.json'),JSON.stringify(report,null,2)+'\n');
  async function get(url,widget=false) {
    await new Promise(r=>setTimeout(r,delay));
    const r=await fetch(url,{signal:AbortSignal.timeout(45000),headers:widget?{Accept:'text/javascript, application/javascript, */*; q=0.01','X-Requested-With':'XMLHttpRequest'}:{Accept:'text/html'}});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  for(const format of formats) {
    report.counts[format]=0; const url=`${BASE}/decks/budget/${format}`;
    try {
      const candidates=parseListing(await get(url),format); report.discovery.push({url,candidates});
      for(const c of candidates) {
        if(report.counts[format]>=target) break;
        await mainNames();
        if(names.has(nameKey(c.name))) {report.skipped.push({...c,reason:'Duplicate listed name'});continue;}
        try {
          const d=parseWidget(await get(`${BASE}/widgets/deck/js?deckId=${c.id}&domId=phase-mana-import`,true),c);
          if(names.has(nameKey(d.name))) {report.skipped.push({...c,reason:'Duplicate actual name'});continue;}
          const file=`${format}-${c.id}.dck`; await fs.writeFile(path.join(out,file),toDck(d));
          names.add(nameKey(d.name));report.decks.push({...d,file});report.counts[format]++;
          console.log(`${format} ${report.counts[format]}/${target}: ${d.name}`);
        } catch(e) {report.failures.push({...c,error:e.message});}
        await save();
      }
    } catch(e) {report.failures.push({listingURL:url,error:e.message});}
    await save();
  }
  console.log(JSON.stringify(report.counts)); return report;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const arg=n=>process.argv[process.argv.indexOf(n)+1];
  await acquire({target:process.argv.includes('--target')?Number(arg('--target')):8,formats:process.argv.includes('--formats')?arg('--formats').split(','):undefined});
}
