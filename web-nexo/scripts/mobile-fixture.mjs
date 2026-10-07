import { chromium, webkit, devices } from 'playwright';
export { chromium, webkit, devices };
export const origin=process.env.MOBILE_URL||'http://127.0.0.1:4196';
export const initialGame={id:'mobile-qa',color:'w',fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',moves:[],turn:'player',status:'active',updated_at:'2026-10-07T00:00:00Z'};
export async function mobileFixture(browser,options,language='es'){
 const context=await browser.newContext({...options}),page=await context.newPage(),errors=[],requests=[];let socket,game=structuredClone(initialGame);
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(lang=>{localStorage.setItem('nexo.welcome.dismissed.v1','1');localStorage.setItem('nexo.language',lang);localStorage.setItem('nexo.auth.token','mobile-fixture');localStorage.setItem('nexo.visitor_id','mobile-fixture')},language);
 await page.routeWebSocket(/\/ws\?/,ws=>socket=ws);
 await page.route('**/*',async route=>{
  const path=new URL(route.request().url()).pathname;requests.push({path,body:route.request().postDataJSON()});
  const data={
   '/api/v1/auth/me':{mode:'user',email_hint:'k***@example.com'},
   '/api/v1/ws-ticket':{ticket:crypto.randomUUID(),expires_in:30},
   '/api/v1/account/notifications':{chess_email:true},
   '/api/v1/session/nodes':{nodes:[]},'/api/v1/live/messages':{conversation_id:'mobile',messages:[]},
   '/api/v1/chess/game':{game},'/api/v1/chat':{run_id:'mobile-chat'},'/api/v1/live/messages/send':{run_id:'mobile-live',message_id:'mobile-msg'}
  };
  if(path==='/api/v1/live/messages'&&route.request().method()==='POST')return route.fulfill({status:202,json:{run_id:'mobile-live',message_id:'mobile-msg'}});
  if(path==='/api/v1/chess/game/move'){
   game={...game,fen:'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',turn:'owner',moves:[{san:'e4',uci:'e2e4',by:'player',ts:new Date().toISOString()}]};return route.fulfill({json:{game}});
  }
  if(data[path])return route.fulfill({status:path==='/api/v1/chat'?202:200,json:data[path]});
  return route.continue();
 });
 await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#floating-chess')?.getAttribute('aria-label')?.includes(' · ')&&!document.querySelector('#floating-chess')?.classList.contains('is-locked'));
 await page.waitForTimeout(300);
 return {context,page,errors,requests,send(type,seq,data,run_id='mobile-trace'){socket.send(JSON.stringify({v:2,type,seq,data,run_id,ts:new Date().toISOString()}))},async chess(){const box=await page.locator('#floating-chess').boundingBox();const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML,{x:box.x+box.width/2,y:box.y+box.height/2});if(!hit?.includes('floating-chess'))throw Error('Chess input intercepted: '+hit);await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await page.locator('.chess-scene.is-ready').waitFor().catch(error=>{console.error(errors);throw error});await page.waitForFunction(()=>document.querySelector('.chess-scene')?.dataset.transition==='resting')}};
}
