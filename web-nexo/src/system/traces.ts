import { t, translateText } from '../i18n';
import { isBackendEvent } from '../backend/types';
import type { BackendArchitecture, BackendEvent, TraceHopEvent } from '../backend/types';
export type LightState = 'idle' | 'active' | 'done' | 'error';
export interface Hop { run: string; id: string; from: string; to: string; phase: LightState; label: string; detail: string; started: number; expires: number; duration?: number; }
interface Run { expected: number; buffer: Map<number, BackendEvent>; preauth: BackendEvent[]; queue: BackendEvent[]; next: number; allowed: boolean; }
export class TracePlayer {
  private known = new Set<string>();
  private runs = new Map<string, Run>();
  private rejected = new Set<string>();
  private hops = new Map<string, Hop>();
  private componentIds: Set<string>;
  private serial = 0;
  latest = t('trace.idle');
  processed = 0;
  constructor(private architecture: BackendArchitecture, private now = () => performance.now()) { this.componentIds = new Set(architecture.components.map(n => n.id)); }
  private edgeExists(from: string, to: string) { return this.architecture.edges.some(e => e.from === from && e.to === to || e.from === to && e.to === from); }
  register(run: string, outgoing = true) {
    this.known.add(run);
    if (outgoing) this.pulse(run, 'browser', 'traefik', t('trace.sending'));
    // Late-approval: flush preauth buffer if events arrived before register() was called.
    const existing = this.runs.get(run);
    if (existing && !existing.allowed) {
      existing.allowed = true;
      for (const event of existing.preauth) {
        existing.queue.push(event);
        this.pulse(run, 'redis', 'gateway', t('trace.received'));
        this.pulse(run, 'gateway', 'browser', t('trace.received'), 180);
      }
      existing.preauth = [];
    }
  }
  receive(value: unknown) {
    if (typeof value === 'object' && value && 'type' in value && (value.type === 'chess.move' || value.type === 'owner.chess')) return;
    if (!isBackendEvent(value) || !Number.isSafeInteger(value.seq) || value.seq < 1 || this.rejected.has(value.run_id)) return;
    const event = value;
    let run = this.runs.get(event.run_id);
    if (!run) {
      if (this.runs.size >= 64) return;
      run = { expected: 1, buffer: new Map(), preauth: [], queue: [], next: 0, allowed: false }; this.runs.set(event.run_id, run);
    }
    if (event.seq < run.expected || run.buffer.has(event.seq) || run.buffer.size >= 256) return;
    run.buffer.set(event.seq, event);
    while (run.buffer.has(run.expected)) {
      const current = run.buffer.get(run.expected)!; run.buffer.delete(run.expected++);
      if (current.type === 'run.start') {
        run.allowed = this.known.has(current.run_id) || current.data.kind === 'live_in';
      }
      if (!run.allowed) { run.preauth.push(current); continue; }
      run.queue.push(current);
      // These pulses belong to transport reception, not to a service-emitted hop.
      this.pulse(current.run_id, 'redis', 'gateway', t('trace.received'));
      this.pulse(current.run_id, 'gateway', 'browser', t('trace.received'), 180);
    }
  }
  private pulse(run: string, from: string, to: string, label: string, delay = 0) {
    const id = `transport:${++this.serial}`, started = this.now() + delay;
    this.hops.set(id, { id, run, from, to, phase: 'active', label, detail: '', started, expires: started + 650 });
  }
  private apply(event: BackendEvent, time: number) {
    this.processed++;
    if (event.type === 'trace.hop') {
      const data = event.data;
      if (!this.componentIds.has(data.from) || !this.componentIds.has(data.to) || !this.edgeExists(data.from, data.to)) return;
      const key = event.run_id + ':' + data.hop_id, old = this.hops.get(key);
      this.hops.set(key, { id: data.hop_id, run: event.run_id, from: data.from, to: data.to,
        phase: data.phase === 'start' ? 'active' : data.phase === 'end' ? 'done' : 'error',
        label: data.label || old?.label || '', detail: data.detail || '', duration: data.duration_ms,
        started: old?.started ?? time, expires: data.phase === 'start' ? Infinity : time + 4200 });
      this.latest = data.detail || data.label || old?.label || t('trace.hopDone');
    } else if (event.type === 'run.start') this.latest = event.data.kind === 'live_in' ? t('trace.liveIn') : t('trace.start');
    else if (event.type === 'run.done' || event.type === 'run.error') {
      for (const hop of this.hops.values()) if (hop.run === event.run_id && hop.expires === Infinity) { hop.phase = 'done'; hop.expires = time + 4200; }
      this.latest = event.type === 'run.error' ? event.data.message : t('trace.done');
    }
  }
  tick() {
    const time = this.now();
    for (const [id, run] of this.runs) {
      const next = run.queue[0]; if (!next || time < run.next) continue;
      if (next.type === 'trace.hop' && next.data.phase !== 'start') {
        const opened = this.hops.get(id + ':' + next.data.hop_id);
        if (opened && time < opened.started + 800) continue;
      }
      run.queue.shift(); this.apply(next, time); run.next = time + 120;
      if (next.type === 'run.done' || next.type === 'run.error') { this.runs.delete(id); this.known.delete(id); this.rejected.add(id); }
    }
    for (const [key, hop] of this.hops) if (time > hop.expires) this.hops.delete(key);
    if (this.rejected.size > 256) this.rejected.delete(this.rejected.values().next().value!);
  }
  light(id: string) { return this.summarize([...this.hops.values()].filter(h => h.to === id || h.from === id && h.id.startsWith('transport:'))); }
  edge(from: string, to: string) { return this.summarize([...this.hops.values()].filter(h => h.from === from && h.to === to || h.from === to && h.to === from)); }
  private summarize(hops: Hop[]) {
    const priority = { idle: 0, done: 1, active: 2, error: 3 }, time = this.now();
    const visible = hops.filter(h => time >= h.started && time <= h.expires).sort((a,b) => priority[b.phase] - priority[a.phase] || b.started - a.started);
    const hop = visible[0];
    return { state: hop?.phase || 'idle' as LightState, label: hop?.label || '', detail: hop?.detail || '', duration: hop?.duration, from: hop?.from, progress: hop ? ((time - hop.started) % 900) / 900 : 0 };
  }
  refreshLanguage(){this.latest=translateText(this.latest);for(const hop of this.hops.values()){hop.label=translateText(hop.label);hop.detail=translateText(hop.detail)}}
  disconnect() { for (const hop of this.hops.values()) if (hop.expires === Infinity) { hop.phase = 'error'; hop.detail = t('trace.lost'); hop.expires = this.now() + 4200; } this.runs.clear(); this.known.clear(); this.latest = t('trace.retry'); }
}
