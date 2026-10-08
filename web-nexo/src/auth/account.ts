import { icon } from '../icons';
import { privacyLink } from '../privacy/link';
import { DataDeletion } from '../privacy/deletion';
import { t, languageStore } from '../i18n';
import { AccountChess, errorText } from './session';

/** Screen-space account control, independent of the chess API and camera. */
export function createAccountNode(session: AccountChess, access: () => void, doc: Document = document) {
  const deletion = new DataDeletion(session.backend);
  const node = doc.createElement('button'); node.type = 'button'; node.className = 'account-node';
  node.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 57 17 57 47 32 61 7 47 7 17Z M32 3v15M7 17l12 7M57 17l-12 7M7 47l12-7M57 47l-12-7M32 61V46"/></svg>';
  const nodeText = doc.createElement('span'); node.append(nodeText);
  node.setAttribute('aria-controls', 'account-panel'); node.setAttribute('aria-expanded', 'false');
  const root = doc.createElement('section'); root.id = 'account-panel'; root.className = 'access-overlay account-overlay'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'account-panel-title');
  const box = doc.createElement('div'); box.className = 'access-glass account-glass';
  const close = doc.createElement('button'); close.type = 'button'; close.className = 'access-close'; close.innerHTML = icon('close');
  const title = doc.createElement('h2'); title.id = 'account-panel-title'; const email = doc.createElement('p'); email.className = 'account-email';
  const settings = doc.createElement('div'); settings.className = 'account-settings';
  const label = doc.createElement('label'); label.className = 'account-notifications'; const checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; const text = doc.createElement('span'); label.append(checkbox, text);
  const help = doc.createElement('p'); help.id = 'account-notifications-help'; checkbox.setAttribute('aria-describedby', help.id);
  const logout = doc.createElement('button'); logout.type = 'button'; logout.className = 'account-logout';
  const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'account-delete';
  const data = doc.createElement('button'); data.type = 'button'; data.className = 'account-delete-data';
  const privacy = privacyLink(doc); privacy.className = 'account-privacy';
  settings.append(label, help, logout, remove, data, privacy);
  const confirmation = doc.createElement('div'); confirmation.className = 'account-confirmation'; confirmation.hidden = true;
  const question = doc.createElement('p'); const warning = doc.createElement('p'); const confirm = doc.createElement('button'); confirm.type = 'button'; confirm.className = 'account-confirm-delete'; const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'account-cancel-delete';
  confirmation.append(question, warning, confirm, cancel);
  const status = doc.createElement('p'); status.className = 'account-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  box.append(close, title, email, settings, confirmation, status); root.append(box); doc.body.append(node, root);
  let previous: HTMLElement | null = null, confirming: false | 'account' | 'data' = false, saving = false;
  const inert = new Map<HTMLElement, boolean>();
  function hide() {
    const wasOpen = !root.hidden; root.hidden = true; confirming = false; node.setAttribute('aria-expanded', 'false');
    for (const [element, value] of inert) element.inert = value; inert.clear();
    if (wasOpen) (previous?.isConnected && !previous.closest('[hidden]') ? previous : node).focus({ preventScroll: true });
  }
  function render() {
    nodeText.innerHTML = icon('person');nodeText.setAttribute('aria-hidden','true'); node.title = t('account.open'); node.setAttribute('aria-label', t('account.open'));
    close.setAttribute('aria-label', t('common.close')); title.textContent = t('account.node'); email.textContent = session.me.email_hint || '';
    text.textContent = t('account.emailNotifications'); help.textContent = t('account.notificationsHelp'); checkbox.checked = session.notifications; checkbox.disabled = session.busy || saving || !session.notificationsReady;
    logout.textContent = t('account.logout'); remove.textContent = t('account.delete'); logout.disabled = remove.disabled = data.disabled = confirm.disabled = session.busy || saving || deletion.busy;
    data.textContent = t('privacy.delete'); data.disabled ||= deletion.seconds > 0;
    if (confirming === 'data') confirm.disabled ||= deletion.seconds > 0;
    privacy.textContent = t('privacy.title');
    settings.hidden = !!confirming; confirmation.hidden = !confirming; question.textContent = t(confirming === 'data' ? 'privacy.confirm' : 'account.deleteTitle'); warning.textContent = t(confirming === 'data' ? 'privacy.detail' : 'account.deleteDetail'); confirm.textContent = t(confirming === 'data' ? 'privacy.delete' : 'account.delete'); cancel.textContent = t('common.cancel');
    status.textContent = deletion.message || (session.busy || saving ? t('account.saving') : session.accountError ? errorText(session.accountError) : '');
    root.setAttribute('aria-busy', String(session.busy || saving || deletion.busy));
    if (session.me.mode === 'guest' && !root.hidden) hide();
  }
  function open() {
    if (session.me.mode === 'guest') { access(); return; }
    if (root.hidden) {
      previous = doc.activeElement as HTMLElement; root.hidden = false; confirming = false;
      for (const child of Array.from(doc.body.children) as HTMLElement[]) if (child !== root) { inert.set(child, child.inert); child.inert = true; }
    }
    node.setAttribute('aria-expanded', 'true'); render(); close.focus({ preventScroll: true });
    void session.refreshNotifications();
  }
  node.addEventListener('click', open); close.addEventListener('click', hide);
  root.addEventListener('click', event => { if (event.target === root) hide(); });
  checkbox.addEventListener('change', () => { const enabled=checkbox.checked;saving = true; render(); void session.setNotifications(enabled).finally(() => { saving = false; render(); }); });
  logout.addEventListener('click', () => void session.signOut());
  remove.addEventListener('click', () => { confirming = 'account'; render(); cancel.focus(); });
  data.addEventListener('click', () => { confirming = 'data'; render(); cancel.focus(); });
  cancel.addEventListener('click', () => { const origin = confirming === 'data' ? data : remove; confirming = false; render(); origin.focus(); });
  confirm.addEventListener('click', async () => {
    if (confirming !== 'data') { void session.signOut(true); return; }
    const pending = deletion.run(); render();
    if (await pending) location.reload(); else render();
  });
  const onKey = (event: KeyboardEvent) => {
    if (root.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); if (confirming) { const origin = confirming === 'data' ? data : remove; confirming = false; render(); origin.focus(); } else hide(); }
    if (event.key === 'Tab') {
      const items = [close, checkbox, logout, remove, data, privacy, cancel, confirm].filter(item => !('disabled' in item && item.disabled) && !item.closest('[hidden]'));
      const index = items.indexOf(doc.activeElement as typeof close);
      if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === items.length - 1) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus(); }
    }
    event.stopImmediatePropagation();
  };
  const onFocus = (event: FocusEvent) => { if (!root.hidden && !root.contains(event.target as Node)) close.focus({ preventScroll: true }); };
  doc.addEventListener('keydown', onKey, true); doc.addEventListener('focusin', onFocus, true);
  const cooldownTimer = setInterval(() => { if (!root.hidden && deletion.retryAt) render(); }, 1000);
  const stopSession = session.subscribe(render), stopLanguage = languageStore.subscribe(render);
  return { element: node, panel: root, open, close: hide, dispose() { clearInterval(cooldownTimer); hide(); stopSession(); stopLanguage(); doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('focusin', onFocus, true); node.remove(); root.remove(); } };
}
