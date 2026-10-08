import { icon } from '../icons';
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
  const close=document.createElement('button');close.type='button';close.className='chess-loading-close';close.innerHTML=icon('close');close.setAttribute('aria-label',t('chess.close'));close.onclick=()=>closePending();
  const label = document.createElement('p'); label.textContent = t('chess.loadingGame'); shell.append(close,grid, label); document.body.append(shell);
  function closePending(){requested=false;shell.hidden=true;document.body.classList.remove('is-chess');dispatchEvent(new Event('nexo:chess-state'));onClosed?.();returnFocus?.focus({preventScroll:true})}
  const warm = () => {
    if (disposed) return Promise.reject(new Error('disposed'));
    return pending ||= import('./index').then(module => {
      ui = module.createChessUI(remote, openAccount); ui.setOnClosed(() => onClosed?.());
      if (disposed) { ui.dispose(); return ui; }
      if (requested) { if(remote.me.mode==='guest'&&remote.available)closePending();else{ui.open(origin[0],origin[1],returnFocus||undefined);requested=false} shell.hidden = true; }
      return ui;
    }).catch(error => { pending = undefined;if(requested)closePending();throw error; });
  };
  const preload = () => { void warm().catch(() => {}); };
  const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(preload, { timeout: 2000 }) : setTimeout(preload, 1200);
  const key = (event: KeyboardEvent) => { if (requested && !ui && event.key === 'Escape') { closePending(); } };
  shell.addEventListener('keydown', key);
  return {
    preload,
    open(...args: Parameters<UI['open']>) {
      origin = args;returnFocus=document.activeElement as HTMLElement;
      if (ui) { ui.open(...args); return; }
      requested = true; document.body.classList.add('is-chess');shell.hidden = false; label.textContent = t('chess.loadingGame'); shell.focus({ preventScroll: true }); preload();
    },
    isOpen: () => requested && !ui || !!ui?.isOpen(),
    isAnimating: () => requested && !ui || !!ui?.isAnimating(),
    pauseFor(ms:number,since?:number){ui?.pauseFor(ms,since)},
    render(...args: Parameters<UI['render']>) { ui?.render(...args); },
    progress: (now?: number) => ui?.progress(now) ?? 0,
    refreshLanguage() { close.setAttribute('aria-label',t('chess.close'));label.textContent = t('chess.loadingGame'); ui?.refreshLanguage(); },
    closeForNavigation(fn: () => void) { if (ui) ui.closeForNavigation(fn); else { closePending(); fn(); } },
    setOnClosed(fn: () => void) { onClosed = fn; },
    dispose() {
      disposed = true;
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idle as number); else clearTimeout(idle);
      shell.remove(); ui?.dispose();
    },
  };
}
