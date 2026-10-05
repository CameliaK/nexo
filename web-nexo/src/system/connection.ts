import type { ConnectionState } from '../backend/types';
import { languageStore, t } from '../i18n';
/** Nonblocking, visible status; independent of the animation pause control. */
export function createConnectionNotice(doc:Document=document){
  const label=doc.createElement('span');label.className='connection-notice';label.hidden=true;
  label.setAttribute('role','status');label.setAttribute('aria-live','polite');
  doc.querySelector('.system-status')?.append(label);
  let state:ConnectionState='closed';
  const render=()=>{label.hidden=state!=='reconnecting';label.textContent=label.hidden?'':t('connection.retrying')};
  const stop=languageStore.subscribe(render);
  return{element:label,update(value:ConnectionState){state=value;render()},dispose(){stop();label.remove()}};
}
