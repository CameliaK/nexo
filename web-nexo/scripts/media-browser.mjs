import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin=process.argv[2]||'http://127.0.0.1:4192';
const browser=await chromium.launch({headless:true});
try{
 for(const viewport of [{width:1366,height:768},{width:390,height:844},{width:844,height:390}]){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'});
  await context.addInitScript(()=>{localStorage.setItem('nexo.welcome.dismissed.v1','1');localStorage.setItem('nexo.language','es');localStorage.setItem('nexo.auth.token','fixture')});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket(/\/ws\?/,()=>{});
  await page.route('**/*',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/v1/auth/me')return route.fulfill({json:{mode:'user',email_hint:'v***@example.com'}});
   if(path==='/api/v1/ws-ticket')return route.fulfill({json:{ticket:'fixture-ticket',expires_in:30}});
   if(path==='/api/v1/session/nodes')return route.fulfill({json:{nodes:[]}});
   if(path==='/api/v1/live/messages')return route.fulfill({json:{messages:[],conversation_id:null}});
   if(path==='/api/v1/account/notifications')return route.fulfill({json:{chess_email:true}});
   if(path==='/api/v1/chess/game')return route.fulfill({status:404});
   return route.continue();
  });
  await page.goto(origin);await page.locator('[data-node="aprendizaje"]').waitFor();
  const enter=async id=>{await page.locator(`[data-node="${id}"]`).evaluate(button=>button.click());await page.waitForFunction(()=>!document.body.classList.contains('is-traveling'))};
  await enter('aprendizaje');await enter('aprendizaje.proyectos-academicos');await enter('aprendizaje.proyectos-academicos.fitness-app');
  assert.equal(await page.locator('.media-window').count(),4);
  const tile=page.locator('.media-window:not([hidden])').first();await page.waitForTimeout(400);if(!await tile.count()){await page.screenshot({path:'/tmp/nexo-media-no-space.png'});console.log(await page.locator('body').innerText())}await tile.waitFor({timeout:3000});await tile.evaluate(button=>button.click());
  const viewer=page.locator('.media-viewer'),image=page.locator('.media-viewer-image');await viewer.waitFor();
  const showFile=async file=>{for(let i=0;i<6;i++){if((await image.getAttribute('src')||'').includes(file))return;await page.keyboard.press('ArrowRight')}assert.fail('Missing viewer image: '+file)};
  for(const [id,w,h] of [['entrenar',395,1600],['actividad',329,1600]]){
   await showFile(id==='entrenar'?'02-entrenar':'03-actividad');
   await image.evaluate(img=>img.decode());
   const dimensions=await image.evaluate(img=>({width:Number(img.getAttribute('width')),height:Number(img.getAttribute('height')),naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,fit:getComputedStyle(img).objectFit}));
   assert.deepEqual(dimensions,{width:w,height:h,naturalWidth:w,naturalHeight:h,fit:'contain'});
   const thumb=page.locator(`[data-media-id="${id}"] img`);assert.equal(await thumb.getAttribute('width'),String(w));assert.equal(await thumb.getAttribute('height'),String(h));assert.equal(await thumb.getAttribute('loading'),'lazy');assert.equal(await thumb.evaluate(img=>getComputedStyle(img).objectFit),'contain');
   const bounds=await viewer.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=viewport.height,'viewer fits viewport');
   const nav=await page.locator('.media-viewer-navigation').boundingBox();assert.ok(nav.y+nav.height<=viewport.height,'arrows stay reachable');
  }
  await page.keyboard.press('Escape');assert.equal(await viewer.isVisible(),false);
  await page.locator('#back').evaluate(button=>button.click());await page.waitForFunction(()=>!document.body.classList.contains('is-traveling'));
  await enter('aprendizaje.proyectos-academicos.sistema-financiero');await page.locator('.media-window:not([hidden])').first().evaluate(button=>button.click());
  await showFile('03-transaccion');
  await image.evaluate(img=>img.decode());assert.equal(await image.getAttribute('width'),'1600');assert.equal(await image.getAttribute('height'),'1078');assert.equal(await image.evaluate(img=>getComputedStyle(img).objectFit),'contain');
  const box=await viewer.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height);assert.deepEqual(errors,[]);
  if(process.env.MEDIA_SCREENSHOT&&viewport.width===390)await page.screenshot({path:process.env.MEDIA_SCREENSHOT});
  await context.close();console.log(`Real tall/wide images, dimensions, containment, arrows and viewport OK (${viewport.width}×${viewport.height})`);
 }
}finally{await browser.close()}
