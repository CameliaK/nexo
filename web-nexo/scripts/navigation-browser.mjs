import assert from 'node:assert/strict';
import { chromium, devices, mobileFixture } from './mobile-fixture.mjs';

const browser = await chromium.launch();
const cases = [['desktop', {viewport:{width:1366,height:768}}], ['iPhone 13', devices['iPhone 13']], ['Pixel 7', devices['Pixel 7']]];
async function activate(page, selector, touch) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} has a hit area`);
  const x=box.x+box.width/2,y=box.y+box.height/2;
  assert.ok(await page.evaluate(({selector,x,y})=>document.querySelector(selector)?.contains(document.elementFromPoint(x,y)),{selector,x,y}), `${selector} receives a normal input`);
  if(touch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
}
async function visit(page,id,touch) {
  await activate(page,`[data-node="${id}"]`,touch);
  await page.waitForFunction(()=>document.querySelector('#depth-number').textContent==='01'&&!document.body.classList.contains('is-traveling'));
  await activate(page,'#back',touch);
  await page.waitForFunction(()=>document.querySelector('#depth-number').textContent==='00'&&!document.body.classList.contains('is-traveling'));
}
async function pinch(page) {
  const cdp=await page.context().newCDPSession(page);
  const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2}))});
  await send('touchStart',[[1,8,330],[2,70,330]]);
  for(let i=1;i<=8;i++){await send('touchMove',[[1,8,330],[2,70+i*3,330]]);await page.waitForTimeout(17)}
  await send('touchEnd',[]);await cdp.detach();
}
try {
  for(const [name,options]of cases){
    const f=await mobileFixture(browser,options),{page}=f,touch=!!options.hasTouch;
    const ids=await page.locator('#node-targets .node-target').evaluateAll(nodes=>nodes.map(n=>n.dataset.node));
    for(const id of ids)await visit(page,id,touch);
    if(touch){
      const zoom=await page.locator('#zoom-label').textContent();await pinch(page);assert.notEqual(await page.locator('#zoom-label').textContent(),zoom);
    }else{await page.mouse.move(12,330);await page.mouse.wheel(0,-180);await page.waitForTimeout(300)}
    await visit(page,ids[0],touch);
    if(touch){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.synthesizeScrollGesture',{x:8,y:320,yDistance:-30,gestureSourceType:'touch',speed:250});await cdp.detach()}
    else{await page.mouse.move(8,320);await page.mouse.down();await page.mouse.move(28,340,{steps:5});await page.mouse.up()}
    await visit(page,ids[0],touch);
    await activate(page,'#zoom-out',touch);await page.waitForTimeout(300);await visit(page,ids[0],touch);
    const r=await page.locator(`[data-node="${ids[0]}"]`).boundingBox();
    if(touch){await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2)}else await page.mouse.dblclick(r.x+r.width/2,r.y+r.height/2);
    await page.waitForFunction(()=>document.querySelector('#depth-number').textContent==='01'&&!document.body.classList.contains('is-traveling'));
    await activate(page,'#back',touch);await page.waitForFunction(()=>document.querySelector('#depth-number').textContent==='00'&&!document.body.classList.contains('is-traveling'));
    assert.deepEqual(f.errors,[]);console.log(`Positive node navigation OK: ${name}, ${ids.length} root nodes + gestures + double input`);await f.context.close();
  }
} finally {await browser.close()}
