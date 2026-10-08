import { languageStore } from './i18n';
export interface SurfaceRect {left:number;right:number;top:number;bottom:number}
const surfaces=new Map<HTMLElement,SurfaceRect>(),covered=new Set<HTMLElement>();
export const chatSurfaceBounds=()=>[...surfaces.values()];
const intersects=(a:SurfaceRect,b:SurfaceRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
export function setChatSurfaceBounds(panel:HTMLElement,rect:SurfaceRect|null){
  if(rect)surfaces.set(panel,rect);else surfaces.delete(panel);
  if(!surfaces.size){for(const element of covered)element.classList.remove('chat-underlay-hidden');covered.clear()}
}
/** The renderer supplies projected bounds, so moving labels need no DOM reads. */
export function placeChatUnderlay(element:HTMLElement|null,rect:SurfaceRect){
  if(!element)return;
  const hidden=chatSurfaceBounds().some(surface=>intersects(rect,surface));
  if(hidden===covered.has(element))return;
  element.classList.toggle('chat-underlay-hidden',hidden);
  if(hidden)covered.add(element);else covered.delete(element);
}
/** A nonmodal glass column/sheet. Its own events stay inside; the rest of the
 * universe remains interactive. Static geometry is refreshed only on changes. */
export function attachGlassPanel(panel:HTMLElement,close:()=>void):()=>void {
  if(typeof window==='undefined')return ()=>{};
  panel.classList.add('chat-glass');panel.setAttribute('aria-modal','false');
  const fixedSelectors='.brand,.system-status,.orientation,.level-mark,footer .scene-info,footer .privacy-footer,footer .instruction,footer .tools,.language-node,.welcome-help,.account-node,.owner-pagination,.generated-inventory';
  const update=()=>{
    setChatSurfaceBounds(panel,panel.getBoundingClientRect());
    for(const element of document.querySelectorAll<HTMLElement>(fixedSelectors))placeChatUnderlay(element,element.getBoundingClientRect());
  };
  const stop=(event:Event)=>event.stopPropagation();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close()}};
  panel.addEventListener('pointerdown',stop);panel.addEventListener('wheel',stop,{passive:true});panel.addEventListener('keydown',key);
  for(const name of ['resize','nexo:mobile-layout','nexo:chat-layout'])window.addEventListener(name,update);
  window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
  const stopLanguage=languageStore.subscribe(update);update();
  return ()=>{
    setChatSurfaceBounds(panel,null);panel.classList.remove('chat-glass');
    panel.removeEventListener('pointerdown',stop);panel.removeEventListener('wheel',stop);panel.removeEventListener('keydown',key);
    for(const name of ['resize','nexo:mobile-layout','nexo:chat-layout'])window.removeEventListener(name,update);
    window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);
    stopLanguage();
    for(const element of document.querySelectorAll<HTMLElement>(fixedSelectors))placeChatUnderlay(element,element.getBoundingClientRect());
  };
}
