import type { AccountChess } from '../auth/session';
import { t } from '../i18n';
import './style.css';
export const CHESS_NODE_VISIBLE = true;
type UI = ReturnType<typeof import('./index')['createChessUI']>;
/** One module, one board. Pointer intent and idle time warm the expensive pieces. */
export function createLazyChess(remote: AccountChess, openAccount: () => void) {
  let ui: UI | undefined, pending: Promise<UI> | undefined, disposed = false, requested = false;
  let returnFocus:HTMLElement|null=null;
  let origin: Parameters<UI['open']>, onClosed: (() => void) | undefined;
  const shell = document.createElement('section'); shell.className = 'chess-loading'; shell.hidden = true;
  shell.setAttribute('role', 'status'); shell.setAttribute('aria-live', 'polite'); shell.tabIndex = -1;
  const grid = document.createElement('div'); grid.className = 'chess-loading-grid';
  const label = document.createElement('p'); label.textContent = t('chess.loadingGame'); shell.append(grid, label); document.body.append(shell);
  const warm = () => {
    if (disposed) return Promise.reject(new Error('disposed'));
    return pending ||= import('./index').then(module => {
      ui = module.createChessUI(remote, openAccount); ui.setOnClosed(() => onClosed?.());
      if (disposed) { ui.dispose(); return ui; }
      if (requested) { if(remote.me.mode==='guest'&&remote.available){requested=false;onClosed?.();returnFocus?.focus({preventScroll:true})}else ui.open(origin[0],origin[1],returnFocus||undefined); shell.hidden = true; }
      return ui;
    }).catch(error => { pending = undefined; shell.hidden = true; requested = false; throw error; });
  };
  const preload = () => { void warm().catch(() => {}); };
  const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(preload, { timeout: 2000 }) : setTimeout(preload, 1200);
  const key = (event: KeyboardEvent) => { if (requested && !ui && event.key === 'Escape') { requested = false; shell.hidden = true; returnFocus?.focus({preventScroll:true});onClosed?.(); } };
  shell.addEventListener('keydown', key);
  return {
    preload,
    open(...args: Parameters<UI['open']>) {
      origin = args;returnFocus=document.activeElement as HTMLElement;
      if (ui) { ui.open(...args); return; }
      requested = true; shell.hidden = false; label.textContent = t('chess.loadingGame'); shell.focus({ preventScroll: true }); preload();
    },
    isOpen: () => requested && !ui || !!ui?.isOpen(),
    isAnimating: () => requested && !ui || !!ui?.isAnimating(),
    pauseFor(ms:number,since?:number){ui?.pauseFor(ms,since)},
    render(...args: Parameters<UI['render']>) { ui?.render(...args); },
    progress: (now?: number) => ui?.progress(now) || (requested ? .1 : 0),
    refreshLanguage() { label.textContent = t('chess.loadingGame'); ui?.refreshLanguage(); },
    closeForNavigation(fn: () => void) { if (ui) ui.closeForNavigation(fn); else { requested = false; shell.hidden = true; returnFocus?.focus({preventScroll:true});onClosed?.(); fn(); } },
    setOnClosed(fn: () => void) { onClosed = fn; },
    dispose() {
      disposed = true;
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idle as number); else clearTimeout(idle);
      shell.remove(); ui?.dispose();
    },
  };
}
