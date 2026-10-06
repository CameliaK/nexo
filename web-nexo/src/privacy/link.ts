import { t, type UIKey } from '../i18n';
export function privacyLink(doc: Document = document) {
  const link = doc.createElement('a'); link.href = '/privacidad'; link.textContent = t('privacy.title');
  link.dataset.i18n = 'privacy.title'; return link;
}
export function privacyNotice(key: UIKey, doc: Document = document) {
  const note = doc.createElement('p'); note.className = 'privacy-notice';
  const text = doc.createElement('span'); text.dataset.i18n = key; text.textContent = t(key);
  note.append(text, doc.createTextNode(' '), privacyLink(doc)); return note;
}
