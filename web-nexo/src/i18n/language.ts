export type Language = 'es' | 'en';
export const LANGUAGE_KEY = 'nexo.language';
type StorageLike = Pick<Storage,'getItem'|'setItem'>;
export function preferredLanguage(browserLanguage:string) : Language {return browserLanguage.toLowerCase().startsWith('es')?'es':'en'}
export class LanguageStore {
  private listeners=new Set<(language:Language)=>void>();
  private current:Language;
  constructor(private storage?:StorageLike,browserLanguage='es'){
    let saved:string|null=null;try{saved=storage?.getItem(LANGUAGE_KEY)??null}catch{/* Storage is optional. */}
    this.current=saved==='es'||saved==='en'?saved:preferredLanguage(browserLanguage);
  }
  get language(){return this.current}
  set(language:Language){
    if(language!=='es'&&language!=='en')return;
    try{this.storage?.setItem(LANGUAGE_KEY,language)}catch{/* Keep the preference in memory. */}
    if(language===this.current)return;
    this.current=language;for(const listener of this.listeners)listener(language);
  }
  toggle(){this.set(this.current==='es'?'en':'es')}
  subscribe(listener:(language:Language)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
}
// Initialize explicitly at the composition root; imports and tests remain deterministic.
export const languageStore=new LanguageStore();
export function initializeLanguage(){
  let storage:StorageLike|undefined;try{storage=localStorage}catch{/* Private mode. */}
  const preference=new LanguageStore(storage,typeof navigator==='undefined'?'es':navigator.language);
  languageStore.set(preference.language);
  try{storage?.setItem(LANGUAGE_KEY,preference.language)}catch{/* Memory only. */}
  return languageStore.subscribe(language=>{try{storage?.setItem(LANGUAGE_KEY,language)}catch{/* Memory only. */}});
}
