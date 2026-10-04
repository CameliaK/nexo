import esPortfolio from '../data/portfolio-content.es.json';
import esArchitecture from '../data/backend-architecture.es.json';
import type { Language } from './language';
import type { BackendArchitecture } from '../backend/types';

// A locale file is optional: removing the English file still produces a working build.
let englishPortfolio:unknown,englishArchitecture:unknown;
export function registerTranslations(content?:unknown,system?:unknown){englishPortfolio=content;englishArchitecture=system}
const topology=new Set(['id','parent','type','order','from','to','layer','kind','links','hops','src','computed_age_from']);
export function fallbackContent<T>(spanish:T,translation:unknown):T {
  if(Array.isArray(spanish)){
    const other=Array.isArray(translation)?translation:[];
    return spanish.map((item,i)=>{
      const match=item&&typeof item==='object'&&'id' in item?other.find(candidate=>candidate?.id===item.id):other[i];
      return fallbackContent(item,match);
    }) as T;
  }
  if(spanish&&typeof spanish==='object'){
    const other=translation&&typeof translation==='object'?translation as Record<string,unknown>:{};
    return Object.fromEntries(Object.entries(spanish).map(([key,value])=>[key,topology.has(key)?structuredClone(value):fallbackContent(value,other[key])])) as T;
  }
  return (translation===undefined||translation===null||typeof translation!==typeof spanish||(typeof translation==='string'&&!translation.trim())?spanish:translation) as T;
}
function updateInPlace(target:any,source:any){
  if(source&&typeof source==='object')for(const key of Object.keys(source)){
    if(source[key]&&typeof source[key]==='object'&&target[key]&&typeof target[key]==='object')updateInPlace(target[key],source[key]);
    else target[key]=source[key];
  }
}
export const portfolio=structuredClone(esPortfolio);
export const architecture=structuredClone(esArchitecture) as BackendArchitecture;
export function applyContent(language:Language){
  updateInPlace(portfolio,fallbackContent(esPortfolio,language==='en'?englishPortfolio:undefined));
  updateInPlace(architecture,fallbackContent(esArchitecture,language==='en'?englishArchitecture:undefined));
  portfolio.meta.language=language;
}
