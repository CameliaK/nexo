import test from 'node:test';
import assert from 'node:assert/strict';
import { MockBackend, type Clock } from '../src/backend/mock';
import { RealBackend } from '../src/backend/real';
import { TracePlayer } from '../src/system/traces';
import type { BackendEvent, BackendArchitecture, TraceHopEvent } from '../src/backend/types';
import architecture from '../src/data/backend-architecture.json';
import scenarios from '../src/data/mock-scenarios.json';
import portfolio from '../src/data/portfolio-content.json';
import { EventInbox } from '../src/backend/events';
import { validateGeneratedNode, generatedSize } from '../src/backend/generated';
class FakeClock implements Clock {
  time=0;serial=0;tasks=new Map<number,{at:number;fn:()=>void}>();
  now=()=>this.time;
  schedule(fn:()=>void,delay:number){const id=++this.serial;this.tasks.set(id,{at:this.time+delay,fn});return id;}
  cancel(id:unknown){this.tasks.delete(id as number);}
  advance(ms:number){const end=this.time+ms;while(true){const next=[...this.tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.time=next[1].at;this.tasks.delete(next[0]);next[1].fn();}this.time=end;}
}
test('Mock: exact scenario order, cumulative delays, independent IDs and cancellation',async()=>{
  const clock=new FakeClock(),mock=new MockBackend(clock),events:BackendEvent[]=[],states:string[]=[];
  mock.onConnectionChange(state=>states.push(state));const unsubscribe=mock.onEvent(event=>events.push(event));await mock.connect();await mock.connect();
  assert.deepEqual(states,['closed','connecting','open']);const accepted=await mock.sendMessage('Infosys');clock.advance(0);assert.equal(events[0].type,'run.start');assert.equal(events[0].run_id,accepted.run_id);clock.advance(99);assert.equal(events.length,1);clock.advance(1);assert.equal(events.length,2);
  await assert.rejects(()=>mock.sendMessage('Otra pregunta'),{code:'busy'});
  clock.advance(30000);const source=scenarios.scenarios.find(s=>s.id==='route-infosys')!;
  assert.deepEqual(events.map(e=>e.type),source.events.map(e=>e.event.type));assert.deepEqual(events.map(e=>e.seq),source.events.map(e=>e.event.seq));assert.ok(events.every(e=>!JSON.stringify(e).includes('{{')));
  const second=await mock.sendMessage('error');assert.notEqual(second.run_id,accepted.run_id);mock.disconnect();const count=events.length;clock.advance(30000);assert.equal(events.length,count);unsubscribe();
});
test('Mock: all scenario outcomes, HTTP errors, fallback and plain text replacement',async()=>{
  const clock=new FakeClock(),mock=new MockBackend(clock);await mock.connect();
  for(const [question,outcome]of [['herramientas','generated'],['xyz qwerty','unknown'],['error','error']]){
    const events:BackendEvent[]=[];const off=mock.onEvent(e=>events.push(e));await mock.sendMessage(question);clock.advance(40000);const end=events.at(-1)!;assert.equal(end.type,outcome==='error'?'run.error':'run.done');if(end.type==='run.done')assert.equal(end.data.outcome,outcome);off();
  }
  await assert.rejects(()=>mock.sendMessage('/429'),{status:429,retryAfterSec:30,code:'rate_limited'});await assert.rejects(()=>mock.sendMessage('/409'),{status:409,code:'busy'});await assert.rejects(()=>mock.sendMessage(''),{code:'invalid_request'});
  const input='"<script> \n {{other}}';const events:BackendEvent[]=[];mock.onEvent(e=>events.push(e));await mock.sendLiveMessage(input);clock.advance(0);const start=events[0];assert.equal(start.type,'run.start');if(start.type==='run.start')assert.equal(start.data.input,input);
});
test('Mock: live-in is independent, follows live-out after 6 s, history and saved nodes survive reload',async()=>{
  const clock=new FakeClock(),store=new Map<string,string>(),storage={getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>{store.set(k,v)}};
  const mock=new MockBackend(clock,storage),events:BackendEvent[]=[];mock.onEvent(e=>events.push(e));await mock.connect();const out=await mock.sendLiveMessage('Hola');
  const outDuration=scenarios.scenarios.find(s=>s.id==='live-out')!.events.reduce((sum,e)=>sum+e.delay_ms,0);
  clock.advance(outDuration+5999);assert.equal(events.filter(e=>e.type==='run.start').length,1);clock.advance(1);const inbound=events.at(-1)!;assert.equal(inbound.type,'run.start');assert.notEqual(inbound.run_id,out.run_id);clock.advance(10000);
  const history=await mock.listLiveMessages();assert.equal(history.messages.length,2);assert.notEqual(history.messages[0].id,history.messages[1].id);assert.ok(history.conversation_id);
  await mock.sendMessage('herramientas');clock.advance(40000);const restored=new MockBackend(clock,storage);assert.deepEqual(await restored.listLiveMessages(),history);assert.equal((await restored.listGeneratedNodes()).length,1);await restored.deleteGeneratedNode('gen_ia_herramientas');assert.equal((await restored.listGeneratedNodes()).length,0);
});
function event(seq:number,type:BackendEvent['type'],data:unknown,run='test'):BackendEvent{return {v:2,run_id:run,seq,type,ts:new Date().toISOString(),data} as BackendEvent;}
const hop=(seq:number,id:string,from:string,to:string,phase:'start'|'end'|'error',run='test')=>event(seq,'trace.hop',{hop_id:id,from,to,phase,label:id},run);
test('Trace player: order, deduplication, overlapping hops, reverse edges and terminal cleanup',()=>{
  const clock=new FakeClock(),player=new TracePlayer(architecture as BackendArchitecture,clock.now);player.register('test');
  player.receive(hop(2,'h1','gateway','agent','start'));player.receive(event(1,'run.start',{kind:'chat',content_version:3}));player.tick();clock.advance(150);player.tick();assert.equal(player.light('agent').state,'active');
  player.receive(hop(3,'h2','agent','llm','start'));clock.advance(150);player.tick();assert.equal(player.light('agent').state,'active');assert.equal(player.light('llm').state,'active');
  const before=player.processed;player.receive(hop(3,'h2','agent','llm','start'));clock.advance(150);player.tick();assert.equal(player.processed,before);
  player.receive(hop(4,'h2','agent','llm','error'));clock.advance(550);player.tick();assert.equal(player.edge('llm','agent').state,'error');
  player.receive(event(5,'run.done',{outcome:'route',duration_ms:1000}));clock.advance(150);player.tick();assert.equal(player.light('agent').state,'done');assert.equal(player.light('llm').state,'error');clock.advance(4500);player.tick();assert.equal(player.light('agent').state,'idle');assert.equal(player.light('llm').state,'idle');
});
test('Trace player: unsolicited live-in accepted; other tabs and unknown components ignored',()=>{
  const clock=new FakeClock(),player=new TracePlayer(architecture as BackendArchitecture,clock.now);
  player.receive(event(1,'run.start',{kind:'chat',content_version:3},'other-tab'));player.receive(hop(2,'h','gateway','agent','start','other-tab'));player.tick();assert.equal(player.light('agent').state,'idle');
  player.receive(event(1,'run.start',{kind:'live_in',content_version:3},'incoming'));player.tick();player.receive(hop(2,'h','owner_channel','n8n','start','incoming'));clock.advance(150);player.tick();assert.equal(player.light('n8n').state,'active');assert.equal(player.edge('n8n','owner_channel').state,'active');assert.equal(player.edge('redis','gateway').state,'active');
  player.receive(hop(3,'unknown','missing','llm','start','incoming'));clock.advance(150);player.tick();assert.equal(player.light('llm').state,'idle');
});
test('Real backend: all HTTP methods require a token — reject 503 without connect()',async()=>{
  const backend=new RealBackend(),events:BackendEvent[]=[];backend.onEvent(e=>events.push(e));
  // Without a prior connect() the token is null — all HTTP methods reject immediately.
  await assert.rejects(()=>backend.sendMessage('Hola'),{status:503});
  await assert.rejects(()=>backend.listGeneratedNodes(),{status:503});
  await assert.rejects(()=>backend.deleteGeneratedNode('x'),{status:503});
  await assert.rejects(()=>backend.sendLiveMessage('Hola'),{status:503});
  await assert.rejects(()=>backend.listLiveMessages(),{status:503});
  assert.equal(events.length,0);
});

test('Chat inbox orders chunks, deduplicates, rejects other tabs and accepts live replies',()=>{
  const received:BackendEvent[]=[],inbox=new EventInbox(e=>received.push(e));inbox.register('test');
  inbox.receive(event(3,'answer.chunk',{text:'mundo'}));inbox.receive(event(2,'answer.chunk',{text:'Hola '}));
  inbox.receive(event(1,'run.start',{kind:'chat',content_version:3}));inbox.receive(event(2,'answer.chunk',{text:'duplicado'}));
  inbox.receive(event(4,'run.done',{outcome:'unknown',duration_ms:10}));inbox.receive(event(5,'answer.chunk',{text:'cerrado'}));
  assert.deepEqual(received.map(e=>e.seq),[1,2,3,4]);
  inbox.receive(event(1,'run.start',{kind:'chat',content_version:3},'other'));inbox.receive(event(2,'answer.chunk',{text:'ajeno'},'other'));
  inbox.receive(event(1,'run.start',{kind:'live_in',content_version:3},'owner'));
  assert.equal(received.length,5);assert.equal(received.at(-1)?.run_id,'owner');
});

test('Inbox + TracePlayer: late register approves events that arrived before the HTTP response (WS race)',()=>{
  // Simulate: WS events arrive before register() (HTTP POST resolves after WS push)
  const received:BackendEvent[]=[],inbox=new EventInbox(e=>received.push(e));
  inbox.receive(event(1,'run.start',{kind:'chat',content_version:3},'r1'));
  inbox.receive(event(2,'answer.chunk',{text:'streaming'},'r1'));
  inbox.receive(event(3,'run.done',{outcome:'route',duration_ms:100},'r1'));
  assert.equal(received.length,0,'nothing delivered before register');
  inbox.register('r1');
  assert.deepEqual(received.map(e=>e.seq),[1,2,3],'all events flushed in order on late register');
  // TracePlayer: same race
  const clock=new FakeClock(),player=new TracePlayer(architecture as BackendArchitecture,clock.now);
  player.receive(event(1,'run.start',{kind:'chat',content_version:3},'r2'));
  player.receive(hop(2,'h1','gateway','agent','start','r2'));
  player.tick();assert.equal(player.light('agent').state,'idle','no events processed before register');
  player.register('r2');player.tick();clock.advance(150);player.tick();
  assert.equal(player.light('agent').state,'active','events flushed and hop applied after late register');
});
test('Generated schema checks every layout, sources, nested IDs and bounds',()=>{
  const ids=new Set(portfolio.nodes.map(n=>n.id));
  const base={id:'gen_test',generated:true,label:'Prueba',summary:'Resumen',created_at:'2026-09-29T00:00:00Z',sources:[{title:'Infosys',ref:'experiencia.infosys'}]};
  const layouts=[{layout:'text',content:{body:'<script>solo texto</script>'}},{layout:'list',content:{items:['uno']}},{layout:'timeline',content:{entries:[{when:'2026',what:'Proyecto'}]}},{layout:'tags',content:{tags:['TypeScript']}},{layout:'metrics',content:{items:[{label:'Equipos',value:'3'}]}}];
  for(const layout of layouts)assert.equal(validateGeneratedNode({...base,...layout},ids),true);
  const node={...base,...layouts[0]};
  for(const invalid of [{...node,label:'x'.repeat(41)},{...node,content:{body:'x'.repeat(601)}},{...node,layout:'html'},{...node,sources:[{title:'Bad',ref:'javascript:alert(1)'}]},{...node,sources:[{title:'Missing',ref:'no-existe'}]},{...node,children:[{...node}]},{...node,children:[{...node,id:'gen_child',children:[]}]}])assert.equal(validateGeneratedNode(invalid,ids),false);
  assert.equal(validateGeneratedNode({...node,children:[{...node,id:'gen_child'}]},ids),true);
});

test('Mock persistence enforces 12 total generated nodes including children',async()=>{
  const sample=scenarios.scenarios.find(s=>s.id==='generated-ia')!.events.find(e=>e.event.type==='node.spawn')!.event.data as any;
  const saved=[0,1,2].map(i=>({...structuredClone(sample.node),id:'gen_saved_'+i,children:sample.node.children.map((c:any,j:number)=>({...c,id:`gen_saved_${i}_${j}`}))}));
  assert.equal(saved.reduce((n,node)=>n+generatedSize(node),0),12);
  const store=new Map([['nexo.mock.session.v2',JSON.stringify({conversation:null,messages:[],nodes:saved})]]),clock=new FakeClock();
  const mock=new MockBackend(clock,{getItem:k=>store.get(k)||null,setItem:(k,v)=>{store.set(k,v)}});await mock.connect();await mock.sendMessage('herramientas');clock.advance(40000);
  assert.equal((await mock.listGeneratedNodes()).length,3);await mock.deleteGeneratedNode('gen_saved_0');await mock.sendMessage('herramientas');clock.advance(40000);
  assert.equal((await mock.listGeneratedNodes()).reduce((n,node)=>n+generatedSize(node),0),12);
});
