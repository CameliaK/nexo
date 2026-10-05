import type { AccountChess } from './session';

export function ownerChessRoute(hash: string): string | null {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  if (path !== '/owner/chess') return null;
  return new URLSearchParams(query).get('game') || null;
}

/** Wait for auth and games; this link never requests login or owner data itself. */
export function createOwnerChessRoute(
  session: AccountChess,
  openGame: (id: string, isCurrent: () => boolean) => Promise<boolean>,
  browser: Pick<Window, 'location' | 'addEventListener' | 'removeEventListener'> = window,
) {
  let handled = false, generation = 0;
  const read = () => {
    if (handled || !session.ready) return;
    const hash = browser.location.hash, id = ownerChessRoute(hash);
    if (!id) return;
    handled = true;
    if (session.me.mode !== 'owner' || !session.ownerGames.some(game => game.id === id)) return;
    const request = generation;
    const isCurrent = () => request === generation && browser.location.hash === hash && session.me.mode === 'owner';
    void openGame(id, isCurrent).catch(() => { /* An unavailable game leaves the normal site usable. */ });
  };
  const changed = () => { ++generation; handled = false; read(); };
  const stop = session.subscribe(read);
  browser.addEventListener('hashchange', changed);
  return { read, dispose() { ++generation; stop(); browser.removeEventListener('hashchange', changed); } };
}
