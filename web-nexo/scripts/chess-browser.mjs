import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const url=process.env.PERF_URL||'http://127.0.0.1:4175';
const output=process.env.CHESS_QA_OUTPUT||'docs';await mkdir(output,{recursive:true});
const game={id:'qa',color:'w',fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',moves:[],turn:'player',status:'active',updated_at:'2026-10-05T18:00:00Z'};
async function fixture(width,height,lang='en',cold=false){
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2});const page=await context.newPage(),errors=[],moves=[];page.on('pageerror',error=>errors.push(error.message));
 let releaseModule,releaseGame;const moduleGate=new Promise(resolve=>releaseModule=resolve),gameGate=new Promise(resolve=>releaseGame=resolve);
 await page.addInitScript(lang=>{localStorage.setItem('nexo.welcome.dismissed.v1','1');localStorage.setItem('nexo.auth.token','fixture');localStorage.setItem('nexo.language',lang)},lang);
 await page.routeWebSocket(/\/ws\?/,()=>{});
 await page.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;
   if(path==='/api/v1/ws-ticket')return route.fulfill({json:{ticket:crypto.randomUUID(),expires_in:30}});
  if(path==='/api/v1/auth/me')return route.fulfill({json:{mode:'user',email_hint:'k***@gmail.com'}});
  if(path==='/api/v1/chess/game/move'){const body=route.request().postDataJSON();moves.push(body.uci);return route.fulfill({json:{game:{...game,fen:'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',turn:'owner',moves:[{san:'e4',uci:'e2e4',by:'player',ts:'2026-10-05T18:01:00Z'}],updated_at:'2026-10-05T18:01:00Z'}}})}
  if(path==='/api/v1/chess/game'){if(cold)await gameGate;return route.fulfill({json:{game}})}
  if(path==='/api/v1/account/notifications')return route.fulfill({json:{chess_email:true}});
  if(path==='/api/v1/session/nodes')return route.fulfill({json:{nodes:[]}});
  if(path==='/api/v1/live/messages')return route.fulfill({json:{conversation_id:'qa',messages:[]}});
  if(cold&&path.endsWith('.js')){const response=await route.fetch();if((await response.text()).includes('chess-square'))await moduleGate;return route.fulfill({response})}
  return route.continue();
 });
 await page.goto(url);await page.waitForSelector('#floating-chess:not([hidden])');await page.waitForFunction(()=>{const node=document.querySelector('#floating-chess');return node.getAttribute('aria-label').includes(' · ')&&!node.classList.contains('is-locked')});
 return {page,context,errors,moves,releaseModule,releaseGame};
}
try{
 const f=await fixture(1366,768,'en',true),{page}=f;
 await page.locator('#floating-chess').focus();await page.locator('#floating-chess').click({force:true});
 await page.waitForSelector('.chess-loading:not([hidden])');assert.equal(await page.locator('.chess-scene').count(),0,'Cold lazy chunk is held; skeleton is already visible');
 f.releaseModule();await page.waitForSelector('.chess-scene.is-ready');assert.equal(await page.locator('.chess-scene').getAttribute('aria-busy'),'true','Panel opens before HTTP response');
 f.releaseGame();await page.waitForFunction(()=>document.querySelector('.chess-scene').getAttribute('aria-busy')==='false');
 await page.waitForTimeout(1200);await page.evaluate(()=>{window.qaCells=[...document.querySelectorAll('.chess-square')]});
 await page.locator('.chess-flip').click();assert.equal(await page.evaluate(()=>window.qaCells.every(cell=>[...document.querySelectorAll('.chess-square')].includes(cell))),true);
 const from=await page.locator('[data-square=e2]').boundingBox(),to=await page.locator('[data-square=e4]').boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:12});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('.chess-status-title').textContent.includes('Kirbith'));assert.deepEqual(f.moves,['e2e4'],'Dragging a piece still sends exactly one legal move');await page.waitForTimeout(500);
 await page.locator('.chess-close').click();await page.waitForSelector('.chess-scene',{state:'hidden'});assert.equal(await page.evaluate(()=>document.activeElement.id),'floating-chess');
 await page.locator('#floating-chess').click({force:true});assert.equal(await page.evaluate(()=>window.qaCells.every(cell=>[...document.querySelectorAll('.chess-square')].includes(cell))),true);assert.equal(await page.locator('.chess-square').count(),64);
 assert.deepEqual(f.errors,[]);await f.context.close();
 const reports=[];
 for(const [width,height] of [[1366,768],[1920,1080],[900,1000],[390,844],[375,667],[320,568],[844,390]]){
  for(const lang of ['es','en']){
   const f=await fixture(width,height,lang);await f.page.locator('#floating-chess').press('Enter');await f.page.waitForSelector('.chess-scene.is-ready');await f.page.waitForTimeout(1400);
   const result=await f.page.evaluate(()=>{
    const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
    const scene=document.querySelector('.chess-scene');return {board:rect(scene.querySelector('.chess-board')),players:[...scene.querySelectorAll('.chess-player')].map(player=>({avatar:player.querySelector('.chess-avatar').textContent,info:player.querySelector('.chess-player-info').textContent,rect:rect(player)})),aside:rect(scene.querySelector('.chess-aside')),minTouch:Math.min(...[...scene.querySelectorAll('.chess-square')].map(cell=>Math.min(cell.getBoundingClientRect().width,cell.getBoundingClientRect().height))),scroll:getComputedStyle(document.documentElement).overflowX!=='hidden'};
   });
   assert.ok(result.players.every(player=>['V','K'].includes(player.avatar)),'Only an initial goes in the polygon avatar');
   assert.equal(result.scroll,false,'No horizontal document overflow');
   if(width<650||height<600)assert.ok(result.minTouch>=44,'Every mobile grid hit target is at least 44px');
   assert.ok(result.players.every(p=>p.rect.y>=0&&p.rect.x>=0&&p.rect.x+p.rect.width<=width+1));
   assert.deepEqual(f.errors,[]);reports.push({width,height,lang,...result});
   if(lang==='en'&&[390,1366,844].includes(width))await f.page.screenshot({path:`${output}/performance-layout-${width}.png`,scale:'css'});
   await f.context.close();
  }
 }
 const report=JSON.stringify({passed:true,viewports:reports},null,2);await writeFile(`${output}/performance-layouts.json`,report+'\n');console.log('Browser QA passed: '+reports.length+' ES/EN viewport cases; cold module, delayed backend, focus and 64 persistent cells.');
}finally{await browser.close()}
