import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountNode } from '../src/auth/account';
import { LoginContinuation } from '../src/auth/continuation';
import { BackendError } from '../src/backend/types';
import fs from 'node:fs';
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
 try {panel.open({kind:'confirm',credential});assert.equal((await backend.authMe()).mode,'guest');const button=Array.from(panel.element.querySelectorAll('button')).find(button=>button.textContent===t('auth.confirm')) as any;assert.equal(f.doc.activeElement,button);languageStore.set('en');assert.equal(button.textContent,'Confirm sign-in');assert.equal(panel.element.querySelector('h2')!.textContent,'Confirm your sign-in');assert.equal(f.doc.activeElement,button);button.click();await flush();assert.equal((await backend.authMe()).mode,'user');assert.equal(panel.state.status,'success');assert.equal(panel.element.hidden,true);assert.equal(panel.element.querySelector('h2')!.textContent,'');assert.equal(f.doc.body.querySelector('.session-notice')!.textContent,t('auth.signedIn'));assert.equal(f.doc.activeElement,f.previous as any);}
 finally{dispose();languageStore.set('es')}
});
test('Access panel renders identical check-email response with disabled resend while waiting',async()=>{
 const {f,panel,dispose}=setup();
 try {panel.open();const input=panel.element.querySelector('input') as any;input.value='new@example.com';f.fire('submit',panel.element.querySelector('form') as any);await flush();assert.equal(panel.state.status,'sent');assert.equal(panel.element.querySelector('.access-status')!.textContent,t('auth.checkEmail')+'. '+t('auth.generic'));const send=Array.from(panel.element.querySelectorAll('button')).find(button=>button.type==='submit')!;assert.equal(send.disabled,true);assert.match(send.textContent!,/30/);}
 finally{dispose()}
});

test('Active session never opens a sign-in title; the access action routes to Account',async()=>{
 const {f,backend,session,panel,dispose}=setup();
 try {await backend.requestEmailLogin('active@example.com','es');await backend.verifyEmailLogin(new URLSearchParams(backend.simulatedLink()!.split('?')[1]).get('t')!);await session.refresh();panel.open();assert.equal(panel.element.hidden,true);assert.equal(panel.element.querySelector('h2')!.textContent,'');languageStore.set('en');assert.equal(panel.element.querySelector('h2')!.textContent,'');}
 finally{dispose();languageStore.set('es')}
});

test('Account node routes guests to access and owns notifications, logout and confirmed deletion independently of chess',async()=>{
 const f=fixture(),backend=new MockBackend(),session=new AccountChess(backend);let access=0;
 const account=createAccountNode(session,()=>access++,f.doc);
 try {
  account.element.click();assert.equal(access,1);assert.equal(account.panel.hidden,true);
  await backend.requestEmailLogin('visitor@example.com','es');await backend.verifyEmailLogin(new URLSearchParams(backend.simulatedLink()!.split('?')[1]).get('t')!);
  backend.chessGetGame=async()=>{throw new BackendError('internal','missing chess',404)};
  await session.refresh();assert.equal(session.available,false);account.open();await flush();
  assert.equal(account.panel.hidden,false);assert.equal(account.panel.querySelector('.account-email')!.textContent,'v***@example.com');
  const checkbox=account.panel.querySelector('input') as any;assert.equal(checkbox.checked,true);assert.equal(checkbox.disabled,false);checkbox.checked=false;f.fire('change',checkbox);await flush();assert.deepEqual(await backend.getNotifications(),{chess_email:false});
  languageStore.set('en');assert.equal(account.panel.querySelector('h2')!.textContent,'Account');assert.equal(account.element.getAttribute('aria-label'),t('account.open'));
  account.panel.querySelector<HTMLButtonElement>('.account-delete')!.click();assert.equal((await backend.authMe()).mode,'user');assert.equal(account.panel.querySelector<HTMLElement>('.account-confirmation')!.hidden,false);
  f.fire('keydown',f.doc.activeElement as any,{key:'Escape'});assert.equal(account.panel.querySelector<HTMLElement>('.account-confirmation')!.hidden,true);assert.equal(account.panel.hidden,false);
  account.panel.querySelector<HTMLButtonElement>('.account-delete')!.click();account.panel.querySelector<HTMLButtonElement>('.account-confirm-delete')!.click();await flush();assert.equal((await backend.authMe()).mode,'guest');assert.equal(account.panel.hidden,true);assert.equal(f.doc.activeElement,f.previous as any);
  const chessSource=fs.readFileSync('src/chess/index.ts','utf8');assert.equal(chessSource.includes('accountMenu'),false);assert.equal(chessSource.includes('signOut('),false);assert.ok(chessSource.includes('chess-account-link'));
 }finally{account.dispose();session.dispose();languageStore.set('es')}
});
test('Google completion auto-closes access, restores focus and signals exactly one chess continuation',async()=>{
 const oldAdd=globalThis.addEventListener,oldRemove=globalThis.removeEventListener;
 globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
 const f=fixture(),backend=new MockBackend(),session=new AccountChess(backend);let completed=0,accounts=0;
 backend.exchangeCode=async()=>{session.me={mode:'user',email_hint:'k***@gmail.com'};backend.authMe=async()=>session.me;return{token:'simulated'}};
 const panel=createAccessPanel(session,{document:f.doc,onSignedIn:()=>completed++,onAccount:()=>accounts++});
 try {panel.open({kind:'done',credential:'google-code'});await flush();assert.equal(panel.element.hidden,true);assert.equal(completed,1);assert.equal(f.doc.activeElement,f.previous as any);assert.equal(panel.element.querySelector('h2')!.textContent,'');
  languageStore.set('en');assert.equal(f.doc.body.querySelector('.session-notice')!.textContent,'Signed in');panel.open();assert.equal(accounts,1);assert.equal(panel.element.hidden,true);assert.equal(completed,1);
 }finally{panel.dispose();session.dispose();globalThis.addEventListener=oldAdd;globalThis.removeEventListener=oldRemove;languageStore.set('es')}
});
test('Chess continuation survives redirects, is consumed once and expires without blocking storage fallback',()=>{
 const saved=new Map<string,string>(),storage={getItem:(k:string)=>saved.get(k)||null,setItem:(k:string,v:string)=>{saved.set(k,v)},removeItem:(k:string)=>{saved.delete(k)}};
 const first=new LoginContinuation(storage,()=>100);first.requestChess();const redirected=new LoginContinuation(storage,()=>200);assert.equal(redirected.takeChess(),true);assert.equal(redirected.takeChess(),false);
 first.requestChess();assert.equal(new LoginContinuation(storage,()=>1_000_000).takeChess(),false);
 const ephemeral=new LoginContinuation();ephemeral.requestChess();assert.equal(ephemeral.takeChess(),true);assert.equal(ephemeral.takeChess(),false);
});
