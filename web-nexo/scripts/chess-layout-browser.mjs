import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Chess} from 'chess.js';
import {initialGame,mobileFixture,chromium,webkit,devices} from './mobile-fixture.mjs';
const output=fileURLToPath(new URL('../docs/chess-layout/',import.meta.url));
const reports=[],overlap=(a,b)=>a.x<b.right-.5&&a.right>b.x+.5&&a.y<b.bottom-.5&&a.bottom>b.y+.5;
export function historyGame(count){
 const board=new Chess(),moves=[],opening=['e4','e5','Nf3','Nc6','Bc4','Nf6','d3','Bc5','O-O','d6','c3','O-O'];
 for(let i=0;i<count;i++){
  let move;
  if(i<opening.length)move=board.move(opening[i]);else{
   const options=board.moves({verbose:true});for(let n=0;n<options.length;n++){const candidate=options[(i*17+n)%options.length];board.move(candidate);const ended=board.isGameOver();board.undo();if(!ended){move=board.move(candidate);break}}assert.ok(move,'Legal nonterminal fixture move');
  }
  moves.push({san:move.san,uci:move.from+move.to+(move.promotion||''),by:i%2?'owner':'player',ts:new Date(Date.UTC(2026,9,8,12,0,i)).toISOString()});
 }
 return {...initialGame,fen:board.fen(),moves,updated_at:new Date(Date.UTC(2026,9,8,12,1,count)).toISOString()};
}
export async function activateChat(page){
 const r=await page.locator('#floating-live-chat').boundingBox(),point={x:r.x+r.width/2,y:r.y+r.height/2};assert.ok(await page.evaluate(p=>document.querySelector('#floating-live-chat').contains(document.elementFromPoint(p.x,p.y)),point),'The sole node receives an ordinary click');await page.mouse.click(point.x,point.y);
}
export const readyChat=(page,which='live')=>page.waitForFunction(which=>{const p=document.querySelector(which==='live'?'#live-panel':'#companion-panel');return !p.hidden&&!p.dataset.chatMorph&&p.style.pointerEvents!=='none'},which);
export async function geometry(page,width){
 const result=await page.evaluate(()=>{
  const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON(),rail=document.querySelector('.chess-aside');
  const overflow=[...document.querySelectorAll('.chess-scene *,.chess-chat-controls,#live-panel *,#companion-panel *')].filter(e=>e instanceof HTMLElement&&e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]')&&!e.classList.contains('sr-only')&&e.scrollWidth>e.clientWidth+1).map(e=>({class:e.className,text:e.textContent.slice(0,40),scroll:e.scrollWidth,client:e.clientWidth}));
  return {board:rect('.chess-board'),left:rect('.chess-left-column'),system:rect('#system-window'),rail:rect('.chess-aside'),controls:[...rail.querySelectorAll('.chess-actions button')].filter(e=>!e.hidden).map(e=>e.getBoundingClientRect().toJSON()),overflow,moveCount:Number(document.querySelector('.chess-move-count').textContent),last:document.querySelector('.chess-moves .is-last')?.textContent,history:rect('.chess-history-scroll'),railRegions:['.chess-status','.chess-history','.chess-actions','.chess-session-line'].map(rect)};
 });
 const regions=width>900?[result.board,result.left,result.system,result.rail]:[result.board,result.system,result.rail];
 for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++)assert.equal(overlap(regions[i],regions[j]),false,'Overlapping regions '+i+'/'+j+' '+JSON.stringify(result));
 assert.deepEqual(result.overflow,[]);
 if(width>900){for(const r of result.railRegions)assert.ok(r.top>=result.rail.top-.5&&r.bottom<=result.rail.bottom+.5,'Internal rail region is contained');for(let i=0;i<result.railRegions.length;i++)for(let j=i+1;j<result.railRegions.length;j++)assert.equal(overlap(result.railRegions[i],result.railRegions[j]),false,'Status, history, controls and session never overlap');const history=result.railRegions[1];assert.ok(result.history.top>=history.top-.5&&result.history.bottom<=history.bottom+.5,'Scroll area fits in its history region')}
 for(const r of result.controls)assert.ok(r.left>=result.rail.left-.5&&r.right<=result.rail.right+.5&&r.top>=result.rail.top-.5&&r.bottom<=result.rail.bottom+.5,'Every control fits entirely in its rail');
 assert.equal(await page.getByRole('button',{name:'Chat',exact:true}).count(),0);assert.equal(await page.locator('#floating-live-chat').count(),1);
 if(width<=900)for(const selector of ['#floating-live-chat','#live-panel','#companion-panel','.chess-chat-controls'])assert.equal(await page.locator(selector).isVisible(),false,'No mobile game chat '+selector);
 return result;
}
export const stableBoard=(actual,before)=>{for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-before[key])<.5,'Board stays fixed: '+key)};
if(process.argv[1]===fileURLToPath(import.meta.url)){
 await mkdir(output,{recursive:true});
 for(const [engine,provider]of [['chromium',chromium],['webkit',webkit]]){const browser=await provider.launch();try{
  for(const [width,height]of [[1920,1080],[1440,900],[1280,720],[1024,768],[390,844]]){
   if(process.env.LAYOUT_WIDTH&&width!==Number(process.env.LAYOUT_WIDTH))continue;
   const f=await mobileFixture(browser,{...(width===390?devices['iPhone 13']:{}),viewport:{width,height},hasTouch:true},width===1024?'en':'es'),p=f.page;
   try{
    await f.chess();const board=await p.locator('.chess-board').boundingBox();
    for(const count of [0,12,80]){
     if(count){f.send('chess.move',1,{game:historyGame(count)},'layout-update-'+count);await p.waitForFunction(n=>Number(document.querySelector('.chess-move-count').textContent)===n,count);await p.waitForFunction(()=>!document.querySelector('.chess-board').inert);}
     for(const state of width>900?['closed','live','agent']:['closed']){
      if(state==='live'){await activateChat(p);await readyChat(p,count?'agent':'live');if(count){await p.locator('.chess-chat-controls button').nth(1).click();await readyChat(p)}}
      if(state==='agent'){await p.locator('.chess-chat-controls button').first().click();await readyChat(p,'agent')}
      const m=await geometry(p,width);stableBoard(m.board,board);assert.equal(m.moveCount,count);if(count)assert.ok(m.last,'Last remote move is highlighted');reports.push({engine,width,height,count,state,...m});
     }
     if(width>900){await p.keyboard.press('Escape');await p.locator('#companion-panel').waitFor({state:'hidden'});assert.equal(await p.locator('#floating-live-chat').evaluate(e=>e===document.activeElement),true)}
     f.send('run.start',1,{kind:'live_in',content_version:3},'layout-incoming-'+count);f.send('live.message',2,{conversation_id:'mobile',message:{id:'layout-reply-'+count,from:'owner',text:'A reply while the chat is closed',ts:new Date().toISOString()}},'layout-incoming-'+count);f.send('run.done',3,{outcome:'received',duration_ms:1},'layout-incoming-'+count);await p.locator('.chess-return-unread:not([hidden])').waitFor();stableBoard((await geometry(p,width)).board,board);
    }
    if(width>900){await activateChat(p);await readyChat(p,'agent');await p.locator('#nexo-input').fill('Create a node');await p.locator('.panel-compose>div>button').first().click();f.send('run.start',1,{kind:'chat',content_version:3},'mobile-chat');f.send('node.spawn',2,{anchor:null,node:{id:'gen_layout',generated:true,label:'Layout node',summary:'Fixture',created_at:new Date().toISOString(),sources:[{title:'Portfolio'}],layout:'text',content:{body:'Answer'}}},'mobile-chat');f.send('answer.chunk',3,{text:'A new node, without moving the current game.'},'mobile-chat');f.send('run.done',4,{outcome:'generated',duration_ms:1},'mobile-chat');await p.waitForFunction(()=>document.querySelector('.generated-camera-controls').textContent.includes('Layout node'));stableBoard((await geometry(p,width)).board,board);await p.keyboard.press('Escape');await p.locator('#companion-panel').waitFor({state:'hidden'})}
    await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.body.classList.contains('is-chess'));assert.ok(Number(await p.locator('#floating-live-chat').getAttribute('data-unread'))>0);assert.deepEqual(f.errors,[]);console.log(engine+' '+width+'x'+height+' — 0/12/80 moves, tabs, unread, generated notice and geometry OK');
   }catch(error){console.error({engine,width,height,errors:f.errors});throw error}finally{await f.context.close()}
  }
 }finally{await browser.close()}}
 await writeFile(output+'E-geometry.json',JSON.stringify(reports,null,2)+'\n');
}
