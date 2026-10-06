import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { TracePlayer } from '../src/system/traces';
import { createSystemWindow } from '../src/system/window';
import architecture from '../src/data/backend-architecture.json';
import { BackendError, type BackendArchitecture, type BackendEvent, type OwnerChessGame } from '../src/backend/types';
import { EventInbox } from '../src/backend/events';
import { MockBackend } from '../src/backend/mock';
import { RealBackend } from '../src/backend/real';
import { AUTH_TOKEN_KEY } from '../src/backend/identity';
import { AccountChess } from '../src/auth/session';
import { createOwnerChessRoute, ownerChessRoute } from '../src/auth/owner-route';
import { languageStore, t } from '../src/i18n';

const ts = '2026-10-05T18:00:00.000Z';
const envelope = (type: BackendEvent['type'], data: unknown, seq: number, run_id = 'chess-action') => ({ v: 2, type, run_id, seq, ts, data });
// Gateway + agent contract: shared sequence, no input or HTTP run_id registration.
const traceEvents = [
  envelope('run.start', { kind: 'chess', content_version: 2 }, 1),
  envelope('trace.hop', { hop_id: 'g1', from: 'gateway', to: 'agent', phase: 'start', label: 'Validando jugada' }, 2),
  envelope('trace.hop', { hop_id: 'a1', from: 'agent', to: 'postgres', phase: 'start', label: 'Guardando partida' }, 3),
  envelope('trace.hop', { hop_id: 'a1', from: 'agent', to: 'postgres', phase: 'end', duration_ms: 0 }, 4),
  envelope('trace.hop', { hop_id: 'a2', from: 'agent', to: 'redis', phase: 'start', label: 'Avisando al dueño' }, 5),
  envelope('trace.hop', { hop_id: 'a2', from: 'agent', to: 'redis', phase: 'end', duration_ms: 0 }, 6),
  envelope('trace.hop', { hop_id: 'g1', from: 'gateway', to: 'agent', phase: 'end', duration_ms: 40 }, 7),
  envelope('run.done', { outcome: 'delivered', duration_ms: 41 }, 8),
];
function game(id = 'game/one'): OwnerChessGame {
  const chess = new Chess(); chess.move('e2e4');
  return { id, tag: 'A3F2', player_hint: 'k***@gmail.com', color: 'w', fen: chess.fen(), moves: [{ san: 'e4', uci: 'e2e4', by: 'player', ts }], turn: 'owner', status: 'active', updated_at: ts };
}
function movedGame(initial = game()): OwnerChessGame {
  const chess = new Chess(initial.fen); chess.move('e7e5');
  const updated_at = '2026-10-05T18:01:00.000Z';
  return { ...initial, fen: chess.fen(), turn: 'player', moves: [...initial.moves, { san: 'e5', uci: 'e7e5', by: 'owner', ts: updated_at }], updated_at };
}

test('Contract chess traces play unsolicited, in sequence, localized and visible in the system window without camera navigation', () => {
  let now = 0;
  const player = new TracePlayer(architecture as BackendArchitecture, () => now);
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  class Element {
    children: Element[] = []; textContent = ''; className = ''; id = ''; type = ''; dataset: Record<string, string> = {};
    append(...items: Element[]) { this.children.push(...items); }
    setAttribute() {}
  }
  const doc = { createElement: () => new Element(), body: new Element() };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  try {
    const portal = createSystemWindow(architecture as BackendArchitecture, player, false);
    languageStore.set('en');
    // Out-of-order WS delivery, then a duplicate; no register() anywhere.
    for (const event of [traceEvents[2], traceEvents[1], traceEvents[0], traceEvents[1], ...traceEvents.slice(3)]) player.receive(JSON.parse(JSON.stringify(event)));
    player.tick(); portal.render();
    assert.equal(player.latest, 'Processing the chess game');
    assert.equal(doc.body.children[0].children[2].textContent, player.latest);
    now = 150; player.tick(); portal.render();
    assert.equal(player.edge('gateway', 'agent').state, 'active');
    assert.equal(player.latest, 'Checking the move');
    assert.equal(portal.element.dataset.active, 'true');
    now = 300; player.tick(); assert.equal(player.light('postgres').state, 'active');
    languageStore.set('es'); player.refreshLanguage(); assert.equal(player.latest, 'Guardando partida');
    for (let i = 0; i < 12; i++) { now += 900; player.tick(); }
    portal.render(); assert.equal(player.latest, t('trace.chessDone')); assert.equal(player.processed, 8);
    assert.equal(doc.body.children[0].children[2].textContent, 'Partida actualizada');
    assert.equal(player.light('postgres').state, 'idle');
    assert.equal(portal.element.dataset.active, 'false');
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    languageStore.set('es');
  }
});

test('Chess traces do not occupy the chat inbox or start conversations; normal chat still works after 80 games', () => {
  const received: BackendEvent[] = [], inbox = new EventInbox(event => received.push(event));
  for (let i = 0; i < 80; i++) for (const event of traceEvents) inbox.receive({ ...event, run_id: 'chess-' + i });
  assert.equal(received.length, 0);
  inbox.register('chat');
  inbox.receive(envelope('run.start', { kind: 'chat', content_version: 2 }, 1, 'chat'));
  inbox.receive(envelope('run.done', { outcome: 'unknown', duration_ms: 10 }, 2, 'chat'));
  assert.deepEqual(received.map(event => event.type), ['run.start', 'run.done']);
});

function hashBrowser(hash: string) {
  const events = new EventTarget(), location = { hash };
  const browser = { location, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } as unknown as Pick<Window, 'location' | 'addEventListener' | 'removeEventListener'>;
  return { browser, change(value: string) { location.hash = value; events.dispatchEvent(new Event('hashchange')); } };
}
test('Owner URL waits for session loading, opens the requested game once and honors later hash changes', async () => {
  const backend = new MockBackend(); await backend.setOwnerMode(true);
  backend.ownerChessGames = async () => [game(), game('other')];
  const session = new AccountChess(backend), hash = hashBrowser('#/owner/chess?game=game%2Fone'), opened: string[] = [];
  let current: (() => boolean) | undefined;
  const route = createOwnerChessRoute(session, async (id, valid) => { current = valid; opened.push(id); return session.selectOwner(id); }, hash.browser);
  try {
    assert.deepEqual(opened, []); await session.refresh();
    assert.deepEqual(opened, ['game/one']); assert.equal(session.ownerId, 'game/one'); assert.equal(session.side, 'b');
    session.notify(); await session.refresh(); assert.equal(opened.length, 1);
    hash.change('#/owner/chess?game=other'); assert.equal(current?.(), true); assert.deepEqual(opened, ['game/one', 'other']);
    hash.change('#/'); assert.equal(current?.(), false);
    assert.equal(ownerChessRoute('#/owner/chess?game=a%2Bb'), 'a+b');
    assert.equal(ownerChessRoute('#/owner/chess'), null); assert.equal(ownerChessRoute('#/login/done?game=x'), null);
  } finally { route.dispose(); session.dispose(); }
});
test('Guest/user owner URLs are inert, never prompt login or request private data; missing games and outages remain usable', async () => {
  for (const mode of ['guest', 'user', 'owner', 'offline'] as const) {
    const backend = new MockBackend();
    if (mode === 'user') { await backend.requestEmailLogin('v@example.com', 'es'); await backend.verifyEmailLogin(new URLSearchParams(backend.simulatedLink()!.split('?')[1]).get('t')!); }
    if (mode === 'owner') await backend.setOwnerMode(true);
    if (mode === 'offline') backend.authMe = async () => { throw new BackendError('internal', '', 503); };
    let privateCalls = 0, opened = 0;
    backend.ownerChessGames = async () => { privateCalls++; return []; };
    const session = new AccountChess(backend), hash = hashBrowser('#/owner/chess?game=missing');
    const route = createOwnerChessRoute(session, async () => { opened++; return true; }, hash.browser);
    try { await session.refresh(); assert.equal(opened, 0); assert.equal(privateCalls, mode === 'owner' ? 1 : 0); }
    finally { route.dispose(); session.dispose(); }
  }
});

test('Real WS contract updates player and owner games in place, including resign and new games, without an HTTP reload', async () => {
  const originals = ['fetch', 'localStorage', 'WebSocket', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  let socket: Socket | undefined, requests = 0;
  class Socket {
    onopen?: () => void; onclose?: (event: { code: number }) => void; onmessage?: (event: { data: string }) => void;
    constructor() { socket = this; queueMicrotask(() => this.onopen?.()); }
    close() { this.onclose?.({ code: 1000 }); }
  }
  const initial = game();
  const globals = {
    localStorage: { getItem: (key: string) => key === AUTH_TOKEN_KEY ? 'account' : null, removeItem() {} },
    location: { host: 'portfolio.test', protocol: 'https:' }, WebSocket: Socket,
    fetch: async (path: unknown) => { requests++; if(String(path)==='/api/v1/ws-ticket')return Response.json({ticket:crypto.randomUUID(),expires_in:30}); return Response.json(String(path).endsWith('/auth/me') ? { mode: 'owner', email_hint: 'k***@gmail.com' } : String(path).endsWith('/notifications') ? { chess_email: true } : String(path).endsWith('/games') ? { games: [initial] } : { game: initial }); },
  };
  for (const [key] of originals) Object.defineProperty(globalThis, key, { value: globals[key as keyof typeof globals], configurable: true });
  const backend = new RealBackend(), session = new AccountChess(backend);
  try {
    await backend.connect(); await session.refresh(); const before = requests;
    const send = (event: unknown) => socket!.onmessage?.({ data: JSON.stringify(event) });
    const updated = movedGame(); send(envelope('chess.move', { game: updated }, 2, initial.id));
    assert.equal(session.playerGame?.fen, updated.fen); assert.equal(session.unread, true);
    session.selectOwner(initial.id); send(envelope('owner.chess', { game: updated, reason: 'move' }, 3, initial.id));
    assert.equal(session.game?.fen, updated.fen); assert.equal(session.canMove, false);
    const resigned = { ...updated, status: 'resigned', updated_at: '2026-10-05T18:02:00.000Z' };
    send(envelope('owner.chess', { game: resigned, reason: 'resign' }, 3, initial.id));
    send(envelope('chess.move', { game: resigned }, 2, initial.id));
    assert.equal(session.game?.status, 'resigned'); assert.equal(session.playerGame?.status, 'resigned');
    send(envelope('owner.chess', { game: game('new-game'), reason: 'new' }, 2, 'new-game'));
    assert.equal(session.ownerGames.length, 2);
    send(envelope('owner.chess', { game: updated, reason: 'move' }, 3, initial.id));
    assert.equal(session.game?.status, 'resigned', 'late older updates cannot undo resignation');
    assert.equal(requests, before, 'push updates never reload data over HTTP');
  } finally {
    session.dispose(); backend.disconnect();
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
test('Owner push updates received during HTTP loading survive the response without losing the other games', async () => {
  const backend = new MockBackend(); await backend.setOwnerMode(true);
  let finish!: (games: OwnerChessGame[]) => void;
  backend.ownerChessGames = () => new Promise(resolve => { finish = resolve; });
  const session = new AccountChess(backend);
  try {
    const pending = session.refresh(); await new Promise(resolve => setImmediate(resolve));
    const updated = movedGame(), added = game('added');
    session.receive(envelope('owner.chess', { game: updated, reason: 'move' }, 3, updated.id) as BackendEvent);
    session.receive(envelope('owner.chess', { game: added, reason: 'new' }, 2, added.id) as BackendEvent);
    finish([game(), game('other')]); await pending;
    assert.equal(session.ownerGames.length, 3); assert.equal(session.ownerGames.find(game => game.id === updated.id)?.fen, updated.fen);
  } finally { session.dispose(); }
});
