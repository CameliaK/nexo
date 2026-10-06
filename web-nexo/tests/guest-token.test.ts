import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RealBackend } from '../src/backend/real';
import { GuestTokens, GUEST_TOKEN_KEY, GUEST_RETRY_KEY, retryAfterMs } from '../src/backend/guest-token';
import { AUTH_TOKEN_KEY } from '../src/backend/identity';
import { createConnectionNotice } from '../src/system/connection';
import { languageStore } from '../src/i18n';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function browser(){
 const keys=['fetch','localStorage','location','WebSocket','setTimeout','clearTimeout'] as const;
 const original=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const),oldNow=Date.now,oldRandom=Math.random;
 let now=1_800_000_000_000,serial=0,autoOpen=true;
 const values=new Map<string,string>([['nexo.visitor_id','visitor-a']]);
 const storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}};
 const tasks=new Map<number,{at:number;fn:()=>void}>(),requests:{path:string;headers:Headers;at:number;method:string}[]=[],sockets:Socket[]=[];
 class Socket{
  closed=false;
  onopen:(()=>void)|null=null;onclose:((event:{code:number})=>void)|null=null;onerror:(()=>void)|null=null;onmessage:((event:unknown)=>void)|null=null;
  constructor(public url:string){sockets.push(this);queueMicrotask(()=>{if(autoOpen)this.onopen?.();else this.onclose?.({code:1006})})}
  close(code=1000){this.closed=true;this.onclose?.({code})}
 }
 let route:(path:string,headers:Headers)=>Response|Promise<Response>=path=>path==='/auth/guest'?Response.json({token:'opaque-guest'}):Response.json(path.endsWith('/auth/me')?{mode:'guest'}:{run_id:'run',message_id:'message'});
 const globals={fetch:async(input:unknown,options?:RequestInit)=>{const path=String(input),headers=new Headers(options?.headers);requests.push({path,headers,at:now,method:options?.method||'GET'});if(path==='/api/v1/ws-ticket'){const response=await route(path,headers);if(!response.ok)return response;return Response.json({ticket:'ticket-'+requests.length,expires_in:30})}return route(path,headers)},localStorage:storage,location:{protocol:'https:',host:'portfolio.test'},WebSocket:Socket,setTimeout:(fn:()=>void,delay:number)=>{const id=++serial;tasks.set(id,{at:now+delay,fn});return id},clearTimeout:(id:number)=>{tasks.delete(id)}};
 for(const key of keys)Object.defineProperty(globalThis,key,{value:globals[key],configurable:true,writable:true});
 Date.now=()=>now;Math.random=()=>.5;
 const backends:RealBackend[]=[];
 return{storage,requests,sockets,tasks,get now(){return now},setRoute(fn:typeof route){route=fn},failSockets(){autoOpen=false},backend(){const backend=new RealBackend();backends.push(backend);return backend},guests:()=>requests.filter(r=>r.path==='/auth/guest'),
  async advance(ms:number){const end=now+ms;for(;;){const next=[...tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();await flush()}now=end;await flush()},
  async dispose(){for(const backend of backends)backend.disconnect();await flush();for(const[key,descriptor]of original)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);Date.now=oldNow;Math.random=oldRandom;languageStore.set('es')}
 };
}

test('Five automatic WS reconnections plus both chats and a reload reuse one persisted opaque guest token',async()=>{
 const b=browser(),real=b.backend();
 try{
  await real.connect();
  for(let i=0;i<5;i++){b.sockets.at(-1)!.close();await b.advance(1000);await real.sendMessage('Hola');await real.sendLiveMessage('Mensaje')}
  assert.equal(b.sockets.length,6);assert.equal(b.guests().length,1);
  assert.equal(b.requests.filter(r=>r.path==='/api/v1/ws-ticket').length,6);
  assert.equal(new Set(b.sockets.map(socket=>new URL(socket.url).searchParams.get('ticket'))).size,6);
  assert.ok(b.requests.filter(r=>r.path!=='/auth/guest').every(r=>r.headers.get('Authorization')==='Bearer opaque-guest'));
  assert.ok(b.sockets.every(socket=>new URL(socket.url).searchParams.has('ticket')&&!new URL(socket.url).searchParams.has('token')));
  real.disconnect();const reloaded=b.backend();await reloaded.connect();assert.equal(b.guests().length,1);
  assert.deepEqual(JSON.parse(b.storage.getItem(GUEST_TOKEN_KEY)!),{token:'opaque-guest',visitorId:'visitor-a',expiresAt:null});
  assert.ok(b.requests.every(r=>!r.path.includes('opaque-guest')),'HTTP credentials only use headers');
 }finally{await b.dispose()}
});
test('WS, agent and live chat concurrent consumers share a single in-flight guest request',async()=>{
 const b=browser(),real=b.backend();let release!:(response:Response)=>void;
 b.setRoute(path=>path==='/auth/guest'?new Promise(resolve=>{release=resolve}):Response.json({run_id:'run',message_id:'message'}));
 try{
  const consumers=[real.connect(),real.sendMessage('Hola'),real.sendLiveMessage('Mensaje')];await flush();assert.equal(b.guests().length,1);assert.equal(b.requests.length,1);
  release(Response.json({token:'shared-token'}));await Promise.all(consumers);assert.equal(b.guests().length,1);assert.equal(b.sockets.length,1);
  assert.ok(b.requests.slice(1).every(r=>r.headers.get('Authorization')==='Bearer shared-token'));
 }finally{await b.dispose()}
});
test('Three concurrent HTTP 401 responses renew a rejected guest token once and retry each operation once',async()=>{
 const b=browser(),real=b.backend();let count=0;
 b.setRoute((path,headers)=>path==='/auth/guest'?Response.json({token:++count===1?'old-token':'renewed-token'}):path!=='/api/v1/ws-ticket'&&headers.get('Authorization')==='Bearer old-token'?Response.json({error:{code:'unauthorized',message:'expired'}},{status:401}):Response.json({run_id:'run',message_id:'message',mode:'guest'}));
 try{
  await real.connect();await Promise.all([real.sendMessage('Hola'),real.sendLiveMessage('Mensaje'),real.authMe()]);
  assert.equal(b.guests().length,2);assert.equal(b.requests.filter(r=>r.path!=='/api/v1/ws-ticket'&&r.headers.get('Authorization')==='Bearer old-token').length,3);assert.equal(b.requests.filter(r=>r.headers.get('Authorization')==='Bearer renewed-token').length,3);
  assert.equal(JSON.parse(b.storage.getItem(GUEST_TOKEN_KEY)!).token,'renewed-token');
 }finally{await b.dispose()}
});
test('A WS handshake rejection verifies the cached guest over HTTP and renews only on a real 401',async()=>{
 const b=browser(),real=b.backend();let count=0;
 b.setRoute((path,headers)=>path==='/auth/guest'?Response.json({token:++count===1?'old-token':'renewed-token'}):path!=='/api/v1/ws-ticket'&&headers.get('Authorization')==='Bearer old-token'?new Response(null,{status:401}):Response.json({mode:'guest'}));
 try{await real.connect();b.sockets.at(-1)!.close(1006);await flush();assert.equal(b.guests().length,2);await b.advance(1000);assert.equal(b.sockets.length,2);assert.equal(b.requests.filter(r=>r.path==='/api/v1/ws-ticket').at(-1)!.headers.get('Authorization'),'Bearer renewed-token');assert.equal(b.guests().length,2)}
 finally{await b.dispose()}
});
test('Guest 429 obeys Retry-After across consumers/reloads and shows a localized nonblocking offline notice',async()=>{
 const b=browser();let attempts=0;
 b.setRoute(path=>path==='/auth/guest'?(++attempts===1?new Response(null,{status:429,headers:{'Retry-After':'60'}}):Response.json({token:'after-wait'})):Response.json({mode:'guest'}));
 const label={hidden:true,textContent:'',className:'',setAttribute(){},remove(){}},doc={createElement:()=>label,querySelector:()=>({append(){}})};
 const notice=createConnectionNotice(doc as unknown as Document);let real=b.backend();let stop=real.onConnectionChange(state=>notice.update(state));
 try{
  languageStore.set('es');await assert.rejects(()=>real.connect(),{status:429,retryAfterSec:60});assert.equal(label.hidden,false);assert.equal(label.textContent,'Sin conexión, reintentando');assert.equal(b.tasks.size,1);
  await Promise.all([assert.rejects(()=>real.sendMessage('Hola'),{status:429}),assert.rejects(()=>real.sendLiveMessage('Mensaje'),{status:429})]);assert.equal(b.guests().length,1);
  stop();real.disconnect();real=b.backend();stop=real.onConnectionChange(state=>notice.update(state));await assert.rejects(()=>real.connect(),{status:429});assert.equal(b.guests().length,1);
  languageStore.set('en');assert.equal(label.textContent,'Offline, retrying');await b.advance(59999);assert.equal(b.guests().length,1);assert.equal(b.sockets.length,0);
  await b.advance(1);assert.equal(b.guests().length,2);assert.equal(b.sockets.length,1);assert.equal(label.hidden,true);assert.equal(b.tasks.size,0);
 }finally{stop();notice.dispose();await b.dispose()}
});
test('Token endpoint outages back off 1/2/4/8/15 seconds, use jitter and never run duplicate reconnect loops',async()=>{
 const b=browser(),real=b.backend();b.setRoute(()=>new Response(null,{status:503}));
 try{
  await assert.rejects(()=>real.connect(),{status:503});const waits=[1000,2000,4000,8000,15000,15000];
  for(const wait of waits){assert.equal(b.tasks.size,1);assert.equal([...b.tasks.values()][0].at-b.now,wait);await b.advance(wait)}
  assert.equal(b.guests().length,7);Math.random=()=>0;await b.advance(15000);assert.equal([...b.tasks.values()][0].at-b.now,12750);
  real.disconnect();assert.equal(b.tasks.size,0);
 }finally{await b.dispose()}
});
test('Explicit expires_at ISO and Unix dates expire the cache; absent expiry never causes guessed renewal',async()=>{
 for(const format of ['iso','seconds','milliseconds','absent']){
  const b=browser(),real=b.backend();let count=0;
  b.setRoute(path=>path==='/auth/guest'?Response.json({token:'guest-'+ ++count,...(format==='absent'?{}:{expires_at:format==='iso'?new Date(b.now+2000).toISOString():format==='seconds'?(b.now+2000)/1000:b.now+2000})}):Response.json({run_id:'run'}));
  try{await real.connect();await real.sendMessage('Antes');assert.equal(b.guests().length,1);await b.advance(2000);await Promise.all([real.sendMessage('Después'),real.sendLiveMessage('Después')]);assert.equal(b.guests().length,format==='absent'?1:2)}
  finally{await b.dispose()}
 }
});
test('Email/Google sign-in discard the guest cache and use the account token; logout gets a different visitor-bound guest',async()=>{
 for(const method of ['email','google']){
  const b=browser(),real=b.backend();let count=0;
  b.setRoute(path=>path==='/auth/guest'?Response.json({token:'guest-'+ ++count}):path==='/auth/logout'?new Response(null,{status:204}):Response.json({token:'opaque-account',visitor_id:'canonical-user'}));
  try{
   await real.connect();const old=JSON.parse(b.storage.getItem(GUEST_TOKEN_KEY)!);if(method==='email')await real.verifyEmailLogin('link');else await real.exchangeCode('code');await flush();
   assert.equal(b.storage.getItem(GUEST_TOKEN_KEY),null);assert.equal(b.storage.getItem(AUTH_TOKEN_KEY),'opaque-account');assert.equal(b.guests().length,1);assert.equal(b.requests.filter(r=>r.path==='/api/v1/ws-ticket').at(-1)!.headers.get('Authorization'),'Bearer opaque-account');
   await real.logout();await flush();assert.equal(b.storage.getItem(AUTH_TOKEN_KEY),null);const fresh=JSON.parse(b.storage.getItem(GUEST_TOKEN_KEY)!);assert.notEqual(fresh.visitorId,old.visitorId);assert.notEqual(fresh.token,old.token);assert.equal(b.guests().length,2);
  }finally{await b.dispose()}
 }
});
test('Changing visitor_id invalidates a cached guest; clearing the cache rejects a late guest response',async()=>{
 const b=browser(),real=b.backend();let count=0;
 b.setRoute(path=>path==='/auth/guest'?Response.json({token:'guest-'+ ++count}):Response.json({run_id:'run'}));
 try{await real.connect();b.storage.setItem('nexo.visitor_id','visitor-b');await real.sendMessage('Hola');assert.equal(b.guests().length,2);assert.equal(JSON.parse(b.storage.getItem(GUEST_TOKEN_KEY)!).visitorId,'visitor-b')}
 finally{await b.dispose()}
 const storage={getItem:()=>null,setItem(){throw Error('private')},removeItem(){throw Error('private')}};
 const oldFetch=globalThis.fetch;let release!:(response:Response)=>void;globalThis.fetch=()=>new Promise<Response>(resolve=>{release=resolve});
 try{const tokens=new GuestTokens(storage),pending=tokens.get('visitor');tokens.clear();release(Response.json({token:'late-token'}));await assert.rejects(()=>pending,{status:503})}finally{globalThis.fetch=oldFetch}
});
test('Retry-After supports HTTP dates and missing/invalid values; private storage preserves in-memory reuse',async()=>{
 const now=Date.now();assert.equal(retryAfterMs('17',now),17000);assert.equal(retryAfterMs(new Date(now+60000).toUTCString(),now),Math.floor((now+60000)/1000)*1000-now);assert.equal(retryAfterMs('invalid',now),30000);assert.equal(retryAfterMs(null,now),30000);
 const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({token:'ephemeral'})};
 try{const tokens=new GuestTokens({getItem(){throw Error('private')},setItem(){throw Error('private')},removeItem(){throw Error('private')}});assert.deepEqual(await Promise.all([tokens.get('visitor'),tokens.get('visitor'),tokens.get('visitor')]),['ephemeral','ephemeral','ephemeral']);await tokens.get('visitor');assert.equal(calls,1);const source=fs.readFileSync('src/backend/guest-token.ts','utf8');assert.equal(source.includes('console.'),false);assert.equal(source.includes('atob('),false)}finally{globalThis.fetch=oldFetch}
});


test('Repeated failed WS handshakes keep the cached token when HTTP authorization still succeeds',async()=>{
 const b=browser(),real=b.backend();b.failSockets();
 try{await assert.rejects(()=>real.connect(),{status:503});for(const wait of [1000,2000,4000,8000,15000])await b.advance(wait);assert.equal(b.sockets.length,6);assert.equal(b.guests().length,1);assert.ok(b.requests.filter(r=>r.path==='/api/v1/auth/me').every(r=>r.headers.get('Authorization')==='Bearer opaque-guest'));assert.equal(b.tasks.size,1)}
 finally{await b.dispose()}
});
test('A second guest 401 is propagated after one renewal, discards the rejected cache and never changes visitor_id',async()=>{
 const b=browser(),real=b.backend();let count=0;
 b.setRoute(path=>path==='/auth/guest'?Response.json({token:'rejected-'+ ++count}):path==='/api/v1/ws-ticket'?Response.json({ticket:'valid-ticket',expires_in:30}):Response.json({error:{code:'unauthorized',message:'rejected'}},{status:401}));
 try{await real.connect();await assert.rejects(()=>real.authMe(),{status:401});assert.equal(b.guests().length,2);assert.equal(b.storage.getItem(GUEST_TOKEN_KEY),null);assert.equal(b.storage.getItem('nexo.visitor_id'),'visitor-a');assert.equal(b.tasks.size,0)}
 finally{await b.dispose()}
});
test('A guest Retry-After does not delay account sign-in; logout retains the IP wait without reusing any guest credential',async()=>{
 const b=browser(),real=b.backend();
 b.setRoute(path=>path==='/auth/guest'?new Response(null,{status:429,headers:{'Retry-After':'90'}}):path==='/auth/logout'?new Response(null,{status:204}):Response.json({token:'account-token',visitor_id:'canonical-user'}));
 try{await assert.rejects(()=>real.connect(),{status:429});await real.exchangeCode('code');await flush();assert.equal(b.guests().length,1);assert.equal(b.sockets.length,1);assert.equal(b.tasks.size,0);assert.equal(b.storage.getItem(GUEST_TOKEN_KEY),null);assert.equal(b.storage.getItem(AUTH_TOKEN_KEY),'account-token');await real.logout();await flush();assert.equal(b.guests().length,1);assert.equal(b.storage.getItem(GUEST_TOKEN_KEY),null);assert.equal(b.storage.getItem(AUTH_TOKEN_KEY),null);assert.equal([...b.tasks.values()][0].at-b.now,90000);assert.equal(Number(b.storage.getItem(GUEST_RETRY_KEY)),b.now+90000)}
 finally{await b.dispose()}
});


test('A rate-limited renewal closes the old WS before retrying after explicit token expiry',async()=>{
 const b=browser(),real=b.backend();let count=0;
 b.setRoute(path=>path==='/auth/guest'?(++count===2?new Response(null,{status:429,headers:{'Retry-After':'20'}}):Response.json({token:'guest-'+count,expires_at:new Date(b.now+2000).toISOString()})):Response.json({run_id:'run'}));
 try{
  await real.connect();const previous=b.sockets[0];await b.advance(2000);
  await assert.rejects(()=>real.sendMessage('Hola'),{status:429});assert.equal(previous.closed,true);assert.equal(b.sockets.length,1);assert.equal(b.tasks.size,1);
  await b.advance(19999);assert.equal(b.guests().length,2);assert.equal(b.sockets.length,1);
  await b.advance(1);assert.equal(b.guests().length,3);assert.equal(b.sockets.length,2);assert.equal(b.sockets[1].closed,false);assert.equal(b.tasks.size,0);
 }finally{await b.dispose()}
});

test('WS ticket 401 renews the opaque guest once, retries the ticket once and opens one socket',async()=>{
 const b=browser(),real=b.backend();let guests=0;
 b.setRoute((path,headers)=>path==='/auth/guest'?Response.json({token:++guests===1?'expired':'fresh'}):headers.get('Authorization')==='Bearer expired'?Response.json({error:{code:'unauthorized',message:'expired'}},{status:401}):Response.json({ticket:'single-use',expires_in:30}));
 try{
  await Promise.all([real.connect(),real.connect(),real.connect()]);
  assert.equal(b.guests().length,2);assert.equal(b.requests.filter(r=>r.path==='/api/v1/ws-ticket').length,2);assert.equal(b.sockets.length,1);
  assert.equal(b.requests.at(-1)!.headers.get('Authorization'),'Bearer fresh');assert.equal(new URL(b.sockets[0].url).searchParams.has('token'),false);
 }finally{await b.dispose()}
});
test('WS ticket 429 respects Retry-After for guest and account, manual connect cannot bypass it, and notice localizes',async()=>{
 for(const account of [false,true]){
  const b=browser();if(account)b.storage.setItem(AUTH_TOKEN_KEY,'account-token');const real=b.backend();let tickets=0;
  b.setRoute(path=>path==='/auth/guest'?Response.json({token:'guest'}):path==='/api/v1/ws-ticket'&&++tickets===1?new Response(null,{status:429,headers:{'Retry-After':'20'}}):Response.json({ticket:'retry-ticket',expires_in:30}));
  const label={hidden:true,textContent:'',className:'',setAttribute(){},remove(){}},doc={createElement:()=>label,querySelector:()=>({append(){}})};
  const notice=createConnectionNotice(doc as unknown as Document),stop=real.onConnectionChange(state=>notice.update(state));
  try{
   languageStore.set('es');await assert.rejects(()=>real.connect(),{status:429});assert.equal(label.textContent,'Sin conexión, reintentando');
   await assert.rejects(()=>real.connect(),{status:429});assert.equal(tickets,1);await b.advance(19999);assert.equal(b.sockets.length,0);assert.equal(tickets,1);
   languageStore.set('en');assert.equal(label.textContent,'Offline, retrying');await b.advance(1);assert.equal(tickets,2);assert.equal(b.sockets.length,1);assert.equal(label.hidden,true);
   assert.equal(b.guests().length,account?0:1);
  }finally{stop();notice.dispose();await b.dispose()}
 }
});
test('DELETE session/data uses the existing Bearer, keeps identity on 429, and clears local credentials only after 204',async()=>{
 for(const account of [false,true]){
  const b=browser();if(account)b.storage.setItem(AUTH_TOKEN_KEY,'account-token');const real=b.backend();let limit=true;
  b.storage.setItem('nexo.live.name','Personal name');b.storage.setItem('nexo.language','en');
  b.setRoute(path=>path==='/auth/guest'?Response.json({token:'guest-token'}):path==='/api/v1/session/data'?(limit?new Response(null,{status:429,headers:{'Retry-After':'9'}}):new Response(null,{status:204})):Response.json({ticket:'ticket',expires_in:30}));
  try{
   await real.connect();await assert.rejects(()=>real.deleteSessionData(),{status:429,retryAfterSec:9});assert.equal(b.storage.getItem('nexo.visitor_id'),'visitor-a');assert.equal(b.sockets[0].closed,false);
   limit=false;await real.deleteSessionData();assert.equal(b.storage.getItem('nexo.visitor_id'),null);assert.equal(b.storage.getItem(AUTH_TOKEN_KEY),null);assert.equal(b.storage.getItem(GUEST_TOKEN_KEY),null);assert.equal(b.storage.getItem('nexo.live.name'),null);assert.equal(b.storage.getItem('nexo.language'),'en');assert.equal(b.sockets[0].closed,true);
   assert.ok(b.requests.filter(r=>r.path==='/api/v1/session/data').every(r=>r.method==='DELETE'&&r.headers.get('Authorization')==='Bearer '+(account?'account-token':'guest-token')));
   await real.connect();assert.notEqual(b.storage.getItem('nexo.visitor_id'),'visitor-a');assert.equal(b.guests().length,account?1:2);
  }finally{await b.dispose()}
 }
});

test('A ticket Retry-After of zero retains the normal reconnect backoff instead of inventing a 30-second limit',async()=>{
 const b=browser(),real=b.backend();let attempts=0;
 b.setRoute(path=>path==='/auth/guest'?Response.json({token:'guest'}):++attempts===1?new Response(null,{status:429,headers:{'Retry-After':'0'}}):Response.json({ticket:'after-backoff',expires_in:30}));
 try{await assert.rejects(()=>real.connect(),{status:429,retryAfterSec:0});assert.equal([...b.tasks.values()][0].at-b.now,1000);await b.advance(1000);assert.equal(b.sockets.length,1);assert.equal(b.guests().length,1)}finally{await b.dispose()}
});
