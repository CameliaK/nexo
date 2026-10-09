import assert from 'node:assert/strict';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {mobileFixture,chromium,webkit,devices} from './mobile-fixture.mjs';
import {activateChat,readyChat,geometry,historyGame} from './chess-layout-browser.mjs';
const output=fileURLToPath(new URL('../docs/chess-follow/',import.meta.url)),capture=process.env.QA_CAPTURE==='1',files=[];
if(capture){await assert.rejects(access(output+'captures.json'),'Capture batch must run only once');await mkdir(output,{recursive:true})}
for(const [engine,provider,width,height]of [['chromium',chromium,1440,900],['chromium',chromium,1280,720],['webkit',webkit,390,844]]){
 const browser=await provider.launch();try{
  const f=await mobileFixture(browser,{...(width===390?devices['iPhone 13']:{}),viewport:{width,height},hasTouch:true},width===1280?'en':'es',historyGame(12)),p=f.page;
  const shot=async name=>{if(capture){const file=`${width}x${height}-${name}.png`;await p.screenshot({path:output+file,scale:'css'});files.push(file)}};
  await f.chess();await geometry(p,width);await shot('chess-closed');
  if(width>900){
   await activateChat(p);await p.waitForTimeout(400);assert.equal(await p.locator('#live-panel').getAttribute('data-chat-morph'),'opening');await shot('chess-forming');await readyChat(p);await geometry(p,width);await shot('chess-live');
   await p.keyboard.press('Escape');await p.locator('#live-panel').waitFor({state:'hidden'});
  }else{
   f.send('run.start',1,{kind:'live_in',content_version:3},'capture-in');f.send('live.message',2,{conversation_id:'mobile',message:{id:'capture-reply',from:'owner',text:'Un mensaje mientras juegas',ts:new Date().toISOString()}},'capture-in');await p.locator('.chess-return-unread:not([hidden])').waitFor();await shot('chess-unread');
  }
  await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.body.classList.contains('is-chess'));await p.waitForFunction(()=>!document.body.classList.contains('is-chess-transitioning'));
  await p.locator('#companion-target').focus();await p.keyboard.press('Enter');await p.locator('#companion-panel').waitFor();await p.locator('#nexo-input').fill('Cuéntame sobre el portafolio');await p.locator('.panel-compose>div>button').first().click();
  f.send('run.start',1,{kind:'chat',content_version:3},'mobile-chat');f.send('answer.chunk',2,{text:Array.from({length:24},(_,i)=>`Parte ${i+1}: el universo reúne la experiencia de Kirbith en backend, frontend e inteligencia artificial. Sus nodos muestran proyectos, tecnologías y el sistema que responde en tiempo real.`).join('\n\n')},'mobile-chat');f.send('run.done',3,{outcome:'answered',duration_ms:1},'mobile-chat');await p.waitForFunction(()=>document.querySelector('.agent-history').textContent.includes('Parte 24'));
  for(const position of ['top','bottom']){await p.locator('#companion-panel .panel-body').evaluate((e,position)=>e.scrollTop=position==='top'?0:e.scrollHeight,position);await p.waitForTimeout(80);await shot('assistant-'+position)}
  assert.deepEqual(f.errors,[]);console.log(engine+' '+width+' capture flow OK');
 }finally{await browser.close()}
}
if(capture)await writeFile(output+'captures.json',JSON.stringify({at:new Date().toISOString(),singleBatch:true,files},null,2)+'\n');
