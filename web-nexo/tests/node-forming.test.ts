import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, isBackendEvent, type BackendEvent, type BackendArchitecture } from '../src/backend/types';
import { EventInbox } from '../src/backend/events';
import { RealBackend } from '../src/backend/real';
import { MockBackend } from '../src/backend/mock';
import { AUTH_TOKEN_KEY } from '../src/backend/identity';
import { TracePlayer } from '../src/system/traces';
import architecture from '../src/data/backend-architecture.json';
import { formationPhase } from '../src/node-forming';
import { motion } from '../src/motion';
const envelope=(type:string,seq:number,data:unknown)=>({v:2,type,run_id:'forming-contract',seq,ts:'2026-10-06T12:00:00Z',data});

test('node.forming validates real sources; motion tokens progress through threads, wireframe and a closing pulse under 1.5 s',()=>{
 assert.ok(EVENT_TYPES.includes('node.forming'));assert.equal(isBackendEvent(envelope('node.forming',2,{sources:['experiencia.infosys']})),true);assert.equal(isBackendEvent(envelope('node.forming',2,{sources:[null]})),false);
 const total=motion.formingThreads+motion.formingBuild+motion.formingPulse;assert.ok(total<1500);
 assert.equal(formationPhase(0).threads,0);assert.equal(formationPhase(motion.formingThreads).build,0);assert.equal(formationPhase(motion.formingThreads+motion.formingBuild/2).build,.5);
 assert.equal(formationPhase(total-motion.formingPulse/2).pulse,.5);assert.equal(formationPhase(total).done,true);assert.equal(formationPhase(total).light,0);assert.equal(formationPhase(0,true).done,true);
});
test('Real WS unknown types are sanitized and consume seq in both chat and traces; following forming/spawn/done still arrive in order',async()=>{
 const keys=['fetch','localStorage','WebSocket','location'] as const,old=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const),info=console.info;
 let socket:Socket|null=null,now=0;const logged:unknown[][]=[],delivered:BackendEvent[]=[];
 class Socket{
  onopen?:()=>void;onclose?:(e:{code:number})=>void;onmessage?:(e:{data:string})=>void;
  constructor(){socket=this;queueMicrotask(()=>this.onopen?.())}close(){this.onclose?.({code:1000})}
 }
 const globals={fetch:async()=>Response.json({ticket:'unique-ticket',expires_in:30}),localStorage:{getItem:(key:string)=>key===AUTH_TOKEN_KEY?'account':null,removeItem(){}},WebSocket:Socket,location:{host:'portfolio.test',protocol:'https:'}};
 for(const key of keys)Object.defineProperty(globalThis,key,{value:globals[key],configurable:true});console.info=(...args)=>logged.push(args);
 const backend=new RealBackend(),inbox=new EventInbox(e=>delivered.push(e)),traces=new TracePlayer(architecture as unknown as BackendArchitecture,()=>now);
 const stop=backend.onEvent(e=>{inbox.receive(e);traces.receive(e)});inbox.register('forming-contract');traces.register('forming-contract',false);
 try{
  await backend.connect();
  const generated={id:'gen_contract',generated:true,label:'Generated',summary:'Summary',created_at:'2026-10-06T12:00:00Z',sources:[{title:'CV'}],layout:'text',content:{body:'Body'}};
  const events=[envelope('run.done',6,{outcome:'generated',duration_ms:1500}),envelope('node.spawn',5,{anchor:null,node:generated}),envelope('answer.chunk',4,{text:'Complete'}),envelope('node.forming',3,{sources:['experiencia.infosys']}),envelope('future.forming.test',2,{secret:'Never log this token or message'}),envelope('run.start',1,{kind:'chat',content_version:3})];
  for(const event of events)(socket! as Socket).onmessage?.({data:JSON.stringify(event)});
  assert.deepEqual(delivered.map(e=>e.type),['run.start','node.forming','answer.chunk','node.spawn','run.done']);assert.deepEqual(delivered.map(e=>e.seq),[1,3,4,5,6]);assert.deepEqual(logged,[['future.forming.test']]);
  for(let i=0;i<8;i++){now=i*200;traces.tick()}assert.equal(traces.processed,5);
  assert.equal(delivered.some(e=>e.type==='event.ignored'),false);assert.equal(JSON.stringify(delivered).includes('Never log'),false);
 }finally{stop();backend.disconnect();console.info=info;for(const[key,descriptor]of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}
});
test('Unknown seq remains consumed before late registration; malformed forming does not freeze subsequent events',()=>{
 const info=console.info;console.info=()=>{};const delivered:BackendEvent[]=[],inbox=new EventInbox(e=>delivered.push(e));
 try{inbox.receive(envelope('run.start',1,{kind:'chat',content_version:3}));inbox.receive(envelope('future.late.test',2,{anything:'private'}));inbox.receive(envelope('node.forming',3,{sources:null}));inbox.receive(envelope('run.done',4,{outcome:'answer',duration_ms:1}));inbox.register('forming-contract');inbox.receive(envelope('answer.chunk',5,{text:'Too late'}));assert.deepEqual(delivered.map(e=>e.seq),[1,4])}finally{console.info=info}
});
test('Mock generated-ia emits node.forming with canonical node IDs immediately before spawn in a contiguous sequence',async()=>{
 let serial=0;const tasks:{id:number;at:number;fn:()=>void}[]=[],events:BackendEvent[]=[];
 const mock=new MockBackend({now:()=>0,schedule:(fn,at)=>{tasks.push({id:++serial,fn,at});return serial},cancel(){}});
 await mock.connect();const off=mock.onEvent(e=>events.push(e));mock.playScenario('generated-ia');for(const task of tasks.sort((a,b)=>a.at-b.at||a.id-b.id))task.fn();
 const index=events.findIndex(e=>e.type==='node.forming');assert.ok(index>0);assert.equal(events[index+1].type,'node.spawn');assert.deepEqual(events[index].data,{sources:['experiencia.infosys','aprendizaje.extras.infosys-ia']});assert.deepEqual(events.map(e=>e.seq),events.map((_,index)=>index+1));off();mock.disconnect();
});
