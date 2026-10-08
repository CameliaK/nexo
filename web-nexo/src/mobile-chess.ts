import { mobileViewport } from './mobile-layout';
import { icon } from './icons';
import type { BackendArchitecture } from './backend/types';
import { t,languageStore } from './i18n';
import type { Chats } from './chat';
/** Dock the existing chats and system entrance; their instances and data stay intact. */
export function createMobileChess(chats:Chats,universe:{openAgent():void;closeAgent():void},portal:{element:HTMLElement;button:HTMLButtonElement},architecture:BackendArchitecture){
 const body=document.body,agent=document.getElementById('companion-panel')!,live=document.getElementById('live-panel')!;
 const button=document.createElement('button');button.type='button';button.className='mobile-chess-chat-toggle';
 const badge=document.createElement('span');badge.className='mobile-chat-badge';badge.hidden=true;
 const label=document.createElement('span');const glyph=document.createElement('span');glyph.innerHTML=icon('chat');button.append(glyph,label,badge);button.setAttribute('aria-controls','mobile-chat-controls');button.setAttribute('aria-expanded','false');
 const controls=document.createElement('nav');controls.id='mobile-chat-controls';controls.className='mobile-chat-controls';controls.hidden=true;
 const assistant=document.createElement('button'),owner=document.createElement('button'),close=document.createElement('button');
 for(const item of [assistant,owner,close])item.type='button';close.innerHTML=icon('close');controls.append(assistant,owner,close);
 const sheetHeader=document.createElement('header');sheetHeader.className='mobile-system-header';
 const title=document.createElement('h2'),systemClose=document.createElement('button');systemClose.type='button';systemClose.innerHTML=icon('close');sheetHeader.append(title,systemClose);portal.element.append(sheetHeader);
 const summary=document.createElement('ul');summary.id='mobile-system-components';summary.className='sr-only';summary.dataset.i18nIgnore='';summary.hidden=true;portal.element.append(summary);
 const safe=document.createElement('div');safe.className='mobile-safe-probe';safe.setAttribute('aria-hidden','true');body.append(button,controls,safe);
 const hiddenState=new Map<HTMLElement,boolean>();
 let active=false,chat:'agent'|'live'|null=null,expanded=false,previous:HTMLElement|null=null,swipe:{id:number;y:number;surface:'chat'|'system'}|null=null;
 const isMobile=()=>innerWidth<=768||(matchMedia('(pointer: coarse)').matches&&innerHeight<=768);
 const emit=()=>dispatchEvent(new Event('nexo:mobile-layout'));
 function measure(){
  const visual=window.visualViewport,styles=getComputedStyle(safe),stable=safe.getBoundingClientRect().height;const height=Math.min(visual?.height||innerHeight,stable||innerHeight);
  body.style.setProperty('--mobile-height',height+'px');body.style.setProperty('--mobile-top',(visual?.offsetTop||0)+'px');
  body.dataset.mobileKeyboard=String(height<innerHeight*.75);
  body.dataset.mobileHeight=String(height);body.dataset.mobileTop=String(visual?.offsetTop||0);
  const inset=body.dataset.mobileKeyboard==='true'?Math.max(8,parseFloat(styles.paddingBottom)||0):Math.max(16,parseFloat(styles.paddingBottom)||0)+(innerWidth>innerHeight?16:56);body.dataset.mobileInset=String(inset);body.style.setProperty('--mobile-bottom-inset',inset+'px');const dock=mobileViewport({width:innerWidth,height,offsetTop:visual?.offsetTop||0,chat:true,landscape:innerWidth>innerHeight,browserInset:inset,composerHeight:body.classList.contains('live-chat-open')?Number(body.dataset.liveComposerHeight)||0:0});body.style.setProperty('--mobile-dock-height',dock.dock+'px');body.style.setProperty('--mobile-dock-top',dock.dockTop+'px');
  body.dataset.safeTop=String(parseFloat(styles.paddingTop)||0);body.dataset.safeBottom=String(parseFloat(styles.paddingBottom)||0);
 }
 function relabel(){
  label.textContent=t('mobile.chat');button.setAttribute('aria-label',badge.hidden?t('mobile.chat'):t('mobile.chatUnread'));
  controls.setAttribute('aria-label',t('mobile.chats'));assistant.textContent=t('mobile.assistant');owner.textContent=t('mobile.live');close.setAttribute('aria-label',t('chat.close'));
  systemClose.setAttribute('aria-label',t('common.close'));title.textContent=t('system.title');
  if(expanded)portal.element.setAttribute('aria-label',t('system.title'));
  summary.replaceChildren(...architecture.components.map(component=>{const item=document.createElement('li');item.textContent=component.label+' · '+component.tech+'. '+component.what;return item}));
 }
 function syncUnread(){
  const count=Number(document.getElementById('floating-live-chat')?.dataset.unread||0);badge.hidden=count===0;badge.textContent=String(count);relabel();
 }
 function closeChat(restore=true){
  if(chat==='agent')universe.closeAgent();else if(chat==='live')chats.closeLive();
  chat=null;controls.hidden=true;body.classList.remove('mobile-chess-chat');button.setAttribute('aria-expanded','false');measure();emit();if(restore)button.focus({preventScroll:true});
 }
 function select(which:'agent'|'live'){
  if(!active)return;
  if(chat&&chat!==which)closeChat(false);
  chat=which;controls.hidden=false;body.classList.add('mobile-chess-chat');button.setAttribute('aria-expanded','true');
  assistant.setAttribute('aria-pressed',String(which==='agent'));owner.setAttribute('aria-pressed',String(which==='live'));
  if(which==='agent')universe.openAgent();else chats.openLive();
  measure();emit();
 }
 function systemSheet(value:boolean){
  if(value===expanded)return;expanded=value;summary.hidden=!value;if(value)portal.element.setAttribute('aria-describedby','mobile-system-components system-connection system-activity');else portal.element.removeAttribute('aria-describedby');body.classList.toggle('mobile-system-expanded',value);
  portal.button.setAttribute('aria-expanded',String(value));portal.element.setAttribute('role',value?'dialog':'complementary');portal.element.setAttribute('aria-modal',String(value));portal.element.setAttribute('aria-label',t('system.title'));
  if(value){previous=document.activeElement as HTMLElement;const board=document.getElementById('chess-scene');if(board)board.inert=true;controls.inert=true;button.inert=true;systemClose.focus({preventScroll:true});}
  else {const board=document.getElementById('chess-scene');if(board)board.inert=false;controls.inert=false;button.inert=false;previous?.focus({preventScroll:true});}
  emit();
 }
 function sync(){
  const next=isMobile()&&body.classList.contains('is-chess');
  if(next===active)return;
  // Close docked surfaces while their mobile layout is still active; avoid starting
  // a world-panel morph during teardown.
  if(!next){systemSheet(false);closeChat(false)}
  active=next;body.classList.toggle('mobile-chess',active);
  if(active){
   for(const element of document.querySelectorAll<HTMLElement>('main, .topbar, footer, #companion-target, #floating-live-chat, .floating-chess, .language-node, .welcome-help, .account-node, #content-card, #system-legend, .owner-pagination')){hiddenState.set(element,element.inert);element.inert=true;}
   if(!agent.hidden){chat='agent';controls.hidden=false;body.classList.add('mobile-chess-chat')}
   else if(!live.hidden){chat='live';controls.hidden=false;body.classList.add('mobile-chess-chat')}
  }else{
   for(const [element,inert]of hiddenState)element.inert=inert;hiddenState.clear();
  }
  measure();syncUnread();emit();
 }
 button.onclick=()=>chat?closeChat():select('live');assistant.onclick=()=>select('agent');owner.onclick=()=>select('live');close.onclick=()=>closeChat();systemClose.onclick=()=>systemSheet(false);
 const openSystem=(event:Event)=>{if(!active)return;event.preventDefault();event.stopImmediatePropagation();systemSheet(true)};
 portal.button.addEventListener('click',openSystem,{capture:true});
 const key=(event:KeyboardEvent)=>{
  if(!active)return;
  if(expanded){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();systemSheet(false)}else if(event.key==='Tab'){event.preventDefault();systemClose.focus()}return}
  if(chat&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeChat()}
 };
 const focus=(event:FocusEvent)=>{if(expanded&&!portal.element.contains(event.target as Node))systemClose.focus({preventScroll:true})};
 const down=(event:PointerEvent)=>{const target=event.target as HTMLElement;if(expanded&&target.closest('.mobile-system-header'))swipe={id:event.pointerId,y:event.clientY,surface:'system'};else if(chat&&target.closest('.panel-header, .mobile-chat-controls'))swipe={id:event.pointerId,y:event.clientY,surface:'chat'}};
 const up=(event:PointerEvent)=>{if(swipe?.id===event.pointerId&&event.clientY-swipe.y>55){if(swipe.surface==='system')systemSheet(false);else closeChat()}swipe=null};
 const cancel=()=>{swipe=null};
 const resize=()=>{measure();sync();if(active)emit()};
 const observer=new MutationObserver(()=>{
  sync();syncUnread();
  if(active&&chat&&((chat==='agent'&&agent.hidden)||(chat==='live'&&live.hidden)))closeChat(false);
 });
 observer.observe(body,{attributes:true,attributeFilter:['class']});observer.observe(agent,{attributes:true,attributeFilter:['hidden']});observer.observe(live,{attributes:true,attributeFilter:['hidden']});
 const target=document.getElementById('floating-live-chat');if(target)observer.observe(target,{attributes:true,attributeFilter:['data-unread']});
 document.addEventListener('focusin',focus,{capture:true});document.addEventListener('keydown',key,{capture:true});document.addEventListener('pointerdown',down);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancel);
 window.addEventListener('nexo:chess-state',sync);window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);
 window.addEventListener('nexo:live-compose',resize);
 const stopLanguage=languageStore.subscribe(relabel);measure();relabel();sync();
 return {dispose(){observer.disconnect();stopLanguage();active=false;systemSheet(false);closeChat(false);for(const [element,inert]of hiddenState)element.inert=inert;body.classList.remove('mobile-chess');button.remove();controls.remove();safe.remove();sheetHeader.remove();summary.remove();portal.button.removeEventListener('click',openSystem,{capture:true});document.removeEventListener('focusin',focus,{capture:true});document.removeEventListener('keydown',key,{capture:true});document.removeEventListener('pointerdown',down);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancel);window.removeEventListener('nexo:chess-state',sync);window.removeEventListener('resize',resize);window.removeEventListener('nexo:live-compose',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize)}};
}
