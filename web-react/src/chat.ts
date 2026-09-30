import portfolio from './data/portfolio-content.json';
import { BackendError, LIMITS } from './backend/types';
import type { PortfolioBackend, BackendEvent, ConnectionState, GeneratedNode, LiveMessage, LiveDeliveryStatus } from './backend/types';
import { EventInbox } from './backend/events';
import { validateGeneratedNode, generatedSize } from './backend/generated';
import type { TracePlayer } from './system/traces';

export interface Universe {
  navigate(id:string):Promise<unknown>;isSystem():boolean;exitSystem():Promise<unknown>;openAgent():void;
  spawnGenerated(node:GeneratedNode,anchor?:string|null,restored?:boolean):void;removeGenerated(id:string):void;
  inspectGenerated(id:string):void;setUnread(count:number):void;setChatMessage(text:string,from:'owner'|'visitor'):void;setLiveOpen(open:boolean):void;focusLiveNode():void;nodeExists(id:string):boolean;nodeLabel(id:string):string;
}
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className='') {const e=document.createElement(tag);e.textContent=text;e.className=className;return e}
const read=(key:string)=>{try{return localStorage.getItem(key)}catch{return null}};
const save=(key:string,value:string)=>{try{localStorage.setItem(key,value)}catch{/* Memory-only mode remains available. */}};
const stepLabels={understand:'Entendiendo la pregunta',search_nodes:'Buscando en mis nodos',search_base:'Buscando en la base de conocimiento',design_node:'Diseñando el nodo',create_node:'Creando el nodo',answer:'Redactando la respuesta'};
type AgentRun={answer:HTMLParagraphElement;path:string[];closed:boolean};
type LiveRow={message:LiveMessage;root:HTMLElement;status:HTMLElement;state:'sending'|LiveDeliveryStatus};
export class Chats {
  private state:ConnectionState='closed';private busy=false;private cooldown=0;private pendingSend=false;private lastQuestion='';private stopped=false;
  private inbox:EventInbox;private runs=new Map<string,AgentRun>();private activeRun:string|null=null;
  private routeQueue:string[]=[];private routing=false;private generated=new Map<string,GeneratedNode>();
  private ids=new Set(portfolio.nodes.map(n=>n.id));private liveRows=new Map<string,LiveRow>();private liveOpen=false;private unread=new Set<string>();
  private livePanel=element('section','','live-panel');private liveHistory=element('div','','chat-history live-history');
  private liveInput=element('textarea');private liveName=element('input');private nameWrap=element('label','','live-name');
  private liveHint=element('p','','chat-hint');private liveCounter=element('span','','chat-counter');private liveSend=element('button','Enviar','chat-send');
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
  register(id:string,outgoing=true){this.inbox.register(id);this.traces.register(id,outgoing)}
  receive(event:BackendEvent){this.inbox.receive(event)}
  async connection(state:ConnectionState){
    const lost=this.state==='open'&&state!=='open';this.state=state;
    if(lost){const interrupted=this.busy||this.pendingSend;this.busy=false;this.pendingSend=false;this.inbox.reset();this.routeQueue=[];this.routeNotice.hidden=true;if(interrupted)this.agentError(new Error('Conexión perdida. Reintenta tu pregunta cuando vuelva la conexión.'));for(const row of this.liveRows.values())if(row.state==='sending'||row.state==='sent')this.delivery(row.message.id,'failed')}
    this.refresh();
    if(state==='open'){
      const [history,nodes]=await Promise.allSettled([this.backend.listLiveMessages(),this.backend.listGeneratedNodes()]);
      if(history.status==='fulfilled')for(const message of history.value.messages)this.addLive(message,'sent',true);
      if(nodes.status==='fulfilled')for(const node of nodes.value)this.acceptGenerated(node,null,true);
      this.updateUnread();
    }
  }
  private buildAgent(){
    const body=document.querySelector('#companion-panel .panel-body')!;
    const context=element('details','','nexo-context');context.append(element('summary','En este lugar'));
    context.append(document.getElementById('panel-context')!,document.getElementById('panel-message')!);body.append(context,this.agentHistory);
    this.agentHistory.setAttribute('role','log');this.agentHistory.setAttribute('aria-label','Conversación con Nexo');this.agentHistory.setAttribute('aria-live','polite');
    this.process.append(element('summary','Proceso de la respuesta'));
    const steps=element('ol');for(const[id,label]of Object.entries(stepLabels)){const row=element('li',label);row.dataset.state='waiting';steps.append(row);this.steps.set(id,row)}this.process.append(steps,this.sources);body.append(this.process);
    this.agentSend.setAttribute('aria-label','Enviar mensaje a Nexo');this.agentSend.textContent='↗';this.agentSend.onclick=()=>void this.sendAgent();
    this.agentInput.maxLength=LIMITS.messageMaxChars;this.agentInput.addEventListener('input',()=>this.refresh());this.agentInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void this.sendAgent()}});
    document.querySelector('.panel-compose')!.append(this.agentCounter);
    if(this.simulated)document.querySelector('#companion-panel .panel-footer')!.append(element('span','SIMULADO','simulation-label'));
  }
  private buildLive(){
    const record=portfolio.nodes.find(n=>n.type==='live_chat')!,content=record.content as {intro:string;name_label:string;placeholder:string;note:string;max_chars:number};
    this.livePanel.id='live-panel';this.livePanel.hidden=true;this.livePanel.setAttribute('role','dialog');this.livePanel.setAttribute('aria-modal','false');this.livePanel.setAttribute('aria-labelledby','live-title');
    const surface=element('div','','panel-surface'),header=element('header','','panel-header'),title=element('h2','Chat con Kirbith');title.id='live-title';
    const close=element('button','×');close.setAttribute('aria-label','Cerrar chat en vivo');close.onclick=()=>this.closeLive();header.append(title,close);
    const intro=element('p',content.intro,'live-intro');this.liveHistory.setAttribute('role','log');this.liveHistory.setAttribute('aria-label','Historial del chat en vivo');this.liveHistory.setAttribute('aria-live','polite');
    this.liveName.type='text';this.liveName.maxLength=LIMITS.liveNameMaxChars;this.liveName.value=read('nexo.live.name')||'';this.nameWrap.append(element('span',content.name_label),this.liveName);this.nameWrap.hidden=read('nexo.live.named')==='yes';
    this.liveInput.maxLength=content.max_chars;this.liveInput.rows=2;this.liveInput.placeholder=content.placeholder;this.liveInput.setAttribute('aria-label','Mensaje para Kirbith');this.liveInput.addEventListener('input',()=>this.refresh());this.liveInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void this.sendLive()}});
    this.liveSend.type='button';this.liveSend.onclick=()=>void this.sendLive();const compose=element('div','','live-compose');compose.append(this.nameWrap,this.liveInput,this.liveCounter,this.liveSend,this.liveHint);
    surface.append(header,intro,this.liveHistory,compose,element('p',content.note,'chat-note'));if(this.simulated)surface.append(element('span','SIMULADO · LOS MENSAJES NO SE ENVÍAN','simulation-label'));this.livePanel.append(surface);document.body.append(this.livePanel);
  }
  private buildNavigation(){
    const go=element('button','Ir ahora');go.onclick=async()=>{await this.universe.exitSystem();this.routeNotice.hidden=true;void this.drainRoute()};this.routeNotice.append(this.routeLabel,go);this.routeNotice.hidden=true;document.body.append(this.routeNotice);
    this.inventory.append(element('summary','Generado para ti'),this.inventoryList);this.inventory.hidden=true;document.body.append(this.inventory);
  }
  openLive(){this.liveOpen=true;this.livePanel.hidden=false;this.universe.setLiveOpen(true);this.unread.clear();save('nexo.live.readAt',new Date().toISOString());this.updateUnread();this.liveInput.focus();this.liveHistory.scrollTop=this.liveHistory.scrollHeight}
  closeLive(){this.liveOpen=false;this.livePanel.hidden=true;this.universe.setLiveOpen(false);this.updateUnread();this.universe.focusLiveNode()}
  escape(){if(this.liveOpen){this.closeLive();return true}return false}
  private updateUnread(){this.universe.setUnread(this.unread.size);}
  private refresh(){
    const remaining=Math.max(0,Math.ceil((this.cooldown-Date.now())/1000)),open=this.state==='open';
    this.agentInput.disabled=!open;this.agentSend.disabled=!open||this.busy||this.pendingSend||!!remaining||!this.agentInput.value.trim();
    this.liveInput.disabled=!open;this.liveSend.disabled=!open||!!remaining||!this.liveInput.value.trim();
    this.agentCounter.textContent=this.agentInput.value.length+'/500';this.liveCounter.textContent=this.liveInput.value.length+'/500';
    if(!open){this.agentHint.textContent='Chat no disponible · Sin conexión';this.liveHint.textContent='Chat no disponible · Sin conexión'}
    else if(remaining){this.agentHint.textContent=`Espera ${remaining} s antes de enviar.`;this.liveHint.textContent=this.agentHint.textContent}
    else {if(this.agentHint.textContent?.startsWith('Chat no disponible')||this.agentHint.textContent?.startsWith('Espera')||this.agentHint.textContent?.includes('próximamente'))this.agentHint.textContent=this.simulated?'Simulado · Puedes probar los escenarios del laboratorio.':'Pregunta a Nexo';if(this.liveHint.textContent?.startsWith('Chat no disponible')||this.liveHint.textContent?.startsWith('Espera'))this.liveHint.textContent='';}
  }
  private agentBubble(text:string,from:'visitor'|'agent'){
    const row=element('div','','chat-message '+from);row.append(element('span',from==='visitor'?'Tú':'Nexo','message-author'));const p=element('p',text);row.append(p);this.agentHistory.append(row);return p;
  }
  async sendAgent(retry?:string){
    const text=(retry??this.agentInput.value).trim();if(!text||text.length>500||this.state!=='open'||this.busy||this.pendingSend||Date.now()<this.cooldown)return;
    this.universe.openAgent();this.pendingSend=true;this.lastQuestion=text;this.agentBubble(text,'visitor');this.agentHint.textContent='Enviando…';this.refresh();
    try{const accepted=await this.backend.sendMessage(text);this.register(accepted.run_id);this.busy=true;this.agentInput.value='';this.agentHint.textContent='Esperando la respuesta…'}catch(error){this.agentError(error)}finally{this.pendingSend=false;this.refresh()}
  }
  private agentError(error:unknown){
    const message=error instanceof Error?error.message:'No se pudo completar la consulta.';this.agentHint.textContent=message;this.busy=false;
    if(error instanceof BackendError&&error.code==='rate_limited')this.cooldown=Date.now()+(error.retryAfterSec||30)*1000;
    const question=this.lastQuestion,p=this.agentBubble(message,'agent');const retry=element('button','Reintentar','message-retry');retry.onclick=()=>void this.sendAgent(question);p.parentElement!.append(retry);
  }
  async sendLive(retry?:LiveRow){
    if(retry&&retry.state!=='failed')return;const text=(retry?.message.text??this.liveInput.value).trim();if(!text||text.length>500||this.state!=='open'||Date.now()<this.cooldown)return;
    const temp=retry?.message.id||'pending_'+crypto.randomUUID();let row=retry;
    if(!row){this.addLive({id:temp,from:'visitor',text,ts:new Date().toISOString()},'sending');row=this.liveRows.get(temp)!}else {row.state='sending';row.status.textContent='Enviando…';row.root.querySelector('.message-retry')?.remove()}
    if(!retry)this.liveInput.value='';this.refresh();
    try{const accepted=await this.backend.sendLiveMessage(text,this.liveName.value.trim()||undefined);this.register(accepted.run_id);this.liveRows.delete(temp);row.message.id=accepted.message_id;this.liveRows.set(accepted.message_id,row);save('nexo.live.name',this.liveName.value.trim());save('nexo.live.named','yes');this.nameWrap.hidden=true;this.liveHint.textContent=''}catch(error){this.liveRows.set(temp,row);this.delivery(temp,'failed');this.liveHint.textContent=error instanceof Error?error.message:'No se pudo enviar.';if(error instanceof BackendError&&error.code==='rate_limited')this.cooldown=Date.now()+(error.retryAfterSec||30)*1000}
    this.refresh();
  }
  private addLive(message:LiveMessage,state:'sending'|LiveDeliveryStatus='sent',restored=false){
    if(this.liveRows.has(message.id))return;
    const root=element('div','','chat-message '+message.from);root.append(element('span',message.from==='owner'?portfolio.meta.owner:'Tú','message-author'),element('p',message.text));const status=element('span','','message-state');root.append(status);const row={message,root,status,state};this.liveRows.set(message.id,row);this.liveHistory.append(root);
    this.universe.setChatMessage(message.text,message.from);
    if(message.from==='visitor')this.delivery(message.id,state);else if(!this.liveOpen&&(!restored||Date.parse(message.ts)>Date.parse(read('nexo.live.readAt')||'1970-01-01')))this.unread.add(message.id);
    if(this.liveOpen){save('nexo.live.readAt',new Date().toISOString());this.liveHistory.scrollTop=this.liveHistory.scrollHeight}this.updateUnread();
  }
  private delivery(id:string,state:'sending'|LiveDeliveryStatus){
    const row=this.liveRows.get(id);if(!row)return;row.state=state;row.status.textContent={sending:'Enviando…',sent:'Enviado',delivered_to_owner:'Entregado',failed:'No se pudo enviar'}[state];
    if(state==='failed'&&!row.root.querySelector('.message-retry')){const retry=element('button','Reintentar','message-retry');retry.onclick=()=>void this.sendLive(row);row.root.append(retry)}
  }
  private acceptGenerated(value:unknown,anchor:string|null,restored=false){
    if(!validateGeneratedNode(value,this.ids))return false;
    if(this.generated.has(value.id))return true;
    const count=[...this.generated.values()].reduce((sum,node)=>sum+generatedSize(node),0);
    const existingIds=new Set([...this.generated.values()].flatMap(n=>[n.id,...(n.children||[]).map(c=>c.id)]));
    if([value.id,...(value.children||[]).map(c=>c.id)].some(id=>existingIds.has(id))||count+generatedSize(value)>LIMITS.generatedNodesPerSession){this.agentHint.textContent='Llegaste al límite de 12 nodos. Descarta alguno para crear más.';return false}
    this.generated.set(value.id,value);this.universe.spawnGenerated(value,anchor&&this.ids.has(anchor)?anchor:null,restored);this.renderInventory();return true;
  }
  private renderInventory(){this.inventory.hidden=!this.simulated||!this.generated.size;this.inventoryList.replaceChildren();const count=[...this.generated.values()].reduce((sum,node)=>sum+generatedSize(node),0);this.inventory.querySelector('summary')!.textContent=`Generado para ti · ${count}/12`;for(const node of this.generated.values()){const button=element('button',node.label);button.onclick=()=>this.universe.inspectGenerated(node.id);this.inventoryList.append(button)}}
  async discard(id:string){try{await this.backend.deleteGeneratedNode(id);this.generated.delete(id);for(const [key,node]of this.generated)if(node.children?.some(child=>child.id===id))this.generated.set(key,{...node,children:node.children.filter(child=>child.id!==id)});this.universe.removeGenerated(id);this.renderInventory()}catch{this.agentHint.textContent='No se pudo descartar el nodo. Vuelve a intentarlo.'}}
  sceneChanged(){if(!this.universe.isSystem()){this.routeNotice.hidden=true;void this.drainRoute()}}
  private async drainRoute(){
    if(this.routing||this.universe.isSystem()||this.stopped)return;this.routing=true;
    try{while(this.routeQueue.length&&!this.universe.isSystem()&&!this.stopped){const id=this.routeQueue.shift()!;const start=performance.now();await this.universe.navigate(id);const wait=500-(performance.now()-start);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));}}
    finally{this.routing=false}
  }
  private onEvent(event:BackendEvent){
    if(event.type==='run.start'&&event.data.kind==='live_out')void this.backend.listLiveMessages().then(history=>{for(const message of history.messages)this.addLive(message)}).catch(()=>{});
    if(event.type==='run.start'&&event.data.kind==='chat'){
      this.busy=true;this.activeRun=event.run_id;if(!this.lastQuestion)this.lastQuestion=event.data.input||'';this.universe.openAgent();this.process.open=true;this.sources.replaceChildren();for(const row of this.steps.values())row.dataset.state='waiting';
      this.runs.set(event.run_id,{answer:this.agentBubble('','agent'),path:[],closed:false});this.agentHint.textContent='Nexo está trabajando…';
    }
    const run=this.runs.get(event.run_id);
    if(event.type==='process.step'&&run){const row=this.steps.get(event.data.step);if(row){row.dataset.state=event.data.status;row.textContent=(event.data.label||stepLabels[event.data.step])+(event.data.status==='done'?' · Listo':event.data.status==='skipped'?' · No necesario':'')}}
    if(event.type==='answer.chunk'&&run){run.answer.textContent+=event.data.text;this.agentHistory.scrollTop=this.agentHistory.scrollHeight}
    if(event.type==='rag.search'&&run)this.sources.textContent='Buscando: '+event.data.query;
    if(event.type==='rag.result'&&run){this.sources.replaceChildren(element('p',event.data.used?'Fuentes encontradas':'No encontré información suficiente'));for(const hit of event.data.hits)this.sources.append(element('span',hit.title,'source-link'))}
    if(event.type==='route.plan'&&run){run.path=[];for(const id of event.data.path){if(!this.ids.has(id))break;run.path.push(id)}this.routeLabel.textContent='Te llevo a '+run.path.map(id=>this.universe.nodeLabel(id)).join(' › ')}
    if(event.type==='route.step'&&run&&run.path[event.data.index]===event.data.node_id){this.routeQueue.push(event.data.node_id);if(this.universe.isSystem())this.routeNotice.hidden=false;else void this.drainRoute()}
    if(event.type==='node.spawn'&&run){if(!this.acceptGenerated(event.data.node,event.data.anchor))this.agentHint.textContent='El nodo no cumple el esquema o el límite disponible.'}
    if(event.type==='live.message')this.addLive(event.data.message);
    if(event.type==='live.delivery')this.delivery(event.data.message_id,event.data.status);
    if((event.type==='run.done'||event.type==='run.error')&&run){run.closed=true;if(this.activeRun===event.run_id){this.busy=false;this.activeRun=null}if(event.type==='run.error')this.agentError(new BackendError(event.data.code,event.data.message));else this.agentHint.textContent='Respuesta completada';}
    this.refresh();
  }
  dispose(){this.stopped=true;clearInterval(this.timer);this.inbox.reset()}
}
