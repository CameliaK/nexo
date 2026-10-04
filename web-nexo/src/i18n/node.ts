import { t, translateUI } from './index';
import { languageStore } from './language';

/** Screen-space control: never participates in the camera or scene graph. */
export function createLanguageNode(doc:Document=document){
  const store=languageStore;
  const button=doc.createElement('button');button.type='button';button.className='language-node';
  button.innerHTML='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 57 17 57 47 32 61 7 47 7 17Z M32 3v15M7 17l12 7M57 17l-12 7M7 47l12-7M57 47l-12-7M32 61V46"/></svg><span></span>';
  const label=button.querySelector('span')!;
  const render=()=>{label.textContent=store.language.toUpperCase();button.setAttribute('aria-label',t('language.switch'));button.title=t('language.switch');doc.documentElement.lang=store.language;translateUI(doc)};
  button.addEventListener('click',()=>store.toggle());doc.body.append(button);render();const stop=store.subscribe(render);
  return {element:button,dispose(){stop();button.remove()}};
}
