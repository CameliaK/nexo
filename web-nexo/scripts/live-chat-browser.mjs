import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,webkit,devices} from 'playwright';

const url=process.env.CHAT_URL||'http://127.0.0.1:4196';
const output=fileURLToPath(new URL(process.env.CHAT_QA_OUTPUT||'../docs/chat-glass/live-regression/',import.meta.url));
const capture=process.env.QA_CAPTURE==='1',reports=[];
const contract=JSON.parse(await readFile(new URL('../tests/fixtures/live-contract.json',import.meta.url),'utf8'));
const initialGame={id:'live-chat-game',color:'w',fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',moves:[],turn:'player',status:'active',updated_at:new Date().toISOString()};
await mkdir(output,{recursive:true});
const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
async function tap(page,selector,touch){
 await page.waitForFunction(selector=>{const e=document.querySelector(selector);if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))},selector);
 const r=await page.locator(selector).boundingBox();
 if(touch)await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);else await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
}
async function fixture(browser,options,lang){
 const context=await browser.newContext(options),page=await context.newPage(),errors=[],posts=[],tickets=[];
 let socket,mode='none',number=0,ownerNumber=0;
 const sequences=new Map();
 const history=Array.from({length:40},(_,i)=>({id:`history-${String(i).padStart(2,'0')}`,from:i%2?'owner':'visitor',text:`History ${i}: ${i%2?'Kirbith’s reply':'visitor message'}`,ts:new Date(Date.UTC(2020,9,8,12,i)).toISOString()}));
 await context.addInitScript(lang=>{
  localStorage.setItem('nexo.welcome.dismissed.v1','1');localStorage.setItem('nexo.language',lang);localStorage.setItem('nexo.auth.token','chat-fixture');localStorage.setItem('nexo.visitor_id','chat-fixture');
  window.__liveTest={receipts:[],retryFlashes:[]};const parse=JSON.parse;
  // Observe the actual wire decoder, independent of Playwright's WS shim.
  JSON.parse=function(...args){const v=parse(...args);if(v?.v===2&&v.type==='live.delivery')window.__liveTest.receipts.push({run:v.run_id,status:v.data.status,at:performance.now()});return v};
  addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{for(const row of document.querySelectorAll('.live-history .chat-message'))if(row.querySelector('p')?.textContent.startsWith('Race ')&&row.querySelector('.message-retry'))window.__liveTest.retryFlashes.push(row.textContent)}).observe(document.body,{subtree:true,childList:true,characterData:true}));
 },lang);
 page.on('pageerror',e=>errors.push(e.message));
 await page.routeWebSocket(/\/ws\?ticket=/,ws=>socket=ws);
 const send=(type,data,run)=>socket.send(JSON.stringify({v:2,type,data,run_id:run,seq:(sequences.get(run)||0)+1,ts:new Date().toISOString()}))||sequences.set(run,(sequences.get(run)||0)+1);
 const start=accepted=>send('run.start',{kind:'live_out',content_version:3},accepted.run_id);
 const receipt=(accepted,status)=>send('live.delivery',{message_id:accepted.message_id,status},accepted.run_id);
 await page.route('**/*',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/v1/ws-ticket'){tickets.push(Date.now());return route.fulfill({json:{ticket:crypto.randomUUID(),expires_in:30}})}
  if(path==='/api/v1/auth/me')return route.fulfill({json:{mode:'user',email_hint:'v***@example.com'}});
  if(path==='/api/v1/account/notifications')return route.fulfill({json:{chess_email:true}});
  if(path==='/api/v1/session/nodes')return route.fulfill({json:{nodes:[]}});
  if(path==='/api/v1/chess/game')return route.fulfill({json:{game:initialGame}});
  if(path==='/api/v1/live/messages'&&request.method()==='GET')return route.fulfill({json:{conversation_id:contract.history.conversation_id,messages:[...history].sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts)||(a.id<b.id?1:-1))}});
  if(path==='/api/v1/live/messages'&&request.method()==='POST'){
   const body=request.postDataJSON(),accepted={message_id:`visitor-${++number}`,run_id:`live-out-${number}`},record={body,accepted,mode,acceptedAt:null};posts.push(record);
   assert.ok(request.headers().authorization.startsWith('Bearer '));assert.deepEqual(Object.keys(body).sort(),body.name?['name','text']:['text']);
   if(mode==='fail')return route.fulfill({status:500,json:{error:{code:'internal',message:'RAW INTERNAL DETAIL'}}});
   if(mode==='network')return route.abort('failed');
   if(mode==='before'){
    start(accepted);receipt(accepted,'sent');
    await page.waitForFunction(run=>window.__liveTest.receipts.some(e=>e.run===run),accepted.run_id);
   }
   history.push({id:accepted.message_id,from:'visitor',text:body.text,ts:new Date().toISOString()});
   record.acceptedAt=await page.evaluate(()=>performance.now());
   await route.fulfill({status:202,json:accepted});
   if(mode==='after'){
    await page.waitForFunction(id=>!!document.querySelector(`[data-message-id="${id}"]`),accepted.message_id);
    start(accepted);receipt(accepted,'sent');
   }
   return;
  }
  return route.continue();
 });
 const ready=async()=>{
  await page.waitForFunction(()=>!document.querySelector('#floating-chess')?.classList.contains('is-locked'));
  await page.waitForFunction(count=>document.querySelectorAll('.live-history .chat-message').length===count,history.length);
  // Ensure the signed-in session refresh cannot clear a just-loaded history.
  await page.waitForTimeout(150);assert.equal(await page.locator('.live-history .chat-message').count(),history.length);
 };
 await page.goto(url);await ready();
 return {context,page,errors,posts,tickets,history,ready,setMode(value){mode=value},receipt,start,
  owner(text='Reply from Telegram'){
   const message={...contract.owner,id:`owner-${++ownerNumber}`,text,ts:new Date().toISOString()},run=`live-in-${ownerNumber}`;history.push(message);
   send('run.start',{kind:'live_in',content_version:3},run);send('live.message',{conversation_id:contract.history.conversation_id,message},run);send('run.done',{outcome:'received',duration_ms:100},run);return message;
  },finish(accepted){receipt(accepted,'delivered_to_owner');send('run.done',{outcome:'delivered',duration_ms:1000},accepted.run_id)},disconnect(){socket.close({code:1000})}};
}
async function header(page){
 for(const selector of ['.system-status','.level-mark','.brand']){
  const portal=await page.locator('#system-window').boundingBox(),label=await page.locator(selector).boundingBox();assert.equal(intersects(portal,label),false,'System clears '+selector);
 }
}
async function layout(page,docked){
 const metrics=await page.evaluate(()=>{
  const panel=document.querySelector('#live-panel'),input=panel.querySelector('textarea'),send=panel.querySelector('.chat-send'),privacy=panel.querySelector('.chat-privacy-bar'),counter=panel.querySelector('.chat-counter');
  return {panel:panel.getBoundingClientRect().toJSON(),input:input.getBoundingClientRect().toJSON(),send:send.getBoundingClientRect().toJSON(),privacy:privacy.getBoundingClientRect().toJSON(),counter:counter.getBoundingClientRect().toJSON(),background:getComputedStyle(panel.firstElementChild).backgroundColor,blur:getComputedStyle(panel.firstElementChild).backdropFilter,before:getComputedStyle(panel.firstElementChild,'::before').display,hit:input.contains(document.elementFromPoint(input.getBoundingClientRect().x+20,input.getBoundingClientRect().y+20)),height:visualViewport.height+visualViewport.offsetTop,mainInert:document.querySelector('main').inert};
 });
 assert.match(metrics.background,/rgba\(8, 19, 26, 0\.64\)/);assert.match(metrics.blur,/blur\(/);assert.equal(metrics.before,'none');assert.ok(metrics.hit);assert.equal(intersects(metrics.input,metrics.send),false,'Send sits beside the textarea');assert.equal(intersects(metrics.input,metrics.privacy),false);assert.equal(intersects(metrics.send,metrics.privacy),false);assert.equal(intersects(metrics.counter,metrics.privacy),false);assert.ok(metrics.counter.height>0);
 for(const r of [metrics.input,metrics.send,metrics.privacy])assert.ok(r.y+r.height<=metrics.height+.5,'Composer stays within visualViewport: '+JSON.stringify(metrics));
 assert.equal(await page.locator('#live-panel').getAttribute('aria-modal'),'false');
 if(!docked)assert.equal(metrics.mainInert,false);
 if(docked){const board=await page.locator('.chess-board').boundingBox(),nav=await page.locator('.mobile-chat-controls').boundingBox();assert.ok(board.y+board.height<=nav.y+1,'The game clears the chat controls even with a four-line draft and keyboard')}
 if(await page.locator('body.desktop-chess-chat').count()){const board=await page.locator('.chess-board').boundingBox();assert.ok(board.x+board.width<metrics.panel.x,'Desktop board clears chat column')}
 return metrics;
}
async function scenarios(f,{engine,touch,docked,lang,chess=false}){
 const p=f.page,translated=lang==='es'?{sent:'Enviado',failed:'No se pudo enviar',retry:'Reintentar'}:{sent:'Sent',failed:'Could not send',retry:'Retry'};
 const rows=p.locator('.live-history .chat-message'),input=p.locator('#live-panel textarea'),send=p.locator('#live-panel .chat-send');
 const open=async()=>{
  if(docked||chess){await tap(p,'#floating-chess',touch);await p.locator('.chess-scene.is-ready').waitFor();await p.waitForFunction(()=>document.querySelector('.chess-scene').dataset.transition==='resting')}
  if(docked||chess)await tap(p,'.chess-chat-toggle',touch);else await tap(p,'#floating-live-chat',touch);
  await p.waitForFunction(()=>!document.querySelector('#live-panel').hidden&&document.querySelector('#live-panel').style.pointerEvents!=='none');
  if(chess)await p.waitForTimeout(300);
 };
 const noRetry=async()=>{assert.equal(await rows.locator('.message-retry').count(),0);assert.equal(await rows.filter({has:p.locator('.message-retry')}).count(),0)};
 const bottom=async()=>assert.ok(await p.locator('.live-history').evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop<=2),'Scrolled to last message');
 const textOrder=async()=>{const timestamps=await rows.locator('time').evaluateAll(ns=>ns.map(n=>Date.parse(n.dateTime)));assert.deepEqual(timestamps,[...timestamps].sort((a,b)=>a-b))};
 await header(p);
 if(touch&&!docked&&engine==='webkit'){await p.setViewportSize({width:844,height:390});await header(p);await p.setViewportSize({width:390,height:844});await header(p)}
 if(capture&&engine==='webkit'&&!docked)await p.screenshot({path:output+'/390x844-universe.png',scale:'css'});
 await open();await noRetry();await textOrder();await bottom();await layout(p,docked);
 assert.deepEqual(await rows.evaluateAll(ns=>ns.map(n=>n.dataset.messageId)),Array.from({length:40},(_,i)=>`history-${String(i).padStart(2,'0')}`));
 for(const mode of ['before','after','none']){
  f.setMode(mode);await input.fill('Race '+mode);await send.click();const row=rows.filter({hasText:'Race '+mode});
  await row.locator('.message-state').filter({hasText:translated.sent}).waitFor();await noRetry();await bottom();
  const accepted=f.posts.at(-1).accepted;
  if(mode!=='none'){
   await p.waitForFunction(run=>window.__liveTest.receipts.some(e=>e.run===run),accepted.run_id);
   const receiptAt=await p.evaluate(run=>window.__liveTest.receipts.find(e=>e.run===run).at,accepted.run_id),acceptedAt=f.posts.at(-1).acceptedAt;
   assert.ok(mode==='before'?receiptAt<acceptedAt:receiptAt>=acceptedAt,mode+' ordering verified in browser');
   f.finish(accepted);await p.waitForFunction(id=>document.querySelector(`[data-message-id="${id}"]`)?.dataset.delivery==='delivered_to_owner',accepted.message_id);
  }
 }
 assert.deepEqual(await p.evaluate(()=>window.__liveTest.retryFlashes),[],'No transient Retry in either race');
 f.setMode('fail');await input.fill('Real failure');await send.click();const failed=rows.filter({hasText:'Real failure'});
 await failed.locator('.message-retry').waitFor();assert.equal(await failed.locator('.message-state').textContent(),translated.failed);assert.equal(await failed.locator('.message-retry').textContent(),translated.retry);
 const count=await rows.count();f.setMode('before');await failed.locator('.message-retry').click();await failed.locator('.message-state').filter({hasText:translated.sent}).waitFor();assert.equal(await rows.count(),count);await noRetry();f.finish(f.posts.at(-1).accepted);
 const owner=f.owner();await p.locator(`[data-message-id="${owner.id}"]`).waitFor();await noRetry();await bottom();
 // Reading older messages must survive a reply; the small SVG control resumes following.
 await p.locator('.live-history').evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'))});
 const reading=f.owner('While reading history');await p.locator(`[data-message-id="${reading.id}"]`).waitFor();assert.equal(await p.locator('.live-history').evaluate(e=>e.scrollTop),0);await p.locator('.live-new-message').waitFor();await p.locator('.live-new-message').click();await bottom();
 await p.locator('.live-history').evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'))});f.setMode('none');await input.fill('Own send while reading');await send.click();await rows.filter({hasText:'Own send while reading'}).locator('.message-state').filter({hasText:translated.sent}).waitFor();await bottom();await textOrder();
 assert.equal(await rows.last().locator('p').textContent(),'Own send while reading');
 const beforeReconnect=await rows.evaluateAll(ns=>ns.map(n=>n.dataset.messageId));f.disconnect();await noRetry();await p.waitForFunction(()=>document.querySelector('#live-panel textarea')?.disabled===false);await f.ready();await noRetry();assert.deepEqual(await rows.evaluateAll(ns=>ns.map(n=>n.dataset.messageId)),beforeReconnect,'History merges without duplicate/jump');assert.ok(f.tickets.length>=2);
 const compact=await input.boundingBox();await input.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6');const expanded=await input.boundingBox();assert.ok(expanded.height>compact.height&&expanded.height<=120,'Textarea grows up to four lines');await layout(p,docked);await input.fill('');
 if(!docked){
  await p.keyboard.press('Tab');assert.equal(await p.locator('main').evaluate(e=>e.inert),false,'Glass panel leaves outside focus available');
  if(!touch&&!chess){const zoom=await p.locator('#zoom-label').textContent();await p.mouse.move(1200,500);await p.mouse.wheel(0,-100);await p.waitForTimeout(350);assert.notEqual(await p.locator('#zoom-label').textContent(),zoom)}
 }
 const screenshot=await layout(p,docked);
 if(capture&&engine==='webkit')await p.screenshot({path:output+`/390x844-${docked?'chess-chat':'live-chat'}.png`,scale:'css'});
 if(touch){
  await p.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:320});visualViewport.dispatchEvent(new Event('resize'))});
  await input.fill('Keyboard line 1\nLine 2\nLine 3\nLine 4\nLine 5');await layout(p,docked);await input.fill('');await p.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))});
 }
 // Reload uses a descending history without status, including accepted sends and Telegram replies.
 await p.reload();await f.ready();await open();await noRetry();await textOrder();await bottom();assert.equal(await rows.count(),f.history.length);
 assert.equal(await rows.locator('.owner .message-retry').count(),0);assert.equal(await p.locator('.live-history .owner .message-retry').count(),0);
 await p.keyboard.press('Escape');await p.locator('#live-panel').waitFor({state:'hidden'});
 if(!docked&&!chess){assert.equal(await p.locator('main').evaluate(e=>e.inert),false);assert.equal(await p.locator('#floating-live-chat').evaluate(e=>e===document.activeElement),true)}
 assert.deepEqual(f.errors,[]);
 reports.push({engine,viewport:p.viewportSize().width+'x'+p.viewportSize().height,docked,chess,language:lang,historyShape:'{ conversation_id, messages: [{ id, from, text, ts }] }, no status',historyOrder:'descending',verified:['receipt-before-POST','receipt-after-POST','202-without-WS','HTTP-failure-and-retry','owner-reply','scroll-reading-and-own-send','reconnection','reload','glass-composer','four-line-draft','focus-and-ESC','visualViewport'],posts:f.posts.length,tickets:f.tickets.length,screenshot});
 console.log(`${engine} ${docked?'chess dock':chess?'desktop chess chat':'normal panel'} OK`);
}
for(const [engine,provider,options,touch,docked,lang,chess]of [
 ['chromium',chromium,{viewport:{width:1366,height:768}},false,false,'en'],
 ['chromium',chromium,{viewport:{width:1440,height:900}},false,false,'es',true],
 ['chromium',chromium,{...devices['Pixel 7'],viewport:{width:393,height:851}},true,false,'en'],
 ['webkit',webkit,{...devices['iPhone 13'],viewport:{width:390,height:844}},true,false,'es'],
 ['webkit',webkit,{...devices['iPhone 13'],viewport:{width:390,height:844}},true,true,'en']
]){
 if(process.env.CHAT_CASE&&process.env.CHAT_CASE!==`${engine}-${docked||chess?'chess':'normal'}`)continue;
 const browser=await provider.launch();let f;
 try{f=await fixture(browser,options,lang);await scenarios(f,{engine,touch,docked,lang,chess})}
 catch(error){if(f)console.error({engine,docked,errors:f.errors,body:await f.page.locator('body').getAttribute('class'),messages:await f.page.locator('.live-history .chat-message').count(),history:f.history.length});throw error}
 finally{await browser.close()}
}
await writeFile(output+'/browser-results.json',JSON.stringify({production:true,url,reports},null,2)+'\n');
