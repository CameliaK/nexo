import { createBackend } from '../backend';
import { initializeLanguage, languageStore, t } from '../i18n';
import { DataDeletion } from './deletion';
import { renderPrivacy } from './content';
import './style.css';
initializeLanguage();
const content = document.getElementById('privacy-content')!;
const dialog = document.getElementById('privacy-confirm') as HTMLDialogElement;
const remove = document.getElementById('privacy-delete') as HTMLButtonElement;
const confirm = document.getElementById('privacy-confirm-delete') as HTMLButtonElement;
const language = document.getElementById('privacy-language')!;
const deletion = new DataDeletion((await createBackend()).backend);
function render() {
  document.documentElement.lang = languageStore.language; document.title = t('privacy.title') + ' · Nexo';
  renderPrivacy(document, content, languageStore.language);
  language.textContent = languageStore.language.toUpperCase(); language.setAttribute('aria-label', t('privacy.language'));
  for (const [id, key] of [['privacy-home', 'privacy.back'], ['privacy-delete', 'privacy.delete'], ['privacy-confirm-delete', 'privacy.delete'], ['privacy-cancel', 'common.cancel'], ['privacy-confirm-title', 'privacy.confirm'], ['privacy-confirm-detail', 'privacy.detail']] as const) document.getElementById(id)!.textContent = t(key);
  renderStatus();
}
function renderStatus() {
  confirm.disabled = remove.disabled = deletion.busy || deletion.seconds > 0;
  dialog.setAttribute('aria-busy', String(deletion.busy));
  document.getElementById('privacy-status')!.textContent = document.getElementById('privacy-confirm-status')!.textContent = deletion.message;
}
language.onclick = () => languageStore.toggle(); languageStore.subscribe(render); render();
remove.onclick = () => { dialog.showModal(); };
document.getElementById('privacy-cancel')!.onclick = () => dialog.close();
dialog.addEventListener('close', () => remove.focus({ preventScroll: true }));
dialog.addEventListener('click', event => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); });
confirm.onclick = async () => { const pending = deletion.run(); renderStatus(); if (await pending) location.reload(); else renderStatus(); };
setInterval(renderStatus, 1000);
