import test from 'node:test';
import assert from 'node:assert/strict';
import { MockBackend } from '../src/backend/mock';
import { RealBackend } from '../src/backend/real';
import { BackendError, isBackendEvent, type BackendEvent } from '../src/backend/types';
import { AccountChess, errorText } from '../src/auth/session';
import { AccessState, accessRoute } from '../src/auth/access';
import { AUTH_TOKEN_KEY } from '../src/backend/identity';
import { languageStore, t } from '../src/i18n';
import { Chess } from 'chess.js';

const memory=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}};
async function login(mock:MockBackend){await mock.requestEmailLogin('visitor@example.com','es');const route=accessRoute(mock.simulatedLink()!)!;await mock.verifyEmailLogin(route.credential);}

test('Guest remains locked; owner data is never requested for guests or users',async()=>{
 languageStore.set('es');const mock=new MockBackend();let ownerRequests=0;const original=mock.ownerChessGames.bind(mock);mock.ownerChessGames=async()=>{ownerRequests++;return original()};
 const session=new AccountChess(mock);await session.refresh();assert.equal(session.me.mode,'guest');assert.equal(session.nodeLabel,t('auth.required'));assert.equal(session.canMove,false);assert.equal(ownerRequests,0);
 await assert.rejects(()=>mock.chessGetGame(),{status:401,code:'login_required'});await assert.rejects(()=>mock.ownerChessGames(),{status:401});ownerRequests=0;
 await login(mock);await session.refresh();assert.equal(ownerRequests,0);await assert.rejects(()=>mock.ownerChessGames(),{status:403,code:'forbidden'});
 await mock.setOwnerMode(true);await session.refresh();assert.equal(session.me.mode,'owner');assert.ok(session.ownerGames.length>=3);session.dispose();
});
test('Opening an email link never verifies it; explicit confirmation consumes it only once',async()=>{
 const mock=new MockBackend();await mock.requestEmailLogin('visitor@example.com','es');const route=accessRoute(mock.simulatedLink()!)!;let calls=0;const original=mock.verifyEmailLogin.bind(mock);mock.verifyEmailLogin=async token=>{calls++;return original(token)};
 let refreshes=0;const access=new AccessState(mock,()=>{},async()=>{refreshes++});access.navigate(route);assert.equal(calls,0);assert.equal((await mock.authMe()).mode,'guest');await access.confirm();assert.equal(calls,1);assert.equal(refreshes,1);assert.equal(access.status,'success');assert.equal((await mock.authMe()).mode,'user');await access.confirm();assert.equal(access.status,'error');assert.equal((access.error as BackendError).code,'unauthorized');access.dispose();
});
test('Email states cover sending, generic success, resend cooldown and Retry-After without revealing existence',async()=>{
 const mock=new MockBackend();let finish:()=>void=()=>{};mock.requestEmailLogin=()=>new Promise(resolve=>{finish=resolve});let now=0;const access=new AccessState(mock,()=>{},async()=>{},()=>now);
 const send=access.send('visitor@example.com');assert.equal(access.status,'sending');finish();await send;assert.equal(access.status,'sent');assert.equal(access.remaining,30);now=30000;assert.equal(access.remaining,0);
 mock.requestEmailLogin=async()=>{throw new BackendError('rate_limited','',429,73)};await access.send('another@example.com');assert.equal(access.status,'error');assert.equal(access.remaining,73);now+=73000;
 mock.requestEmailLogin=async()=>{throw new BackendError('internal','',500)};await access.send('another@example.com');assert.equal(access.remaining,0);assert.equal(errorText(access.error),t('auth.error'));
 const raw=new MockBackend();await raw.requestEmailLogin('new@example.com','es');assert.equal((await raw.authMe()).mode,'guest');access.dispose();
});
for(const [status,code] of [[409,'not_your_turn'],[422,'illegal_move']] as const)test(`Server ${status} rolls the speculative move back and shows the localized reason`,async()=>{
 const mock=new MockBackend();await login(mock);const session=new AccountChess(mock);await session.refresh();await session.newGame('w');const original=session.game!.fen;
 mock.chessMove=async()=>{throw new BackendError(code,'server text',status)};
 const positions:string[]=[];const off=session.subscribe(()=>positions.push(session.game!.fen));await session.move('e2e4');assert.ok(positions.some(fen=>fen!==original));assert.equal(session.game!.fen,original);assert.equal(session.game!.moves.length,0);assert.equal((session.error as BackendError).code,code);assert.equal(errorText(session.error),t(status===409?'chess.notYourTurn':'chess.illegalRemote'));off();session.dispose();
});
test('A saved server game resumes after reload, including the player color and email preference',async()=>{
 const storage=memory(),mock=new MockBackend(undefined,storage);await login(mock);const first=new AccountChess(mock);await first.refresh();await first.newGame('w');await first.move('e2e4');await first.setNotifications(false);const game=structuredClone(first.game);first.dispose();
 const restored=new AccountChess(new MockBackend(undefined,storage));await restored.refresh();assert.deepEqual(restored.game,game);assert.equal(restored.notifications,false);assert.equal(restored.canMove,false);assert.equal(restored.side,'w');restored.dispose();
});
test('An unsolicited chess.move updates a closed board and keeps its indicator until the player opens it',async()=>{
 const mock=new MockBackend();await login(mock);const session=new AccountChess(mock);await session.refresh();await session.newGame('w');await session.move('e2e4');const id=session.game!.id;await mock.setOwnerMode(true);await mock.ownerChessMove(id,'e7e5');assert.equal(session.unread,true);assert.equal(session.game!.moves.length,2);assert.equal(session.canMove,true);assert.equal(session.ownerGames.length,0);session.notify();assert.equal(session.unread,true);session.open(true);assert.equal(session.unread,false);session.dispose();
});
test('Owner board plays the opposite side, receives private events, and new player games are not lost to a WS race',async()=>{
 const mock=new MockBackend();await mock.setOwnerMode(true);const session=new AccountChess(mock);await session.refresh();const game=session.ownerGames.find(g=>g.turn==='owner'&&g.status==='active')!;assert.equal(session.selectOwner(game.id),true);assert.equal(session.side,'b');assert.equal(session.canMove,true);await session.move('e7e5');assert.equal(session.game!.moves.at(-1)!.by,'owner');assert.equal(session.canMove,false);
 session.selectPlayer();await session.newGame('w');assert.ok(session.playerGame);assert.equal(session.playerGame!.color,'w');assert.ok(session.ownerGames.some(g=>g.id===session.playerGame!.id));await session.resign();assert.equal(session.game!.status,'resigned');session.dispose();
});
test('404 and 503 auth/chess endpoints produce Coming soon without requesting owner data',async()=>{
 for(const status of [404,503]){const mock=new MockBackend();mock.authMe=async()=>{throw new BackendError('internal','',status)};const session=new AccountChess(mock);await session.refresh();assert.equal(session.available,false);assert.equal(session.nodeLabel,t('auth.soon'));session.dispose();}
 const mock=new MockBackend();await login(mock);mock.chessGetGame=async()=>{throw new BackendError('internal','',404)};const session=new AccountChess(mock);await session.refresh();assert.equal(session.available,false);session.dispose();
});
test('Hash routes keep confirmation and unsubscribe explicit; Google codes exchange on entry',async()=>{
 const mock=new MockBackend();let exchanged='',unsubscribed='';mock.exchangeCode=async code=>{exchanged=code;return {token:'test'}};mock.unsubscribe=async token=>{unsubscribed=token};const state=new AccessState(mock,()=>{},async()=>{});
 state.navigate(accessRoute('#/auth/unsubscribe?token=sample')!);assert.equal(unsubscribed,'');await state.confirm();assert.equal(unsubscribed,'sample');assert.equal(state.status,'success');state.navigate(accessRoute('#/login/done?code=sample-code')!);await new Promise(resolve=>setImmediate(resolve));assert.equal(exchanged,'sample-code');assert.equal(state.status,'success');assert.equal(accessRoute('#/login/confirm?t=encoded%2Btoken')!.credential,'encoded+token');state.dispose();
});
test('Chess events accept the new WS envelope independently of chat runs and reject malformed games',()=>{
 const game={id:'game',fen:new Chess().fen(),color:'w',moves:[],turn:'player',status:'active',updated_at:'now'};
 assert.equal(isBackendEvent({type:'chess.move',data:{game}}),true);assert.equal(isBackendEvent({type:'owner.chess',data:{game:{...game,tag:'A3F2',player_hint:'k***@gmail.com'},reason:'new'}}),true);assert.equal(isBackendEvent({type:'chess.move',data:{game:{id:'bad'}}}),false);
});
test('Language changes update lock and error text without replacing the resumed game',async()=>{
 const session=new AccountChess(new MockBackend());languageStore.set('es');assert.equal(session.nodeLabel,'Inicia sesión para jugar');languageStore.set('en');assert.equal(session.nodeLabel,'Sign in to play');assert.match(errorText(new BackendError('illegal_move','',422)),/server rejected/);session.dispose();languageStore.set('es');
});
test('Real endpoints serialize bodies and Bearer tokens; 401 login_required never retries as a guest',async()=>{
 const fetchOriginal=globalThis.fetch,storageOriginal=Object.getOwnPropertyDescriptor(globalThis,'localStorage');const storage=memory();storage.setItem(AUTH_TOKEN_KEY,'signed-session');Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});const requests:{path:string;options:RequestInit|undefined}[]=[];
 const initial=new Chess().fen(),game={id:'game/id',fen:initial,color:'w',moves:[],turn:'player',status:'active',updated_at:'now'};
 globalThis.fetch=async(path,options)=>{requests.push({path:String(path),options});const p=String(path);if(p.endsWith('/move'))return new Response(JSON.stringify({error:{code:'login_required',message:'login'}}),{status:401});if(p.endsWith('/notifications'))return Response.json({chess_email:true});if(p.endsWith('/auth/me'))return Response.json({mode:'user',email_hint:'v***@example.com'});if(p.endsWith('/games'))return Response.json({games:[]});if(p==='/auth/email/request')return new Response(null,{status:202});return Response.json({game});};
 try {const real=new RealBackend();await real.requestEmailLogin('visitor@example.com','en');await real.authMe();await real.getNotifications();await real.setNotifications({chess_email:false});await real.chessGetGame();await real.chessNewGame('b');await real.ownerChessGames();await assert.rejects(()=>real.chessMove('e2e4'),{code:'login_required',status:401});assert.equal(requests.filter(r=>r.path==='/auth/guest').length,0);assert.equal((requests[0].options!.headers as Record<string,string>).Authorization,undefined);assert.equal((requests[1].options!.headers as Record<string,string>).Authorization,'Bearer signed-session');assert.deepEqual(JSON.parse(requests[0].options!.body as string),{email:'visitor@example.com',lang:'en'});assert.deepEqual(JSON.parse(requests.find(r=>r.path==='/api/v1/chess/game'&&r.options?.method==='POST')!.options!.body as string),{color:'b'});}
 finally{globalThis.fetch=fetchOriginal;if(storageOriginal)Object.defineProperty(globalThis,'localStorage',storageOriginal);else Reflect.deleteProperty(globalThis,'localStorage');}
});

// Shared fake browser for RealBackend sign-in tests: storage, location, WebSocket and a fetch
// that records every request with its headers.
async function withFakeBrowser(fn:(env:{storage:ReturnType<typeof memory>;requests:{path:string;headers:Record<string,string>}[];route:(handler:(path:string,headers:Record<string,string>)=>Response)=>void})=>Promise<void>){
 const descriptors=['fetch','localStorage','WebSocket','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 class Socket {onopen:()=>void=()=>{};onclose:()=>void=()=>{};onmessage:((e:any)=>void)|undefined;onerror:(()=>void)|undefined;constructor(public url:string){queueMicrotask(()=>this.onopen())}close(){queueMicrotask(()=>this.onclose())}}
 const storage=memory(),requests:{path:string;headers:Record<string,string>}[]=[];let handler:(path:string,headers:Record<string,string>)=>Response=()=>new Response(null,{status:500});
 Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});Object.defineProperty(globalThis,'location',{value:{protocol:'https:',host:'portfolio.test'},configurable:true});Object.defineProperty(globalThis,'WebSocket',{value:Socket,configurable:true});
 globalThis.fetch=async(path,options)=>{const headers={...(options?.headers as Record<string,string>|undefined)};requests.push({path:String(path),headers});return handler(String(path),headers)};
 try{await fn({storage,requests,route:h=>{handler=h}})}
 finally{for(const [key,descriptor] of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
}

test('Sign-in adopts visitor_id from the body; the opaque token is never decoded and response headers are ignored',async()=>{
 for(const signIn of ['verify','exchange'] as const)await withFakeBrowser(async({storage,requests,route})=>{
  storage.setItem('nexo.visitor_id','anon-id');const token='v4.local.opaque';
  route(path=>path==='/auth/guest'?Response.json({token:'guest-token'}):Response.json({token,visitor_id:'canonical-body'},{headers:{'X-Visitor-Id':'header-is-not-the-contract'}}));
  const real=new RealBackend();const result=signIn==='verify'?await real.verifyEmailLogin('one-use-link'):await real.exchangeCode('one-use-code');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(result.visitor_id,'canonical-body');assert.equal(storage.getItem('nexo.visitor_id'),'canonical-body');assert.equal(storage.getItem(AUTH_TOKEN_KEY),token);
  // The adopted session reconnects with its own token, never as a guest again.
  const guestCalls=requests.filter(r=>r.path==='/auth/guest').length;real.disconnect();await real.connect();assert.equal(requests.filter(r=>r.path==='/auth/guest').length,guestCalls);real.disconnect();
 });
});

test('verify and exchange send the current guest token as Bearer so anonymous data follows the account',async()=>{
 for(const signIn of ['verify','exchange'] as const)await withFakeBrowser(async({storage,requests,route})=>{
  storage.setItem('nexo.visitor_id','anon-id');
  route((path,headers)=>path==='/auth/guest'?(headers['X-Visitor-Id']==='anon-id'?Response.json({token:'guest-token'}):new Response(null,{status:400})):Response.json({token:'v4.local.user',visitor_id:'anon-id'}));
  // A fresh page (Google redirect, link opened in a new tab) has no guest token in memory yet.
  const real=new RealBackend();if(signIn==='verify')await real.verifyEmailLogin('link');else await real.exchangeCode('code');
  const path=signIn==='verify'?'/auth/email/verify':'/auth/exchange';const call=requests.find(r=>r.path===path)!;
  assert.equal(call.headers.Authorization,'Bearer guest-token');
  assert.ok(requests.findIndex(r=>r.path==='/auth/guest')<requests.indexOf(call),'guest token is obtained before signing in');
  assert.equal(storage.getItem('nexo.visitor_id'),'anon-id');real.disconnect();
 });
});

test('A signed-in browser signs in again without a guest Bearer, and a failing /auth/guest does not block sign-in',async()=>{
 await withFakeBrowser(async({storage,requests,route})=>{
  storage.setItem(AUTH_TOKEN_KEY,'v4.local.current-user');route(()=>Response.json({token:'v4.local.other',visitor_id:'other-id'}));
  const real=new RealBackend();await real.verifyEmailLogin('link');
  assert.equal(requests.some(r=>r.path==='/auth/guest'),false);assert.equal(requests.find(r=>r.path==='/auth/email/verify')!.headers.Authorization,undefined);real.disconnect();
 });
 await withFakeBrowser(async({storage,requests,route})=>{
  storage.setItem('nexo.visitor_id','anon-id');route(path=>path==='/auth/guest'?new Response(null,{status:503}):Response.json({token:'v4.local.user',visitor_id:'fresh-id'}));
  const real=new RealBackend();const result=await real.exchangeCode('code');
  assert.equal(result.visitor_id,'fresh-id');assert.equal(requests.find(r=>r.path==='/auth/exchange')!.headers.Authorization,undefined);assert.equal(storage.getItem('nexo.visitor_id'),'fresh-id');real.disconnect();
 });
});

test('Account removal clears player data and pending mock access links; notifications and owner switching stay usable',async()=>{
 const storage=memory(),mock=new MockBackend(undefined,storage);await login(mock);const session=new AccountChess(mock);await session.refresh();await session.newGame('b');await session.setNotifications(false);assert.equal(session.notifications,false);await mock.setOwnerMode(true);await session.refresh();assert.equal(session.me.mode,'owner');await mock.setOwnerMode(false);await session.refresh();assert.equal(session.me.mode,'user');await session.signOut(true);assert.equal(session.me.mode,'guest');assert.equal(session.playerGame,null);assert.equal(session.ownerGames.length,0);assert.equal(mock.simulatedLink(),null);const saved=JSON.parse(storage.getItem('nexo.mock.account.v1')!);assert.equal(saved.email,'');assert.equal(saved.game,null);assert.equal(saved.settings.chess_email,true);session.dispose();
});
