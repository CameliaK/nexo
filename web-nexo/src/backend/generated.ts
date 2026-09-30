import { LIMITS } from './types';
import type { GeneratedNode } from './types';
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const string=(x:unknown,max:number):x is string=>typeof x==='string'&&x.length>0&&x.length<=max;
/** The model's closed schema is checked again before it reaches any renderer. */
export function validateGeneratedNode(value:unknown,portfolioIds:Set<string>):value is GeneratedNode {
  const ids=new Set<string>();
  function check(x:unknown,depth:number):boolean{
    if(!object(x)||!string(x.id,160)||!/^gen_[A-Za-z0-9_-]+$/.test(x.id)||ids.has(x.id)||portfolioIds.has(x.id))return false;ids.add(x.id);
    if(x.generated!==true||!string(x.label,LIMITS.labelMaxChars)||!string(x.summary,LIMITS.summaryMaxChars)||!string(x.created_at,64)||!Number.isFinite(Date.parse(x.created_at)))return false;
    if(x.tagline!==undefined&&!string(x.tagline,LIMITS.summaryMaxChars))return false;
    if(!Array.isArray(x.sources)||!x.sources.length||!x.sources.every(source=>{if(!object(source)||!string(source.title,LIMITS.summaryMaxChars))return false;if(source.ref===undefined)return true;if(!string(source.ref,2048))return false;if(portfolioIds.has(source.ref))return true;try{const url=new URL(source.ref);return url.protocol==='https:'&&!url.username&&!url.password}catch{return false}}))return false;
    if(!object(x.content))return false;const c=x.content;
    const list=(items:unknown,max:number,predicate:(v:unknown)=>boolean)=>Array.isArray(items)&&items.length>0&&items.length<=max&&items.every(predicate);
    let contentValid=false;
    switch(x.layout){
      case 'text':contentValid=string(c.body,LIMITS.bodyMaxChars);break;
      case 'list':contentValid=list(c.items,LIMITS.listMaxItems,v=>string(v,LIMITS.bodyMaxChars));break;
      case 'timeline':contentValid=list(c.entries,LIMITS.timelineMaxEntries,v=>object(v)&&string(v.when,LIMITS.summaryMaxChars)&&string(v.what,LIMITS.bodyMaxChars));break;
      case 'tags':contentValid=list(c.tags,LIMITS.tagsMaxItems,v=>string(v,LIMITS.summaryMaxChars));break;
      case 'metrics':contentValid=list(c.items,LIMITS.metricsMaxItems,v=>object(v)&&string(v.label,LIMITS.labelMaxChars)&&string(v.value,LIMITS.summaryMaxChars));break;
    }
    if(!contentValid)return false;
    if(x.children!==undefined){if(depth>0||!Array.isArray(x.children)||x.children.length>LIMITS.childrenPerNode)return false;return x.children.every(child=>check(child,depth+1))}
    return true;
  }
  return check(value,0);
}
export function generatedSize(node:GeneratedNode):number{return 1+(node.children||[]).length}
