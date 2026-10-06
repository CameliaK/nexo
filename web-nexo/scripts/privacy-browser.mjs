import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const origin = process.argv[2] || 'http://127.0.0.1:4187';
const host = new URL(origin).host;
const candidate = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8').match(/# add_header Content-Security-Policy-Report-Only "([^"]+)"/)[1].replace('wss://__PUBLIC_HOST__', `ws://${host}`);
const browser = await chromium.launch({ headless: true });
try {
 for (const viewport of [{width:1366,height:768},{width:390,height:844}]) {
  const context = await browser.newContext({viewport,reducedMotion:'reduce'});
  await context.addInitScript(() => {
   window.__violations=[];
   document.addEventListener('securitypolicyviolation', e => window.__violations.push({directive:e.effectiveDirective,uri:e.blockedURI}));
   if(!localStorage.getItem('fixture.initialized')){
    localStorage.setItem('fixture.initialized','yes');localStorage.setItem('nexo.language','es');localStorage.setItem('nexo.welcome.dismissed.v1','1');localStorage.setItem('nexo.visitor_id','original-id');localStorage.setItem('nexo.auth.token','account-token');localStorage.setItem('nexo.guest.session',JSON.stringify({token:'guest-token',visitorId:'original-id',expiresAt:null}));
   }
  });
  let deletes=0,deleted=false;const sockets=[],requests=[],errors=[];
  await context.route('**/*',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;requests.push({path,method:request.method(),authorization:request.headers().authorization});
   if(path==='/api/v1/session/data'){assert.equal(request.method(),'DELETE');assert.equal(request.headers().authorization,'Bearer account-token');if(++deletes===1)return route.fulfill({status:429,headers:{'Retry-After':'2'},json:{error:{code:'rate_limited',message:'raw details'}}});deleted=true;return route.fulfill({status:204})}
   if(path==='/auth/guest')return route.fulfill({json:{token:'fresh-guest'}});
   if(path==='/api/v1/ws-ticket')return route.fulfill({json:{ticket:crypto.randomUUID(),expires_in:30}});
   if(path==='/api/v1/auth/me')return route.fulfill({json:deleted?{mode:'guest'}:{mode:'user',email_hint:'v***@example.com'}});
   if(path==='/api/v1/account/notifications')return route.fulfill({json:{chess_email:true}});
   if(path==='/api/v1/chess/game')return route.fulfill({status:404});
   if(path==='/api/v1/session/nodes')return route.fulfill({json:{nodes:[]}});
   if(path==='/api/v1/live/messages')return route.fulfill({json:{conversation_id:null,messages:[]}});
   if(request.isNavigationRequest()) {const response=await route.fetch();return route.fulfill({response,headers:{...response.headers(),'Content-Security-Policy-Report-Only':candidate}})}
   return route.continue();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.routeWebSocket(/\/ws\?/,socket=>{sockets.push(socket.url())});
  await page.goto(origin+'/privacidad');await page.locator('h1').filter({hasText:'Aviso de privacidad'}).waitFor();
  assert.equal(sockets.length,0);assert.equal(requests.some(r=>r.path.startsWith('/api/')||r.path==='/auth/guest'),false);
  assert.equal(await page.locator('html').getAttribute('lang'),'es');assert.equal(await page.locator('table tbody tr').count(),8);
  for(const text of ['90 días','180 días','30 días','7 días','[fecha de publicación]','[Proveedor de correo]'])assert.ok((await page.locator('article').innerText()).includes(text));
  await page.locator('#privacy-language').click();assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.match(await page.locator('h1').innerText(),/Privacy notice/);assert.ok((await page.locator('article').innerText()).includes('[publication date]'));
  await page.locator('#privacy-delete').click();await page.keyboard.press('Escape');assert.equal(deletes,0);assert.equal(await page.locator('#privacy-delete').evaluate(e=>e===document.activeElement),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no mobile horizontal overflow');
  await page.locator('#privacy-home').click();await page.locator('.account-node').waitFor();await page.locator('.account-node').click();await page.locator('.account-email').filter({hasText:'v***@example.com'}).waitFor();
  assert.equal(await page.locator('.account-privacy').getAttribute('href'),'/privacidad');
  assert.ok((await page.locator('#companion-panel .privacy-notice').innerText()).includes('AI provider'));
  assert.ok((await page.locator('.live-panel .privacy-notice').textContent()).includes('Telegram'));
  assert.ok(sockets.length>0);assert.ok(sockets.every(url=>new URL(url).searchParams.has('ticket')&&!new URL(url).searchParams.has('token')));
  await page.locator('.account-delete-data').click();await page.keyboard.press('Escape');assert.equal(deletes,0);
  await page.locator('.account-delete-data').click();await page.locator('.account-confirm-delete').click();await page.locator('.account-status').filter({hasText:'Wait 2 s'}).waitFor();assert.equal(await page.locator('.account-confirm-delete').isDisabled(),true);
  await page.locator('.account-confirm-delete').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.account-confirm-delete').disabled);
  await Promise.all([page.waitForEvent('load'),page.locator('.account-confirm-delete').click()]);await page.locator('.account-node').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('nexo.auth.token')),null);assert.notEqual(await page.evaluate(()=>localStorage.getItem('nexo.visitor_id')),'original-id');assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.locator('.account-node').click();await page.locator('.access-overlay:not([hidden])').waitFor();assert.equal(await page.locator('.access-privacy a').getAttribute('href'),'/privacidad');await page.locator('.access-privacy a').focus();await page.waitForTimeout(650);assert.equal(await page.locator('.access-privacy a').evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.locator('.access-close').first().evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Escape');
  const violations=await page.evaluate(()=>window.__violations);assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
  // Test the page's own deletion UI in a separate authenticated visit.
  await page.evaluate(()=>{localStorage.setItem('nexo.auth.token','account-token');localStorage.setItem('nexo.visitor_id','second-id')});
  await page.goto(origin+'/privacidad');await page.locator('#privacy-delete').click();
  await Promise.all([page.waitForEvent('load'),page.locator('#privacy-confirm-delete').click()]);await page.locator('h1').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('nexo.visitor_id')),null);assert.equal(await page.evaluate(()=>localStorage.getItem('nexo.auth.token')),null);assert.equal(await page.evaluate(()=>localStorage.getItem('nexo.guest.session')),null);assert.equal(deletes,3);
  assert.deepEqual(await page.evaluate(()=>window.__violations),[]);assert.deepEqual(errors,[]);
  await context.close();console.log(`Privacy/account/ticket/report-only UI OK: ${viewport.width}×${viewport.height}`);
 }
} finally { await browser.close(); }
