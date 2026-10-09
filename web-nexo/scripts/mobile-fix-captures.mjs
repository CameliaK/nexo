import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium,devices,mobileFixture} from './mobile-fixture.mjs';
const output=fileURLToPath(new URL('../docs/mobile/fix/',import.meta.url));
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
try{
 const chatOnly=process.argv.includes('--chat-only');
 for(const [name,options]of (chatOnly?[['390x844',devices['iPhone 13']]]:[['390x844',devices['iPhone 13']],['desktop',{viewport:{width:1366,height:768}}]])){
  const f=await mobileFixture(browser,options),{page}=f;
  const shot=view=>page.screenshot({path:`${output}/${name}-${view}.png`,scale:'css'});
  if(!chatOnly)await shot('universe');const b=await page.locator('#floating-chess').boundingBox();
  if(options.hasTouch)await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);else await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
  await page.locator('.chess-scene.is-ready').waitFor();await page.waitForTimeout(300);if(!chatOnly)await shot('unfolding');
  await page.waitForFunction(()=>document.querySelector('.chess-scene').dataset.transition==='resting');if(!chatOnly)await shot('chess');
  if(options.hasTouch){
   await page.locator('.system-enter').tap();await page.waitForTimeout(120);if(!chatOnly)await shot('system');await page.locator('.mobile-system-header button').tap();
   await page.locator('.chess-close').tap();await page.locator('.chess-scene').waitFor({state:'hidden'});await page.locator('#floating-live-chat').press('Enter');await page.waitForTimeout(120);await shot('chat');
  }
  assert.deepEqual(f.errors,[]);await f.context.close();
 }
}finally{await browser.close()}
console.log('Final captures saved: 390x844 and desktop only');
