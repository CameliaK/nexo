import type { LiveMessage } from './backend/types';

/** The wire contract uses ts; persisted deployments may expose created_at. */
export function liveTimestamp(message: LiveMessage): string { return message.created_at || message.ts; }
export function compareLiveMessages(a: LiveMessage, b: LiveMessage): number {
  const difference=(Date.parse(liveTimestamp(a))||0)-(Date.parse(liveTimestamp(b))||0);
  return difference || (a.id<b.id?-1:a.id>b.id?1:0);
}
export function normalizeLiveMessage(value: unknown): LiveMessage | null {
  if(!value||typeof value!=='object')return null;
  const message=value as LiveMessage;
  if(typeof message.id!=='string'||!['visitor','owner'].includes(message.from)||typeof message.text!=='string')return null;
  const stamp=message.created_at||message.ts;
  if(typeof stamp!=='string'||!Number.isFinite(Date.parse(stamp)))return null;
  return {...message,ts:stamp};
}
