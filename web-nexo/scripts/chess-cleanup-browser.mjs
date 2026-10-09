import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mobileFixture,chromium,webkit,devices} from './mobile-fixture.mjs';
const reports=[];
for(const [name,engine,options]of [['desktop',chromium,{viewport:{width:1440,height:900},hasTouch:true}],['iphone',webkit,{...devices['iPhone 13'],viewport:{width:390,height:844}}],['900',chromium,{viewport:{width:1440,height:900},hasTouch:true}]]){
 const browser=await engine.launch();try{
  const f=await mobileFixture(browser,options),p=f.page;await f.chess();if(name==='900'){await p.setViewportSize({width:900,height:900});await p.waitForFunction(()=>document.body.classList.contains('mobile-chess'));}
  assert.equal(await p.locator('#floating-live-chat').count(),1);assert.equal(await p.getByRole('button',{name:'Chat',exact:true}).count(),0);
  if(name==='desktop'){
   const node=p.locator('#floating-live-chat'),r=await node.boundingBox();assert.ok(r);await p.mouse.click(r.x+r.width/2,r.y+r.height/2);await p.locator('#live-panel').waitFor();await p.waitForTimeout(400);assert.equal(await p.locator('body.is-chess').count(),1);assert.equal(await node.getAttribute('aria-expanded'),'true');
   await p.keyboard.press('Escape');await p.locator('#live-panel').waitFor({state:'hidden'});assert.equal(await node.evaluate(e=>e===document.activeElement),true);
   for(const key of ['Enter','Space']){await node.focus();await p.keyboard.press(key);await p.locator('#live-panel').waitFor();assert.equal(await p.locator('body.is-chess').count(),1);await p.keyboard.press('Escape');await p.locator('#live-panel').waitFor({state:'hidden'})}
  }else{assert.equal(await p.locator('#floating-live-chat').isVisible(),false);assert.equal(await p.locator('#live-panel').isVisible(),false);assert.equal(await p.locator('#companion-panel').isVisible(),false);}
  f.send('run.start',1,{kind:'live_in',content_version:3},'cleanup-in');f.send('live.message',2,{message:{id:'cleanup-reply',from:'owner',text:'Hello',ts:new Date().toISOString()}},'cleanup-in');
  await p.locator('.chess-return-unread:not([hidden])').waitFor();assert.equal(await p.locator('body.is-chess').count(),1);
  await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.body.classList.contains('is-chess'));
  await p.locator('#floating-live-chat').waitFor();assert.equal(await p.locator('#floating-live-chat').getAttribute('data-unread'),'1');assert.deepEqual(f.errors,[]);reports.push({name,passed:true});console.log(name+' sole node, preserved game, mobile isolation and unread OK');
 }finally{await browser.close()}
}
await mkdir('docs/chess-layout',{recursive:true});await writeFile('docs/chess-layout/A-results.json',JSON.stringify(reports,null,2)+'\n');
