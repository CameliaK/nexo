import { es, type UIKey } from './es';
import { en } from './en';
import { languageStore } from './language';
export { languageStore, initializeLanguage } from './language';
export type { Language } from './language';
export type { UIKey } from './es';
type Params=Record<string,string|number>;
const remembered=new Map<string,{key:UIKey;params:Params}>();
export function t(key:UIKey,params:Params={}):string {
  const catalog=languageStore.language==='en'?en:es;
  const format=(pattern:string)=>pattern.replace(/\{(\w+)\}/g,(_,name)=>String(params[name]??`{${name}}`));
  const binding={key,params:{...params}};
  remembered.set(format(es[key]),binding);remembered.set(format(en[key]),binding);
  if(remembered.size>4096)remembered.delete(remembered.keys().next().value!);
  return format(catalog[key]??es[key]);
}
// Translate only application-owned UI. User messages and server answers are content.
export function translateText(text:string):string {
  const binding=remembered.get(text);
  if(binding)return t(binding.key,binding.params);
  const key=(Object.keys(es) as UIKey[]).find(key=>es[key]===text||en[key]===text);
  return key?t(key):text;
}
export function translateUI(root:ParentNode=document){
  for(const element of Array.from(root.querySelectorAll?.<HTMLElement>('*')||[])){
    const initial=element.dataset.i18nInitial as UIKey|undefined;
    if(initial&&initial in es){element.textContent=t(initial);element.removeAttribute('data-i18n-initial')}
    // Content has already been localized per node, including its Spanish fallback.
    // Relabeling it as an interface string could overwrite that fallback.
    if(element.closest?.('[data-i18n-ignore], .chat-message p, .source-link, .node-label, #level-title, #level-description, #scene-facts, #scene-highlights, #content-title, #content-body, #speech-title, #speech-text, #panel-context, #panel-message, .media-window-caption, .media-viewer-caption, #media-viewer-title, .live-intro, .chat-note, .live-name span'))continue;
    const key=element.dataset.i18n as UIKey|undefined;
    if(key&&key in es)element.textContent=t(key);
    else for(const child of Array.from(element.childNodes))if(child.nodeType===3&&child.textContent)child.textContent=translateText(child.textContent);
    for(const attr of ['aria-label','title','placeholder','content']){
      const binding=element.getAttribute('data-i18n-'+attr) as UIKey|null;
      const value=element.getAttribute(attr);
      if(binding&&binding in es)element.setAttribute(attr,t(binding));
      else if(value)element.setAttribute(attr,translateText(value));
    }
  }
}
