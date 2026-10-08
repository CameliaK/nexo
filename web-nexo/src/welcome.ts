import { icon as uiIcon } from './icons';
import { languageStore, t, type UIKey } from './i18n';

export const WELCOME_KEY = 'nexo.welcome.dismissed.v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
interface WelcomeOptions {document?:Document;storage?:StorageLike}
const frame = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 57 17 57 47 32 61 7 47 7 17Z M32 3v15M7 17l12 7M57 17l-12 7M7 47l12-7M57 47l-12-7M32 61V46"/></svg>';
const icons = ['expand','chat','history'] as const;

/** A modal guide; rendering and backend initialization continue independently. */
export function createWelcome(options:WelcomeOptions={}) {
  const doc=options.document??document;
  let storage=options.storage;
  if(!storage)try{storage=localStorage}catch{/* Private browsing can disable storage entirely. */}
  let dismissed=false;try{dismissed=storage?.getItem(WELCOME_KEY)==='1'}catch{/* Keep the guide usable without persistence. */}
  let hintEligible=!dismissed,hintPending=false,firstRootNode:(()=>HTMLElement|null)|undefined;
  let returnFocus:HTMLElement|null=null,hintTarget:HTMLElement|null=null,hint:HTMLElement|null=null;
  const inertStates=new Map<HTMLElement,boolean>();
  const bindings:Array<{element:HTMLElement;key:UIKey}>=[];
  const label=(tag:string,key:UIKey,className='')=>{
    const element=doc.createElement(tag);element.className=className;bindings.push({element,key});return element;
  };
  const help=doc.createElement('button');help.type='button';help.className='welcome-help';
  help.innerHTML=frame+'<span aria-hidden="true">?</span>';help.setAttribute('aria-controls','welcome-dialog');
  const overlay=doc.createElement('section');overlay.id='welcome-dialog';overlay.className='welcome-overlay';overlay.hidden=true;
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','welcome-title');overlay.setAttribute('aria-describedby','welcome-description');
  const card=doc.createElement('div');card.className='welcome-card';
  const content=doc.createElement('div');content.className='welcome-content';content.tabIndex=0;
  content.setAttribute('role','region');content.setAttribute('aria-labelledby','welcome-title');
  const masthead=doc.createElement('div');masthead.className='welcome-masthead';
  const language=doc.createElement('span');language.className='welcome-language';
  masthead.append(label('span','welcome.label','welcome-eyebrow'),language);
  const title=label('h1','welcome.title');title.id='welcome-title';
  const subtitle=label('p','welcome.subtitle','welcome-subtitle');subtitle.id='welcome-description';
  const steps=doc.createElement('ol');steps.className='welcome-steps';
  const copy:Array<[UIKey,UIKey]>=[['welcome.explore','welcome.exploreDetail'],['welcome.ask','welcome.askDetail'],['welcome.inspect','welcome.inspectDetail']];
  copy.forEach(([heading,detail],index)=>{
    const item=doc.createElement('li'),icon=doc.createElement('span');icon.className='welcome-step-icon';
    icon.innerHTML=uiIcon(icons[index]);
    const text=doc.createElement('div');text.append(label('h2',heading),label('p',detail));item.append(icon,text);steps.append(item);
  });
  const actions=doc.createElement('div');actions.className='welcome-actions';
  const enter=label('button','welcome.enter','welcome-enter') as HTMLButtonElement;enter.type='button';
  actions.append(enter);content.append(masthead,title,subtitle,steps);card.append(content,actions);overlay.append(card);
  doc.body.append(help,overlay);

  const render=()=>{
    for(const {element,key} of bindings)element.textContent=t(key);
    help.title=t('welcome.reopen');help.setAttribute('aria-label',t('welcome.reopen'));
    language.textContent=languageStore.language.toUpperCase();language.setAttribute('aria-hidden','true');
    if(hint)hint.textContent=t('welcome.click');
  };
  const controls:HTMLElement[]=[content,enter];
  const focus=()=>enter.focus({preventScroll:true});
  const lockBackground=()=>{
    for(const child of Array.from(doc.body.children)){
      const element=child as HTMLElement;if(element===overlay)continue;
      if(!inertStates.has(element))inertStates.set(element,element.inert);
      element.inert=true;
    }
  };
  const observer=typeof MutationObserver==='undefined'?null:new MutationObserver(lockBackground);
  function open(opener?:HTMLElement){
    if(!overlay.hidden)return;
    returnFocus=opener??doc.activeElement as HTMLElement|null;
    overlay.hidden=false;help.setAttribute('aria-expanded','true');lockBackground();
    observer?.observe(doc.body,{childList:true});focus();
  }
  const interactionEvents=['pointerdown','click','keydown','wheel'] as const;
  function clearHint(){
    hintPending=false;
    hintTarget?.classList.remove('has-first-visit-hint');
    if(hintTarget&&hint){
      const remaining=(hintTarget.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==hint!.id);
      if(remaining.length)hintTarget.setAttribute('aria-describedby',remaining.join(' '));else hintTarget.removeAttribute('aria-describedby');
    }
    hint?.remove();hint=null;hintTarget=null;
    for(const event of interactionEvents)doc.removeEventListener(event,clearHint,true);
  }
  function showHint(){
    if(!hintPending||!overlay.hidden)return;
    const target=firstRootNode?.();if(!target)return;
    hintPending=false;hintTarget=target;hint=label('span','welcome.click','first-visit-hint');hint.id='welcome-node-hint';hint.textContent=t('welcome.click');
    // The announcement belongs to the node, so keyboard visitors receive it too.
    target.append(hint);target.classList.add('has-first-visit-hint');
    target.setAttribute('aria-describedby',[target.getAttribute('aria-describedby'),hint.id].filter(Boolean).join(' '));
  }
  function close(){
    if(overlay.hidden)return;
    overlay.hidden=true;help.setAttribute('aria-expanded','false');observer?.disconnect();
    for(const [element,inert] of inertStates)element.inert=inert;inertStates.clear();
    try{storage?.setItem(WELCOME_KEY,'1')}catch{/* Dismissal still applies to this visit. */}
    const previous=returnFocus;
    const destination=previous&&previous!==doc.body&&previous.isConnected&&!previous.inert?previous:doc.getElementById('level-title');
    if(destination){if(destination===doc.getElementById('level-title'))destination.tabIndex=-1;destination.focus({preventScroll:true})}
    if(hintEligible){hintEligible=false;hintPending=true;for(const event of interactionEvents)doc.addEventListener(event,clearHint,true);showHint()}
  }
  const onKey=(event:KeyboardEvent)=>{
    if(overlay.hidden)return;
    if(event.key==='Escape'||event.key==='Enter'){
      event.preventDefault();event.stopImmediatePropagation();close();return;
    }
    if(event.key==='Tab'){
      const index=controls.indexOf(doc.activeElement as HTMLElement);
      if(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===controls.length-1){
        event.preventDefault();controls[event.shiftKey?controls.length-1:0].focus({preventScroll:true});
      }
    }
    // Native scrolling and button activation remain available; universe shortcuts stay behind the modal.
    event.stopImmediatePropagation();
  };
  const onFocus=(event:FocusEvent)=>{if(!overlay.hidden&&!overlay.contains(event.target as Node))focus()};
  help.addEventListener('click',()=>open(help));enter.addEventListener('click',close);
  doc.addEventListener('keydown',onKey,true);doc.addEventListener('focusin',onFocus,true);
  render();help.setAttribute('aria-expanded','false');const stopLanguage=languageStore.subscribe(render);
  if(!dismissed)open();
  return {element:overlay,help,open,close,
    attachUniverse(getFirstRootNode:()=>HTMLElement|null){firstRootNode=getFirstRootNode;showHint()},
    dispose(){
      overlay.hidden=true;observer?.disconnect();for(const [element,inert] of inertStates)element.inert=inert;inertStates.clear();
      clearHint();stopLanguage();doc.removeEventListener('keydown',onKey,true);doc.removeEventListener('focusin',onFocus,true);overlay.remove();help.remove();
    }};
}
