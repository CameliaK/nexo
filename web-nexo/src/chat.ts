import { icon } from './icons';
import { compareLiveMessages, liveTimestamp, normalizeLiveMessage } from './live-messages';
import { lockLivePanel } from './live-modal';
import { privacyNotice, privacyLink } from './privacy/link';
import { chatErrorText } from './chat-errors';
import { t, translateText, translateUI, languageStore } from './i18n';
import { portfolio } from './i18n/content';
import { BackendError, LIMITS } from './backend/types';
import type { PortfolioBackend, BackendEvent, ConnectionState, GeneratedNode, LiveMessage, LiveDeliveryStatus } from './backend/types';
import { EventInbox } from './backend/events';
import { validateGeneratedNode, generatedSize } from './backend/generated';
import type { TracePlayer } from './system/traces';

export interface Universe {
  navigate(id:string):Promise<unknown>;isSystem():boolean;exitSystem():Promise<unknown>;openAgent():void;
  formGenerated?(runId:string,sources:string[]):void;finishForming?(runId:string):void;clearFormations?():void;
  spawnGenerated(node:GeneratedNode,anchor?:string|null,restored?:boolean,runId?:string):void;removeGenerated(id:string):void;
  inspectGenerated(id:string):void;setUnread(count:number):void;setChatMessage(text:string,from:'owner'|'visitor'):void;setLiveOpen(open:boolean):void;morphLivePanel(panel:HTMLElement,opening:boolean,complete:()=>void):void;focusLiveNode():void;nodeExists(id:string):boolean;nodeLabel(id:string):string;
}
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='') {const e=document.createElement(tag);e.textContent=text;e.className=className;return e}
const read=(key:string)=>{try{return localStorage.getItem(key)}catch{return null}};
const save=(key:string,value:string)=>{try{localStorage.setItem(key,value)}catch{/* Memory-only mode remains available. */}};
function messageTime(stamp:string){const date=new Date(stamp);return Number.isNaN(date.valueOf())?'':new Intl.DateTimeFormat(languageStore.language,{hour:'2-digit',minute:'2-digit'}).format(date)}
function metadata(stamp:string){const meta=element('div','','message-meta'),time=element('time',messageTime(stamp));time.dateTime=stamp;meta.append(time);return meta}
function chatPrivacy(key:'privacy.assistant'|'privacy.live'){const bar=element('div','','chat-privacy-bar'),summary=element('p','','privacy-summary'),text=element('span',t('chat.privacyLine'));text.dataset.i18n='chat.privacyLine';summary.append(text,document.createTextNode(' '),privacyLink());bar.append(privacyNotice(key),summary);return bar}
function emptyChat(key:'chat.emptyAgent'|'chat.emptyLive'){const empty=element('p',t(key),'chat-empty');empty.dataset.i18n=key;return empty}
const stepLabels=()=>({understand:t('step.understand'),search_nodes:t('step.search_nodes'),search_base:t('step.search_base'),design_node:t('step.design_node'),create_node:t('step.create_node'),answer:t('step.answer')});
type AgentRun={answer:HTMLParagraphElement;path:string[];closed:boolean};
type LiveRow={message:LiveMessage;root:HTMLElement;status:HTMLElement;state:'sending'|LiveDeliveryStatus;optimistic?:boolean;retryable?:boolean;error?:unknown};
export class Chats {
  private waitHint='';private state:ConnectionState='closed';private busy=false;private agentCooldown=0;private liveCooldown=0;private pendingSend=false;private lastQuestion='';private stopped=false;
  private inbox:EventInbox;private runs=new Map<string,AgentRun>();private activeRun:string|null=null;
  private routeQueue:string[]=[];private routing=false;private generated=new Map<string,GeneratedNode>();
  private ids=new Set(portfolio.nodes.map(n=>n.id));private liveRows=new Map<string,LiveRow>();private liveOpen=false;private liveTransition:'opening'|'closing'|null=null;private closeAfterOpen=false;private unread=new Set<string>();
  private livePanel=element('section','','live-panel');private liveHistory=element('div','','chat-history live-history');
  private liveInput=element('textarea');private liveName=element('input');private nameWrap=element('label','','live-name');
  private liveHint=element('p','','chat-hint');private liveCounter=element('span','','chat-counter');private liveSend=element('button',t('common.send'),'chat-send');
  private livePinned=true;private liveNew=element('button','','live-new-message');
  private releaseLiveSurface:(()=>void)|null=null;
  private resizeLiveDraft=()=>{
    if(typeof getComputedStyle!=='function')return;
    this.liveInput.style.height='auto';
    const style=getComputedStyle(this.liveInput),line=parseFloat(style.lineHeight)||24;
    const padding=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
    const maximum=line*4+padding;
    const height=Math.min(maximum,Math.max(line+padding,this.liveInput.scrollHeight));
    this.liveInput.style.height=height+'px';
    this.liveInput.style.overflowY=this.liveInput.scrollHeight>maximum?'auto':'hidden';
    if(document.body.dataset.liveComposerHeight!==String(height)){
      document.body.dataset.liveComposerHeight=String(height);window.dispatchEvent(new Event('nexo:live-compose'));
    }
    if(this.liveOpen&&this.livePinned)this.scrollLiveEnd();
  };
  private agentHistory=element('div','','chat-history agent-history');
  private process=element('details','','agent-process');private steps=new Map<string,HTMLElement>();private sources=element('div','','rag-sources');
  private agentInput=document.getElementById('nexo-input') as HTMLInputElement;
  private agentSend=document.querySelector('.panel-compose button') as HTMLButtonElement;
  private agentHint=document.getElementById('compose-hint')!;private agentCounter=element('span','','chat-counter');
  private routeNotice=element('aside','','route-notice');private routeLabel=element('span');
  private inventory=element('details','','generated-inventory');private inventoryList=element('div');
  private timer:ReturnType<typeof setInterval>;
  constructor(private backend:PortfolioBackend,private universe:Universe,private traces:TracePlayer,private simulated:boolean){
    this.inbox=new EventInbox(event=>this.onEvent(event));this.buildAgent();this.buildLive();this.buildNavigation();
    this.timer=setInterval(()=>this.refresh(),500);this.refresh();
    if(!read('nexo.visitor_id'))save('nexo.visitor_id',crypto.randomUUID());
  }
  private identityEpoch=0;private agentErrorValue:unknown=null;private liveErrorValue:unknown=null;private errorRows:{element:HTMLElement;error:unknown}[]=[];private liveRuns=new Map<string,string>();
  private livePosts=0;
  private liveReceipts=new Map<string,{runId:string;state:LiveDeliveryStatus}>();
  resetIdentity(){
    this.universe.clearFormations?.();this.identityEpoch++;this.agentCooldown=this.liveCooldown=0;this.agentErrorValue=this.liveErrorValue=null;this.errorRows=[];this.liveRuns.clear();this.liveReceipts.clear();this.livePosts=0;
    this.inbox.reset();this.runs.clear();this.liveRows.clear();this.liveHistory.replaceChildren();this.agentHistory.replaceChildren();this.livePinned=true;this.liveNew.hidden=true;
    for(const id of this.generated.keys())this.universe.removeGenerated(id);this.generated.clear();this.unread.clear();this.routeQueue=[];this.updateUnread();
    this.busy=false;this.activeRun=null;
  }
  register(id:string,outgoing=true){this.inbox.register(id);this.traces.register(id,outgoing)}
  receive(event:BackendEvent){
    // A receipt can precede both POST acceptance and the history response. Keep
    // it by message ID as well as the ordered run's preauth queue.
    if(event.type==='live.delivery'&&['sent','delivered_to_owner','failed'].includes(event.data.status)){
      if(this.liveRows.has(event.data.message_id))this.delivery(event.data.message_id,event.data.status);
      else if(this.livePosts){
        if(this.liveReceipts.size>=64)this.liveReceipts.delete(this.liveReceipts.keys().next().value!);
        const previous=this.liveReceipts.get(event.data.message_id);
        if(previous?.state!=='delivered_to_owner'||event.data.status==='failed')this.liveReceipts.set(event.data.message_id,{runId:event.run_id,state:event.data.status});
      }
    }
    this.inbox.receive(event);
  }
  async connection(state:ConnectionState){
    const lost=this.state==='open'&&state!=='open';this.state=state;
    if(lost){this.universe.clearFormations?.();const interrupted=this.busy||this.pendingSend;this.busy=false;this.pendingSend=false;this.inbox.reset();this.routeQueue=[];this.routeNotice.hidden=true;if(interrupted)this.agentError(new Error(t('chat.lost')))}
    this.refresh();
    if(state==='open'){
      const identityEpoch=this.identityEpoch;
      const [history,nodes]=await Promise.allSettled([this.backend.listLiveMessages(),this.backend.listGeneratedNodes()]);
      if(identityEpoch!==this.identityEpoch||this.stopped)return;
      if(history.status==='fulfilled')for(const message of history.value.messages)this.addLive(message,'delivered_to_owner',true);
      if(nodes.status==='fulfilled')for(const node of nodes.value)this.acceptGenerated(node,null,true);
      this.updateUnread();
    }
  }
  private buildAgent(){
    const body=document.querySelector('#companion-panel .panel-body')!;
    const context=element('details','','nexo-context');context.append(element('summary',t('chat.context')));
    context.append(document.getElementById('panel-context')!,document.getElementById('panel-message')!);body.append(context,this.agentHistory,emptyChat('chat.emptyAgent'));
    this.agentHistory.setAttribute('role','log');this.agentHistory.setAttribute('aria-label',t('chat.agentHistory'));this.agentHistory.setAttribute('aria-live','polite');
    this.process.append(element('summary',t('chat.process')));
    const steps=element('ol');for(const[id,label]of Object.entries(stepLabels())){const row=element('li',label);row.dataset.state='waiting';steps.append(row);this.steps.set(id,row)}this.process.append(steps,this.sources);body.append(this.process);
    this.agentSend.setAttribute('aria-label',t('chat.sendAgent'));this.agentSend.innerHTML=icon('send');this.agentSend.onclick=()=>void this.sendAgent();
    this.agentInput.maxLength=LIMITS.messageMaxChars;this.agentInput.addEventListener('input',()=>this.refresh());this.agentInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void this.sendAgent()}});
    const suggestions=element('div','','chat-suggestions');suggestions.setAttribute('role','group');suggestions.setAttribute('aria-label',t('chat.suggestions'));
    for(const key of ['chat.suggestFrontend','chat.suggestAI','chat.suggestData'] as const){
      const button=element('button',t(key));button.type='button';button.dataset.i18n=key;
      button.onclick=()=>{this.agentInput.value=t(key);this.refresh();this.agentInput.focus()};suggestions.append(button);
    }
    document.querySelector('.panel-compose')!.append(this.agentCounter,suggestions,chatPrivacy('privacy.assistant'));
    if(this.simulated)document.querySelector('#companion-panel .panel-footer')!.append(element('span',t('common.simulated'),'simulation-label'));
  }
  private buildLive(){
    const record=portfolio.nodes.find(n=>n.type==='live_chat')!,content=record.content as {intro:string;name_label:string;placeholder:string;note:string;max_chars:number};
    this.livePanel.id='live-panel';this.livePanel.hidden=true;this.livePanel.setAttribute('role','dialog');this.livePanel.setAttribute('aria-modal','false');this.livePanel.setAttribute('aria-labelledby','live-title');
    const surface=element('div','','panel-surface'),header=element('header','','panel-header'),title=element('h2',t('chat.title'));title.id='live-title';
    const close=element('button');close.innerHTML=icon('close');close.setAttribute('aria-label',t('chat.close'));close.onclick=()=>this.closeLive();header.append(title,close);
    const intro=element('p',content.intro,'live-intro');this.liveHistory.setAttribute('role','log');this.liveHistory.setAttribute('aria-label',t('chat.history'));this.liveHistory.setAttribute('aria-live','polite');
    this.liveHistory.addEventListener('scroll',()=>{
      this.livePinned=this.liveHistory.scrollHeight-this.liveHistory.clientHeight-this.liveHistory.scrollTop<=48;
      if(this.livePinned)this.liveNew.hidden=true;
    },{passive:true});
    this.liveNew.type='button';this.liveNew.hidden=true;this.liveNew.innerHTML=icon('down');
    const newLabel=element('span',t('chat.newMessage'));newLabel.dataset.i18n='chat.newMessage';this.liveNew.append(newLabel);
    this.liveNew.onclick=()=>this.scrollLiveEnd();
    this.liveName.type='text';this.liveName.maxLength=LIMITS.liveNameMaxChars;this.liveName.value=read('nexo.live.name')||'';this.nameWrap.append(element('span',content.name_label),this.liveName);this.nameWrap.hidden=read('nexo.live.named')==='yes';
    this.liveInput.maxLength=content.max_chars;this.liveInput.rows=1;this.liveInput.placeholder=content.placeholder;this.liveInput.setAttribute('aria-label',t('chat.ownerMessage'));this.liveInput.addEventListener('input',()=>{this.resizeLiveDraft();this.refresh()});this.liveInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void this.sendLive()}});
    this.liveSend.innerHTML=icon('send');this.liveSend.setAttribute('aria-label',t('common.send'));this.liveSend.type='button';this.liveSend.onclick=()=>void this.sendLive();const compose=element('div','','live-compose');const field=element('div','','compose-field');field.append(this.liveInput,this.liveSend);compose.append(this.nameWrap,field,this.liveCounter,this.liveHint);
    surface.append(header,intro,this.liveHistory,this.liveNew,emptyChat('chat.emptyLive'),compose,chatPrivacy('privacy.live'));if(this.simulated)surface.append(element('span',t('chat.simulated'),'simulation-label'));this.livePanel.append(surface);document.body.append(this.livePanel);
    if(typeof window!=='undefined'){window.addEventListener('resize',this.resizeLiveDraft);window.visualViewport?.addEventListener('resize',this.resizeLiveDraft)}
  }
  private buildNavigation(){
    const go=element('button',t('nav.goNow'));go.onclick=async()=>{await this.universe.exitSystem();this.routeNotice.hidden=true;void this.drainRoute()};this.routeNotice.append(this.routeLabel,go);this.routeNotice.hidden=true;document.body.append(this.routeNotice);
    this.inventory.append(element('summary',t('generated.label')),this.inventoryList);this.inventory.hidden=true;document.body.append(this.inventory);
  }
  openLive(){
    if(this.liveOpen||this.liveTransition)return;
    this.liveOpen=true;this.liveTransition='opening';this.livePanel.hidden=false;this.universe.setLiveOpen(true);
    this.releaseLiveSurface=lockLivePanel(this.livePanel,()=>this.closeLive());this.resizeLiveDraft();
    this.unread.clear();save('nexo.live.readAt',new Date().toISOString());this.updateUnread();
    this.universe.morphLivePanel(this.livePanel,true,()=>{
      this.liveTransition=null;
      if(this.closeAfterOpen){this.closeAfterOpen=false;this.closeLive();return}
      this.liveInput.focus();this.scrollLiveEnd();
    });
  }
  closeLive(){
    if(this.liveTransition==='opening'){this.closeAfterOpen=true;return}
    if(!this.liveOpen||this.liveTransition)return;
    this.liveTransition='closing';this.liveInput.blur();
    this.universe.morphLivePanel(this.livePanel,false,()=>{
      this.liveOpen=false;this.liveTransition=null;this.livePanel.hidden=true;this.releaseLiveSurface?.();this.releaseLiveSurface=null;this.universe.setLiveOpen(false);this.updateUnread();this.universe.focusLiveNode();
    });
  }
  escape(){if(this.liveOpen){this.closeLive();return true}return false}
  private updateUnread(){this.universe.setUnread(this.unread.size);}
  private scrollLiveEnd(){this.livePinned=true;this.liveNew.hidden=true;this.liveHistory.scrollTop=this.liveHistory.scrollHeight;}
  private sortLive(){
    const rows=[...this.liveRows.values()].sort((a,b)=>compareLiveMessages(a.message,b.message));
    // Move only the rows that are out of order. Existing optimistic rows retain
    // their timestamp when server data arrives, so acceptance cannot jump them.
    rows.forEach((row,index)=>{const current=this.liveHistory.children[index];if(current!==row.root)this.liveHistory.insertBefore(row.root,current||null)});
  }
  private resetHint(text:string|null){
    const value=translateText(text||'');return !value||[t('connection.retrying'),t('chat.offline'),t('guide.future'),t('chat.mockHint'),t('chat.ask')].includes(value)||!!this.waitHint&&value===translateText(this.waitHint);
  }
  refreshLanguage(){
    const record=portfolio.nodes.find(n=>n.type==='live_chat')!,content=record.content as {intro:string;name_label:string;placeholder:string;note:string};
    this.livePanel.querySelector('.live-intro')!.textContent=content.intro;
    this.nameWrap.querySelector('span')!.textContent=content.name_label;this.liveInput.placeholder=content.placeholder;
    for(const row of this.liveRows.values())this.delivery(row.message.id,row.state,row.retryable);
    for(const [id,row] of this.steps)row.textContent=stepLabels()[id as keyof ReturnType<typeof stepLabels>]+(row.dataset.state==='done'?t('step.done'):row.dataset.state==='skipped'?t('step.skipped'):'');
    const run=this.activeRun?this.runs.get(this.activeRun):undefined;if(run?.path.length)this.routeLabel.textContent=t('step.route',{path:run.path.map(id=>this.universe.nodeLabel(id)).join(' › ')});
    for(const row of this.errorRows)row.element.textContent=chatErrorText(row.error);
    if(this.agentErrorValue)this.agentHint.textContent=chatErrorText(this.agentErrorValue);
    if(this.liveErrorValue)this.liveHint.textContent=chatErrorText(this.liveErrorValue);
    for(const panel of [this.livePanel,document.getElementById('companion-panel')!])for(const time of panel.querySelectorAll<HTMLTimeElement>('.message-meta time'))time.textContent=messageTime(time.dateTime);
    translateUI(this.livePanel);translateUI(document.getElementById('companion-panel')!);translateUI(this.routeNotice);this.renderInventory();this.refresh();
  }
  private refresh(){
    const agentRemaining=Math.max(0,Math.ceil((this.agentCooldown-Date.now())/1000)),liveRemaining=Math.max(0,Math.ceil((this.liveCooldown-Date.now())/1000)),open=this.state==='open';
    this.agentInput.disabled=!open;this.agentSend.disabled=!open||this.busy||this.pendingSend||!!agentRemaining||!this.agentInput.value.trim();
    this.liveInput.disabled=!open;this.liveSend.disabled=!open||!!liveRemaining||!this.liveInput.value.trim();
    this.agentCounter.textContent=this.agentInput.value.length+'/500';this.liveCounter.textContent=this.liveInput.value.length+'/500';
    if(!open){this.agentHint.textContent=this.liveHint.textContent=t(this.state==='reconnecting'?'connection.retrying':'chat.offline');return}
    if(agentRemaining)this.agentHint.textContent=t('chat.errorRate')+' '+t('chat.wait',{seconds:agentRemaining});
    else if(this.agentErrorValue)this.agentHint.textContent=chatErrorText(this.agentErrorValue);
    else if(this.resetHint(this.agentHint.textContent))this.agentHint.textContent=this.simulated?t('chat.mockHint'):t('chat.ask');
    if(liveRemaining)this.liveHint.textContent=t('chat.errorRate')+' '+t('chat.wait',{seconds:liveRemaining});
    else if(this.liveErrorValue)this.liveHint.textContent=chatErrorText(this.liveErrorValue);
    else if(this.resetHint(this.liveHint.textContent))this.liveHint.textContent='';
  }
  private agentBubble(text:string,from:'visitor'|'agent'){
    const row=element('div','','chat-message '+from);row.append(element('span',from==='visitor'?t('common.you'):'Nexo','message-author'));const p=element('p',text);row.append(p,metadata(new Date().toISOString()));this.agentHistory.append(row);return p;
  }
  async sendAgent(retry?:string){
    const text=(retry??this.agentInput.value).trim();if(!text||text.length>500||this.state!=='open'||this.busy||this.pendingSend||Date.now()<this.agentCooldown)return;
    this.agentErrorValue=null;this.universe.openAgent();this.pendingSend=true;this.lastQuestion=text;const sent=this.agentBubble(text,'visitor'),status=element('span',t('chat.sending'),'message-state');status.dataset.i18n='chat.sending';sent.parentElement!.querySelector('.message-meta')!.append(status);this.agentHint.textContent=t('chat.sending');this.refresh();
    try{const accepted=await this.backend.sendMessage(text,languageStore.language);this.busy=true;this.agentInput.value='';this.agentHint.textContent=t('chat.waiting');this.register(accepted.run_id);status.dataset.i18n='chat.sent';status.textContent=t('chat.sent')}catch(error){status.dataset.i18n='chat.failed';status.textContent=t('chat.failed');this.agentError(error)}finally{this.pendingSend=false;this.refresh()}
  }
  private agentError(error:unknown,retryable=true){
    const message=chatErrorText(error);this.agentErrorValue=error;this.agentHint.textContent=message;this.busy=false;
    if(error instanceof BackendError&&(error.code==='rate_limited'||error.status===429))this.agentCooldown=Date.now()+(error.retryAfterSec||30)*1000;
    const question=this.lastQuestion,p=this.agentBubble(message,'agent');this.errorRows.push({element:p,error});
    if(retryable){const retry=element('button',t('common.retry'),'message-retry');retry.onclick=()=>void this.sendAgent(question);p.parentElement!.append(retry)}
  }
  async sendLive(retry?:LiveRow){
    if(retry&&(retry.message.from!=='visitor'||retry.state!=='failed'||retry.retryable===false))return;const text=(retry?.message.text??this.liveInput.value).trim();if(!text||text.length>500||this.state!=='open'||Date.now()<this.liveCooldown)return;
    this.liveErrorValue=null;
    const temp=retry?.message.id||'pending_'+crypto.randomUUID();let row=retry;
    if(!row){this.addLive({id:temp,from:'visitor',text,ts:new Date().toISOString()},'sending');row=this.liveRows.get(temp)!}else {row.error=undefined;row.state='sending';row.status.textContent=t('chat.sending');row.root.querySelector('.message-retry')?.remove()}
    if(!retry){this.liveInput.value='';this.resizeLiveDraft()}this.refresh();
    this.scrollLiveEnd();
    const epoch=this.identityEpoch;this.livePosts++;
    try{
      const accepted=await this.backend.sendLiveMessage(text,this.liveName.value.trim()||undefined);
      if(epoch!==this.identityEpoch||this.stopped)return;
      const duplicate=this.liveRows.get(accepted.message_id);if(duplicate&&duplicate!==row){duplicate.root.remove();this.liveRows.delete(accepted.message_id)}
      this.liveRows.delete(temp);row.message.id=accepted.message_id;row.root.dataset.messageId=accepted.message_id;this.liveRows.set(accepted.message_id,row);
      this.delivery(accepted.message_id,'sent');this.liveRuns.set(accepted.run_id,accepted.message_id);
      const receipt=this.liveReceipts.get(accepted.message_id);this.liveReceipts.delete(accepted.message_id);
      if(receipt?.runId===accepted.run_id)this.delivery(accepted.message_id,receipt.state);
      this.liveHint.textContent='';this.register(accepted.run_id);
      save('nexo.live.name',this.liveName.value.trim());save('nexo.live.named','yes');this.nameWrap.hidden=true;
    }catch(error){
      if(epoch!==this.identityEpoch||this.stopped)return;
      this.liveRows.set(temp,row);row.error=error;this.delivery(temp,'failed');this.liveErrorValue=error;this.liveHint.textContent=chatErrorText(error);if(error instanceof BackendError&&(error.code==='rate_limited'||error.status===429))this.liveCooldown=Date.now()+(error.retryAfterSec||30)*1000;
    }finally{if(epoch===this.identityEpoch&&!--this.livePosts)this.liveReceipts.clear()}
    this.refresh();
  }
  private addLive(message:LiveMessage,state:'sending'|LiveDeliveryStatus='sent',restored=false){
    const normalized=normalizeLiveMessage(message);if(!normalized)return;message=normalized;
    const existing=this.liveRows.get(message.id);
    if(existing){
      existing.message={...message,...(existing.optimistic?{ts:existing.message.ts,created_at:existing.message.created_at}:{})};
      existing.root.querySelector('p')!.textContent=message.text;
      if(restored)this.delivery(message.id,'delivered_to_owner');
      this.sortLive();return;
    }
    if(message.from==='owner')state='delivered_to_owner';
    const root=element('div','','chat-message '+message.from);root.dataset.messageId=message.id;root.append(element('span',message.from==='owner'?portfolio.meta.owner:t('common.you'),'message-author'),element('p',message.text));const status=element('span','','message-state');const meta=metadata(liveTimestamp(message));meta.append(status);root.append(meta);const row={message,root,status,state,optimistic:state==='sending'};this.liveRows.set(message.id,row);this.liveHistory.append(root);this.sortLive();
    if(!restored)this.universe.setChatMessage(message.text,message.from);
    this.delivery(message.id,state);
    if(message.from==='owner'&&!this.liveOpen&&(!restored||Date.parse(liveTimestamp(message))>Date.parse(read('nexo.live.readAt')||'1970-01-01')))this.unread.add(message.id);
    if(this.liveOpen){save('nexo.live.readAt',new Date().toISOString());if(this.livePinned||state==='sending')this.scrollLiveEnd();else if(!restored)this.liveNew.hidden=false}this.updateUnread();
  }
  private delivery(id:string,state:'sending'|LiveDeliveryStatus,retryable?:boolean){
    const row=this.liveRows.get(id);if(!row||!['sending','sent','delivered_to_owner','failed'].includes(state))return;
    if(row.message.from==='owner'){row.state='delivered_to_owner';row.retryable=false;row.root.dataset.delivery='delivered_to_owner';row.status.textContent=t('chat.delivered');row.root.querySelector('.message-retry')?.remove();return}
    if(row.state==='delivered_to_owner'&&state==='sent')return;
    retryable??=row.retryable??true;row.state=state;row.retryable=retryable;row.root.dataset.delivery=state;row.status.textContent={sending:t('chat.sending'),sent:t('chat.sent'),delivered_to_owner:t('chat.delivered'),failed:t('chat.failed')}[state];
    if(state!=='failed'||!retryable)row.root.querySelector('.message-retry')?.remove();
    if(state==='failed'&&retryable&&!row.root.querySelector('.message-retry')){const retry=element('button',t('common.retry'),'message-retry');retry.onclick=()=>void this.sendLive(row);row.root.append(retry)}
  }
  private acceptGenerated(value:unknown,anchor:string|null,restored=false,runId?:string){
    if(!validateGeneratedNode(value,this.ids))return false;
    if(this.generated.has(value.id))return true;
    const count=[...this.generated.values()].reduce((sum,node)=>sum+generatedSize(node),0);
    const existingIds=new Set([...this.generated.values()].flatMap(n=>[n.id,...(n.children||[]).map(c=>c.id)]));
    if([value.id,...(value.children||[]).map(c=>c.id)].some(id=>existingIds.has(id))||count+generatedSize(value)>LIMITS.generatedNodesPerSession){this.agentHint.textContent=t('generated.limit');return false}
    this.generated.set(value.id,value);this.universe.spawnGenerated(value,anchor&&this.ids.has(anchor)?anchor:null,restored,runId);this.renderInventory();return true;
  }
  private renderInventory(){this.inventory.hidden=!this.simulated||!this.generated.size;this.inventoryList.replaceChildren();const count=[...this.generated.values()].reduce((sum,node)=>sum+generatedSize(node),0);this.inventory.querySelector('summary')!.textContent=t('generated.count',{count});for(const node of this.generated.values()){const button=element('button',node.label);button.onclick=()=>this.universe.inspectGenerated(node.id);this.inventoryList.append(button)}}
  async discard(id:string){try{await this.backend.deleteGeneratedNode(id);this.generated.delete(id);for(const [key,node]of this.generated)if(node.children?.some(child=>child.id===id))this.generated.set(key,{...node,children:node.children.filter(child=>child.id!==id)});this.universe.removeGenerated(id);this.renderInventory()}catch{this.agentHint.textContent=t('generated.discardFailed')}}
  sceneChanged(){if(!this.universe.isSystem()){this.routeNotice.hidden=true;void this.drainRoute()}}
  private async drainRoute(){
    if(this.routing||this.universe.isSystem()||this.stopped)return;this.routing=true;
    try{while(this.routeQueue.length&&!this.universe.isSystem()&&!this.stopped){const id=this.routeQueue.shift()!;const start=performance.now();await this.universe.navigate(id);const wait=500-(performance.now()-start);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));}}
    finally{this.routing=false}
  }
  private onEvent(event:BackendEvent){
    if(event.type==='run.start'&&event.data.kind==='chat'){
      this.agentErrorValue=null;this.busy=true;this.activeRun=event.run_id;if(!this.lastQuestion)this.lastQuestion=event.data.input||'';this.universe.openAgent();this.process.open=true;this.sources.replaceChildren();for(const row of this.steps.values())row.dataset.state='waiting';
      this.runs.set(event.run_id,{answer:this.agentBubble('','agent'),path:[],closed:false});this.agentHint.textContent=t('chat.working');
    }
    const run=this.runs.get(event.run_id);
    if(event.type==='process.step'&&run){const row=this.steps.get(event.data.step);if(row){row.dataset.state=event.data.status;row.textContent=(event.data.label?translateText(event.data.label):stepLabels()[event.data.step])+(event.data.status==='done'?t('step.done'):event.data.status==='skipped'?t('step.skipped'):'')}}
    if(event.type==='answer.chunk'&&run){run.answer.textContent+=event.data.text;this.agentHistory.scrollTop=this.agentHistory.scrollHeight;if(document.body.classList.contains('generated-camera-focused')){const body=document.querySelector('#companion-panel .panel-body')!;body.scrollTop=body.scrollHeight}}
    if(event.type==='rag.search'&&run)this.sources.textContent=t('step.search',{query:event.data.query});
    if(event.type==='rag.result'&&run){this.sources.replaceChildren(element('p',event.data.used?t('step.sources'):t('step.noSources')));for(const hit of event.data.hits)this.sources.append(element('span',hit.title,'source-link'))}
    if(event.type==='route.plan'&&run){run.path=[];for(const id of event.data.path){if(!this.ids.has(id))break;run.path.push(id)}this.routeLabel.textContent=t('step.route',{path:run.path.map(id=>this.universe.nodeLabel(id)).join(' › ')})}
    if(event.type==='route.step'&&run&&run.path[event.data.index]===event.data.node_id){this.routeQueue.push(event.data.node_id);if(this.universe.isSystem())this.routeNotice.hidden=false;else void this.drainRoute()}
    if(event.type==='node.forming'&&run)this.universe.formGenerated?.(event.run_id,event.data.sources.filter(id=>this.ids.has(id)));
    if(event.type==='node.spawn'&&run){if(!this.acceptGenerated(event.data.node,event.data.anchor,false,event.run_id))this.agentHint.textContent=t('generated.invalid')}
    if(event.type==='live.message')this.addLive(event.data.message);
    if(event.type==='live.delivery')this.delivery(event.data.message_id,event.data.status);
    if((event.type==='run.done'||event.type==='run.error')&&run){run.closed=true;if(this.activeRun===event.run_id){this.busy=false;this.activeRun=null}if(event.type==='run.error')this.agentError(new BackendError(event.data.code,''),event.data.retryable);else this.agentHint.textContent=t('chat.done');}
    if(event.type==='run.error'&&this.liveRuns.has(event.run_id)){
      const id=this.liveRuns.get(event.run_id)!,row=this.liveRows.get(id),error=new BackendError(event.data.code,'');
      if(row)row.error=error;this.liveErrorValue=error;this.liveHint.textContent=chatErrorText(error);this.delivery(id,'failed',event.data.retryable);
      if(error.code==='rate_limited')this.liveCooldown=Date.now()+30000;
    }
    if(event.type==='run.done'||event.type==='run.error'){this.universe.finishForming?.(event.run_id);this.liveRuns.delete(event.run_id);}
    this.refresh();
  }
  dispose(){this.stopped=true;clearInterval(this.timer);this.inbox.reset();this.universe.clearFormations?.();this.releaseLiveSurface?.();if(typeof window!=='undefined'){window.removeEventListener('resize',this.resizeLiveDraft);window.visualViewport?.removeEventListener('resize',this.resizeLiveDraft)}}
}
