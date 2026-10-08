import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {webkit,devices,mobileFixture,origin} from './mobile-fixture.mjs';
const browser=await webkit.launch({headless:true}),reports=[];
try{
 for(const [width,height,lang] of [[390,844,'es'],[844,390,'en'],[360,640,'en']]){
  const f=await mobileFixture(browser,{...devices['iPhone 13'],viewport:{width,height}},lang),p=f.page;
  const initial=await p.evaluate(()=>visualViewport.scale);await p.touchscreen.tap(5,Math.min(300,height*.5));await p.touchscreen.tap(5,Math.min(300,height*.5));assert.equal(await p.evaluate(()=>visualViewport.scale),initial);
  // WebKit's automation protocol lacks multi-touch injection. Exercise real Pointer
  // Events here; Chromium's companion suite injects native two-finger touch via CDP.
  const start=await p.locator('#zoom-label').innerText();
  await p.evaluate(async()=>{const canvas=document.querySelector('#space');const event=(type,id,x)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,clientX:x,clientY:260}));event('pointerdown',1,12);event('pointerdown',2,100);event('pointermove',2,150);await new Promise(requestAnimationFrame);event('pointerup',2,150);event('pointerup',1,12)});
  assert.notEqual(await p.locator('#zoom-label').innerText(),start);assert.equal(await p.locator('#depth-number').innerText(),'00');await p.locator('#reset').tap();await p.waitForTimeout(500);
  await p.locator('.account-node').tap();const account=p.locator('.account-glass');await account.waitFor({state:'visible'});let r=await account.boundingBox();assert.ok(r.y>=0&&r.x>=0&&r.x+r.width<=width+1&&r.y+r.height<=height+1);await p.locator('.account-overlay .access-close').tap();
  await p.locator('.welcome-help').tap();const welcome=p.locator('.welcome-card');await welcome.waitFor({state:'visible'});r=await welcome.boundingBox();assert.ok(r.y>=0&&r.y+r.height<=height+1);await p.locator('.welcome-enter').tap();
  await p.locator('#floating-chess').press('Enter');await p.locator('.chess-scene.is-ready').waitFor();await p.waitForFunction(()=>document.querySelector('.chess-scene')?.dataset.transition==='resting');
  assert.equal(await p.locator('main').evaluate(e=>e.inert),true);const mini=await p.locator('#system-window').boundingBox(),board=await p.locator('.chess-board').boundingBox();assert.ok(width>height?mini.x+mini.width<=board.x:mini.y+mini.height<=board.y);
  await p.locator('.system-enter').tap();await p.locator('.mobile-system-header button').tap();assert.equal(await p.locator('.chess-scene').isVisible(),true);
  await p.locator('.mobile-chess-chat-toggle').tap();await p.locator('#live-panel textarea').fill('Safari message');assert.ok(await p.locator('#live-panel textarea').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));await Promise.all([p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/live/messages'&&r.request().method()==='POST'),p.locator('#live-panel .chat-send').tap()]);assert.ok(f.requests.some(r=>r.body?.text==='Safari message'));assert.equal(await p.locator('.chess-scene').isVisible(),true);
  await p.locator('.chess-close').tap();await p.locator('.chess-scene').waitFor({state:'hidden'});assert.equal(await p.locator('#live-panel').isVisible(),false,'closing the game also dismisses its docked chat');
  await p.goto(origin+'/privacidad');await p.locator('#privacy-content h1').waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok((await p.locator('#privacy-content').innerText()).includes(lang==='es'?'contacto@kirbith.dev':'contacto@kirbith.dev'));
  assert.deepEqual(f.errors,[]);reports.push({width,height,lang,passed:true});console.log(`WebKit mobile QA OK: ${width}x${height} ${lang}`);await f.context.close();
 }
 await writeFile(fileURLToPath(new URL('../docs/mobile/fix/webkit-results.json',import.meta.url)),JSON.stringify({engine:'WebKit 26.6',reports},null,2)+'\n');
}finally{await browser.close()}
