import { CONTRACT_VERSION, EVENT_TYPES, isBackendEvent, type BackendEvent } from './types';
const loggedTypes = new Set<string>();
/** Unknown types consume their sequence slot, but never expose their payload to the UI. */
export function readBackendEvent(value: unknown): BackendEvent | null {
  if (isBackendEvent(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.v !== CONTRACT_VERSION || typeof event.type !== 'string' || typeof event.run_id !== 'string' || !Number.isSafeInteger(event.seq) || Number(event.seq) < 1) return null;
  if (event.type !== 'event.ignored' && !(EVENT_TYPES as readonly string[]).includes(event.type) && !loggedTypes.has(event.type)) {
    if (loggedTypes.size < 64) { loggedTypes.add(event.type); console.info(event.type); }
  }
  return { v: CONTRACT_VERSION, type: 'event.ignored', run_id: event.run_id, seq: Number(event.seq), ts: typeof event.ts === 'string' ? event.ts : '', data: {} };
}
