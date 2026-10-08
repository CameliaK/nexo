/** Isolate the normal live panel. The mobile chess dock keeps its existing tabs
 * and board interaction; it shares the same opaque surface and message list. */
export function lockLivePanel(panel:HTMLElement,close:()=>void):()=>void {
  if(typeof window==='undefined')return ()=>{};
  const docked=document.body.classList.contains('mobile-chess-chat');
  document.body.classList.add('live-chat-open');
  panel.setAttribute('aria-modal',String(!docked));
  if(docked)return ()=>{document.body.classList.remove('live-chat-open');panel.setAttribute('aria-modal','false')};
  document.body.classList.add('live-chat-modal');
  const backdrop=document.createElement('div');backdrop.className='live-backdrop';backdrop.setAttribute('aria-hidden','true');
  backdrop.addEventListener('click',close);document.body.append(backdrop);
  const states=new Map<HTMLElement,boolean>();
  const lock=()=>{
    for(const child of Array.from(document.body.children) as HTMLElement[]){
      if(child===panel||child===backdrop||child.tagName==='SCRIPT'||child.tagName==='STYLE')continue;
      if(!states.has(child))states.set(child,child.inert);child.inert=true;
    }
  };
  const observer=new MutationObserver(lock);observer.observe(document.body,{childList:true});lock();
  const controls=()=>Array.from(panel.querySelectorAll<HTMLElement>('button,a[href],input,textarea,[tabindex]')).filter(el=>!el.hasAttribute('disabled')&&!el.inert&&el.getClientRects().length>0);
  const key=(event:KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return}
    if(event.key!=='Tab')return;
    const items=controls(),index=items.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();items[(index+(event.shiftKey?-1:1)+items.length)%items.length]?.focus({preventScroll:true});
  };
  const focus=(event:FocusEvent)=>{if(!panel.contains(event.target as Node))controls()[0]?.focus({preventScroll:true})};
  document.addEventListener('keydown',key,{capture:true});document.addEventListener('focusin',focus,{capture:true});
  return ()=>{
    observer.disconnect();document.removeEventListener('keydown',key,{capture:true});document.removeEventListener('focusin',focus,{capture:true});
    for(const [element,inert] of states)element.inert=inert;
    backdrop.remove();document.body.classList.remove('live-chat-open','live-chat-modal');panel.setAttribute('aria-modal','false');
  };
}
