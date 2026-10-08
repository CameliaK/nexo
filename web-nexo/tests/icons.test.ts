import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {icon} from '../src/icons';
const glyph=/[\p{Extended_Pictographic}\u2190-\u21ff\u2300-\u23ff\u25a0-\u27ff\u2b00-\u2bff\u00d7\u2212]/gu;
function violations(text:string){return [...text.matchAll(glyph)].filter(match=>!text.slice(match.index!+match[0].length).startsWith('\uFE0E')&&!text.slice(match.index!+match[0].length).startsWith('\\uFE0E')).map(match=>match[0])}
function files(path:string):string[]{return readdirSync(path,{withFileTypes:true}).flatMap(item=>item.name==='data'?[]:item.isDirectory()?files(join(path,item.name)):/\.(ts|js|css)$/.test(item.name)?[join(path,item.name)]:[])}
test('Interface source never uses emoji-presentable characters as icons; semantic symbols opt into text',()=>{
 for(const file of [...files('src'),'index.html','privacidad/index.html']){
  const source=readFileSync(file,'utf8').replace(/<svg\b[\s\S]*?<\/svg>/g,'');
  assert.deepEqual(violations(source),[],file);
 }
 assert.deepEqual(violations('Go \u2192\uFE0E next'),[]);assert.deepEqual(violations('\u2197'),['\u2197']);
});
test('Action icons are decorative, consistent 24px inline SVGs with rounded 1.75px strokes',()=>{
 for(const name of ['close','back','next','external','chat','send','person','flip','restart','flag','pause','play','minus','plus','expand','home','history'] as const){
  const svg=icon(name);assert.match(svg,/viewBox="0 0 24 24"/);assert.match(svg,/stroke-width="1.75"/);assert.match(svg,/stroke="currentColor"/);assert.match(svg,/aria-hidden="true"/);assert.match(svg,/stroke-linecap="round"/);assert.deepEqual(violations(svg),[]);
 }
});
