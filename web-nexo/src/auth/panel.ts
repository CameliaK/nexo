import { t, languageStore } from '../i18n';
import { AccountChess, errorText } from './session';
import { AccessState, accessRoute, type AccessRoute } from './access';

export function createAccessPanel(session: AccountChess, options: { document?: Document; onIdentity?: () => void; onRoute?: () => void; simulatedLink?: () => string | null } = {}) {
  const doc = options.document || document;
  const root = doc.createElement('section'); root.className = 'access-overlay'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'access-title');
  const box = doc.createElement('div'); box.className = 'access-glass';
  const close = doc.createElement('button'); close.type = 'button'; close.className = 'access-close'; close.textContent = '×';
  const title = doc.createElement('h2'); title.id = 'access-title';
  const detail = doc.createElement('p'); const form = doc.createElement('form');
  const label = doc.createElement('label'); const fieldName = doc.createElement('span');
  const input = doc.createElement('input'); input.type = 'email'; input.name = 'email'; input.required = true; input.autocomplete = 'email'; input.maxLength = 254;
  label.append(fieldName, input);
  const send = doc.createElement('button'); send.type = 'submit';
  const google = doc.createElement('button'); google.type = 'button';
  const confirm = doc.createElement('button'); confirm.type = 'button';
  const status = doc.createElement('p'); status.className = 'access-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const privacy = doc.createElement('p'); privacy.className = 'access-privacy';
  form.append(label, send); box.append(close, title, detail, form, google, confirm, status, privacy); root.append(box); doc.body.append(root);
  const simulatedLink=doc.createElement('button');simulatedLink.type='button';
  if(options.simulatedLink){box.append(simulatedLink);simulatedLink.onclick=()=>{const link=options.simulatedLink?.();if(link)location.hash=link}}
  let previous: HTMLElement | null = null;
  const locked = new Map<HTMLElement, boolean>();
  const state = new AccessState(session.backend, render, async () => { options.onIdentity?.(); await session.refresh(); });
  function render() {
    const kind = state.route.kind, login = kind === 'login', busy = state.status === 'sending', success = state.status === 'success';
    title.textContent = t(kind === 'unsubscribe' ? 'auth.unsubscribeTitle' : kind === 'confirm' ? 'auth.confirmTitle' : 'auth.title');
    simulatedLink.textContent=t('lab.loginLink');simulatedLink.hidden=!options.simulatedLink?.()||!login;
    close.setAttribute('aria-label', t('common.close'));
    detail.textContent = t(kind === 'unsubscribe' ? 'auth.unsubscribeDetail' : kind === 'confirm' ? 'auth.confirmDetail' : 'auth.intro');
    fieldName.textContent = t('auth.email'); input.setAttribute('aria-label', t('auth.email'));
    form.hidden = !login || success; google.hidden = !login || success;
    send.textContent = busy ? t('auth.sending') : state.remaining ? t('auth.wait', { seconds: state.remaining }) : t(state.email ? 'auth.resend' : 'auth.send');
    send.disabled = busy || !!state.remaining; google.disabled = busy; input.disabled = busy;
    google.textContent = t('auth.google');
    confirm.hidden = login || success || kind === 'done' && state.status !== 'error'; confirm.disabled = busy;
    confirm.textContent = t(kind === 'unsubscribe' ? 'auth.unsubscribe' : 'auth.confirm');
    status.textContent = state.status === 'error' ? errorText(state.error) : busy ? t(kind === 'done' ? 'auth.exchange' : 'auth.sending') : state.status === 'sent' ? t('auth.checkEmail') + '. ' + t('auth.generic') : success ? t(kind === 'unsubscribe' ? 'auth.unsubscribed' : 'auth.success') : '';
    privacy.textContent = t('auth.privacy'); privacy.hidden = !login;
    root.setAttribute('aria-busy', String(busy));
    if (success && kind !== 'unsubscribe' && typeof history !== 'undefined') history.replaceState(null, '', location.pathname + location.search);
  }
  function open(route: AccessRoute = { kind: 'login', credential: '' }) {
    if (root.hidden) {
      previous = doc.activeElement as HTMLElement; root.hidden = false;
      for (const child of Array.from(doc.body.children) as HTMLElement[]) if (child !== root) { locked.set(child, child.inert); child.inert = true; }
    }
    state.navigate(route); (route.kind === 'login' ? input : route.kind === 'done' ? close : confirm).focus({ preventScroll: true });
  }
  function hide() {
    root.hidden = true; for (const [element, inert] of locked) element.inert = inert; locked.clear();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  }
  form.addEventListener('submit', event => { event.preventDefault(); void state.send(input.value); });
  google.addEventListener('click', () => void state.google()); confirm.addEventListener('click', () => void state.confirm()); close.addEventListener('click', hide);
  root.addEventListener('click', event => { if (event.target === root) hide(); });
  const onKey = (event: KeyboardEvent) => {
    if (root.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
    if (event.key === 'Tab') {
      const items = [close, input, send, google, confirm, ...(options.simulatedLink?[simulatedLink]:[])].filter(item => !item.disabled && !item.hidden && !item.closest('[hidden]'));
      const index = items.indexOf(doc.activeElement as typeof close);
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === items.length - 1) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus(); }
    }
    event.stopImmediatePropagation();
  };
  const onFocus=(event:FocusEvent)=>{if(!root.hidden&&!root.contains(event.target as Node))close.focus({preventScroll:true})};
  doc.addEventListener('focusin',onFocus,true);
  doc.addEventListener('keydown', onKey, true);
  const routeChanged = () => { const route = accessRoute(location.hash); if (route) { options.onRoute?.(); open(route); } };
  addEventListener('hashchange', routeChanged);
  const stopLanguage = languageStore.subscribe(render); const timer = setInterval(() => { if (!root.hidden) render(); }, 500);
  render();
  return { open, close: hide, readRoute: routeChanged, state, element: root, dispose() { state.dispose(); hide(); clearInterval(timer); stopLanguage(); removeEventListener('hashchange', routeChanged); doc.removeEventListener('keydown', onKey, true);doc.removeEventListener('focusin',onFocus,true); root.remove(); } };
}
