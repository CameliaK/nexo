import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { privacyContent, renderPrivacy } from '../src/privacy/content';
import { DataDeletion } from '../src/privacy/deletion';
import { privacyNotice } from '../src/privacy/link';
import { MockBackend } from '../src/backend/mock';
import { MockWsTickets } from '../src/backend/ws-ticket';
import { BackendError } from '../src/backend/types';
import { languageStore, t } from '../src/i18n';

function dom() {
  class Element {
    children: Element[] = []; dataset: Record<string,string> = {}; className=''; ownText=''; attrs: Record<string,string> = {};
    constructor(public tagName: string) {}
    set textContent(text: string) { this.ownText = text; this.children = []; }
    get textContent(): string { return this.ownText + this.children.map(c => c.textContent).join(''); }
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren() { this.children=[];this.ownText=''; }
    setAttribute(key: string, value: string) { this.attrs[key]=value; }
  }
  const doc = {createElement:(tag:string)=>new Element(tag),createTextNode:(text:string)=>{const e=new Element('text');e.textContent=text;return e;}};
  return {doc:doc as unknown as Document,root:new Element('article') as unknown as HTMLElement};
}

const sourceNotice = fs.readFileSync('../docs/aviso-de-privacidad.md', 'utf8');
const normalize = (text:string) => text.replace(/\s+/g, ' ').trim();
// Keep inline punctuation adjacent, and give block/table boundaries the same
// whitespace as browser innerText, rather than inventing spaces around <strong>.
function renderedText(element:any):string {
 return ['article','div','table','thead','tbody','tr','ul'].includes(element.tagName)
  ? element.children.map(renderedText).join(' '):element.textContent;
}

function publishedNotice(language:'es'|'en') {
 const pattern=language==='es'
  ? /^# Aviso de privacidad \(español\)\n[\s\S]*?(?=^## Avisos breves)/m
  : /^# Privacy notice \(English\)\n[\s\S]*?(?=^## Short notices)/m;
 const match=sourceNotice.match(pattern);assert.ok(match, `Missing final ${language} document`);
 return match[0].replace(/\n---\s*$/, '').trim();
}
function plainMarkdown(markdown:string) {
 return normalize(markdown.split('\n').filter(line=>!/^\|(?:[-:\s]+\|)+$/.test(line)).map(line=>
  line.startsWith('|')?line.split('|').slice(1,-1).map(cell=>cell.trim()).join(' '):line.replace(/^#{1,2} |^- /,'')
 ).join(' ').replace(/\*\*([^*]+)\*\*/g,'$1'));
}
function briefNotices(language:'es'|'en') {
 const section=language==='es'
  ? sourceNotice.match(/^## Avisos breves[^\n]*\n([\s\S]*?)(?=^# Privacy notice)/m)
  : sourceNotice.match(/^## Short notices[^\n]*\n([\s\S]*)/m);
 assert.ok(section);
 return [...section[1].matchAll(/^> .+(?:\n> .+)*/gm)].map(match=>normalize(match[0].replace(/^> /gm,'')));
}

test('Published ES/EN Markdown and every rendered word match the final source notice, sections 1–7 only',()=>{
 for(const language of ['es','en'] as const){
  const expected=publishedNotice(language),{doc,root}=dom();
  assert.equal(privacyContent(language),expected,'Run npm run sync-privacy after updating the source notice.');
  renderPrivacy(doc,root,language);
  assert.equal(normalize(renderedText(root)),plainMarkdown(expected),'The rendered page must preserve all final text, punctuation, dates and table cells.');
  assert.doesNotMatch(root.textContent!,/\[|\b(?:borrador|draft)\b|Avisos breves|Short notices/i);
  assert.ok(root.textContent!.includes('contacto@kirbith.dev'));
  const date=expected.match(/\*\*(?:Última actualización|Last updated):\*\* ([^\n]+)/);assert.ok(date);assert.ok(root.textContent!.includes(date[1]));
  for(const value of ['90','180','30','7','48','Hetzner','Resend','DeepSeek','Telegram'])assert.ok(root.textContent!.includes(value));
  const children=(root as any).children;assert.equal(children.filter((e:any)=>e.tagName==='h1').length,1);
  const headings=children.filter((e:any)=>e.tagName==='h2');assert.deepEqual(headings.map((e:any)=>Number(e.textContent.match(/^([1-7])\./)?.[1])),[1,2,3,4,5,6,7]);
  assert.equal(children.find((e:any)=>e.className==='privacy-table').children[0].tagName,'table');
 }
});
test('The six localized brief notices match the source quotes word for word, with links instead of brackets',()=>{
 const {doc}=dom();
 try{
  for(const language of ['es','en'] as const){
   languageStore.set(language);const quotes=briefNotices(language);assert.equal(quotes.length,3);
   for(const [index,key] of (['privacy.assistant','privacy.live','privacy.access'] as const).entries()){
    const quote=quotes[index],marker=quote.match(/\[([^\]]+)\]$/);assert.ok(marker);
    assert.equal(t(key),quote.slice(0,marker.index).trim());
    const note=privacyNotice(key,doc);assert.equal(normalize(note.textContent!),quote.replace(/\[([^\]]+)\]$/,'$1'));
    const link=(note as any).children.at(-1);assert.equal(link.href,'/privacidad');assert.equal(link.textContent,marker[1]);
    assert.doesNotMatch(note.textContent!,/\[|\b(?:borrador|draft)\b/i);
   }
  }
 }finally{languageStore.set('es')}
});
test('Nginx serves a real non-hash privacy page and omits queries from logs; account links remain intact',()=>{
 const nginx=fs.readFileSync('nginx.conf','utf8');assert.match(nginx,/location = \/privacidad \{ try_files \/privacidad\/index.html =404;/);assert.match(nginx,/\$request_method \$uri \$server_protocol/);assert.doesNotMatch(nginx,/\$request(?:\s|['"]|_uri)|\$args|\$http_referer/);
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/href="\/privacidad"/);
 assert.ok(fs.readFileSync('src/auth/account.ts','utf8').includes('privacyLink(doc)'));
});
test('Data deletion deduplicates clicks, localizes errors and respects its own Retry-After before retrying',async()=>{
 let now=1000,calls=0,release!:()=>void;
 const deletion=new DataDeletion({async deleteSessionData(){calls++;if(calls===1)throw new BackendError('rate_limited','private detail',429,10);await new Promise<void>(resolve=>{release=resolve})}},()=>now);
 try{
  languageStore.set('es');assert.equal(await deletion.run(),false);assert.equal(deletion.seconds,10);assert.equal(deletion.message,'Espera 10 s antes de volver a intentarlo.');assert.equal(await deletion.run(),false);assert.equal(calls,1);
  languageStore.set('en');assert.equal(deletion.message,'Wait 10 s before trying again.');now+=9999;assert.equal(await deletion.run(),false);now++;const pending=deletion.run();assert.equal(deletion.message,'Deleting data…');assert.equal(await deletion.run(),false);release();assert.equal(await pending,true);assert.equal(calls,2);
  const failure=new DataDeletion({async deleteSessionData(){throw Error('raw error')}});assert.equal(await failure.run(),false);assert.equal(failure.message,t('privacy.error'));
 }finally{languageStore.set('es')}
});
test('Mock WS tickets expire after 30 seconds, are single-use, and every mock connection requests a new ticket',async()=>{
 let now=1000;const tickets=new MockWsTickets(()=>now);const first=await tickets.request();assert.equal(first.expires_in,30);tickets.consume(first.ticket);assert.throws(()=>tickets.consume(first.ticket),{status:401});const expired=await tickets.request();now+=30000;assert.throws(()=>tickets.consume(expired.ticket),{status:401});
 const mock=new MockBackend(),transport=Reflect.get(mock,'tickets') as MockWsTickets;const request=transport.request.bind(transport);const issued:string[]=[];transport.request=async()=>{const result=await request();issued.push(result.ticket);return result};
 await Promise.all([mock.connect(),mock.connect(),mock.connect()]);assert.equal(issued.length,1);mock.disconnect();await mock.connect();assert.equal(issued.length,2);assert.notEqual(issued[0],issued[1]);assert.throws(()=>transport.consume(issued[1]),{status:401});mock.disconnect();
});
test('Mock deletion cancels pending messages/nodes, empties visitor history, removes local session and preserves account/game',async()=>{
 const values=new Map<string,string>([['nexo.visitor_id','guest-id'],['nexo.auth.token','mock-token'],['nexo.guest.session','mock-guest']]);
 const storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}};
 const tasks=new Map<number,()=>void>();let serial=0;
 const mock=new MockBackend({now:()=>1000,schedule:fn=>{tasks.set(++serial,fn);return serial},cancel:id=>{tasks.delete(id as number)}},storage);
 await mock.connect();await mock.requestEmailLogin('visitor@example.com','es');await mock.verifyEmailLogin(new URLSearchParams(mock.simulatedLink()!.split('?')[1]).get('t')!);const game=await mock.chessNewGame('w');await mock.sendLiveMessage('My message','My name');assert.ok(tasks.size>0);
 await mock.deleteSessionData();assert.equal(tasks.size,0);assert.equal((await mock.authMe()).mode,'guest');assert.deepEqual(await mock.listGeneratedNodes(),[]);assert.deepEqual(await mock.listLiveMessages(),{conversation_id:null,messages:[]});assert.equal(values.has('nexo.visitor_id'),false);assert.equal(values.has('nexo.auth.token'),false);assert.equal(values.has('nexo.guest.session'),false);
 const saved=JSON.parse(storage.getItem('nexo.mock.account.v1')!);assert.equal(saved.email,'visitor@example.com');assert.equal(saved.game.id,game.id);
 const reload=new MockBackend(undefined,storage);assert.equal((await reload.authMe()).mode,'guest');assert.deepEqual(await reload.listGeneratedNodes(),[]);reload.disconnect();
});
