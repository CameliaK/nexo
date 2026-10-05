import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWelcome, WELCOME_KEY } from '../src/welcome';
import { languageStore, t } from '../src/i18n';

const memory=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}};

function fixture(){
  let doc:any;
  const listeners=new Map<string,Array<{fn:(e:any)=>void;capture:boolean}>>();
  const observers=new Set<()=>void>();
  class Element {
    children:Element[]=[];parent:Element|null=null;attributes=new Map<string,string>();handlers=new Map<string,Array<(e:any)=>void>>();
    hidden=false;inert=false;id='';className='';title='';type='';tabIndex=0;innerHTML='';private text='';
    constructor(public tagName:string){}
    classList={contains:(name:string)=>this.className.split(' ').includes(name),add:(name:string)=>{if(!this.classList.contains(name))this.className+=' '+name},remove:(name:string)=>{this.className=this.className.split(' ').filter(c=>c!==name).join(' ')}};
    get isConnected():boolean{return this===doc.body||!!this.parent?.isConnected}
    get textContent():string{return this.text+this.children.map(child=>child.textContent).join(' ')}
    set textContent(text:string){this.text=text;this.children=[]}
    append(...children:Element[]){for(const child of children){child.parent=this;this.children.push(child)}if(this===doc.body)for(const update of observers)update()}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null}
    setAttribute(key:string,value:string){this.attributes.set(key,value)}
    getAttribute(key:string){return this.attributes.get(key)??null}
    removeAttribute(key:string){this.attributes.delete(key)}
    addEventListener(name:string,fn:(e:any)=>void){this.handlers.set(name,[...(this.handlers.get(name)||[]),fn])}
    contains(target:Element):boolean{return this===target||this.children.some(child=>child.contains(target))}
    querySelectorAll(selector:string):Element[]{return this.children.flatMap(child=>[...(selector==='*'||selector==='#'+child.id||selector==='.'+child.className||selector===child.tagName?[child]:[]),...child.querySelectorAll(selector)])}
    querySelector(selector:string){return this.querySelectorAll(selector)[0]??null}
    focus(){if(doc.activeElement===this)return;doc.activeElement=this;fire('focusin',this)}
    click(){fire('click',this)}
  }
  const fire=(name:string,target:Element,fields:Record<string,unknown>={})=>{
    const event={target,...fields,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true}};
    const callbacks=[...(listeners.get(name)||[])];
    for(const {fn,capture} of callbacks)if(capture&&!event.stopped)fn(event);
    for(const fn of [...(target.handlers.get(name)||[])])if(!event.stopped)fn(event);
    for(const {fn,capture} of callbacks)if(!capture&&!event.stopped)fn(event);
    if(name==='keydown'&&fields.key==='Enter'&&!event.defaultPrevented&&target.tagName==='button')target.click();
    return event;
  };
  doc={body:new Element('body'),activeElement:null,
    createElement:(tag:string)=>new Element(tag),
    getElementById:(id:string)=>doc.body.querySelector('#'+id),
    addEventListener:(name:string,fn:(e:any)=>void,capture=false)=>listeners.set(name,[...(listeners.get(name)||[]),{fn,capture}]),
    removeEventListener:(name:string,fn:(e:any)=>void)=>listeners.set(name,(listeners.get(name)||[]).filter(listener=>listener.fn!==fn)),
  };
  doc.activeElement=doc.body;
  const background=new Element('main'),heading=new Element('h1'),node=new Element('button'),previous=new Element('button'),locked=new Element('section');
  heading.id='level-title';node.id='existing-root-node';node.className='node-target';locked.inert=true;
  background.append(heading,node,previous);doc.body.append(background,locked);
  class Observer {
    constructor(private callback:()=>void){}
    observe(){observers.add(this.callback)}disconnect(){observers.delete(this.callback)}
  }
  return {doc:doc as Document,background,heading,node,previous,locked,Observer,fire,make:(tag:string)=>new Element(tag)};
}
const element=(welcome:ReturnType<typeof createWelcome>,selector:string)=>welcome.element.querySelector(selector) as unknown as ReturnType<typeof fixture>['node'];

test('Welcome appears on the first visit, Enter dismisses it, and dismissal survives reload',()=>{
  languageStore.set('es');const storage=memory(),first=fixture(),welcome=createWelcome({document:first.doc,storage});
  try{
    assert.equal(welcome.element.hidden,false);assert.equal(welcome.element.getAttribute('role'),'dialog');assert.equal(welcome.element.getAttribute('aria-modal'),'true');
    assert.equal(first.background.inert,true);assert.equal(first.doc.activeElement,element(welcome,'.welcome-enter'));
    const event=first.fire('keydown',first.doc.activeElement as any,{key:'Enter'});
    assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);assert.equal(welcome.element.hidden,true);assert.equal(storage.getItem(WELCOME_KEY),'1');
    assert.equal(first.doc.activeElement,first.heading);assert.equal(first.background.inert,false);assert.equal(first.locked.inert,true);
  }finally{welcome.dispose()}
  const next=fixture(),reloaded=createWelcome({document:next.doc,storage});
  try{assert.equal(reloaded.element.hidden,true);assert.equal(next.background.inert,false);assert.equal(reloaded.help.getAttribute('aria-expanded'),'false')}
  finally{reloaded.dispose()}
});

test('Skip persists dismissal; the question node reopens the guide and ESC returns focus to it',()=>{
  const storage=memory(),f=fixture(),welcome=createWelcome({document:f.doc,storage});
  try{
    element(welcome,'.welcome-skip').click();assert.equal(storage.getItem(WELCOME_KEY),'1');
    const help=welcome.help as any;help.focus();help.click();
    assert.equal(welcome.element.hidden,false);assert.equal(help.getAttribute('aria-expanded'),'true');assert.equal(help.getAttribute('aria-label'),t('welcome.reopen'));
    const event=f.fire('keydown',element(welcome,'.welcome-enter'),{key:'Escape'});
    assert.equal(event.stopped,true);assert.equal(welcome.element.hidden,true);assert.equal(f.doc.activeElement,help);
  }finally{welcome.dispose()}
});

test('Modal traps Tab and programmatic focus, restores prior focus, and protects UI added while loading',()=>{
  const f=fixture(),descriptor=Object.getOwnPropertyDescriptor(globalThis,'MutationObserver');
  Object.defineProperty(globalThis,'MutationObserver',{configurable:true,value:f.Observer});
  f.previous.focus();const welcome=createWelcome({document:f.doc,storage:memory()});
  try{
    const content=element(welcome,'.welcome-content'),skip=element(welcome,'.welcome-skip'),enter=element(welcome,'.welcome-enter');
    skip.focus();assert.equal(f.fire('keydown',skip,{key:'Tab',shiftKey:false}).defaultPrevented,true);assert.equal(f.doc.activeElement,content);
    const scrolling=f.fire('keydown',content,{key:'PageDown'});assert.equal(scrolling.defaultPrevented,false);assert.equal(scrolling.stopped,true,'The guide can scroll with the keyboard without triggering universe shortcuts');
    assert.equal(f.fire('keydown',content,{key:'Tab',shiftKey:true}).defaultPrevented,true);assert.equal(f.doc.activeElement,skip);
    f.previous.focus();assert.equal(f.doc.activeElement,enter);
    const late=f.make('button');f.doc.body.append(late as any);assert.equal(late.inert,true,'Loading new universe controls does not leak focus outside the modal');
    f.fire('keydown',enter,{key:'Escape'});assert.equal(f.doc.activeElement,f.previous);assert.equal(late.inert,false);assert.equal(f.locked.inert,true);
  }finally{
    welcome.dispose();if(descriptor)Object.defineProperty(globalThis,'MutationObserver',descriptor);else Reflect.deleteProperty(globalThis,'MutationObserver');
  }
});

test('Changing language relabels the open welcome in place and preserves focus',()=>{
  languageStore.set('es');const f=fixture(),welcome=createWelcome({document:f.doc,storage:memory()});
  try{
    const title=element(welcome,'#welcome-title'),enter=element(welcome,'.welcome-enter'),language=element(welcome,'.welcome-language');
    assert.equal(title.textContent,'Hola, soy Kirbith Cubillas');assert.equal(enter.textContent,'Entrar al universo');
    language.click();assert.equal(title.textContent,"Hi, I'm Kirbith Cubillas");assert.equal(enter.textContent,'Enter the universe');
    assert.equal(element(welcome,'#welcome-title'),title);assert.equal(f.doc.activeElement,enter);assert.equal(language.textContent,'EN');
    language.focus();f.fire('keydown',language,{key:'Enter'});assert.equal(welcome.element.hidden,false,'Enter on the language control retains native toggle behavior');
    assert.equal(title.textContent,'Hola, soy Kirbith Cubillas');assert.equal(language.textContent,'ES');
  }finally{welcome.dispose();languageStore.set('es')}
});

test('First dismissal hints at the first root node once and first interaction removes the localized hint',()=>{
  languageStore.set('es');const f=fixture(),welcome=createWelcome({document:f.doc,storage:memory()});
  f.node.setAttribute('aria-describedby','existing-description');welcome.attachUniverse(()=>f.node as any);
  try{
    welcome.close();assert.equal(f.node.classList.contains('has-first-visit-hint'),true);assert.equal(f.node.querySelector('.first-visit-hint')?.textContent,'Haz clic');
    assert.equal(f.node.id,'existing-root-node');assert.equal(f.node.getAttribute('aria-describedby'),'existing-description welcome-node-hint');
    languageStore.set('en');assert.equal(f.node.querySelector('.first-visit-hint')?.textContent,'Click');
    f.fire('pointerdown',f.node);assert.equal(f.node.classList.contains('has-first-visit-hint'),false);assert.equal(f.node.querySelector('.first-visit-hint'),null);assert.equal(f.node.getAttribute('aria-describedby'),'existing-description');
    welcome.open();welcome.close();assert.equal(f.node.querySelector('.first-visit-hint'),null);
  }finally{welcome.dispose();languageStore.set('es')}
});

test('Closing before the universe loads defers the hint; an earlier interaction cancels it',()=>{
  for(const interacted of [false,true]){
    const f=fixture(),welcome=createWelcome({document:f.doc,storage:memory()});
    try{
      welcome.close();if(interacted)f.fire('wheel',f.heading);
      welcome.attachUniverse(()=>f.node as any);assert.equal(f.node.classList.contains('has-first-visit-hint'),!interacted);
    }finally{welcome.dispose()}
  }
});

test('Blocked localStorage never prevents opening, closing, reopening or cleanup',()=>{
  const f=fixture(),descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Storage disabled')}});
  try{
    for(const storage of [undefined,{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}]){
      const welcome=createWelcome({document:f.doc,storage});
      assert.equal(welcome.element.hidden,false);welcome.close();assert.equal(welcome.element.hidden,true);welcome.open();assert.equal(welcome.element.hidden,false);welcome.dispose();assert.equal(f.background.inert,false);
    }
  }finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage')}
});

test('HTML has a Spanish title and description before JS, documented social URL placeholders and a local favicon',()=>{
  const html=fs.readFileSync('index.html','utf8');languageStore.set('es');
  assert.ok(html.includes(`<title data-i18n="app.documentTitle">${t('app.documentTitle')}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${t('app.description')}"`));
  for(const key of ['og:title','og:description','og:url','og:image','twitter:title','twitter:description','twitter:url','twitter:image','twitter:card'])assert.ok(html.includes(`="${key}"`),key);
  assert.match(html,/name="theme-color" content="#[\da-f]{6}"/);assert.ok(html.includes('href="/favicon.svg"'));assert.match(fs.readFileSync('public/favicon.svg','utf8'),/<svg/);
  const docs=fs.readFileSync('docs/metadata.md','utf8');for(const placeholder of ['__PUBLIC_SITE_URL__','__SOCIAL_IMAGE_URL__'])assert.ok(html.includes(placeholder)&&docs.includes(placeholder));
});
