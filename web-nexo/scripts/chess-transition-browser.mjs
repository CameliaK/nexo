import assert from 'node:assert/strict';
import {chromium,devices,mobileFixture} from './mobile-fixture.mjs';
async function input(page,selector,touch){const box=await page.locator(selector).boundingBox();assert.ok(box);const x=box.x+box.width/2,y=box.y+box.height/2;if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y)}
const browser=await chromium.launch();
try{
 for(const [name,options,reduced]of [['desktop',{viewport:{width:1366,height:768}},false],['iPhone',devices['iPhone 13'],false],['reduced',{...devices['iPhone 13'],reducedMotion:'reduce'},true]]){
  const f=await mobileFixture(browser,options),{page}=f;
  const identity=await page.locator('#system-window').evaluate(element=>{window.systemIdentity=element;return element.id});assert.equal(identity,'system-window');
  await input(page,'#floating-chess',!!options.hasTouch);await page.locator('.chess-scene.is-ready').waitFor();
  if(!reduced){
   await page.waitForTimeout(200);const reveal=await page.locator('.chess-scene').evaluate(el=>Number(el.style.getPropertyValue('--chess-reveal')));assert.ok(reveal<.15,'pieces do not pop into view');assert.equal(await page.locator('body').getAttribute('data-canvas-fps'),'60');
   const box=await page.locator('#system-window').boundingBox();assert.ok(box.width>0&&box.height>0,'same window remains visible during travel');
   await input(page,'.chess-close',!!options.hasTouch);await page.locator('.chess-scene').waitFor({state:'hidden'});assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('is-chess-transitioning')),false);
   await input(page,'#floating-chess',!!options.hasTouch);await page.waitForFunction(()=>document.querySelector('.chess-scene').dataset.transition==='resting');
  }else await page.waitForTimeout(200);
  assert.equal(await page.locator('#system-window').evaluate(el=>el===window.systemIdentity),true);
  await page.evaluate(()=>window.transitionCells=[...document.querySelectorAll('.chess-square')]);
  await input(page,'.chess-close',!!options.hasTouch);await page.locator('.chess-scene').waitFor({state:'hidden'});
  assert.equal(await page.locator('.chess-square').count(),64);assert.equal(await page.evaluate(()=>window.transitionCells.every(el=>document.contains(el))),true);
  assert.deepEqual(f.errors,[]);console.log(`Chess reversible entry OK: ${name}`);await f.context.close();
 }
}finally{await browser.close()}
