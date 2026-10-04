import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LanguageStore, LANGUAGE_KEY, preferredLanguage, initializeLanguage } from '../src/i18n/language';
import { t, languageStore, translateText, translateUI } from '../src/i18n';
import { es } from '../src/i18n/es';
import { en } from '../src/i18n/en';
import { fallbackContent, portfolio, architecture, registerTranslations, applyContent } from '../src/i18n/content';
import { createLanguageNode } from '../src/i18n/node';
import { RealBackend } from '../src/backend/real';
import { MockBackend } from '../src/backend/mock';
import { ChessGame } from '../src/chess/game';
import spanish from '../src/data/portfolio-content.es.json';
import spanishArchitecture from '../src/data/backend-architecture.es.json';

const english:typeof spanish=fs.existsSync('src/data/portfolio-content.en.json')?JSON.parse(fs.readFileSync('src/data/portfolio-content.en.json','utf8')):spanish;
const englishArchitecture:typeof spanishArchitecture=fs.existsSync('src/data/backend-architecture.en.json')?JSON.parse(fs.readFileSync('src/data/backend-architecture.en.json','utf8')):spanishArchitecture;

const memory=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}};
const reset=()=>{languageStore.set('es');registerTranslations(english,englishArchitecture);applyContent('es')};

test('Locale defaults follow navigator language, stored preference survives reload and private storage stays usable',()=>{
  assert.equal(preferredLanguage('es-MX'),'es');assert.equal(preferredLanguage('ES-es'),'es');assert.equal(preferredLanguage('en-US'),'en');assert.equal(preferredLanguage('fr'),'en');
  const storage=memory(),first=new LanguageStore(storage,'en-GB');assert.equal(first.language,'en');let updates=0;first.subscribe(()=>updates++);first.toggle();assert.equal(first.language,'es');assert.equal(storage.getItem(LANGUAGE_KEY),'es');assert.equal(new LanguageStore(storage,'en').language,'es');first.set('es');assert.equal(updates,1);
  storage.setItem(LANGUAGE_KEY,'invalid');assert.equal(new LanguageStore(storage,'en').language,'en');
  const privateStore=new LanguageStore({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}},'en');privateStore.toggle();assert.equal(privateStore.language,'es');
});

test('Initialization uses navigator.language and persists toggles without requiring localStorage access',()=>{
  const originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');const storage=memory();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'en-US'}});
  const stop=initializeLanguage();
  try{assert.equal(languageStore.language,'en');languageStore.toggle();assert.equal(storage.getItem(LANGUAGE_KEY),'es');storage.setItem(LANGUAGE_KEY,'en');const reload=initializeLanguage();assert.equal(languageStore.language,'en');reload()}
  finally{stop();for(const [key,descriptor] of [['localStorage',originalStorage],['navigator',originalNavigator]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}reset()}
});

test('Missing English files, nodes and nested fields fall back to Spanish; translated arrays match IDs, not order',()=>{
  const source={nodes:[{id:'a',parent:'root',label:'Primero',summary:'Resumen',content:{body:'Texto',items:[{label:'Edad',value:'23 años'}]},media:[{id:'img',src:'/media/a/a.webp',alt:'Un cubo'}]},{id:'b',label:'Segundo'}]};
  assert.deepEqual(fallbackContent(source,undefined),source);
  const translated=fallbackContent(source,{nodes:[{id:'b',label:'Second'},{id:'a',parent:'wrong',label:'First',summary:'',content:{body:'Body'},media:[{id:'img',src:'/bad.webp'}]}]});
  assert.deepEqual(translated.nodes.map(node=>node.id),['a','b']);assert.equal(translated.nodes[0].parent,'root');assert.equal(translated.nodes[0].label,'First');assert.equal(translated.nodes[0].summary,'Resumen');assert.equal(translated.nodes[0].content?.body,'Body');assert.deepEqual(translated.nodes[0].content?.items,source.nodes[0].content?.items);assert.equal(translated.nodes[0].media?.[0].alt,'Un cubo');assert.equal(translated.nodes[0].media?.[0].src,'/media/a/a.webp');
  assert.equal(fallbackContent(source,{nodes:[{id:'a',label:null}]}).nodes[1].label,'Segundo');
  registerTranslations();applyContent('en');assert.equal(portfolio.nodes[0].label,spanish.nodes[0].label);reset();
});

function ids(value:unknown):string[]{
  if(Array.isArray(value))return value.flatMap(ids);
  if(value&&typeof value==='object')return Object.entries(value).flatMap(([key,item])=>key==='id'?[String(item)]:ids(item));
  return [];
}
test('Portfolio, architecture components, media and flow IDs have exact parity; graph topology stays identical',()=>{
  assert.deepEqual(ids(spanish),ids(english));assert.deepEqual(ids(spanishArchitecture),ids(englishArchitecture));
  assert.equal(new Set(spanish.nodes.map(node=>node.id)).size,54);
  for(const [i,node] of spanish.nodes.entries()){assert.equal(english.nodes[i].parent,node.parent);assert.equal(english.nodes[i].type,node.type);assert.deepEqual(english.nodes[i].links,node.links);assert.deepEqual(english.nodes[i].architecture?.connections.map(edge=>[edge.from,edge.to]),node.architecture?.connections.map(edge=>[edge.from,edge.to]))}
  assert.deepEqual(englishArchitecture.edges.map(edge=>[edge.id,edge.from,edge.to,edge.kind]),spanishArchitecture.edges.map(edge=>[edge.id,edge.from,edge.to,edge.kind]));
  assert.deepEqual(Object.keys(en).sort(),Object.keys(es).sort());
  for(const key of Object.keys(es) as (keyof typeof es)[])assert.deepEqual([...es[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...en[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key);
});

test('Content switches in place with localized chess and interface status; no camera or graph rebuild is needed',()=>{
  reset();const node=portfolio.nodes[0],component=architecture.components[0],game=new ChessGame();game.move('e2','e4');const fen=game.fen;
  assert.equal(t('chat.offline'),'Chat no disponible · Sin conexión');const preview=t('chat.wait',{seconds:8});
  languageStore.set('en');applyContent('en');
  try{assert.equal(portfolio.nodes[0],node);assert.equal(architecture.components[0],component);assert.equal(node.label,'Personal information');assert.equal(component.label,'Your browser');assert.equal(t('chat.offline'),'Chat unavailable · Offline');assert.equal(translateText(preview),'Wait 8 s before sending.');assert.equal(game.fen,fen);assert.match(game.status.title,/Kirbith/);assert.equal(game.status.detail,'Black · select a piece')}
  finally{reset()}
});

test('Language node toggles ES/EN with native keyboard semantics, accessible label and html lang',()=>{
  reset();const attrs=new Map<string,string>(),label={textContent:''};let click:()=>void=()=>{},removed=false;
  const button={type:'',className:'',innerHTML:'',title:'',querySelector:()=>label,setAttribute:(key:string,value:string)=>attrs.set(key,value),addEventListener:(_key:string,fn:()=>void)=>{click=fn},remove:()=>{removed=true}};
  const doc={documentElement:{lang:''},body:{append(){}},createElement:()=>button,querySelectorAll:()=>[]};
  const node=createLanguageNode(doc as unknown as Document);
  try{assert.equal(button.type,'button');assert.equal(label.textContent,'ES');assert.equal(doc.documentElement.lang,'es');assert.match(attrs.get('aria-label')!,/Cambiar a inglés/);click();assert.equal(label.textContent,'EN');assert.equal(doc.documentElement.lang,'en');assert.match(attrs.get('aria-label')!,/Switch to Spanish/);click();assert.equal(label.textContent,'ES');assert.equal(doc.documentElement.lang,'es');const css=fs.readFileSync('src/style.css','utf8');assert.match(css,/\.language-node\{position:fixed/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/)}
  finally{node.dispose();assert.equal(removed,true);reset()}
});

test('UI relabeling preserves input drafts and skips visitor messages',()=>{
  reset();const attrs=new Map([['placeholder',t('guide.message')]]),input={dataset:{},childNodes:[],value:'Texto sin enviar',closest:()=>null,getAttribute:(name:string)=>attrs.get(name)??null,setAttribute:(name:string,value:string)=>attrs.set(name,value)};
  const text={nodeType:3,textContent:t('common.you')},message={dataset:{},childNodes:[text],closest:()=>message,getAttribute:()=>null};
  languageStore.set('en');try{translateUI({querySelectorAll:()=>[input,message]} as unknown as ParentNode);assert.equal(input.value,'Texto sin enviar');assert.equal(attrs.get('placeholder'),'Your message…');assert.equal(text.textContent,'Tú')}finally{reset()}
});

test('RealBackend serializes optional chat lang; MockBackend accepts and ignores it',async()=>{
  const real=new RealBackend();Reflect.set(real,'token','test-token');const original=globalThis.fetch,bodies:unknown[]=[];
  globalThis.fetch=async (_url,options)=>{bodies.push(JSON.parse(String(options?.body)));return new Response(JSON.stringify({run_id:'test'}),{status:202,headers:{'Content-Type':'application/json'}})};
  try{await real.sendMessage('Hello','en');await real.sendMessage('Hola','es');await real.sendMessage('Legacy');assert.deepEqual(bodies,[{message:'Hello',lang:'en'},{message:'Hola',lang:'es'},{message:'Legacy'}])}finally{globalThis.fetch=original}
  const mock=new MockBackend({now:()=>0,schedule:()=>0,cancel(){}});await mock.connect();assert.ok((await mock.sendMessage('Hola','en')).run_id);mock.disconnect();
});
