import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {mobileFixture,chromium,webkit,devices} from './mobile-fixture.mjs';
const output=fileURLToPath(new URL(process.env.GLASS_QA_OUTPUT||'../docs/chat-glass/',import.meta.url));
await mkdir(output,{recursive:true});
const capture=process.env.QA_CAPTURE==='1',reports=[];
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
async function press(page,selector,touch=false){
 const r=await page.locator(selector).boundingBox();assert.ok(r,selector+' is visible');
 if(touch)await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);else await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
}
async function glass(page){
 const result=await page.locator('#live-panel').evaluate(e=>{
  const css=getComputedStyle(e.firstElementChild),input=e.querySelector('textarea'),r=input.getBoundingClientRect(),surfaces=[...document.querySelectorAll('body>*')].filter(n=>n.className?.includes?.('backdrop')&&!n.hidden&&getComputedStyle(n).display!=='none');
  return {color:css.backgroundColor,blur:css.backdropFilter||css.webkitBackdropFilter,hit:input.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),rect:e.getBoundingClientRect().toJSON(),input:r.toJSON(),opacity:getComputedStyle(document.querySelector('main')).opacity,modal:e.getAttribute('aria-modal'),dimLayers:surfaces.map(n=>n.className),canvasFps:document.body.dataset.canvasFps};
 });
 const alpha=Number(result.color.match(/, ([\d.]+)\)$/)?.[1]);assert.ok(alpha>=.55&&alpha<=.70,result.color);assert.match(result.blur,/blur\((16|20)px\).*saturate\(1.1\)/);assert.equal(result.hit,true);assert.equal(result.modal,'false');assert.deepEqual(result.dimLayers,[]);
 // Actual computed colors composited over white: worst-case light behind glass.
 const ratios=await page.evaluate(()=>{
  const rgba=value=>value.match(/[\d.]+/g).map(Number),blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*(fg[3]??1)+bg[i]*(1-(fg[3]??1))),lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0),contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  const pane=document.querySelector('#live-panel>.panel-surface'),base=blend(rgba(getComputedStyle(pane).backgroundColor),[255,255,255]),input=pane.querySelector('textarea'),css=getComputedStyle(input),bg=blend(rgba(css.backgroundColor),base);
  const cases={input:contrast(rgba(css.color),bg),placeholder:contrast(rgba(getComputedStyle(input,'::placeholder').color),bg)};
  for(const row of pane.querySelectorAll('.chat-message')){const text=row.querySelector('p'),bubble=blend(rgba(getComputedStyle(row).backgroundColor),base);cases[row.classList.contains('owner')?'owner':'visitor']=contrast(rgba(getComputedStyle(text).color),bubble)}return cases;
 });
 for(const [name,ratio]of Object.entries(ratios))assert.ok(ratio>=4.5,name+' WCAG AA: '+ratio);
 return {...result,contrast:ratios};
}
async function root(f,touch,reduced){
 const p=f.page;await press(p,'#floating-live-chat',touch);await p.waitForTimeout(600);
 f.send('run.start',1,{kind:'live_in',content_version:3},'glass-in');
 f.send('live.message',2,{conversation_id:'mobile',message:{id:'glass-owner',from:'owner',text:'Hello from the working universe',ts:new Date().toISOString()}},'glass-in');
 await p.locator('[data-message-id="glass-owner"]').waitFor();const result=await glass(p);
 assert.equal(result.opacity,'1');assert.equal(result.canvasFps,'60');assert.equal(await p.locator('main').evaluate(e=>e.inert),false);
 if(!touch){
  const before=await p.locator('.node-target').first().getAttribute('style');await p.mouse.move(990,720);await p.mouse.down();await p.mouse.move(1060,690,{steps:12});await p.mouse.up();await p.waitForTimeout(150);
  assert.notEqual(await p.locator('.node-target').first().getAttribute('style'),before,'Root remains draggable outside glass');
  const zoom=await p.locator('#zoom-label').textContent();await p.mouse.wheel(0,-100);await p.waitForTimeout(300);assert.notEqual(await p.locator('#zoom-label').textContent(),zoom,'Root still zooms');
  if(capture&&!reduced)await p.screenshot({path:output+'/level-0-chat.png',scale:'css'});
  const node=p.locator('.node-target:not(.chat-underlay-hidden)').filter({has:p.locator('.node-label')}).first();await node.focus();await p.keyboard.press('Enter');await p.waitForTimeout(1800);assert.equal(await p.locator('#live-panel').isVisible(),true,'Entering a node keeps chat open');assert.notEqual((await p.locator('#depth-number').textContent()).trim(),'00','Node depth changes while chat stays open');
 }else{
  assert.ok(result.rect.top>innerRootHeight(result)/4,'Universe remains above the bottom sheet');
  assert.ok(result.rect.height<550,'Sheet uses roughly 55%');
  const labels=await p.locator('.node-target,.floating-chess,.language-node,.account-node,.welcome-help,.privacy-footer,.instruction').evaluateAll(nodes=>nodes.filter(n=>{const css=getComputedStyle(n),r=n.getBoundingClientRect(),pane=document.querySelector('#live-panel').getBoundingClientRect();return css.visibility!=='hidden'&&css.display!=='none'&&r.width&&r.left<pane.right&&r.right>pane.left&&r.top<pane.bottom&&r.bottom>pane.top}).map(n=>n.className));
  assert.deepEqual(labels,[],'Labels and floating controls beneath glass are hidden, never drawn over composer');
  if(capture&&p.context().browser().browserType().name()==='webkit')await p.screenshot({path:output+'/390x844-chat.png',scale:'css'});
 }
 await p.keyboard.press('Escape');await p.locator('#live-panel').waitFor({state:'hidden'});return result;
}
const innerRootHeight=result=>result.rect.bottom;
async function game(f,touch,reduced){
 const p=f.page;if(!touch){await p.reload();await p.waitForFunction(()=>!document.querySelector('#floating-chess')?.classList.contains('is-locked'));await p.waitForTimeout(200)}
 await f.chess();const before=await p.locator('.chess-board').boundingBox();
 if(touch){assert.equal(await p.locator('#floating-live-chat').isVisible(),false);await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.body.classList.contains('is-chess'));return {mobileWithoutChat:true};}
 const squares=await p.locator('.chess-board [data-square]').count();assert.equal(squares,64);
 await press(p,'#floating-live-chat',touch);await p.waitForFunction(()=>!document.querySelector('#live-panel').dataset.chatMorph);assert.equal(await p.locator('body.is-chess').count(),1);
 const result=await glass(p),board=await p.locator('.chess-board').boundingBox(),system=await p.locator('#system-window').boundingBox();assert.equal(overlap(board,result.rect),false);assert.equal(overlap(system,result.rect),false);
 if(!touch){assert.ok(Math.abs(board.width-before.width)<.5,'Reserved columns keep the board unchanged');assert.equal(overlap(system,board),false)}
 assert.equal(await p.locator('.chess-board [data-square]').count(),squares,'Existing squares are reused during reflow');
 await p.locator('#live-panel textarea').focus();await p.keyboard.type('Chat while playing');await p.keyboard.press('ArrowLeft');assert.equal(await p.locator('.chess-square[aria-selected=true]').count(),0,'Typing does not select or move a chess piece');await p.locator('#live-panel .chat-send').click();await p.locator('[data-message-id="mobile-msg"][data-delivery="sent"]').waitFor();assert.equal(await p.locator('.message-retry').count(),0);assert.equal(await p.locator('body.is-chess').count(),1);
 f.send('run.start',1,{kind:'live_out',content_version:3},'glass-live-hop');f.send('trace.hop',2,{hop_id:'glass-hop',from:'gateway',to:'owner_channel',phase:'start',label:'Sending message'},'glass-live-hop');
 await p.waitForFunction(()=>document.querySelector('#system-window').dataset.active==='true');
 f.send('trace.hop',3,{hop_id:'glass-hop',from:'gateway',to:'owner_channel',phase:'end',duration_ms:20},'glass-live-hop');f.send('run.done',4,{outcome:'delivered',duration_ms:20},'glass-live-hop');
 if(capture&&!touch&&!reduced)await p.screenshot({path:output+'/desktop-chess-chat.png',scale:'css'});
 // The shared assistant tab must leave the same game open, including generated notices.
 await p.locator('.chess-chat-controls button').first().click();await p.locator('#companion-panel').waitFor();await p.locator('#nexo-input').fill('Create a node');await p.locator('.panel-compose > div > button').first().click();
 const camera=await p.locator('.chess-board').getAttribute('style');
 const node={id:'gen_glass_node',generated:true,label:'A node for you',summary:'Glass fixture',created_at:new Date().toISOString(),sources:[{title:'Portfolio'}],layout:'text',content:{body:'An answer'}};
 f.send('run.start',1,{kind:'chat',content_version:3},'mobile-chat');f.send('node.spawn',2,{anchor:null,node},'mobile-chat');f.send('answer.chunk',3,{text:'The new node is ready.'},'mobile-chat');f.send('run.done',4,{outcome:'generated',duration_ms:50},'mobile-chat');
 await p.waitForFunction(()=>document.querySelector('.generated-camera-controls')?.textContent.includes('A node for you'));assert.equal(await p.locator('.chess-board').getAttribute('style'),camera,'Generated node does not move game camera');assert.equal(await p.locator('body.is-chess').count(),1);
 await p.keyboard.press('Escape');await p.locator('.chess-chat-controls').waitFor({state:'hidden'});await p.waitForTimeout(300);assert.equal(await p.locator('#floating-live-chat').evaluate(e=>e===document.activeElement),true);
 assert.equal(await p.locator('body.is-chess').count(),1);if(!touch){const restored=await p.locator('.chess-board').boundingBox();assert.ok(Math.abs(restored.width-before.width)<1)}
 f.send('run.start',1,{kind:'live_in',content_version:3},'glass-unread');f.send('live.message',2,{conversation_id:'mobile',message:{id:'glass-unread-message',from:'owner',text:'A reply while playing',ts:new Date().toISOString()}},'glass-unread');await p.locator('.chess-return-unread:not([hidden])').waitFor();
 // Legal keyboard move also drives the visible system, independently of chat.
 await p.locator('[data-square="e2"]').focus();await p.keyboard.press('Enter');await p.locator('[data-square="e4"]').focus();await p.keyboard.press('Enter');
 await p.waitForFunction(()=>document.querySelector('.chess-move-count')?.textContent==='01');assert.ok(f.requests.some(r=>r.path==='/api/v1/chess/game/move'&&r.body.uci==='e2e4'));await p.waitForTimeout(400);
 f.send('run.start',1,{kind:'chess',content_version:3},'glass-chess-hop');f.send('trace.hop',2,{hop_id:'move',from:'gateway',to:'postgres',phase:'start',label:'Saving move'},'glass-chess-hop');await p.waitForFunction(()=>document.querySelector('#system-window').dataset.active==='true');
 await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.body.classList.contains('is-chess'));
 return {...result,board,system,reducedMotion:reduced};
}
for(const [name,engine,options,touch,reduced]of [
 ['desktop',chromium,{viewport:{width:1440,height:900},hasTouch:true},false,false],
 ['iphone13',webkit,{...devices['iPhone 13'],viewport:{width:390,height:844}},true,false],
 ['pixel7',chromium,{...devices['Pixel 7']},true,false],
 ['desktop-reduced',chromium,{viewport:{width:1440,height:900},hasTouch:true,reducedMotion:'reduce'},false,true]
]){
 if(process.env.GLASS_CASE&&process.env.GLASS_CASE!==name)continue;
 const browser=await engine.launch();let f;
 try{f=await mobileFixture(browser,options,'en');const rootResult=await root(f,touch,reduced),gameResult=await game(f,touch,reduced);assert.deepEqual(f.errors,[]);reports.push({name,root:rootResult,chess:gameResult});console.log(name+' glass, layers, contrast, camera, chess, focus, traces and unread OK')}
 catch(error){if(f)console.error({name,errors:f.errors,body:await f.page.locator('body').getAttribute('class'),state:await f.page.evaluate(()=>({hidden:document.hidden,transition:document.querySelector('.chess-scene')?.dataset.transition,fps:document.body.dataset.canvasFps}))});throw error}
 finally{await browser.close()}
}
await writeFile(output+'/browser-results.json',JSON.stringify({production:true,reports},null,2)+'\n');
