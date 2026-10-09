import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('../docs/chess-layout/',import.meta.url));
import {mkdir,writeFile} from 'node:fs/promises';
import {mobileFixture,chromium,webkit,devices} from './mobile-fixture.mjs';
const overlap=(a,b)=>a.x<b.x+b.width-.5&&a.x+a.width>b.x+.5&&a.y<b.y+b.height-.5&&a.y+a.height>b.y+.5,reports=[];
for(const [engine,provider]of [['chromium',chromium],['webkit',webkit]]){
 const browser=await provider.launch();try{for(const [width,height]of [[1920,1080],[1440,900],[1280,720],[1024,768],[390,844]]){
  if(process.env.GEOMETRY_WIDTH&&width!==Number(process.env.GEOMETRY_WIDTH))continue;
  const f=await mobileFixture(browser,{...(width===390?devices['iPhone 13']:{}),viewport:{width,height},hasTouch:true}),p=f.page;
  try{
   await f.chess();const before=await p.locator('.chess-board').boundingBox();
   for(const state of width>900?['closed','live','agent']:['closed']){
    if(state==='live'){const r=await p.locator('#floating-live-chat').boundingBox();await p.mouse.click(r.x+r.width/2,r.y+r.height/2);await p.locator('#live-panel').waitFor();await p.waitForTimeout(300)}
    if(state==='agent'){await p.locator('.chess-chat-controls button').first().click();await p.locator('#companion-panel').waitFor()}
    const measured=await p.evaluate(()=>{
     const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();
     const aside=document.querySelector('.chess-aside');
     const overflow=[...document.querySelectorAll('.chess-scene *,.chess-chat-controls,#live-panel *,#companion-panel *')].filter(e=>e instanceof HTMLElement&&e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]')&&!e.classList.contains('sr-only')&&e.scrollWidth>e.clientWidth+1).map(e=>({class:e.className,text:e.textContent.slice(0,50),sw:e.scrollWidth,cw:e.clientWidth}));
     return {board:rect('.chess-board'),left:rect('.chess-left-column'),system:rect('#system-window'),aside:rect('.chess-aside'),controls:[...aside.querySelectorAll('.chess-actions button')].filter(e=>!e.hidden).map(e=>e.getBoundingClientRect().toJSON()),overflow};
    });
    const slots=width>900?[measured.board,measured.left,measured.system,measured.aside]:[measured.board,measured.system,measured.aside];for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++)assert.equal(overlap(slots[i],slots[j]),false,engine+' '+width+' '+state+' slots '+i+'/'+j+' '+JSON.stringify(measured));
    assert.deepEqual(measured.overflow,[],engine+' '+width+' '+state+' overflow');for(const r of measured.controls)assert.ok(r.x>=measured.aside.x-.5&&r.x+r.width<=measured.aside.x+measured.aside.width+.5&&r.y>=measured.aside.y-.5&&r.y+r.height<=measured.aside.y+measured.aside.height+.5,'Controls inside rail '+JSON.stringify(measured));
    assert.ok(Math.abs(before.x-measured.board.x)<.5&&Math.abs(before.y-measured.board.y)<.5&&Math.abs(before.width-measured.board.width)<.5,'Opening tabs never moves or shrinks board');
    if(width<=900)assert.equal(await p.locator('#floating-live-chat').isVisible(),false);
    reports.push({engine,width,height,state,...measured});
   }
   assert.deepEqual(f.errors,[]);console.log(engine+' '+width+'x'+height+' columns OK');
  }catch(error){console.error({engine,width,height,body:await p.locator('body').getAttribute('class'),errors:f.errors});throw error}
  finally{await f.context.close()}
 }}finally{await browser.close()}
}
await mkdir(output,{recursive:true});await writeFile(output+'B-geometry.json',JSON.stringify(reports,null,2)+'\n');
