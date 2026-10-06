// @ts-nocheck -- Minimal DOM; exercise Chats through RealBackend with mocked HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chats } from '../src/chat';
import { RealBackend } from '../src/backend/real';
import { AUTH_TOKEN_KEY } from '../src/backend/identity';
import { languageStore, t } from '../src/i18n';

function setup(response:(path:string,request:any)=>Response){
 const oldDocument=globalThis.document,oldStorage=globalThis.localStorage,oldFetch=globalThis.fetch;
 class Element {
  children=[];childNodes=[];dataset={};attributes={};value='';textContent='';className='';hidden=false;disabled=false;handlers={};parentElement=null;
  append(...items){for(const item of items){item.parentElement?.removeChild(item);this.children.push(item);item.parentElement=this}}
  removeChild(item){this.children=this.children.filter(child=>child!==item)}
  replaceWith(item){const parent=this.parentElement;this.remove();parent?.append(item)}
  replaceChildren(...items){this.children=[];this.append(...items)}remove(){this.parentElement?.removeChild(this)}
  setAttribute(key,value){this.attributes[key]=value}getAttribute(key){return this.attributes[key]??null}removeAttribute(key){delete this.attributes[key]}
  addEventListener(key,fn){this.handlers[key]=fn}focus(){}blur(){}closest(){return null}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='*'||selector===child.tagName||selector==='#'+child.id||selector.startsWith('.')&&child.className.split(' ').includes(selector.slice(1))?[child]:[]),...child.querySelectorAll(selector)])}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 }
 const els=new Map(),make=(tag='div')=>{const el=new Element();el.tagName=tag;return el},get=(key)=>{if(!els.has(key))els.set(key,make());return els.get(key)};
 const doc={createTextNode:text=>{const e=make('text');e.textContent=text;return e},createElement:make,getElementById:get,querySelector:get,body:make('body')};globalThis.document=doc;
 const storage=new Map([[AUTH_TOKEN_KEY,'signed-in-token'],['nexo.visitor_id','visitor']]);globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const requests=[];globalThis.fetch=async(path,request)=>{requests.push({path,request});return response(String(path),request)};
 const backend=new RealBackend(),universe={openAgent(){},setUnread(){},setChatMessage(){},spawnGenerated(){},removeGenerated(){},isSystem:()=>false,nodeLabel:id=>id};
 const chats=new Chats(backend,universe,{register(){}},false);
 return{chats,requests,els,async ready(){await chats.connection('open')},dispose(){chats.dispose();globalThis.document=oldDocument;globalThis.localStorage=oldStorage;globalThis.fetch=oldFetch;languageStore.set('es')}};
}
const json=(value:any,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const ok=(path:string)=>json(path.includes('/live/')?{messages:[]}:path.includes('/session/')?{nodes:[]}:{run_id:'run',message_id:'msg'},path.includes('/chat')||path.includes('/live/messages')?202:200);
const error=(code:string,status:number)=>json({error:{code,message:'RAW INTERNAL DETAILS — never show'}},status,{'Retry-After':'7'});
const event=(run_id:string,seq:number,type:string,data:any)=>({v:2,run_id,seq,type,ts:new Date().toISOString(),data});

test('Agent HTTP errors busy/409, rate_limited, llm_unavailable and internal use ES/EN catalogues, never raw text',async()=>{
 for(const [code,status,key] of [['busy',409,'error.busy'],['rate_limited',429,'chat.errorRate'],['llm_unavailable',503,'chat.errorLLM'],['internal',500,'chat.errorInternal']]){
  const f=setup((path,request)=>request.method==='POST'?error(code,status):ok(path));
  try {languageStore.set('es');await f.ready();f.els.get('nexo-input').value='Hola';await f.chats.sendAgent();
   assert.equal(f.chats.errorRows.at(-1).element.textContent,t(key));assert.equal(f.chats.agentHistory.querySelector('p').textContent,'Hola');assert.equal(f.chats.agentHint.textContent.includes('RAW'),false);
   languageStore.set('en');f.chats.refreshLanguage();assert.equal(f.chats.errorRows.at(-1).element.textContent,t(key));assert.equal(f.chats.agentHint.textContent.includes(t(key)),true);
  }finally{f.dispose()}
 }
});
test('Agent and live HTTP 429 cooldowns are independent and respect Retry-After',async()=>{
 for(const blocked of ['agent','live']){
  const blockedPath=blocked==='agent'?'/api/v1/chat':'/api/v1/live/messages';
  const f=setup((path,request)=>request.method==='POST'&&path===blockedPath?error('rate_limited',429):ok(path));
  try {await f.ready();f.chats.agentInput.value='Pregunta';f.chats.liveInput.value='Mensaje';
   if(blocked==='agent')await f.chats.sendAgent();else await f.chats.sendLive();
   assert.equal(f.chats.agentSend.disabled,blocked==='agent');
   // The live input is cleared after sending; refill to test the cooldown itself.
   f.chats.liveInput.value='Otro';f.chats.refresh();assert.equal(f.chats.liveSend.disabled,blocked==='live');
   if(blocked==='agent')await f.chats.sendLive();else await f.chats.sendAgent();
   const posts=f.requests.filter(r=>r.request.method==='POST');assert.equal(posts.length,2);assert.notEqual(posts[0].path,posts[1].path);
   assert.ok((blocked==='agent'?f.chats.agentHint:f.chats.liveHint).textContent.includes('7'));
  }finally{f.dispose()}
 }
});
test('run.error retryable false removes Retry for agent and live, including WS arriving before HTTP acceptance',async()=>{
 for(const channel of ['agent','live'])for(const retryable of [false,true]){
  let f:any;
  f=setup((path,request)=>{
   if(request.method!=='POST')return ok(path);
   {
    f.chats.receive(event('run',1,'run.start',{kind:channel==='agent'?'chat':'live_out',input:'Pregunta'}));
    f.chats.receive(event('run',2,'run.error',{code:'internal',message:'RAW',retryable}));
   }
   return json({run_id:'run',message_id:'msg'},202);
  });
  try {await f.ready();
   if(channel==='agent'){f.chats.agentInput.value='Pregunta';await f.chats.sendAgent();assert.equal(f.chats.busy,false)}
   else{f.chats.liveInput.value='Mensaje';await f.chats.sendLive()}
   const history=channel==='agent'?f.chats.agentHistory:f.chats.liveHistory;assert.equal(history.querySelectorAll('.message-retry').length,retryable?1:0);
   assert.equal((channel==='agent'?f.chats.agentHint:f.chats.liveHint).textContent.includes('RAW'),false);
   languageStore.set('en');f.chats.refreshLanguage();assert.equal(history.querySelectorAll('.message-retry').length,retryable?1:0);
   if(channel==='live'&&!retryable){const before=f.requests.length;await f.chats.sendLive(f.chats.liveRows.get('msg'));assert.equal(f.requests.length,before)}
  }finally{f.dispose()}
 }
});
