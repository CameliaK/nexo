import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessPanel } from '../src/auth/panel';
import { MockBackend } from '../src/backend/mock';
import { AccountChess } from '../src/auth/session';
import { languageStore, t } from '../src/i18n';
function fixture(){
 let doc:any;
 const handlers=new Map<string,((event:any)=>void)[]>();
 class Element {
  children:Element[]=[];parent:Element|null=null;attributes=new Map<string,string>();handlers=new Map<string,(event:any)=>void>();
  hidden=false;inert=false;disabled=false;className='';id='';type='';value='';name='';required=false;autocomplete='';maxLength=0;textContent='';onclick:(()=>void)|undefined;
  constructor(public tagName:string){}
  get isConnected():boolean{return this===doc.body||!!this.parent?.isConnected}
  append(...items:Element[]){for(const item of items){item.parent=this;this.children.push(item)}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null}
  setAttribute(key:string,value:string){this.attributes.set(key,value)}getAttribute(key:string){return this.attributes.get(key)||null}
  contains(target:Element):boolean{return this===target||this.children.some(child=>child.contains(target))}
  closest(selector:string):Element|null {if(selector==='[hidden]'&&this.hidden)return this;return this.parent?.closest(selector)||null}
  addEventListener(key:string,fn:(e:any)=>void){this.handlers.set(key,fn)}
  querySelectorAll(selector:string):Element[]{return this.children.flatMap(child=>[...(selector===child.tagName||selector==='.'+child.className||selector==='#'+child.id?[child]:[]),...child.querySelectorAll(selector)])}
  querySelector(selector:string){return this.querySelectorAll(selector)[0]||null}
  focus(){doc.activeElement=this;fire('focusin',this)}
  click(){if(!this.disabled){this.handlers.get('click')?.({target:this});this.onclick?.()}}
 }
 const fire=(kind:string,target:Element,fields:Record<string,unknown>={})=>{const event={target,...fields,preventDefault(){},stopImmediatePropagation(){}};target.handlers.get(kind)?.(event);for(const fn of handlers.get(kind)||[])fn(event);return event};
 doc={body:new Element('body'),activeElement:null,createElement:(tag:string)=>new Element(tag),addEventListener:(kind:string,fn:(e:any)=>void)=>handlers.set(kind,[...(handlers.get(kind)||[]),fn]),removeEventListener:(kind:string,fn:(e:any)=>void)=>handlers.set(kind,(handlers.get(kind)||[]).filter(handler=>handler!==fn))};
 const background=new Element('main'),previous=new Element('button');background.append(previous);doc.body.append(background);doc.activeElement=previous;
 return {doc:doc as Document,previous,background,fire};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const oldAdd=globalThis.addEventListener,oldRemove=globalThis.removeEventListener;globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
 const f=fixture(),backend=new MockBackend(),session=new AccountChess(backend),panel=createAccessPanel(session,{document:f.doc});
 return {f,backend,session,panel,dispose(){panel.dispose();session.dispose();globalThis.addEventListener=oldAdd;globalThis.removeEventListener=oldRemove}};
}
test('Access panel presents email and Google, traps focus, closes with ESC and restores focus',()=>{
 languageStore.set('es');const {f,panel,dispose}=setup();
 try {panel.open();assert.equal(panel.element.getAttribute('role'),'dialog');assert.equal(panel.element.hidden,false);assert.equal(f.background.inert,true);assert.equal(f.doc.activeElement,(panel.element.querySelector('input') as any));assert.ok(Array.from(panel.element.querySelectorAll('button')).some(button=>button.textContent===t('auth.google')));
 f.fire('keydown',f.doc.activeElement as any,{key:'Escape'});assert.equal(panel.element.hidden,true);assert.equal(f.background.inert,false);assert.equal(f.doc.activeElement,f.previous as any);}
 finally{dispose()}
});
test('Confirmation panel leaves token unused until its button is clicked; language updates preserve focus',async()=>{
 const {f,backend,panel,dispose}=setup();languageStore.set('es');await backend.requestEmailLogin('visitor@example.com','es');const credential=new URLSearchParams(backend.simulatedLink()!.split('?')[1]).get('t')!;
 try {panel.open({kind:'confirm',credential});assert.equal((await backend.authMe()).mode,'guest');const button=Array.from(panel.element.querySelectorAll('button')).find(button=>button.textContent===t('auth.confirm')) as any;assert.equal(f.doc.activeElement,button);languageStore.set('en');assert.equal(button.textContent,'Confirm sign-in');assert.equal(panel.element.querySelector('h2')!.textContent,'Confirm your sign-in');assert.equal(f.doc.activeElement,button);button.click();await flush();assert.equal((await backend.authMe()).mode,'user');assert.equal(panel.state.status,'success');assert.match(panel.element.querySelector('.access-status')!.textContent!,/now play/);}
 finally{dispose();languageStore.set('es')}
});
test('Access panel renders identical check-email response with disabled resend while waiting',async()=>{
 const {f,panel,dispose}=setup();
 try {panel.open();const input=panel.element.querySelector('input') as any;input.value='new@example.com';f.fire('submit',panel.element.querySelector('form') as any);await flush();assert.equal(panel.state.status,'sent');assert.equal(panel.element.querySelector('.access-status')!.textContent,t('auth.checkEmail')+'. '+t('auth.generic'));const send=Array.from(panel.element.querySelectorAll('button')).find(button=>button.type==='submit')!;assert.equal(send.disabled,true);assert.match(send.textContent!,/30/);}
 finally{dispose()}
});
