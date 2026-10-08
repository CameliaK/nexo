// @ts-nocheck -- Minimal DOM; exercise Chats through RealBackend with mocked HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chats } from '../src/chat';
import { RealBackend } from '../src/backend/real';
import { AUTH_TOKEN_KEY } from '../src/backend/identity';
import { languageStore, t, translateUI } from '../src/i18n';
import liveContract from './fixtures/live-contract.json';

function setup(response:(path:string,request:any)=>Response){
 const oldDocument=globalThis.document,oldStorage=globalThis.localStorage,oldFetch=globalThis.fetch;
 class Element {
  classList={contains:name=>this.className.split(' ').includes(name)};
  children=[];childNodes=[];dataset={};attributes={};value='';textContent='';className='';hidden=false;disabled=false;handlers={};parentElement=null;
  append(...items){for(const item of items){item.parentElement?.removeChild(item);this.children.push(item);item.parentElement=this}}
  removeChild(item){this.children=this.children.filter(child=>child!==item)}
  insertBefore(item,before){item.parentElement?.removeChild(item);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,item);item.parentElement=this}
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

test('Three localized discovery suggestions only fill the draft; they never send a request',async()=>{
 const f=setup((path)=>ok(path));
 try{
  await f.ready();const group=f.els.get('.panel-compose').querySelector('.chat-suggestions'),buttons=group.children;
  assert.equal(buttons.length,3);assert.equal(group.getAttribute('role'),'group');
  const expected={
   es:['Créame un nodo con las tecnologías de frontend de Kirbith','Créame un nodo con la experiencia de Kirbith en IA','Créame un nodo con las bases de datos de Kirbith'],
   en:["Create a node with Kirbith's frontend technologies","Create a node with Kirbith's AI experience","Create a node with Kirbith's databases"]
  };
  for(const language of ['es','en']){
   languageStore.set(language);f.chats.refreshLanguage();
   // The minimal DOM keeps panel-compose outside companion-panel; relabel that subtree too.
   translateUI(group);
   for(const [index,label]of expected[language].entries()){
    const before=f.requests.length;assert.equal(buttons[index].textContent,label);
    buttons[index].onclick();assert.equal(f.chats.agentInput.value,label);
    assert.equal(f.requests.length,before);assert.equal(buttons[index].type,'button');
   }
  }
 }finally{f.dispose()}
});
test('Ordered forming/spawn real events reach the universe with their run ID; malformed sources and terminal events are handled',async()=>{
 const f=setup(path=>ok(path)),calls=[];f.chats.universe.formGenerated=(...args)=>calls.push(['forming',...args]);f.chats.universe.spawnGenerated=(...args)=>calls.push(['spawn',...args]);f.chats.universe.finishForming=id=>calls.push(['finish',id]);
 try{
  f.chats.register('forming-chat');const node={id:'gen_forming_chat',generated:true,label:'Node',summary:'Summary',created_at:'2026-10-06T00:00:00Z',sources:[{title:'CV'}],layout:'text',content:{body:'Body'}};
  f.chats.receive(event('forming-chat',3,'node.spawn',{anchor:null,node}));f.chats.receive(event('forming-chat',2,'node.forming',{sources:['experiencia.infosys','missing']}));f.chats.receive(event('forming-chat',1,'run.start',{kind:'chat',content_version:3}));f.chats.receive(event('forming-chat',4,'run.done',{outcome:'generated',duration_ms:1000}));
  assert.deepEqual(calls[0],['forming','forming-chat',['experiencia.infosys']]);assert.equal(calls[1][0],'spawn');assert.equal(calls[1][4],'forming-chat');assert.deepEqual(calls[2],['finish','forming-chat']);assert.equal(f.chats.busy,false);
 }finally{f.dispose()}
});

test('Answer streaming stays visible in the compact panel while the generated camera view is active',()=>{
 const f=setup(path=>ok(path));try{document.body.className='generated-camera-focused';const body=document.querySelector('#companion-panel .panel-body');body.scrollHeight=123;f.chats.register('stream-focus');f.chats.receive(event('stream-focus',1,'run.start',{kind:'chat',content_version:3}));f.chats.receive(event('stream-focus',2,'answer.chunk',{text:'Still completing'}));assert.equal(body.scrollTop,123);assert.equal(f.chats.runs.get('stream-focus').answer.textContent,'Still completing')}finally{f.dispose()}
});

test('Real live contract: 202 is Sent without waiting for WS; disconnect never fails accepted/history/owner messages',async()=>{
 const f=setup((path,request)=>request.method==='POST'?json(liveContract.accepted,202):path.includes('/live/')?json(liveContract.history):ok(path));
 try{
  await f.ready();f.chats.liveInput.value='A new message';await f.chats.sendLive();
  assert.equal(f.chats.liveRows.get(liveContract.accepted.message_id).state,'sent');
  for(const message of liveContract.history.messages)assert.equal(f.chats.liveRows.get(message.id).state,'delivered_to_owner');
  await f.chats.connection('reconnecting');
  assert.equal(f.chats.liveHistory.querySelectorAll('.message-retry').length,0);
  assert.equal(f.chats.liveRows.get(liveContract.accepted.message_id).state,'sent');
 }finally{f.dispose()}
});
test('Real live contract: delivery before/after HTTP acceptance is correlated by run and message ID',async()=>{
 for(const early of [true,false]){
  let f;const deliver=()=>{for(const e of liveContract.outgoing)f.chats.receive(e)};
  f=setup((path,request)=>{if(request.method!=='POST')return ok(path);if(early)deliver();return json(liveContract.accepted,202)});
  try{
   await f.ready();f.chats.liveInput.value='Hello';await f.chats.sendLive();if(!early)deliver();
   assert.equal(f.chats.liveRows.size,1);assert.equal(f.chats.liveRows.get(liveContract.accepted.message_id).state,'delivered_to_owner');
   assert.equal(f.chats.liveHistory.querySelectorAll('.message-retry').length,0);
   for(const e of liveContract.incoming)f.chats.receive(e);
   const owner=f.chats.liveRows.get(liveContract.owner.id);assert.equal(owner.state,'delivered_to_owner');
   // An unrelated/malformed delivery must never make an owner reply retryable.
   f.chats.delivery(owner.message.id,'failed');assert.equal(owner.root.querySelector('.message-retry'),null);
  }finally{f.dispose()}
 }
});
test('Real live contract: only genuine POST/explicit failures allow own retry; successful retry replaces the row',async()=>{
 for(const network of [true,false]){
  let attempt=0;const f=setup((path,request)=>{
   if(request.method!=='POST')return ok(path);
   if(++attempt===1){if(network)throw new TypeError('Network failed');return error('internal',500)}
   return json(liveContract.accepted,202);
  });
  try{
   await f.ready();f.chats.liveInput.value='Retry this';await f.chats.sendLive();const row=[...f.chats.liveRows.values()][0];
   assert.equal(row.state,'failed');assert.equal(row.status.textContent,t('chat.failed'));assert.ok(row.root.querySelector('.message-retry'));
   const root=row.root;await f.chats.sendLive(row);assert.equal(f.chats.liveRows.size,1);assert.equal(row.root,root);
   assert.equal(row.state,'sent');assert.equal(row.root.querySelector('.message-retry'),null);
  }finally{f.dispose()}
 }
});

test('Descending history is sorted oldest first with stable ID ties; created_at is supported and optimistic echoes merge in place',async()=>{
 const history=JSON.parse(JSON.stringify(liveContract.history).replaceAll('2026-10-08','2020-10-08'));
 const f=setup((path,request)=>request.method==='POST'?json(liveContract.accepted,202):path.includes('/live/')?json(history):ok(path));
 try{
  await f.ready();const ids=()=>f.chats.liveHistory.children.map(e=>e.dataset.messageId);
  assert.deepEqual(ids(),['visitor-history','owner-history']);
  for(const id of ['z','a'])f.chats.addLive({id,from:'owner',text:id,created_at:'2020-10-08T12:02:00Z'});
  assert.deepEqual(ids(),['visitor-history','owner-history','a','z']);
  f.chats.liveInput.value='New';await f.chats.sendLive();const row=f.chats.liveRows.get(liveContract.accepted.message_id),date=row.message.ts,root=row.root;
  f.chats.addLive({id:row.message.id,from:'visitor',text:'New',created_at:'2026-10-08T12:02:30Z'});
  assert.equal(f.chats.liveRows.size,5);assert.equal(row.root,root);assert.equal(row.message.ts,date);assert.equal(ids().at(-1),row.message.id);
 }finally{f.dispose()}
});
test('Live scroll follows opening and own sends, preserves reading position for incoming messages and offers a localized jump control',async()=>{
 const f=setup(path=>ok(path));
 try{
  await f.ready();f.chats.liveOpen=true;const history=f.chats.liveHistory;history.scrollHeight=1000;history.clientHeight=200;history.scrollTop=0;history.handlers.scroll();
  f.chats.addLive(liveContract.owner);assert.equal(history.scrollTop,0);assert.equal(f.chats.liveNew.hidden,false);
  assert.ok(f.chats.liveNew.innerHTML.includes('data-icon="down"'));languageStore.set('en');f.chats.refreshLanguage();assert.equal(f.chats.liveNew.querySelector('span').textContent,'New message');
  f.chats.liveNew.onclick();assert.equal(history.scrollTop,1000);assert.equal(f.chats.liveNew.hidden,true);
  history.scrollTop=0;history.handlers.scroll();f.chats.liveInput.value='Own send';await f.chats.sendLive();assert.equal(history.scrollTop,1000);assert.equal(f.chats.liveNew.hidden,true);
 }finally{f.dispose()}
});
