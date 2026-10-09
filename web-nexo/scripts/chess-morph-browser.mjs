import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {mobileFixture,chromium,webkit} from './mobile-fixture.mjs';
const reports=[];
const stableBoard=(actual,expected)=>Object.keys(expected).forEach(key=>assert.ok(Math.abs(actual[key]-expected[key])<.5,`Board ${key} changed: ${expected[key]} → ${actual[key]}`));
async function hit(p){const r=await p.locator('#floating-live-chat').boundingBox();assert.ok(await p.evaluate(({x,y})=>document.querySelector('#floating-live-chat').contains(document.elementFromPoint(x,y)),{x:r.x+r.width/2,y:r.y+r.height/2}));await p.mouse.click(r.x+r.width/2,r.y+r.height/2)}
const ready=(p,which)=>p.waitForFunction(which=>{const e=document.querySelector(which==='live'?'#live-panel':'#companion-panel');return !e.hidden&&!e.dataset.chatMorph&&e.style.pointerEvents!=='none'},which);
for(const [name,provider]of [['chromium',chromium],['webkit',webkit]])for(const reduced of [false,true]){
 const browser=await provider.launch();try{
  const f=await mobileFixture(browser,{viewport:{width:1440,height:900},hasTouch:true,reducedMotion:reduced?'reduce':'no-preference'}),p=f.page;await f.chess();const board=await p.locator('.chess-board').boundingBox();
  await hit(p);await p.waitForTimeout(reduced?10:250);assert.equal(await p.locator('#live-panel').getAttribute('data-chat-morph-ms'),reduced?'100':'900');if(!reduced){assert.equal(await p.locator('.live-morph-canvas').isVisible(),true);assert.equal(await p.locator('body').getAttribute('data-canvas-fps'),'60')}
  await p.keyboard.press('Escape');await p.locator('#live-panel').waitFor({state:'hidden'});assert.equal(await p.locator('#floating-live-chat').evaluate(e=>e===document.activeElement),true);
  await hit(p);await ready(p,'live');await p.locator('#live-panel textarea').fill('Saved live draft');await p.keyboard.press('Escape');await p.waitForTimeout(reduced?20:250);await hit(p);await ready(p,'live');assert.equal(await p.locator('#live-panel textarea').inputValue(),'Saved live draft');
  assert.equal(await p.locator('#floating-live-chat').count(),1);assert.equal(await p.locator('#live-panel').count(),1);assert.equal(await p.locator('.live-morph-canvas').count(),1);stableBoard(await p.locator('.chess-board').boundingBox(),board);
  assert.equal(await p.locator('.chess-chat-controls button').count(),1);assert.equal(await p.locator('#companion-panel').isVisible(),false);await p.keyboard.press('Escape');await p.locator('#live-panel').waitFor({state:'hidden'});assert.equal(await p.locator('body.is-chess').count(),1);await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.body.classList.contains('is-chess'));assert.deepEqual(f.errors,[]);reports.push({name,reduced,passed:true});console.log(name+' reduced='+reduced+' morph, reversal, drafts, live-only game and focus OK');
 }finally{await browser.close()}
}
await writeFile(fileURLToPath(new URL('../docs/chess-follow/morph.json',import.meta.url)),JSON.stringify(reports,null,2)+'\n');
