import { readBackendEvent } from './wire-events';
import type { BackendEvent } from './types';

/** Ordered delivery shared by the chat UI. Unknown runs from other tabs never
 * affect this tab; owner replies are allowed without an outgoing request. */
export class EventInbox {
  private known=new Set<string>();
  private runs=new Map<string,{next:number;allowed:boolean;pending:Map<number,BackendEvent>;preauth:BackendEvent[]}>();
  private closed=new Set<string>();
  constructor(private deliver:(event:BackendEvent)=>void){}
  register(id:string){
    this.known.add(id);
    // Late-approval: WS events can arrive before the HTTP response that carries run_id.
    const run=this.runs.get(id);
    if(run&&!run.allowed){
      run.allowed=true;
      for(const event of run.preauth){this.deliver(event);if(event.type==='run.done'||event.type==='run.error'){this.finish(id);return}}
      run.preauth=[];
      while(run.pending.has(run.next)){
        const event=run.pending.get(run.next)!;run.pending.delete(run.next++);
        this.deliver(event);
        if(event.type==='run.done'||event.type==='run.error'){this.finish(id);return}
      }
    }
  }
  receive(input:unknown){
    const value = readBackendEvent(input);
    if (typeof value === 'object' && value && 'type' in value && (value.type === 'chess.move' || value.type === 'owner.chess')) return;
    if(!value||!Number.isSafeInteger(value.seq)||value.seq<1||this.closed.has(value.run_id))return;
    let run=this.runs.get(value.run_id);
    if(!run){if(this.runs.size>=64)return;run={next:1,allowed:false,pending:new Map(),preauth:[]};this.runs.set(value.run_id,run)}
    if(value.seq<run.next||run.pending.has(value.seq)||run.pending.size>=256)return;
    run.pending.set(value.seq,value);
    while(run.pending.has(run.next)){
      const event=run.pending.get(run.next)!;run.pending.delete(run.next++);
      if(event.type==='event.ignored')continue;
      if(event.type==='run.start'&&event.data.kind==='chess'){this.finish(event.run_id);return}
      if(event.type==='run.start'){run.allowed=this.known.has(event.run_id)||event.data.kind==='live_in'}
      if(!run.allowed){run.preauth.push(event);continue}
      this.deliver(event);
      if(event.type==='run.done'||event.type==='run.error'){this.finish(event.run_id);return}
    }
  }
  private finish(id:string){this.runs.delete(id);this.known.delete(id);this.closed.add(id);if(this.closed.size>256)this.closed.delete(this.closed.values().next().value!)}
  reset(){this.runs.clear();this.known.clear()}
}
