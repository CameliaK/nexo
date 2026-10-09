import { desktopChatRegions } from './chess-chat-layout';
import { mobileViewport } from './mobile-layout';
import { icon } from './icons';
import { t,languageStore } from './i18n';
import type { Chats } from './chat';
/** The existing live chat docks beside the game. The system keeps its normal journey. */
export function createMobileChess(chats:Chats,universe:{closeAgent():void;focusLiveNode():void},portal:{element:HTMLElement;button:HTMLButtonElement}){
 const body=document.body,agent=document.getElementById('companion-panel')!,live=document.getElementById('live-panel')!,node=document.getElementById('floating-live-chat')!;
 const unread=document.createElement('span');unread.className='chess-return-unread';unread.hidden=true;unread.setAttribute('aria-hidden','true');
 const controls=document.createElement('header');controls.id='mobile-chat-controls';controls.className='mobile-chat-controls chess-chat-controls';controls.hidden=true;
 const title=document.createElement('span'),close=document.createElement('button');close.type='button';close.innerHTML=icon('close');controls.append(title,close);
 const safe=document.createElement('div');safe.className='mobile-safe-probe';safe.setAttribute('aria-hidden','true');body.append(controls,safe);
 const hiddenState=new Map<HTMLElement,boolean>();let active=false,mobile=false,chat=false;
 const emit=()=>dispatchEvent(new Event('nexo:mobile-layout'));
 function measure(){
  const regions=desktopChatRegions(innerWidth,innerHeight);for(const [key,value]of Object.entries({left:regions.left,width:regions.width,top:regions.top,panelTop:regions.panelTop,bottom:regions.bottom,tabsHeight:regions.tabsHeight}))body.style.setProperty('--desktop-chat-'+key,value+'px');
  const visual=window.visualViewport,styles=getComputedStyle(safe),stable=safe.getBoundingClientRect().height,height=Math.min(visual?.height||innerHeight,stable||innerHeight);
  body.style.setProperty('--mobile-height',height+'px');body.style.setProperty('--mobile-top',(visual?.offsetTop||0)+'px');body.dataset.mobileKeyboard=String(height<innerHeight*.75);body.dataset.mobileHeight=String(height);body.dataset.mobileTop=String(visual?.offsetTop||0);
  const inset=body.dataset.mobileKeyboard==='true'?Math.max(8,parseFloat(styles.paddingBottom)||0):Math.max(16,parseFloat(styles.paddingBottom)||0)+(innerWidth>innerHeight?16:56);
  body.dataset.mobileInset=String(inset);body.style.setProperty('--mobile-bottom-inset',inset+'px');
  const dock=mobileViewport({width:innerWidth,height,offsetTop:visual?.offsetTop||0,chat:true,landscape:innerWidth>innerHeight,browserInset:inset,composerHeight:body.classList.contains('live-chat-open')?Number(body.dataset.liveComposerHeight)||0:0});body.style.setProperty('--mobile-dock-height',dock.dock+'px');body.style.setProperty('--mobile-dock-top',dock.dockTop+'px');
  body.dataset.safeTop=String(parseFloat(styles.paddingTop)||0);body.dataset.safeBottom=String(parseFloat(styles.paddingBottom)||0);
 }
 function relabel(){title.textContent=t('chat.title');close.setAttribute('aria-label',t('chat.close'));controls.setAttribute('aria-label',t('chat.title'))}
 function syncUnread(){
  const count=Number(node.dataset.unread||0);unread.hidden=count===0;unread.textContent=String(count);const back=document.querySelector<HTMLButtonElement>('.chess-close');if(back){if(unread.parentElement!==back)back.append(unread);back.setAttribute('aria-label',t('chess.close')+(count?' · '+t('chess.messageUnread'):''))}node.setAttribute('aria-label',t('chat.open')+(count?' · '+t('chess.messageUnread'):''));
 }
 function finishChat(restore=true){chat=false;controls.hidden=true;body.classList.remove('desktop-chess-chat','chess-chat-open');node.setAttribute('aria-expanded','false');measure();emit();if(restore&&!mobile)universe.focusLiveNode()}
 function closeChat(restore=true,immediate=false){if(!chat)return;chats.closeLive(immediate);if(live.hidden)finishChat(restore)}
 function openChat(){if(!active||mobile)return;chat=true;controls.hidden=false;body.classList.add('chess-chat-open','desktop-chess-chat');node.setAttribute('aria-controls','live-panel');node.setAttribute('aria-expanded','true');chats.openLive(node);measure();emit()}
 function sync(){
  const next=body.classList.contains('is-chess'),nextMobile=next&&innerWidth<=900;
  if(next===active&&nextMobile===mobile)return;
  if(!next||nextMobile)closeChat(false,true);
  for(const [element,inert]of hiddenState)element.inert=inert;hiddenState.clear();active=next;mobile=nextMobile;
  body.classList.toggle('mobile-chess',mobile);body.classList.toggle('desktop-chess',active&&!mobile);
  if(active)universe.closeAgent();
  if(mobile){chats.closeLive(true);for(const element of document.querySelectorAll<HTMLElement>('main,.topbar,footer,#companion-target,#floating-live-chat,.floating-chess,.language-node,.welcome-help,.account-node,#content-card,#system-legend,.owner-pagination')){hiddenState.set(element,element.inert);element.inert=true}}
  if(active&&!mobile&&!live.hidden)openChat();measure();syncUnread();emit();
 }
 const activate=(event:Event)=>{if(!active)return;event.preventDefault();event.stopImmediatePropagation();openChat()};node.addEventListener('click',activate,{capture:true});close.onclick=()=>closeChat();
 const key=(event:KeyboardEvent)=>{if(active&&chat&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeChat()}};
 const morph=(event:Event)=>{const detail=(event as CustomEvent<{panel:HTMLElement;opening:boolean}>).detail;if(chat&&detail?.panel===live&&!detail.opening&&live.hidden)finishChat()};
 const resize=()=>{measure();sync();if(active)emit()};
 const observer=new MutationObserver(()=>{sync();syncUnread();if(active&&!agent.hidden)universe.closeAgent();if(mobile&&!live.hidden)chats.closeLive(true);if(chat&&live.hidden)finishChat(false)});
 observer.observe(body,{attributes:true,attributeFilter:['class']});observer.observe(agent,{attributes:true,attributeFilter:['hidden']});observer.observe(live,{attributes:true,attributeFilter:['hidden']});observer.observe(node,{attributes:true,attributeFilter:['data-unread']});
 document.addEventListener('keydown',key,{capture:true});window.addEventListener('nexo:chat-morph',morph);window.addEventListener('nexo:chess-state',sync);window.addEventListener('resize',resize);window.addEventListener('nexo:live-compose',resize);window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);
 const stopLanguage=languageStore.subscribe(()=>{relabel();syncUnread()});measure();relabel();sync();
 return {dispose(){observer.disconnect();stopLanguage();closeChat(false,true);for(const [element,inert]of hiddenState)element.inert=inert;body.classList.remove('mobile-chess','desktop-chess');node.removeEventListener('click',activate,{capture:true});unread.remove();controls.remove();safe.remove();document.removeEventListener('keydown',key,{capture:true});window.removeEventListener('nexo:chat-morph',morph);window.removeEventListener('nexo:chess-state',sync);window.removeEventListener('resize',resize);window.removeEventListener('nexo:live-compose',resize);window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize)}};
}
