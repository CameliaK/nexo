import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {mobileFixture,chromium,webkit,devices} from './mobile-fixture.mjs';
import {historyGame} from './chess-layout-browser.mjs';
const output=fileURLToPath(new URL('../docs/chess-follow/',import.meta.url)),reports=[];await mkdir(output,{recursive:true});
const center=async p=>{const r=await p.locator('#companion-target').boundingBox();return{x:r.x+r.width/2,y:r.y+r.height/2}};
async function hold(p,touch,engine){
 const point=await center(p);assert.ok(await p.evaluate(pt=>document.querySelector('#companion-target').contains(document.elementFromPoint(pt.x,pt.y)),point),'Nexo receives input: '+JSON.stringify(await p.evaluate(pt=>({hit:document.elementFromPoint(pt.x,pt.y)?.outerHTML,pt}),point)));
 if(!touch){await p.mouse.move(point.x,point.y);await p.mouse.down();await p.waitForTimeout(600);await p.mouse.up()}
 else if(engine==='chromium'){const c=await p.context().newCDPSession(p);await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await p.waitForTimeout(600);await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await c.detach()}
 else {await p.locator('#companion-target').evaluate((el,pt)=>el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:42,isPrimary:true,pointerType:'touch',button:0,clientX:pt.x,clientY:pt.y})),point);await p.waitForTimeout(600);await p.locator('#companion-target').evaluate((el,pt)=>{el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:42,pointerType:'touch',clientX:pt.x,clientY:pt.y}));el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}))},point)}
 await p.waitForTimeout(750);
}
for(const [engine,provider]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await provider.launch();try{for(const mobile of [false,true]){
  const f=await mobileFixture(browser,{...(mobile?devices['iPhone 13']:{}),viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:true},'es',historyGame(80)),p=f.page;
  try{
   if(!mobile){await p.mouse.move(600,350);await p.waitForTimeout(1200);const c=await center(p);assert.ok(Math.hypot(c.x-648,c.y-398)<5,'Nexo follows without a free-zone jump');const r=await p.locator('.node-target').first().boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.waitForTimeout(1200);const c2=await center(p);assert.ok(Math.hypot(c2.x-(r.x+r.width/2+48),c2.y-(r.y+r.height/2+48))<7,'Following continues near node hit areas');}
   if(!mobile)await p.mouse.move(700,200);else await p.touchscreen.tap(50,260);await p.waitForTimeout(1200)
   await hold(p,mobile,engine);assert.equal(await p.locator('#companion-target').getAttribute('data-pinned'),'true');assert.equal(await p.locator('#companion-panel').isVisible(),false,'Hold never opens assistant');const dock=await center(p);await p.mouse.move(100,200);await p.waitForTimeout(350);const kept=await center(p);assert.ok(Math.hypot(kept.x-dock.x,kept.y-dock.y)<1);
   await hold(p,mobile,engine);assert.equal(await p.locator('#companion-target').getAttribute('data-pinned'),'false');assert.equal(await p.locator('#companion-panel').isVisible(),false);
   await p.locator('#companion-target').focus();await p.keyboard.press('p');await p.waitForTimeout(700);assert.equal(await p.locator('#companion-target').getAttribute('data-pinned'),'true');await p.keyboard.press('p');await p.waitForTimeout(700);
   await f.chess();
   if(mobile){assert.equal(await p.locator('#floating-live-chat').isVisible(),false);await p.locator('.system-enter').tap();await p.waitForFunction(()=>document.body.classList.contains('system-scene')&&!document.body.classList.contains('is-chess')&&!document.body.classList.contains('is-traveling'));assert.equal(await p.locator('.mobile-system-header').count(),0);assert.equal(await p.locator('body.mobile-system-expanded').count(),0)}
   else{
    for(const [width,height]of [[1440,900],[1280,720],[1280,592],[1024,592],[1024,480]]){
     await p.setViewportSize({width,height});await p.waitForTimeout(200);
     const measured=await p.evaluate(()=>{const rail=document.querySelector('.chess-aside'),history=document.querySelector('.chess-history-scroll');return{rail:rail.getBoundingClientRect().toJSON(),history:history.getBoundingClientRect().toJSON(),h:innerHeight}});assert.ok(measured.rail.bottom<=height+1);assert.ok(measured.history.height>=20,'History remains visible at '+height);
     await p.locator('.chess-resign').scrollIntoViewIfNeeded();const r=await p.locator('.chess-resign').boundingBox();assert.ok(r.y+r.height<=measured.rail.bottom+1,'Resign is reachable by scrolling');await p.locator('.chess-aside').evaluate(e=>e.scrollTop=0);
     if(width===1280&&height===592){await p.locator('#floating-live-chat').click();await p.waitForFunction(()=>!document.querySelector('#live-panel').dataset.chatMorph);assert.equal(await p.locator('.chess-chat-controls button').count(),1);assert.equal(await p.locator('.chess-chat-controls').textContent(),'Chat con Kirbith');assert.equal(await p.locator('#companion-panel').isVisible(),false);await p.screenshot({path:output+engine+'-1280x592.png',scale:'css'});await p.keyboard.press('Escape');await p.locator('#live-panel').waitFor({state:'hidden'})}
    }
   }
   assert.deepEqual(f.errors,[]);reports.push({engine,mobile,passed:true,hold:mobile&&engine==='webkit'?'DOM PointerEvent timing; native taps for navigation':'native input'});console.log(engine+' '+(mobile?'phone':'desktop')+' follow, pin, live-only chess and responsive rail/system journey OK');
  }catch(error){console.error({engine,mobile,errors:f.errors,body:await p.locator('body').getAttribute('class')});throw error}finally{await f.context.close()}
 }}finally{await browser.close()}
}
await writeFile(output+'results.json',JSON.stringify(reports,null,2)+'\n');
