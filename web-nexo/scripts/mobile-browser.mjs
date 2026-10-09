import { fileURLToPath } from 'node:url';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium,devices,mobileFixture,origin } from './mobile-fixture.mjs';
const phase=process.argv[2]||'after',captures=process.env.QA_CAPTURE!=='0',output=fileURLToPath(new URL('../docs/mobile/ui/',import.meta.url));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const pixel=devices['Pixel 7'].viewport;
const cases=[['iPhone 13',390,844,'es'],['iPhone 13',844,390,'en'],['Pixel 7',pixel.width,pixel.height,'en'],['Pixel 7',pixel.height,pixel.width,'es'],['iPhone 13',360,640,'es']];
const reports=[];
async function touch(cdp,type,points){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2,force:1}))})}
async function pinch(page){
 const cdp=await page.context().newCDPSession(page),y=Math.min(320,(await page.evaluate(()=>innerHeight))*.5);
 await touch(cdp,'touchStart',[[1,12,y],[2,100,y]]);
 for(let i=1;i<=12;i++){await touch(cdp,'touchMove',[[1,12,y+i],[2,100+i*5,y+i]]);await page.waitForTimeout(17)}
 await touch(cdp,'touchEnd',[]);await cdp.detach();await page.waitForTimeout(100);
}
async function swipe(page,x,y,endY){
 const cdp=await page.context().newCDPSession(page);await touch(cdp,'touchStart',[[1,x,y]]);
 for(let i=1;i<=8;i++){await touch(cdp,'touchMove',[[1,x,y+(endY-y)*i/8]]);await page.waitForTimeout(17)}
 await touch(cdp,'touchEnd',[]);await cdp.detach();await page.waitForTimeout(100);
}
const rect=async(page,selector)=>page.locator(selector).boundingBox();
async function overflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal document overflow')}
try{
 for(const [device,width,height,lang] of cases.filter(row=>!process.env.MOBILE_CASE||row[1]===Number(process.env.MOBILE_CASE))){
  const f=await mobileFixture(browser,{...devices[device],viewport:{width,height}},lang),{page}=f;
  if(phase==='before'){
   if(width===390||width===360){if(captures)await page.screenshot({path:`${output}/before-universe-${width}x${height}.png`,scale:'css'});await page.locator('#floating-chess').press('Enter');await page.waitForTimeout(1300);if(captures)await page.screenshot({path:`${output}/before-chess-${width}x${height}.png`,scale:'css'})}
   await f.context.close();continue;
  }
  const scale=await page.evaluate(()=>visualViewport.scale);await page.touchscreen.tap(5,Math.min(300,height*.5));await page.touchscreen.tap(5,Math.min(300,height*.5));await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>visualViewport.scale),scale,'double tap never zooms the document');
  const initial=await page.locator('#zoom-label').textContent();await pinch(page);assert.notEqual(await page.locator('#zoom-label').textContent(),initial,'pinch changes universe zoom');assert.equal(await page.locator('#depth-number').textContent(),'00','pinch never selects a node');
  await page.locator('#reset').tap();await page.waitForTimeout(600);
  // Some satellites live outside a small viewport; a world pan brings them into reach.
  let box=await rect(page,'#floating-chess');if(box.y+box.height>height)await swipe(page,4,height*.7,height*.35);
  if(width===390||width===360)if(captures)await page.screenshot({path:`${output}/after-universe-${width}x${height}.png`,scale:'css'});
  await page.evaluate(()=>window.systemIdentity=document.querySelector('#system-window'));
  await f.chess();assert.equal(await page.locator('#system-window').evaluate(el=>el===window.systemIdentity),true);assert.equal(await page.locator('body').evaluate(b=>b.classList.contains('mobile-chess')),true);
  assert.equal(await page.locator('main').evaluate(e=>e.inert),true);
  assert.equal(await page.locator('main').evaluate(e=>Number(getComputedStyle(e).opacity)),0);
  assert.equal(await page.locator('#system-window').count(),1);
  const mini=await rect(page,'#system-window'),board=await rect(page,'.chess-board');
  assert.ok(width>height?mini.x+mini.width<=board.x:mini.y+mini.height<=board.y,'miniature does not cover board');
  assert.ok(mini.width>=110&&mini.height>=72);
  const minTouch=await page.locator('.chess-square').evaluateAll(cells=>Math.min(...cells.map(c=>Math.min(c.getBoundingClientRect().width,c.getBoundingClientRect().height))));assert.ok(minTouch>=40,'grid touch targets are at least 40px');
  if(width===390||width===360)if(captures)await page.screenshot({path:`${output}/after-chess-${width}x${height}.png`,scale:'css'});
  await page.locator('.chess-moves-open').tap();await page.locator('.is-history-sheet').waitFor({state:'visible'});await page.locator('.history-sheet-close').tap();
  const players=await page.locator('.chess-player-info').allTextContents();assert.ok(players.every(s=>s.includes('·')),'side labels remain intact');
  await page.locator('[data-square=e2]').tap();await page.locator('[data-square=e4]').tap();await page.waitForFunction(()=>document.querySelector('.chess-move-count').textContent==='01');
  await page.evaluate(()=>window.mobileCells=[...document.querySelectorAll('.chess-square')]);
  f.send('run.start',1,{kind:'chess',content_version:3});f.send('trace.hop',2,{hop_id:'mobile-hop',from:'gateway',to:'postgres',phase:'start',label:'Mobile chess hop'});
  await page.waitForFunction(()=>document.querySelector('#system-window').dataset.active==='true'&&document.querySelector('#system-activity').textContent==='Mobile chess hop');
  await page.locator('.system-enter').tap();await page.waitForFunction(()=>document.body.classList.contains('mobile-system-expanded'));assert.equal(await page.locator('#mobile-system-components li').count(),9,'architecture has a complete accessible text alternative');await page.keyboard.press('Tab');assert.equal(await page.locator('.mobile-system-header button').evaluate(e=>e===document.activeElement),true);
  if(width===390)if(captures)await page.screenshot({path:`${output}/after-system-sheet-390x844.png`,scale:'css'});await page.locator('.mobile-system-header button').tap();await page.waitForFunction(()=>!document.body.classList.contains('mobile-system-expanded'));
  assert.equal(await page.locator('.chess-move-count').textContent(),'01','system expansion preserves the played move');assert.equal(await page.locator('.chess-scene').isVisible(),true);assert.equal(await page.evaluate(()=>window.mobileCells.every(c=>document.contains(c))),true,'one board instance survives sheet expansion');
  f.send('trace.hop',3,{hop_id:'mobile-hop',from:'gateway',to:'postgres',phase:'end',label:'Mobile chess hop'});f.send('run.done',4,{outcome:'accepted',duration_ms:200});
  // An unsolicited owner message lights the return indicator without closing chess.
  f.send('run.start',1,{kind:'live_in',content_version:3},'mobile-incoming');f.send('live.message',2,{message:{id:'incoming',from:'owner',text:'Hello from Kirbith',ts:new Date().toISOString()}},'mobile-incoming');f.send('run.done',3,{outcome:'accepted',duration_ms:10},'mobile-incoming');
  await page.locator('.chess-return-unread:not([hidden])').waitFor();assert.equal(await page.locator('#floating-live-chat').isVisible(),false);assert.equal(await page.locator('#live-panel').isVisible(),false);
  await page.locator('.chess-close').tap();await page.locator('.chess-scene').waitFor({state:'hidden'});assert.equal(await page.locator('main').evaluate(e=>e.inert),false);
  await page.locator('.generated-camera-controls button').first().tap();await page.waitForTimeout(1200);const back=await rect(page,'.generated-camera-controls .back-button');assert.ok(back.width>=44&&back.height>=44);await page.locator('.generated-camera-controls .back-button').tap();await page.waitForTimeout(1200);
  await page.locator('[data-node="experiencia"]').tap({force:true});await page.waitForTimeout(2000);const rootBack=await rect(page,'#back');assert.ok(rootBack.width>=44&&rootBack.height>=44);assert.ok(await page.locator('#back').getAttribute('aria-label'));await page.locator('#back').tap();await page.waitForTimeout(1800);
  await overflow(page);
  if(width===360){await page.goto(origin+'/privacidad');await page.locator('#privacy-content h1').waitFor();const before=await page.evaluate(()=>visualViewport.scale),cdp=await page.context().newCDPSession(page);await cdp.send('Input.synthesizePinchGesture',{x:180,y:220,scaleFactor:1.5,gestureSourceType:'touch'});await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>visualViewport.scale)>before,'text pages retain native pinch zoom');await cdp.detach()}
  assert.deepEqual(f.errors,[]);reports.push({device,width,height,lang,minTouch,doubleTapScale:scale,mini,board,passed:true});console.log(`Mobile touch QA OK: ${device} ${width}x${height} ${lang}`);await f.context.close();
 }
 if(phase!=='before')await writeFile(`${output}/results.json`,JSON.stringify({origin,engine:'Chromium',reports},null,2)+'\n');
}finally{await browser.close()}
