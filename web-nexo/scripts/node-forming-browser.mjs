import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin=process.argv[2]||'http://127.0.0.1:4190';
const browser=await chromium.launch({headless:true});
try{
 for(const {reduced,viewport} of [{reduced:false,viewport:{width:1366,height:768}},{reduced:true,viewport:{width:1366,height:768}},{reduced:false,viewport:{width:390,height:844}}]){
  const context=await browser.newContext({viewport,reducedMotion:reduced?'reduce':'no-preference'});
  await context.addInitScript(()=>{localStorage.setItem('nexo.welcome.dismissed.v1','1');localStorage.setItem('nexo.language','es');localStorage.setItem('nexo.visitor_id','anonymous')});
  let releaseLogin;const login=new Promise(resolve=>releaseLogin=resolve);let exchanged=false,tickets=0,connections=0,socket;const errors=[],logs=[],requests=[];
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='info')logs.push(message.text())});
  await page.routeWebSocket(/\/ws\?/,ws=>{connections++;socket=ws;assert.equal(new URL(ws.url()).searchParams.has('token'),false)});
  await page.route('**/*',async route=>{
   const path=new URL(route.request().url()).pathname;requests.push(path);
   if(path==='/auth/guest')return route.fulfill({json:{token:'anonymous-token'}});
   if(path==='/auth/exchange'){await login;exchanged=true;return route.fulfill({json:{token:'canonical-account',visitor_id:'canonical-id'}})}
   if(path==='/api/v1/ws-ticket'){assert.equal(exchanged,true);assert.equal(route.request().headers().authorization,'Bearer canonical-account');tickets++;return route.fulfill({json:{ticket:crypto.randomUUID(),expires_in:30}})}
   if(path==='/api/v1/auth/me')return route.fulfill({json:{mode:exchanged?'user':'guest',...(exchanged?{email_hint:'k***@example.com'}:{})}});
   if(path==='/api/v1/account/notifications')return route.fulfill({json:{chess_email:true}});
   if(path==='/api/v1/chess/game')return route.fulfill({status:404});
   if(path==='/api/v1/session/nodes')return route.fulfill({json:{nodes:[]}});
   if(path==='/api/v1/live/messages')return route.fulfill({json:{conversation_id:null,messages:[]}});
   if(path==='/api/v1/chat')return route.fulfill({status:202,json:{run_id:'browser-forming'}});
   return route.continue();
  });
  await page.goto(origin+'/#/login/done?code=simulated',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.access-status')?.textContent.length>0);await page.waitForTimeout(100);
  assert.equal(tickets,0);assert.equal(connections,0);releaseLogin();await page.waitForFunction(()=>localStorage.getItem('nexo.visitor_id')==='canonical-id');await page.locator('.access-overlay').first().waitFor({state:'hidden'});await page.waitForTimeout(100);assert.equal(tickets,1);assert.equal(connections,1);
  await page.locator('#companion-target').focus();await page.keyboard.press('Enter');await page.locator('#companion-panel').waitFor({state:'visible'});
  const suggestions=page.locator('.chat-suggestions button');assert.equal(await suggestions.count(),3);await suggestions.nth(0).click();assert.equal(await page.locator('#nexo-input').inputValue(),'Créame un nodo con las tecnologías de frontend de Kirbith');assert.equal(requests.includes('/api/v1/chat'),false);
  await page.locator('.language-node').click();assert.equal(await suggestions.nth(2).innerText(),"Create a node with Kirbith's databases");await suggestions.nth(2).click();assert.equal(await page.locator('#nexo-input').inputValue(),"Create a node with Kirbith's databases");
  await page.locator('.panel-compose > div > button').first().click();await page.waitForTimeout(30);
  const event=(type,seq,data)=>({v:2,type,run_id:'browser-forming',seq,ts:new Date().toISOString(),data});
  const node={id:'gen_browser_forming',generated:true,label:'A node for you',summary:'A short description',created_at:new Date().toISOString(),sources:[{title:'Portfolio'}],layout:'text',content:{body:'A generated answer'}};
  socket.send(JSON.stringify(event('run.start',1,{kind:'chat',content_version:3})));
  socket.send(JSON.stringify(event('future.browser.test',2,{secret:'NEVER_LOG_PAYLOAD'})));
  socket.send(JSON.stringify(event('node.forming',3,{sources:['experiencia.infosys','aprendizaje.extras.infosys-ia']})));
  socket.send(JSON.stringify(event('node.spawn',4,{anchor:null,node})));
  socket.send(JSON.stringify(event('answer.chunk',5,{text:'Node created.'})));
  socket.send(JSON.stringify(event('run.done',6,{outcome:'generated',duration_ms:100})));
  const target=page.locator('[data-node="gen_browser_forming"]');await target.waitFor({state:'attached'});await page.waitForTimeout(100);
  if(reduced)assert.equal(await target.isDisabled(),false);else assert.equal(await target.isDisabled(),true);
  await page.waitForFunction(()=>!document.querySelector('[data-node="gen_browser_forming"]').disabled);assert.equal(await target.count(),1);const nodeBounds=await target.boundingBox();assert.ok(Math.abs(nodeBounds.x+nodeBounds.width/2-viewport.width/2)<12,'created node is centered horizontally');assert.ok(Math.abs(nodeBounds.y+nodeBounds.height/2-viewport.height/2)<12,'created node is centered vertically');assert.ok((await page.locator('.agent-history').innerText()).includes('Node created.'));
  const reply=await page.locator('.agent-history .chat-message.agent p').last().boundingBox(),body=await page.locator('#companion-panel .panel-body').boundingBox();assert.ok(reply.y>=body.y-2&&reply.y+reply.height<=body.y+body.height+2,'streaming answer remains visible in the focused view');
  assert.deepEqual(logs,['future.browser.test']);assert.deepEqual(errors,[]);assert.equal(tickets,1);assert.equal(connections,1);
  const bounds=await page.locator('#companion-panel .panel-surface').boundingBox();assert.ok(bounds.y+bounds.height<=viewport.height-40,'discovery panel leaves bottom controls reachable');
  if(process.env.FORMING_SCREENSHOT&&viewport.width===390)await page.screenshot({path:process.env.FORMING_SCREENSHOT});
  await context.close();console.log(`Startup, suggestions and ordered node formation OK (${viewport.width}×${viewport.height}, reduced motion: ${reduced})`);
 }
}finally{await browser.close()}
