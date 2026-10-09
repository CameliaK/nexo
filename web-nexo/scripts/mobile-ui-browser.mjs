import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,webkit,devices,mobileFixture} from './mobile-fixture.mjs';
const output=fileURLToPath(new URL(process.env.UI_QA_OUTPUT||'../docs/mobile/ui/',import.meta.url)),capture=process.env.QA_CAPTURE==='1',reports=[];
await mkdir(output,{recursive:true});
const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
async function snapshot(page,name,width,engine){if(capture&&engine==='webkit'&&(width===390||width===360))await page.screenshot({path:`${output}/after-${name}-${width}.png`,scale:'css'})}
async function aperture(page){
 const failures=await page.locator('#system-window').evaluate(root=>[root,...root.querySelectorAll('*')].filter(e=>!e.classList.contains('sr-only')&&getComputedStyle(e).display!=='none').flatMap(e=>{const s=getComputedStyle(e);return parseFloat(s.borderTopWidth)||parseFloat(s.borderRightWidth)||parseFloat(s.borderBottomWidth)||parseFloat(s.borderLeftWidth)||!['rgba(0, 0, 0, 0)','transparent'].includes(s.backgroundColor)||s.backgroundImage!=='none'?[e.className]:[]}));
 assert.deepEqual(failures,[],'Every distant-system element is frameless');
}
async function emoji(page){
 const bad=await page.evaluate(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),bad=[];let n;while(n=walker.nextNode()){const el=n.parentElement;if(el.closest('svg,script,style,[hidden]')||getComputedStyle(el).display==='none'||getComputedStyle(el).visibility==='hidden')continue;for(const match of n.textContent.matchAll(/[\p{Extended_Pictographic}\u2190-\u21ff\u2300-\u23ff\u25a0-\u27ff\u2b00-\u2bff\u00d7\u2212]/gu))if(n.textContent[match.index+match[0].length]!=='\uFE0E')bad.push(match[0]+' '+el.className)}return bad});assert.deepEqual(bad,[],'Rendered UI has no emoji-presentable glyphs');
 const badIcons=await page.locator('.ui-icon').evaluateAll(icons=>icons.filter(e=>e.getAttribute('viewBox')!=='0 0 24 24'||getComputedStyle(e).strokeWidth!=='1.75px').map(e=>e.outerHTML));assert.deepEqual(badIcons,[]);
}
async function normalTap(page,selector){
 await page.waitForFunction(selector=>{const el=document.querySelector(selector);if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))},selector,{timeout:3000}).catch(async error=>{console.error(selector,await page.evaluate(selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return {body:document.body.className,inert:e?.inert,r:r?.toJSON(),hit:r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML:null}},selector));throw error});
 // Wait for the renderer to position a just-expanded sheet; world nodes keep drifting.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const r=await page.locator(selector).boundingBox();assert.ok(r&&r.width>0);const point={x:r.x+r.width/2,y:r.y+r.height/2};assert.ok(await page.evaluate(({selector,x,y})=>document.querySelector(selector)?.contains(document.elementFromPoint(x,y)),{selector,...point}),selector+' receives a normal tap: '+JSON.stringify(await page.evaluate(({x,y})=>({hit:document.elementFromPoint(x,y)?.outerHTML,body:document.body.className}),point)));await page.touchscreen.tap(point.x,point.y);
}
async function root(page,width,height){
 await aperture(page);await emoji(page);
 const caption=await page.locator('.floating-chess-caption').boundingBox(),node=await page.locator('#floating-chess').boundingBox();
 assert.ok(caption.y+caption.height<=height-72&&caption.x>=0&&caption.x+caption.width<=width,'Full chess caption is above the Safari reserve');
 assert.ok(await page.locator('.floating-chess-caption small').isVisible());
 for(const selector of ['footer .scene-info','footer .privacy-footer','footer .tools','.language-node','.welcome-help','.account-node','footer .instruction']){
  if(!await page.locator(selector).isVisible())continue;
  // Wait for the renderer to position a just-expanded sheet; world nodes keep drifting.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const r=await page.locator(selector).boundingBox();assert.ok(r.y+r.height<=height-72+.1,selector+' respects bottom reserve');assert.equal(intersects(caption,r)||intersects(node,r),false,'Chess clears '+selector);
 }
 const truncated=await page.evaluate(()=>[...document.querySelectorAll('.node-name,.node-meta,footer .eyebrow,footer .scene-count,footer .privacy-footer,.floating-chess-caption')].flatMap(el=>{if(!el.getBoundingClientRect().width)return[];const range=document.createRange();range.selectNodeContents(el);return [...range.getClientRects()].some(r=>r.left<-.5||r.right>innerWidth+.5)?[el.textContent]:[]}));assert.deepEqual(truncated,[],'Root text stays within the viewport');
}
try{
 for(const [engine,provider,device,cases]of [['chromium',chromium,'Pixel 7',[[393,851,'es'],[851,393,'en'],[360,640,'en']]],['webkit',webkit,'iPhone 13',[[390,844,'es'],[844,390,'en'],[360,640,'es']]]]){
  const browser=await provider.launch();try{for(const [width,height,lang]of cases.filter(c=>!process.env.UI_CASE||c[0]===Number(process.env.UI_CASE))){
   const f=await mobileFixture(browser,{...devices[device],viewport:{width,height}},lang),p=f.page;
   await root(p,width,height);await snapshot(p,'universe',width,engine);await normalTap(p,'.language-node');assert.equal(await p.locator('html').getAttribute('lang'),lang==='es'?'en':'es');await root(p,width,height);await normalTap(p,'.language-node');
   // A single action; modal keyboard close and restore still work.
   await normalTap(p,'.welcome-help');assert.equal(await p.locator('#welcome-dialog button').count(),1);await emoji(p);await p.keyboard.press('Escape');assert.equal(await p.locator('.welcome-help').evaluate(e=>e===document.activeElement),true);
   await normalTap(p,'.welcome-help');await p.keyboard.press('Enter');assert.equal(await p.locator('#welcome-dialog').isVisible(),false);
   const ids=await p.locator('#node-targets .node-target').evaluateAll(ns=>ns.map(n=>n.dataset.node));
   for(const id of ids){await normalTap(p,`[data-node="${id}"]`);await p.waitForFunction(()=>document.querySelector('#depth-number').textContent==='01'&&!document.body.classList.contains('is-traveling'));const back=await p.locator('#back').boundingBox();assert.ok(back.width>=44&&back.height>=44);await normalTap(p,'#back');await p.waitForFunction(()=>document.querySelector('#depth-number').textContent==='00'&&!document.body.classList.contains('is-traveling'))}
   await f.chess();await aperture(p);await emoji(p);
   const heading=await p.locator('.chess-heading').boundingBox();assert.equal(await p.locator('#floating-live-chat').isVisible(),false);assert.equal(await p.locator('.chess-heading h2').evaluate(e=>e.scrollHeight<=44&&e.scrollWidth<=e.clientWidth),true,'Full game title wraps within the header');const close=await p.locator('.chess-close').boundingBox();assert.ok(close.width===44&&close.height===44);
   const board=await p.locator('.chess-board').boundingBox(),rail=await p.locator('.chess-aside').boundingBox();assert.ok(rail.y+rail.height<=height-(width<height?72:32)+1);
   if(width<height)assert.ok(Math.abs(board.width-(width-12))<1,'Portrait board retains its original size');
   const actions=await p.locator('.chess-actions button').evaluateAll(ns=>ns.map(e=>{const s=getComputedStyle(e);return {border:s.borderTopWidth,background:s.backgroundColor,r:e.getBoundingClientRect().toJSON()}}));for(const a of actions){assert.equal(a.border,'0px');assert.equal(a.background,'rgba(0, 0, 0, 0)');assert.ok(a.r.y+a.r.height<=height-(width<height?72:32)+1)}
   await p.locator('[data-square=e2]').tap();await p.locator('[data-square=e4]').tap();await p.waitForFunction(()=>document.querySelector('.chess-move-strip .is-last')?.textContent==='1. e4');
   await p.waitForFunction(()=>!document.querySelector('.chess-board').inert&&!document.querySelector('.chess-resign').disabled);await snapshot(p,'chess',width,engine);await normalTap(p,'.chess-moves-open');assert.ok((await p.locator('.history-sheet-list').textContent()).includes('e4'));await normalTap(p,'.history-sheet-close');
   await p.locator('.chess-resign').tap();assert.equal(await p.locator('.chess-popover').isVisible(),true);assert.equal(f.requests.some(r=>r.path.endsWith('/resign')),false);await p.locator('.chess-popover-cancel').tap();
   f.send('run.start',1,{kind:'chess',content_version:3});f.send('trace.hop',2,{hop_id:'ui-hop',from:'gateway',to:'postgres',phase:'start',label:'UI hop'});await p.waitForFunction(()=>document.querySelector('#system-window').dataset.active==='true');await aperture(p);
   assert.equal(await p.locator('.mobile-system-header').count(),0);
   f.send('trace.hop',3,{hop_id:'ui-hop',from:'gateway',to:'postgres',phase:'end',label:'UI hop'});f.send('run.done',4,{outcome:'accepted',duration_ms:200});
   f.send('run.start',1,{kind:'live_in',content_version:3},'ui-incoming');f.send('live.message',2,{message:{id:'owner-msg',from:'owner',text:lang==='es'?'Hola, gracias por visitar mi universo.':'Hi, thanks for visiting my universe.',ts:new Date().toISOString()}},'ui-incoming');f.send('run.done',3,{outcome:'accepted',duration_ms:10},'ui-incoming');
   await p.locator('.chess-return-unread:not([hidden])').waitFor();assert.equal(await p.locator('#live-panel').isVisible(),false);await normalTap(p,'.system-enter');await p.waitForFunction(()=>document.body.classList.contains('system-scene')&&!document.body.classList.contains('is-chess')&&!document.body.classList.contains('is-traveling'));await normalTap(p,'#back');await p.waitForFunction(()=>!document.body.classList.contains('system-scene')&&!document.body.classList.contains('is-traveling'));assert.equal(await p.locator('#floating-live-chat').getAttribute('data-unread'),'1');
   if(engine==='webkit'&&width===390){await p.route('**/api/v1/auth/me',r=>r.fulfill({json:{mode:'owner',email_hint:'k***@example.com'}}));await p.route('**/api/v1/owner/chess/games',r=>r.fulfill({json:{games:[]}}));await p.reload();await p.locator('.is-owner-panel').waitFor();const owner=await p.locator('.is-owner-panel .node-label').boundingBox();assert.ok(owner.y+owner.height<=height-72,'Owner caption remains visible');await normalTap(p,'.is-owner-panel');await p.waitForFunction(()=>document.querySelector('#depth-number').textContent==='01'&&!document.body.classList.contains('is-traveling'));assert.equal(await p.locator('.node-target').count(),1,'Owner empty state opens')}
   assert.deepEqual(f.errors,[]);reports.push({engine,device,width,height,lang,rootNodesTapped:ids.length,board,rail,chat:null,passed:true});console.log(`${engine} UI OK ${width}x${height} ${lang}`);await f.context.close();
  }}finally{await browser.close()}
 }
 await writeFile(output+'/ui-results.json',JSON.stringify({production:true,reports},null,2)+'\n');
}finally{/* Every browser closes on failures too. */}
