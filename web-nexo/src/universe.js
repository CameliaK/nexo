import { chessChatProgress, desktopChatRegions } from './chess-chat-layout';
import { icon } from './icons';
import { chatSurfaceBounds, placeChatUnderlay } from './chat-surface';
import { mobileSystemBox } from './mobile-layout';
import { createCameraGestures, clampZoom } from './camera-gestures';
import { formationPhase } from './node-forming';
import { motion as MOTION, easeOut, resumeStart } from './motion';
import { t, translateText, translateUI } from './i18n';
import { portfolio } from './i18n/content';
import { LivePreview, placeSatellite, satelliteFootprint } from './live-satellite.js';
export default function createUniverse(system) {
const $ = id => document.getElementById(id);
const canvas = $('space'), ctx = canvas.getContext('2d');
const colors = {mint:[174,241,210],blue:[141,163,245],cyan:[116,210,234],amber:[232,185,112],purple:[189,148,227],rose:[224,151,169],gray:[104,120,137]};

const records=new Map(portfolio.nodes.map(n=>[n.id,n]));
const scenes=new Map();
const statuses=new Proxy({actual:'common.actual',practicado:'common.practiced',favorito:'common.favorite',en_construccion:'common.building'},{get:(keys,key)=>keys[key]?t(keys[key]):undefined});
const branchColors={personal:'mint',hobbies:'rose',aprendizaje:'amber','proyectos-personales':'purple',experiencia:'blue'};
const kindColors={client:'cyan',api:'blue',service:'mint',data:'amber',ml:'purple',infra:'rose',tool:'cyan',concern:'gray'};
const orderedChildren=id=>portfolio.nodes.filter(n=>n.parent===id&&n.type!=='live_chat').sort((a,b)=>a.order-b.order);
function nodeWeight(record){
  const children=orderedChildren(record.id),descendants=children.reduce((total,child)=>total+1+nodeWeight(child).descendants,0);
  const architecture=record.architecture;
  const score=children.length*2+descendants*.55+(architecture?.components.length||0)*.8+(architecture?.connections.length||0)*.25+(record.links?.length||0)*.5;
  return{descendants,tier:score>=8?3:score>=3?2:1};
}
function positions(count){
  if(count===1)return[[0,.08]];
  if(count===2)return[[-.37,.05],[.37,.05]];
  if(count===3)return[[-.43,.16],[0,-.31],[.44,.19]];
  return Array.from({length:count},(_,i)=>{const angle=-Math.PI/2+i*Math.PI*2/count;return[Math.cos(angle)*.58,Math.sin(angle)*.4]});
}
function sceneNode(record,index,total,reference=false){
  const [x,y]=positions(total)[index],tint=branchColors[record.id.split('.')[0]]||'mint';
  const description=record.status==='en_construccion'?statuses[record.status]:record.summary||record.content?.body||'';
  const tier=reference?1:nodeWeight(record).tier;
  return{ id:record.id,name:record.label,meta:reference?t('nav.related'):record.content?.display||statuses[record.status]||record.tagline||'',
    color:colors[record.status==='en_construccion'?'gray':tint],x,y,r:reference?23:(record.status==='actual'?52:35)+tier*5,
    type:tier===3?'orb':tier===2?'ico':'oct',weightTier:tier,children:reference?null:(record.type==='architecture'||orderedChildren(record.id).length?buildScene(record.id):null),description,record,reference,
    active:record.status==='actual',pending:record.status==='en_construccion'};
}
function buildScene(id){
  if(scenes.has(id))return scenes.get(id);
  const record=records.get(id),isRoot=id===portfolio.root.id;
  const scene={id,record,title:isRoot?portfolio.root.title:record.label,description:isRoot?portfolio.root.subtitle:record.summary||'',tint:isRoot?'mint':branchColors[id.split('.')[0]],intro:isRoot?t('guide.welcome'):record.summary||'',nodes:[],edges:[]};
  scenes.set(id,scene);
  if(record?.architecture){
    scene.architecture=true;scene.confidence=record.architecture.topology_confidence;
    const components=record.architecture.components,main=components.filter(c=>c.kind!=='concern'),satellites=components.filter(c=>c.kind==='concern');
    // A single scene contains every architectural component. Concerns orbit
    // below the main graph without suggesting a data-flow connection.
    scene.nodes=components.map(component=>{
      const concern=component.kind==='concern',index=(concern?satellites:main).indexOf(component);
      const [x,y]=concern?[(index-(satellites.length-1)/2)*.65,.59]:positions(main.length)[index];
      const contribution=component.contribution||record.architecture.contribution;
      const degree=record.architecture.connections.filter(edge=>edge.from===component.id||edge.to===component.id).length;
      const tier=concern?1:degree>=3?3:degree>=2?2:1;
      return{id:component.id,name:component.label,meta:component.tech,color:colors[kindColors[component.kind]||'mint'],x,y,r:concern?24:38+tier*4,type:tier===3?'orb':tier===2?'ico':'oct',weightTier:tier,children:null,component,record,
        description:t('content.what',{tech:component.tech,what:component.what,contribution:contribution?t('content.contribution',{text:contribution}):''})};
    });
    scene.edges=record.architecture.connections.map(connection=>{
      const from=components.findIndex(c=>c.id===connection.from),to=components.findIndex(c=>c.id===connection.to);
      return[from,to,{label:connection.label,text:components[from].label+' →︎ '+components[to].label+': '+connection.label+'.',directed:true}];
    }).filter(([a,b])=>components[a].kind!=='concern'&&components[b].kind!=='concern');
    return scene;
  }
  const children=orderedChildren(id);
  const related=[...new Set(children.flatMap(n=>n.links||[]))].filter(id=>!children.some(n=>n.id===id));
  const visible=[...children,...related.map(id=>records.get(id))];
  scene.nodes=visible.map((n,i)=>{const reference=i>=children.length,node=sceneNode(n,reference?0:i,children.length,reference);if(reference){node.r=23;node.x=(i-children.length)*.55;node.y=.58}return node});
  if(children.length===2)scene.edges.push([0,1]);
  if(children.length>2)children.forEach((_,i)=>scene.edges.push([i,(i+1)%children.length]));
  children.forEach((n,i)=>(n.links||[]).forEach(target=>scene.edges.push([i,visible.findIndex(n=>n.id===target),{related:true}])));
  if(isRoot){const points=[[-.36,-.28],[.35,-.28],[.57,.2],[0,.35],[-.57,.2]];scene.nodes.forEach((n,i)=>{[n.x,n.y]=points[i];n.r=38+n.weightTier*9})}
  return scene;
}
const root=buildScene(portfolio.root.id);

// The scene uses one shared clock; a transition freezes its two endpoint meshes.
let frameId=null,lastPaint=0,hiddenAt=0;
let width=innerWidth, height=innerHeight, dpr=1, clock=0, last=0,occupiedNodeBounds=[],occupiedMediaBounds=[],systemHeaderRects=[];
let zoom=1, targetZoom=1, hoverId=null, focusedId=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),coarse=matchMedia('(pointer:coarse)');
let paused=reduced.matches, level=root, stack=[], nodes=[], travel=null, returnTarget=null, navigationQueue=[];
let pointer={x:0,y:0}, parallax={x:0,y:0}, pan={x:0,y:0}, drag=null;
const companion={x:innerWidth*.82,y:innerHeight*.67,tx:innerWidth*.82,ty:innerHeight*.67,vx:0,vy:0,present:false,touch:false};
const rgba=(c,a=1)=>`rgba(${c[0]},${c[1]},${c[2]},${Math.max(0,Math.min(1,a))})`;
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
const pointMix=(a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
const stars=Array.from({length:170},(_,i)=>({x:Math.sin(i*127.1+8)*43758.5453%1,y:Math.sin(i*311.7+4)*19642.349%1,r:.45+(i%5)*.18,z:.2+(i%7)*.12}));
const phi=(1+Math.sqrt(5))/2;
const raw=[[-1,phi,0],[1,phi,0],[-1,-phi,0],[1,-phi,0],[0,-1,phi],[0,1,phi],[0,-1,-phi],[0,1,-phi],[phi,0,-1],[phi,0,1],[-phi,0,-1],[-phi,0,1]];
const icoV=raw.map(v=>v.map(x=>x/Math.sqrt(1+phi*phi)));
const icoF=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
const octV=[[0,-1.2,0],[1,0,0],[0,0,1],[-1,0,0],[0,0,-1],[0,1.2,0]];
const octF=[[0,1,2],[0,2,3],[0,3,4],[0,4,1],[5,2,1],[5,3,2],[5,4,3],[5,1,4]];
const orbMesh=(()=>{
  const vertices=icoV.map(v=>[...v]),faces=[],cache=new Map();
  const midpoint=(a,b)=>{const key=[a,b].sort((x,y)=>x-y).join(':');if(cache.has(key))return cache.get(key);const v=pointMix(vertices[a],vertices[b],.5),length=Math.hypot(...v);vertices.push(v.map(x=>x/length));cache.set(key,vertices.length-1);return vertices.length-1};
  for(const[a,b,c]of icoF){const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);faces.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca])}
  return{vertices,faces};
})();
const systemMesh={vertices:[[0,-1,0],[0,1,0],...Array.from({length:8},(_,i)=>[Math.cos(i*Math.PI/4),0,Math.sin(i*Math.PI/4)])],faces:Array.from({length:8},(_,i)=>[[0,i+2,(i+1)%8+2],[1,(i+1)%8+2,i+2]]).flat()};
function geometry(type){return type==='system'?systemMesh:type==='orb'?orbMesh:type==='oct'?{vertices:octV,faces:octF}:{vertices:icoV,faces:icoF}}
const systemScene={id:'system',title:t('system.title'),description:t('system.description'),intro:t('system.intro'),tint:'mint',architecture:true,system:true,nodes:[],edges:[]};
systemScene.nodes=system.architecture.components.map(component=>{
  const peers=system.architecture.components.filter(c=>c.layer===component.layer),index=peers.indexOf(component);
  const degree=system.architecture.edges.filter(edge=>edge.from===component.id||edge.to===component.id).length;
  const tier=degree>=4?3:degree>=2?2:1;
  return{id:component.id,name:component.label,meta:component.tech,description:component.what+(component.contribution?t('content.contribution',{text:component.contribution}):''),component,color:colors[kindColors[component.kind]||'mint'],x:-.66+component.layer*.285,y:(index-(peers.length-1)/2)*.29,r:(component.layer===4?27:33)+tier*3,type:tier===3?'orb':tier===2?'system':'oct',weightTier:tier,children:null,system:true};
});
systemScene.edges=system.architecture.edges.map(edge=>[systemScene.nodes.findIndex(n=>n.id===edge.from),systemScene.nodes.findIndex(n=>n.id===edge.to),{label:edge.label,text:edge.label,directed:true,event:edge.kind==='event'}]);
let systemReturn=null,systemTravel=null,disposed=false,chessJourney=null;
const systemPopulation=instantiate(systemScene);let apertureHover=false;
function distantSystemBounds(view=camera()){
  const target=systemFrame(view),u=system.chess?.progress?.()||0;
  if(!chessJourney||!system.chess?.isOpen()||document.body.classList.contains('mobile-system-expanded'))return target;
  const from=chessJourney.systemFrom;
  // FLIP: preserve the current box, interpolate its position and scale to the
  // game's box, using the same geometry for canvas and DOM hit area.
  return Object.fromEntries(['left','top','width','height'].map(key=>[key,lerp(from[key],target[key],easeOut(u))]));
}
function systemFrame(view=camera()){
  if(document.body.classList.contains('mobile-chess')){
    const top=(Number(document.body.dataset.safeTop)||0)+(Number(document.body.dataset.mobileTop)||0),h=Number(document.body.dataset.mobileHeight)||height;
    if(document.body.classList.contains('mobile-system-expanded'))return{left:12,top:top+h*.25+56,width:width-24,height:h*.60-70};
    return mobileSystemBox({width,height:h,safeTop:Number(document.body.dataset.safeTop)||0,offsetTop:Number(document.body.dataset.mobileTop)||0,chat:document.body.classList.contains('mobile-chess-chat'),landscape:width>height});
  }
  const mobile=compactUniverse(),scale=view.zoom;
  const w=(mobile?138:218)*scale,h=(mobile?88:120)*scale;
  const baseWidth=mobile?138:218,baseHeight=mobile?88:120;
  const anchorX=width*(mobile?(width>height?.57:.79):.87);
  let anchorY=height*(mobile?.25:.32);
  for(const rect of systemHeaderRects)if(anchorX+baseWidth/2>rect.left&&anchorX-baseWidth/2<rect.right)anchorY=Math.max(anchorY,rect.bottom+18+baseHeight/2);
  const x=width/2+(anchorX-width/2)*scale+view.pan.x+view.parallax.x*9;
  const y=height*.53+(anchorY-height*.53)*scale+view.pan.y+view.parallax.y*9;
  const ordinary={left:x-w/2,top:y-h/2,width:w,height:h};
  const progress=system.chess?.isOpen()?1:0,target=desktopChatRegions(width,height).system;
  return Object.fromEntries(['left','top','width','height'].map(key=>[key,lerp(ordinary[key],target[key],progress)]));
}
function apertureNodes(bounds,population=systemPopulation){
  return population.map(n=>{const point=system.positions.find(p=>p.id===n.id);return{...n,sx:bounds.left+bounds.width*(.1+.8*point.x/258),sy:bounds.top+bounds.height*(.09+.8*point.y/136),sr:n.r*bounds.width/1020,hover:apertureHover?.18:0,miniature:true}});
}
const systemCaption=system.portal.element?.querySelector('.system-caption');
function renderDistantSystem(expanded=false){
  if(document.body.classList.contains('mobile-system-expanded')&&!expanded)return;
  const button=system.portal.button;button.style.opacity=level.system||systemTravel?'0':'1';button.disabled=!!level.system||!!systemTravel;button.style.pointerEvents=button.disabled?'none':'';
  if(level.system||systemTravel)return;
  const bounds=distantSystemBounds(),items=apertureNodes(bounds);
  placeChatUnderlay(systemCaption,{left:bounds.left,right:bounds.left+bounds.width,top:bounds.top-32,bottom:bounds.top+bounds.height+40});
  if(expanded){ctx.fillStyle='#0b161eef';ctx.beginPath();ctx.roundRect(0,bounds.top-56,width,height-bounds.top+56,[24,24,0,0]);ctx.fill();}
  if(system.portal.element){
    const style=system.portal.element.style,flip=chessJourney&&system.chess?.isOpen()&&!expanded;
    const destination=flip?systemFrame():bounds;
    style.left=destination.left+'px';style.top=destination.top+'px';style.width=destination.width+'px';style.height=destination.height+'px';style.transformOrigin='0 0';
    style.transform=flip?`translate(${bounds.left-destination.left}px,${bounds.top-destination.top}px) scale(${bounds.width/destination.width},${bounds.height/destination.height})`:'';
  }
  const clipMini=document.body.classList.contains('mobile-chess')&&!expanded;if(clipMini){ctx.save();ctx.beginPath();ctx.rect(bounds.left,bounds.top,bounds.width,bounds.height);ctx.clip()}
  drawEdges(systemScene,items,apertureHover?.9:.65);for(const n of items){drawNode(n,apertureHover?1:.75);if(expanded){ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillStyle='#c9ded8';ctx.fillText(n.name,n.sx,n.sy+n.sr+14)}}
  if(clipMini)ctx.restore();
}
const generatedRegistry=new Map();let navigationComplete=null,liveUnread=0;
const chatTarget=document.createElement('button');chatTarget.id='floating-live-chat';chatTarget.type='button';chatTarget.className='floating-live-chat';
chatTarget.setAttribute('aria-controls','live-panel');chatTarget.setAttribute('aria-expanded','false');
const chatCaption=document.createElement('span');chatCaption.className='floating-live-caption';chatCaption.textContent=t('chat.caption');
const chatPreview=document.createElement('span');chatPreview.className='floating-live-preview';chatPreview.hidden=true;
const chatAuthor=document.createElement('span');chatAuthor.className='floating-live-author';
const chatMessage=document.createElement('span');chatMessage.className='floating-live-message';chatPreview.append(chatAuthor,chatMessage);const chatGlyph=document.createElement('span');chatGlyph.className='floating-live-glyph';chatGlyph.innerHTML=icon('chat');chatTarget.append(chatGlyph,chatCaption,chatPreview);
chatTarget.addEventListener('click',()=>{if(system.chess?.isOpen()&&width<=900)return;system.onLiveOpen?.()});document.body.append(chatTarget);
const previewTimer=new LivePreview();let chatHovered=false,chatFocused=false,chatPosition=null,chatFrameTime=0,chatViewport='';
chatTarget.addEventListener('pointerenter',()=>{chatHovered=true;companion.locked=true;previewTimer.hover(true)});
chatTarget.addEventListener('pointerleave',()=>{chatHovered=false;previewTimer.hover(false);if(!chatFocused&&!panelOpen&&!companion.keyboard)companion.locked=false});
chatTarget.addEventListener('focus',()=>{chatFocused=true;companion.locked=true});
chatTarget.addEventListener('blur',()=>{chatFocused=false;if(!chatHovered&&!panelOpen&&!companion.keyboard)companion.locked=false});
function setChatMessage(text,from){
  chatAuthor.textContent=from==='owner'?'Kirbith':t('common.you');chatMessage.textContent=text;
  if(text&&(!livePanelOpen||from==='visitor'))previewTimer.show();else previewTimer.clear();
  chatPreview.hidden=!previewTimer.visible;
}
let livePanelOpen=false,chatMorph=null,morphCanvas=null,morphCtx=null;
// A disconnected satellite: it doesn't change portfolio records or graph edges.
const chessTarget=system.chess?document.createElement('button'):null;
let chessHover=false;
if(chessTarget){
  chessTarget.type='button';chessTarget.className='floating-chess';chessTarget.id='floating-chess';chessTarget.hidden=true;
  chessTarget.setAttribute('aria-label',t('chess.nodeAria'));
  chessTarget.setAttribute('aria-controls','chess-scene');chessTarget.setAttribute('aria-expanded','false');
  const caption=document.createElement('span');caption.className='floating-chess-caption';caption.textContent=t('chess.node');
  const subtitle=document.createElement('small');subtitle.textContent=t('chess.nodeCaption');caption.append(subtitle);chessTarget.append(caption);document.body.append(chessTarget);
  chessTarget.addEventListener('pointerenter',()=>chessHover=true);chessTarget.addEventListener('pointerleave',()=>chessHover=false);
  chessTarget.addEventListener('focus',()=>chessHover=true);chessTarget.addEventListener('blur',()=>chessHover=false);
  chessTarget.addEventListener('click',openChess);
  chessTarget.addEventListener('pointerenter',()=>system.chess.preload?.());chessTarget.addEventListener('focus',()=>system.chess.preload?.());
  system.chess.setOnClosed(()=>{chessJourney=null;document.body.style.removeProperty('--chess-world-reveal');chessTarget.setAttribute('aria-expanded','false');chessTarget.hidden=level!==root||!system.chessNodeVisible;last=performance.now()});
}
function openChess(){
  if(!chessTarget||travel||systemTravel||chatMorph)return;
  if(system.onChessAccess&&!system.onChessAccess())return;
  const source=()=>{const node=chessOrbit();return{x:node.sx,y:node.sy,r:node.sr,faces:meshFaces(node)}};
  drag=null;chessJourney={source:source(),systemFrom:distantSystemBounds(),snapshot:null,soft:null,chatFrom:chatOrbit()};system.chess.open(chessJourney.source,source);chessTarget.setAttribute('aria-expanded','true');chessTarget.hidden=true;
}
let worldLayoutKey='',worldLayout=new Map();
function compactUniverse(){return width<650||coarse.matches&&width>height&&height<650}
function rootWorldLayout(population){
  // Allocate once at a neutral camera. Pan and zoom only project world positions.
  const extras=population.filter(n=>n.generated||n.privatePanel);
  const key=JSON.stringify([width,height,!!system.chessNodeVisible,chessFootprint(),population.map(n=>[n.id,n.name,n.meta])]);
  if(key===worldLayoutKey)return worldLayout;
  worldLayoutKey=key;worldLayout=new Map();
  const base={zoom:1,pan:{x:0,y:0},parallax:{x:0,y:0}},obstacles=[...fixedObstacles()];
  const sb=distantSystemBounds(base);
  obstacles.push({left:sb.left-20,right:sb.left+sb.width+20,top:sb.top-20,bottom:sb.top+sb.height+40});
  for(const n of population.filter(n=>!n.generated&&!n.privatePanel)){
    const p=layout(n,root,base),reach=p.r*1.85+16,half=compactUniverse()?82:115;
    obstacles.push({left:p.x-reach,right:p.x+reach,top:p.y-reach,bottom:p.y+reach},
      {left:p.x-half,right:p.x+half,top:p.y+p.r,bottom:p.y+p.r+(compactUniverse()?60:95)});
  }
  const items=[...(chessTarget&&system.chessNodeVisible?[{id:'floating-chess',footprint:chessFootprint()}]:[]),...extras.filter(n=>n.privatePanel),...extras.filter(n=>n.generated)];
  for(const [index,n] of items.entries()){
    const radius=n.footprint?0:layout(n,root,base).r;
    const half=n.footprint?0:Math.max(radius*1.85+14,width<650?(n.privatePanel?75:48):(n.privatePanel?80:115));
    const footprint=n.footprint||{left:-half,right:half,top:-radius*1.85-14,bottom:radius+(n.privatePanel?65:width<650?72:95)};
    const preferred=n.id==='floating-chess'&&compactUniverse()?{x:width>height?67:width*.80,y:width>height?height*.48:height-(ownerMode&&height>=720?235:195)}:{x:width*(index%2?.72:.28),y:height*.76+Math.floor(index/2)*150};
    // Crowded worlds extend below the viewport and remain reachable by panning.
    // A forced screen clamp would cause overlap and make these nodes feel fixed.
    const searchWidth=Math.max(width,footprint.right-footprint.left+32);
    const lowerBand={left:0,right:searchWidth,top:0,bottom:height*(compactUniverse()&&width>height?.35:.6)};
    let point=placeSatellite({width:searchWidth,height,obstacles:[...obstacles,lowerBand],preferred,footprint});
    for(let rows=1;!point;rows++)point=placeSatellite({width:searchWidth,height:height+rows*220,obstacles:[...obstacles,lowerBand],preferred,footprint});
    worldLayout.set(n.id,point);
    const box=satelliteBox(point,footprint);obstacles.push({left:box.left-16,right:box.right+16,top:box.top-16,bottom:box.bottom+16});
  }
  return worldLayout;
}
function projectWorld(point,view,seed=0){
  const drift=paused||reduced.matches?0:1;
  return{x:width/2+(point.x-width/2+Math.sin(clock*.23+seed)*5*drift)*view.zoom+view.pan.x+view.parallax.x*3,
    y:height*.53+(point.y-height*.53+Math.cos(clock*.19+seed)*5*drift)*view.zoom+view.pan.y+view.parallax.y*3};
}
function chessOrbit(population=nodes,view=camera()){
  const position=projectWorld(rootWorldLayout(population).get('floating-chess')||{x:width*.28,y:height*.76},view,7.2);
  return{type:'orb',seed:7.2,color:colors.mint,hover:chessHover?.5:0,weightTier:2,sx:position.x,sy:position.y,sr:(compactUniverse()?17:27)*view.zoom*(1+(chessHover?.1:0))};
}
function chessFootprint(){return compactUniverse()?{left:-55,right:55,top:-30,bottom:75}:{left:-80,right:80,top:-60,bottom:95}}
const satelliteBox=(position,shape)=>({left:position.x+shape.left,right:position.x+shape.right,top:position.y+shape.top,bottom:position.y+shape.bottom});
let fixedCache=null,fixedCacheAt=-Infinity;
function fixedObstacles(){
  const now=performance.now();
  if(fixedCache&&now-fixedCacheAt<100)return fixedCache;
  const obstacles=[];
  const add=rect=>{if(rect?.width>0&&rect?.height>0)obstacles.push({left:rect.left,right:rect.left+rect.width,top:rect.top,bottom:rect.top+rect.height})};
  for(const element of document.querySelectorAll?.(`.topbar, .orientation, .level-mark, ${compactUniverse()?'footer .instruction, footer .tools, footer .privacy-footer, footer .scene-info':'footer'}, .language-node, .welcome-help, .account-node, .scene-info, .development-panel, .generated-inventory, .route-notice, .chess-heading, .chess-close, .chess-aside, .chess-player, .chess-help, .chess-popover-backdrop, .owner-pagination`)||[]){
    if(element.hidden||element.closest?.('[hidden]')||getComputedStyle(element).visibility==='hidden'||getComputedStyle(element).display==='none')continue;
    add(element.getBoundingClientRect());
  }
  for(const id of ['companion-panel','content-card']){const element=$(id);if(element&&!element.hidden)add(element.getBoundingClientRect())}
  fixedCache=obstacles;fixedCacheAt=now;return obstacles;
}
function drawChessSatellite(){
  if(!chessTarget)return;
  const hidden=level!==root||!!travel||!!systemTravel||system.chess.isOpen()||!system.chessNodeVisible;chessTarget.hidden=hidden;
  if(hidden)return;
  const state=system.chessAccess?.();
  if(state){
    chessTarget.dataset.compactCaption=String(!state.locked&&state.label!==t('auth.soon'));chessTarget.classList.toggle('is-locked',state.locked);chessTarget.classList.toggle('has-chess-unread',state.unread);
    chessTarget.querySelector('small').textContent=state.label;
    chessTarget.setAttribute('aria-label',t('chess.node')+' · '+state.label);
  }
  const node=chessOrbit();drawNode(node,.92);chessTarget.style.transform=`translate(${node.sx}px,${node.sy}px) translate(-50%,-50%)`;
  chessTarget.style.width=chessTarget.style.height=node.sr*2+16*zoom+'px';chessTarget.style.setProperty('--node-label-zoom',zoom);chessTarget.style.setProperty('--caption-gap',10*zoom+'px');
  const footprint=chessFootprint();placeChatUnderlay(chessTarget,{left:node.sx+footprint.left*zoom,right:node.sx+footprint.right*zoom,top:node.sy+footprint.top*zoom,bottom:node.sy+footprint.bottom*zoom});
}
function chatObstacles(includeCompanion=false){
  const obstacles=[...occupiedNodeBounds,...occupiedMediaBounds,...fixedObstacles(),{left:width*.41,right:width*.59,top:height*.43,bottom:height*.63}];
  const add=rect=>{if(rect?.width>0&&rect?.height>0)obstacles.push({left:rect.left,right:rect.left+rect.width,top:rect.top,bottom:rect.top+rect.height})};
  for(const n of nodes){
    if(!Number.isFinite(n.sx)||!Number.isFinite(n.sy))continue;
    const reach=Math.max(24,n.sr*1.65);
    obstacles.push({left:n.sx-reach,right:n.sx+reach,top:n.sy-reach,bottom:n.sy+reach});
    const z=level===root?zoom:1;
    // Leaf media uses measured label sizes rather than a 55 px blanket reserve.
    // Cache sizes, not positions: panning needs no DOM reads or stale rectangles.
    const label=includeCompanion?n.el?.querySelector('.node-label'):null,key=width+'|'+n.name+'|'+n.meta+'|'+z;
    if(label&&n.mediaLabelKey!==key){const box=label.getBoundingClientRect();n.mediaLabelKey=key;n.mediaLabelSize={width:box.width,height:box.height}}
    const measured=includeCompanion?n.mediaLabelSize:null,half=measured?.width>0?measured.width/2:(width<650?(n.privatePanel?67.5:n.generated?38:72.5):(n.privatePanel?75:80))*z;
    const labelHeight=measured?.height>0?measured.height:(n.generated&&width<650?32:55)*z;
    obstacles.push({left:n.sx-half,right:n.sx+half,top:n.sy+n.sr+(width<650?12:19)*z,bottom:n.sy+n.sr+(width<650?12:19)*z+labelHeight});
  }
  if(!level.system&&!systemTravel){const b=distantSystemBounds();add({...b,height:b.height+20})}
  // The moving companion yields to chat; media still avoids its body and speech.
  if(includeCompanion)for(const id of ['companion-target','speech-bubble']){const element=$(id);if(element&&!element.hidden)add(element.getBoundingClientRect())}
  if(system.chess?.isOpen())add(document.querySelector('.chess-board')?.getBoundingClientRect());
  if(chessTarget&&!chessTarget.hidden){const n=chessOrbit(),shape=chessFootprint();obstacles.push(satelliteBox({x:n.sx,y:n.sy},{left:shape.left*zoom,right:shape.right*zoom,top:shape.top*zoom,bottom:shape.bottom*zoom}))}
  return obstacles;
}
function chatOrbit(){return chatPosition?{...chatPosition,r:width<650?17:21}:{x:width*.79,y:height*.69,r:width<650?17:21}}
function positionChat(now){
  if(system.chess?.isOpen()){if(width<=900)return null;const region=desktopChatRegions(width,height),u=easeOut(system.chess.progress?.()||1),from=chessJourney?.chatFrom||chatPosition||{x:region.left+region.width/2,y:region.top};chatCaption.style.visibility='visible';chatPreview.style.visibility='hidden';return chatPosition={x:lerp(from.x,region.left+region.width/2,u),y:lerp(from.y,(region.top+height-region.bottom)/2,u),r:21,caption:true};}

  const r=width<650?17:21,drift=paused||reduced.matches?0:1;
  const preferred=chatHovered&&chatPosition?chatPosition:{x:width*(width<650?.80:.82)+Math.sin(clock*.46+.7)*27*drift,y:height*(width<650?.69:.71)+Math.cos(clock*.37+.9)*31*drift};
  const opacity=previewTimer.opacity(reduced.matches);chatPreview.hidden=!previewTimer.visible;chatPreview.style.opacity=String(opacity);
  const step=Math.min(Math.max(now-chatFrameTime,0),50);chatFrameTime=now;
  const viewport=width+'x'+height;
  // Once the visitor aims at the node, keep its hit target under their pointer.
  // Reflow after a viewport change, and resume evasion when interaction ends.
  if((chatHovered||chatFocused)&&chatPosition&&chatViewport===viewport)return chatPosition;
  chatViewport=viewport;
  const preview=previewTimer.visible?{width:chatPreview.offsetWidth||190,height:chatPreview.offsetHeight||74}:null;
  const options={width,height,obstacles:chatObstacles(),preferred,previous:chatPosition,preview,ease:reduced.matches?1:1-Math.exp(-step/260)};
  let caption=!(width<650&&system.chess?.isOpen());
  chatPosition=placeSatellite({...options,footprint:satelliteFootprint(r,caption)});
  if(!chatPosition&&caption){caption=false;chatPosition=placeSatellite({...options,footprint:satelliteFootprint(r,false)})}
  if(chatPosition)chatPosition.caption=caption;
  chatCaption.style.visibility=caption?'visible':'hidden';
  chatPreview.style.visibility=chatPosition?.bubble?'visible':'hidden';
  if(chatPosition?.bubble){
    chatPreview.style.left=chatPosition.bubble.left+r+8+'px';chatPreview.style.top=chatPosition.bubble.top+r+8+'px';chatPreview.style.right='auto';
  }
  return chatPosition;
}
function syncMediaLevel(){
  const selected=openContentNode&&!$('content-card').hidden&&!openContentNode.component?openContentNode.record:null;
  const record=selected||(level.system?portfolio.nodes.find(node=>node.type==='system'):level.record);
  const terminal=record&&(level.architecture||!orderedChildren(record.id).length);
  system.media?.setNode(terminal?record:null,colors[level.tint]||colors.mint);
}
let openContentNode=null;
function closeContent(){ openContentNode=null; $('content-card').hidden=true;syncMediaLevel() }
function renderMedia(now){
  if(!system.media||system.media.hasMedia&&!system.media.hasMedia())return;
  const obstacles=chatObstacles(true);
  if(chatPosition&&!livePanelOpen&&!chatMorph){
    const shape=satelliteFootprint(width<650?17:21,chatPosition.caption);
    obstacles.push({left:chatPosition.x+shape.left,right:chatPosition.x+shape.right,top:chatPosition.y+shape.top,bottom:chatPosition.y+shape.bottom});
    if(chatPosition.bubble&&previewTimer.visible){const b=chatPosition.bubble;obstacles.push({left:chatPosition.x+b.left,right:chatPosition.x+b.right,top:chatPosition.y+b.top,bottom:chatPosition.y+b.bottom})}
  }
  obstacles.push(...chatSurfaceBounds());
  for(let i=0;i<level.edges.length;i++){
    const [from,to,note]=level.edges[i],a=nodes[from],b=nodes[to];if(!a||!b)continue;
    const bend=(i%2?1:-1)*(level.system?.11:.085),points=Array.from({length:25},(_,j)=>bezier(a,b,j/24,bend));
    obstacles.push(...system.media.curveObstacles(points));
    if(note?.label){const p=bezier(a,b,.5,bend),w=Math.min(width<650?104:200,note.label.length*7);obstacles.push({left:p.x-w/2,right:p.x+w/2,top:p.y-20,bottom:p.y+8})}
  }
  occupiedMediaBounds=system.media.render({width,height,clock,now,obstacles,hidden:!!travel||!!systemTravel||!!system.chess?.isOpen(),reduced:reduced.matches,paused});
}
function panelTriangles(bounds){
  const triangles=[];
  for(let row=0;row<2;row++)for(let col=0;col<5;col++){
    const x0=bounds.left+bounds.width*col/5,x1=bounds.left+bounds.width*(col+1)/5;
    const y0=bounds.top+bounds.height*row/2,y1=bounds.top+bounds.height*(row+1)/2;
    triangles.push([[x0,y0],[x1,y0],[x0,y1]],[[x1,y0],[x1,y1],[x0,y1]]);
  }
  const cx=bounds.left+bounds.width/2,cy=bounds.top+bounds.height/2;
  return triangles.sort((a,b)=>Math.atan2(a[0][1]+a[1][1]+a[2][1]-cy*3,a[0][0]+a[1][0]+a[2][0]-cx*3)-Math.atan2(b[0][1]+b[1][1]+b[2][1]-cy*3,b[0][0]+b[1][0]+b[2][0]-cx*3));
}
function morphLivePanel(panel,opening,complete){
  if(document.body.classList.contains('chess-chat-open')){panel.style.opacity='';panel.style.pointerEvents='';complete();return}
  const origin=chatOrbit();
  if(opening&&document.body.classList.contains('live-chat-open')){
    // The sheet follows visualViewport through CSS; a world-node anchor would
    // leave an inline top behind when the mobile keyboard changes the viewport.
    panel.style.left=panel.style.top=panel.style.bottom='';
  }else if(opening){
    const panelWidth=panel.offsetWidth,panelHeight=panel.offsetHeight;
    panel.style.left=clamp(origin.x-panelWidth-26,16,Math.max(16,width-panelWidth-16))+'px';
    panel.style.top=clamp(origin.y-panelHeight*.55,92,Math.max(92,height-panelHeight-116))+'px';
    panel.style.bottom='auto';
  }
  if(reduced.matches){panel.style.opacity='';panel.style.pointerEvents='';complete();return}
  if(!morphCanvas){morphCanvas=document.createElement('canvas');morphCanvas.className='live-morph-canvas';morphCtx=morphCanvas.getContext('2d');document.body.append(morphCanvas)}
  const bounds=panel.getBoundingClientRect();
  if(!bounds.width||!bounds.height||!morphCtx){panel.style.opacity='';panel.style.pointerEvents='';complete();return}
  const faces=meshFaces({type:'ico',seed:4.9,sx:origin.x,sy:origin.y,sr:origin.r}).sort((a,b)=>Math.atan2(a.center[1],a.center[0])-Math.atan2(b.center[1],b.center[0]));
  const targets=panelTriangles(bounds);
  chatMorph={opening,complete,panel,origin,faces,targets,start:performance.now(),duration:MOTION.livePanel};
  panel.style.pointerEvents='none';panel.style.opacity=opening?'0':'1';chatTarget.hidden=true;
  morphCanvas.hidden=false;
}
function drawLiveMorph(now){
  if(!chatMorph)return;
  const m=chatMorph,t=clamp((now-m.start)/m.duration),u=smooth(m.opening?t:1-t),scatter=Math.sin(Math.PI*t);
  const pixelWidth=Math.round(width*dpr),pixelHeight=Math.round(height*dpr);
  if(morphCanvas.width!==pixelWidth||morphCanvas.height!==pixelHeight){morphCanvas.width=pixelWidth;morphCanvas.height=pixelHeight;morphCanvas.style.width=width+'px';morphCanvas.style.height=height+'px'}
  morphCtx.setTransform(dpr,0,0,dpr,0,0);morphCtx.clearRect(0,0,width,height);
  m.faces.forEach((face,i)=>{
    const target=m.targets[i],sourceCenter=face.points.reduce((sum,p)=>[sum[0]+p[0]/3,sum[1]+p[1]/3],[0,0]);
    const targetCenter=target.reduce((sum,p)=>[sum[0]+p[0]/3,sum[1]+p[1]/3],[0,0]);
    const centerProgress=smooth((u-.04)/.92),sizeProgress=smooth((u-.4)/.58);
    const angle=Math.atan2(targetCenter[1]-sourceCenter[1],targetCenter[0]-sourceCenter[0])+(i%2?.65:-.65);
    const travel=20+(i%4)*7,dx=Math.cos(angle)*scatter*travel,dy=Math.sin(angle)*scatter*travel;
    const cx=lerp(sourceCenter[0],targetCenter[0],centerProgress)+dx,cy=lerp(sourceCenter[1],targetCenter[1],centerProgress)+dy;
    const points=face.points.map((p,j)=>[cx+lerp(p[0]-sourceCenter[0],target[j][0]-targetCenter[0],sizeProgress),cy+lerp(p[1]-sourceCenter[1],target[j][1]-targetCenter[1],sizeProgress)]);
    morphCtx.beginPath();morphCtx.moveTo(...points[0]);morphCtx.lineTo(...points[1]);morphCtx.lineTo(...points[2]);morphCtx.closePath();
    morphCtx.fillStyle=rgba(mix(colors.rose,[18,34,39],u),.64+.24*Math.sin(Math.PI*t));morphCtx.fill();
    morphCtx.strokeStyle=rgba(mix(colors.rose,colors.mint,u),.45+.25*scatter);morphCtx.lineWidth=.9;morphCtx.stroke();
  });
  m.panel.style.opacity=String(m.opening?smooth((t-.72)/.28):1-smooth(t/.28));
  if(t>=1){if(m.opening)morphCanvas.hidden=true;m.panel.style.opacity='';m.panel.style.pointerEvents='';chatMorph=null;m.complete()}
}
function generatedVisual(record,x,y,parentId){
  const childScene=record.children?.length?{id:record.id,title:record.label,description:record.summary,intro:record.summary,tint:'mint',generated:true,generatedRecord:record,nodes:record.children.map((child,i)=>generatedVisual(child,...positions(record.children.length)[i],record.id)),edges:[]}:null;
  return{id:record.id,name:record.label,meta:t('generated.badge'),description:record.summary,color:colors.mint,x,y,r:30,type:'ico',children:childScene,generated:record,generatedParent:parentId||record.id,born:performance.now()};
}
function syncGenerated(){
  const badge=chatTarget.querySelector?.('.unread-badge');badge?.remove();
  if(liveUnread){const label=document.createElement('span');label.className='unread-badge';label.textContent=String(liveUnread);chatTarget.append(label)}
  chatTarget.classList.toggle('has-unread',!!liveUnread);
  chatTarget.setAttribute('aria-label',liveUnread?t('chat.unread',{count:liveUnread}):t('chat.open'));
}
function reconcileGenerated(){
  if(travel||systemTravel||level.system)return;
  nodes=nodes.filter(n=>!n.generated||level.nodes.some(v=>v.id===n.id));
  for(const visual of level.nodes)if(visual.generated&&!nodes.some(n=>n.id===visual.id)){
    const n=instantiate({nodes:[visual]})[0];n.seed=nodes.length*1.7+2;n.birthOrigin=visual.birthOrigin;nodes.push(n);
  }
  bindNodes();updateUI();
}
const formingRuns=new Map();
// Generated-node focus uses the same projection, level travel and render clock.
let generatedFocus=null,generatedRequest=null,generatedReturn=null,generatedPulse=null,generatedNotice=null,pinnedAgent=null;
const focusControls=document.createElement('aside');focusControls.className='generated-camera-controls';focusControls.hidden=true;
const focusNotice=document.createElement('span');focusNotice.setAttribute('role','status');
const focusView=document.createElement('button');focusView.type='button';
const focusBack=document.createElement('button');focusBack.type='button';focusControls.append(focusNotice,focusView,focusBack);document.body.append(focusControls);
function syncFocusControls(){
  focusControls.hidden=!generatedNotice&&!generatedReturn;
  const orientation=!focusControls.hidden?document.querySelector('.orientation')?.getBoundingClientRect():null;if(orientation)focusControls.style.top=Math.min(height-80,Math.max(110,(orientation?(orientation.bottom??orientation.top+orientation.height):200)+12))+'px';focusNotice.hidden=!generatedNotice;focusView.hidden=!generatedNotice;focusBack.hidden=!generatedReturn;
  focusNotice.textContent=generatedNotice?t('generated.created',{name:generatedRegistry.get(generatedNotice)?.record.label||''}):'';
  focusView.textContent=t('generated.view');focusBack.innerHTML=icon('back')+'<span>'+t('common.back')+'</span>';focusBack.className='back-button';focusBack.setAttribute('aria-label',t('common.back'));
}
function focusBlocked(){return livePanelOpen||!!system.chess?.isOpen()||!!system.media?.isOpen()||(document.querySelectorAll?.('.welcome-overlay:not([hidden]), .access-overlay:not([hidden]), .account-overlay:not([hidden]), dialog[open]')||[]).length>0}
function cancelGeneratedFocus(){generatedRequest=null;generatedFocus=null;returnTarget=null}
function captureGeneratedView(){return{path:stack.map(state=>state.entryId),system:!!level.system,view:camera(),targetZoom,panel:panelOpen?panelProjection():null}}
function focusGenerated(id){
  if(!generatedRegistry.has(id))return false;
  cancelGeneratedFocus();
  if(focusBlocked()){generatedNotice=id;syncFocusControls();return false}
  generatedReturn??=captureGeneratedView();generatedNotice=null;
  generatedRequest={id,returning:false,path:[],index:0};
  if(panelOpen&&!pinnedAgent){pinnedAgent={x:width<650?Math.max(16,(width-320)/2):Math.max(16,width-366),y:width<650?height-Math.min(height*.26,220)-90:Math.max(100,height*.2)};document.body.classList.add('generated-camera-focused')}
  syncFocusControls();advanceGeneratedFocus(performance.now());return true;
}
function backGenerated(){
  if(!generatedReturn)return;const previous=generatedReturn;cancelGeneratedFocus();generatedNotice=null;
  generatedRequest={id:null,returning:true,path:previous.path,index:0,previous};advanceGeneratedFocus(performance.now());
}
focusView.addEventListener('click',()=>{const id=generatedNotice;if(!id)return;for(const button of document.querySelectorAll?.('.account-overlay:not([hidden]) .access-close, .access-overlay:not([hidden]) .access-close, .welcome-overlay:not([hidden]) .welcome-enter')||[])button.click();system.media?.close();if(system.chess?.isOpen())system.chess.closeForNavigation?.(()=>focusGenerated(id));else focusGenerated(id)});
focusBack.addEventListener('click',backGenerated);
function advanceGeneratedFocus(now){
  if(!generatedRequest&&!generatedFocus)return;
  const active=generatedRequest||generatedFocus;
  if(focusBlocked()){if(active.id)generatedNotice=active.id;cancelGeneratedFocus();syncFocusControls();return}
  if(travel||systemTravel)return;
  if(generatedRequest){
    const request=generatedRequest;
    if(level.system&&!(request.returning&&request.previous.systemReached)){exitSystem();return}
    if(!request.returning&&stack.length){goBackTo(0);return}
    if(request.returning){
      // Walk the saved ancestry with ordinary node transitions (also works for
      // generated groups and the private owner scene, without public IDs).
      if(stack.length>request.index){goBackTo(request.index);return}
      const nextId=request.path[request.index];
      if(nextId){const next=nodes.find(n=>n.id===nextId);if(next?.children){request.index++;startTravel(next,false);return}request.path=[]}
      if(request.previous.system&&!request.previous.systemReached){request.previous.systemReached=true;enterSystem();return}
    }
    const point=request.id?rootWorldLayout(nodes).get(request.id):null;
    if(request.id&&!point){cancelGeneratedFocus();return}
    const to=request.returning?request.previous.view:{zoom:width<650?1.65:1.2,pan:{x:0,y:0},parallax:{...parallax}};
    if(point){const n=nodes.find(n=>n.id===request.id),position=projectWorld(point,to,n?.seed||0);to.pan={x:width/2-position.x,y:height/2-position.y}}
    generatedFocus={...request,from:camera(),to,start:now};generatedRequest=null;
  }
  const move=generatedFocus;if(!move)return;
  const progress=reduced.matches?1:clamp((now-move.start)/MOTION.generatedFocus,0,1),u=easeOut(progress);
  pan={x:lerp(move.from.pan.x,move.to.pan.x,u),y:lerp(move.from.pan.y,move.to.pan.y,u)};zoom=targetZoom=lerp(move.from.zoom,move.to.zoom,u);syncZoomUI();
  if(progress>=1){
    generatedFocus=null;
    if(move.returning){generatedReturn=null;pinnedAgent=null;document.body.classList.remove('generated-camera-focused');if(move.previous.panel&&panelOpen)anchorPanel(move.previous.panel.x,move.previous.panel.y)}
    else{generatedPulse={id:move.id,start:now};$('announcement').textContent=t('generated.created',{name:generatedRegistry.get(move.id)?.record.label||''})}
    syncFocusControls();
  }
}
function drawGeneratedPulse(now){
  if(!generatedPulse)return;const u=(now-generatedPulse.start)/MOTION.formingPulse;
  if(u>=1||reduced.matches){generatedPulse=null;return}
  const node=nodes.find(n=>n.id===generatedPulse.id);if(!node)return;
  ctx.save();ctx.strokeStyle=rgba(colors.mint,(1-u)*.7);ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(node.sx,node.sy,node.sr*(1+u*.8),0,Math.PI*2);ctx.stroke();ctx.restore();
}

function formingSources(state){return nodes.filter(n=>state.sources.some(id=>id===n.id||id.startsWith(n.id+'.')))}
function formGenerated(runId,sources){
  if(reduced.matches||formingRuns.has(runId)||formingRuns.size>=12)return;
  const destination=root,index=generatedRegistry.size+formingRuns.size;
  const x=clamp((companion.x-width/2-pan.x)/(Math.min(width*.52,740)*zoom),-.48,.48),y=.28+index*.08;
  const ghost={id:'forming:'+runId,x,y,r:30,type:'ico',seed:nodes.length*1.7+2,generated:true,name:t('generated.forming'),meta:t('generated.badge'),dx:0,dy:0,hover:0,color:colors.mint};
  formingRuns.set(runId,{runId,sources:[...new Set(sources)].filter(id=>records.has(id)),scene:destination,start:performance.now(),x,y,ghost,nodeId:null,world:destination===root?rootWorldLayout([...nodes,ghost]).get(ghost.id):null,viewport:[width,height]});
  $('announcement').textContent=t('generated.forming');
}
function finishForming(runId){const state=formingRuns.get(runId);if(state&&!state.nodeId)formingRuns.delete(runId)}
function clearFormations(){formingRuns.clear();cancelGeneratedFocus();generatedNotice=null;generatedReturn=null;pinnedAgent=null;document.body.classList.remove('generated-camera-focused');syncFocusControls()}
function drawFormations(now){
  for(const [runId,state]of formingRuns){
    const phase=formationPhase(now-state.start,reduced.matches||paused);
    if(phase.done&&state.nodeId||now-state.start>MOTION.formingWait){formingRuns.delete(runId);continue}
    if(state.scene!==level||travel||systemTravel)continue;
    const target=nodes.find(n=>n.id===state.nodeId)||state.ghost;
    if(!state.nodeId){
      if(state.world&&(state.viewport[0]!==width||state.viewport[1]!==height)){state.world=rootWorldLayout([...nodes,state.ghost]).get(state.ghost.id);state.viewport=[width,height]}
      const view=camera(),p=layout(target,state.scene===root?root:{...state.scene,nodes:[...state.scene.nodes,target]},view),position=state.world?projectWorld(state.world,view,target.seed):p;
      target.sx=position.x;target.sy=position.y;target.sr=p.r;
    }
    const opacity=(1-phase.build)*.7;
    if(phase.threads>0&&opacity>0&&!reduced.matches&&!paused){
      for(const source of formingSources(state)){
        ctx.save();ctx.strokeStyle=rgba(colors.mint,opacity);ctx.lineWidth=1.1;
        const x=lerp(source.sx,target.sx,phase.threads),y=lerp(source.sy,target.sy,phase.threads);
        ctx.beginPath();ctx.moveTo(source.sx,source.sy);ctx.quadraticCurveTo((source.sx+x)/2,Math.min(source.sy,y)-30,x,y);ctx.stroke();
        drawGlow(x,y,3,colors.mint,opacity,.8);ctx.restore();
      }
    }
    if(!state.nodeId){state.ghost.formation=state;drawNode(target,.65,false)}
    if(phase.pulse>0&&phase.pulse<1&&!reduced.matches&&!paused){ctx.save();ctx.strokeStyle=rgba(colors.mint,(1-phase.pulse)*.7);ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(target.sx,target.sy,target.sr*(1+phase.pulse*.8),0,Math.PI*2);ctx.stroke();ctx.restore()}
  }
}
/** @param {string|null} runId */
function spawnGenerated(record,anchor=null,restored=false,runId=null){
  const existing=generatedRegistry.get(record.id);if(existing)return;
  const forming=restored?null:formingRuns.get(runId);
  const destination=runId?root:forming?.scene||(level.system||level.generated?root:level);
  const anchorNode=destination.nodes.find(n=>n.id===anchor),target=anchorNode?{x:anchorNode.x+.20,y:anchorNode.y-.08}:{x:clamp((companion.x-width/2-pan.x)/(Math.min(width*.52,740)*zoom),-.48,.48),y:.28};
  const index=generatedRegistry.size;
  const x=restored?-.55+(index%4)*.35:target.x,y=restored?.51+Math.floor(index/4)*.22:target.y+index*.08;
  const visual=generatedVisual(record,forming?.x??x,forming?.y??y,null);
  if(forming){forming.nodeId=record.id;visual.formation=forming}
  visual.birthOrigin=restored||anchorNode||forming||reduced.matches?null:{x:companion.x,y:companion.y};destination.nodes.push(visual);generatedRegistry.set(record.id,{record,scene:destination,visual});
  if(destination===level)reconcileGenerated();
  if(!restored&&runId)focusGenerated(record.id);
}
function removeGenerated(id,refresh=true){
  if(disposed)return;
  if(generatedNotice===id)generatedNotice=null;if(generatedRequest?.id===id||generatedFocus?.id===id)cancelGeneratedFocus();syncFocusControls();
  for(const [runId,state]of formingRuns)if(state.nodeId===id)formingRuns.delete(runId);if(travel||systemTravel){setTimeout(()=>removeGenerated(id,refresh),80);return}
  $('content-card').hidden=true;
  const parent=[...generatedRegistry.values()].find(item=>item.record.children?.some(child=>child.id===id));
  if(parent){parent.record.children=parent.record.children.filter(child=>child.id!==id);parent.visual.children.nodes=parent.visual.children.nodes.filter(n=>n.id!==id);nodes=nodes.filter(n=>n.id!==id);bindNodes();updateUI();return}
  const item=generatedRegistry.get(id);if(!item)return;if(level.generated&&level.id===id){goBack();const after=()=>{if(travel||systemTravel)setTimeout(after,80);else removeGenerated(id,refresh)};after();return}item.scene.nodes=item.scene.nodes.filter(n=>n.id!==id);generatedRegistry.delete(id);
  nodes=nodes.filter(n=>n.id!==id);for(const state of stack)state.nodes=state.nodes.filter(n=>n.id!==id);
  if(systemReturn){systemReturn.nodes=systemReturn.nodes.filter(n=>n.id!==id);for(const state of systemReturn.stack)state.nodes=state.nodes.filter(n=>n.id!==id)}
  if(refresh&&!travel&&!systemTravel){bindNodes();updateUI()}
}
function showGenerated(node){
  openContentNode=node;
  const record=node.generated,body=$('content-body');body.replaceChildren();$('content-title').textContent=record.label;addText(body,'span',t('generated.label'),'content-status');addText(body,'p',record.summary);
  const c=record.content;
  if(record.layout==='text')addText(body,'p',c.body);
  if(record.layout==='list'){const list=document.createElement('ul');for(const text of c.items)addText(list,'li',text);body.append(list)}
  if(record.layout==='tags'){const tags=document.createElement('div');tags.className='generated-tags';for(const tag of c.tags)addText(tags,'span',tag);body.append(tags)}
  if(record.layout==='timeline'){const list=document.createElement('dl');list.className='facts-list';for(const entry of c.entries){addText(list,'dt',entry.when);addText(list,'dd',entry.what)}body.append(list)}
  if(record.layout==='metrics')addFacts(body,c.items);
  addText(body,'h3',t('generated.sources'),'sources-title');
  for(const source of record.sources){
    if(/^https:\/\//i.test(source.ref||'')){const link=addText(body,'a',source.title,'source-link');link.href=source.ref;link.target='_blank';link.rel='noopener noreferrer'}
    else if(source.ref&&records.has(source.ref)){const button=addText(body,'button',source.title,'source-link');button.addEventListener('click',()=>navigateAsync(source.ref))}
    else addText(body,'span',source.title,'source-link');
  }
  const discard=addText(body,'button',t('generated.discard'),'discard-generated');discard.addEventListener('click',()=>system.onDiscard?.(record.id));$('content-card').hidden=false;
}
function navigateAsync(id){return new Promise(resolve=>{
  if(system.chess?.isOpen()){resolve(false);return}
  if(!records.has(id)){resolve(false);return}
  if(travel||systemTravel){setTimeout(()=>navigateAsync(id).then(resolve),80);return}
  if(level.system){resolve(false);return}
  navigationComplete?.(false);navigationComplete=resolve;navigateTo(id);
  if(!travel&&!navigationQueue.length){navigationComplete?.(true);navigationComplete=null}
})}
function exitSystemAsync(){return new Promise(resolve=>{if(!level.system&&!systemTravel){resolve();return}if(!systemTravel)exitSystem();const wait=()=>{if(systemTravel)setTimeout(wait,60);else resolve()};wait()})}
function inspectGenerated(id){const item=generatedRegistry.get(id);if(item)showGenerated(item.visual)}

function enterSystem(){
  if(system.chess?.isOpen()){system.chess.closeForNavigation?.(enterSystem);return}
  if(travel||systemTravel||level.system)return;
  systemReturn={level,nodes,stack:[...stack],camera:camera(),targetZoom};
  const target={level:systemScene,nodes:systemPopulation,camera:{zoom:1,pan:{x:0,y:0},parallax:{...parallax}},targetZoom:1};
  project(target);beginSystemTravel('in',target);
}
function exitSystem(){if(systemTravel||!systemReturn)return;beginSystemTravel('out',{level,nodes,camera:camera(),targetZoom})}
function beginSystemTravel(kind,state){
  drag=null;
  systemTravel={kind,state,start:performance.now(),duration:reduced.matches?MOTION.reduced:MOTION.system,switched:false,aperture:distantSystemBounds(kind==='out'?systemReturn.camera:camera())};
  document.body.classList.add('is-traveling');$('node-targets').inert=true;$('edge-targets').inert=true;$('back').disabled=true;$('content-card').hidden=true;hoverId=null;focusedId=null;hoverEdge=null;
  say(kind==='in'?t('system.title'):systemReturn.level.title,kind==='in'?systemScene.intro:t('nav.returnPoint'),'system-travel',0);
}
function switchSystem(){
  const transition=systemTravel,state=transition.kind==='in'?transition.state:systemReturn,p=panelOpen?panelProjection():null;
  level=state.level;nodes=state.nodes;pan={...state.camera.pan};parallax={...state.camera.parallax};zoom=state.camera.zoom;targetZoom=state.targetZoom;if(p)anchorPanel(p.x,p.y);
  stack=transition.kind==='in'?[]:[...systemReturn.stack];transition.switched=true;bindNodes();updateUI();
}
function renderSystemTravel(now){
  const t=systemTravel,p=clamp((now-t.start)/t.duration),u=t.kind==='in'?easeOut(p):1-easeOut(p);
  if(p>=.5&&!t.switched)switchSystem();
  drawBackground();project(systemReturn);project(t.state);
  const bounds=t.aperture;
  const focusX=bounds.left+bounds.width/2,focusY=bounds.top+bounds.height/2,approachScale=1+2.2*u;
  const background=systemReturn.nodes.map(n=>({...n,sx:lerp(n.sx,width/2+(n.sx-focusX)*approachScale,u),sy:lerp(n.sy,height*.53+(n.sy-focusY)*approachScale,u),sr:n.sr*(1+1.25*u)}));
  drawEdges(systemReturn.level,background,1-u);for(const n of background)drawNode(n,1-u);
  const minis=apertureNodes(bounds,t.state.nodes);
  const transformed=t.state.nodes.map((n,i)=>({...n,sx:lerp(minis[i].sx,n.sx,u),sy:lerp(minis[i].sy,n.sy,u),sr:lerp(minis[i].sr,n.sr,u),hover:lerp(minis[i].hover,n.hover,u),miniature:u<.85}));
  drawEdges(systemScene,transformed,1);for(const n of transformed)drawNode(n,1);
  placeTargets(t.switched?smooth((p-.8)/.2):1-smooth(p/.2));
  if(p>=1){if(!t.switched)switchSystem();const incoming=t.kind==='in';systemTravel=null;if(!incoming)systemReturn=null;reconcileGenerated();document.body.classList.remove('is-traveling');$('node-targets').inert=false;$('edge-targets').inert=false;$('back').disabled=false;$('level-title').focus({preventScroll:true});say(level.title,level.intro,'level',8000);system.onSceneChanged?.()}
}
system.portal.button.addEventListener('click',enterSystem);
system.portal.button.addEventListener('pointerenter',()=>apertureHover=true);system.portal.button.addEventListener('pointerleave',()=>apertureHover=false);
system.portal.button.addEventListener('focus',()=>apertureHover=true);system.portal.button.addEventListener('blur',()=>apertureHover=false);
const flowLegend=document.createElement('details');flowLegend.id='system-legend';flowLegend.hidden=true;const legendTitle=document.createElement('summary');legendTitle.textContent=t('system.flows');flowLegend.append(legendTitle);
for(const flow of system.architecture.flows){const item=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent=flow.label;text.textContent=flow.description;item.append(summary,text);flowLegend.append(item)}
document.body.append(flowLegend);

function measureSystemHeader(){
  // Header geometry is read on resize/language changes, never every frame.
  systemHeaderRects=[];
  for(const selector of ['.system-status','.level-mark','.brand']){
    const rect=document.querySelector(selector)?.getBoundingClientRect?.();
    if(rect?.height&&rect.top>=0&&rect.top<height*.4)systemHeaderRects.push({left:rect.left,right:rect.right,bottom:rect.top+rect.height});
  }
}
function resize(){
  fixedCache=null;worldLayoutKey='';width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,MOTION.maxDpr);
  measureSystemHeader();
  if(ownerMode){ownerSignature='';setOwnerGames(ownerMode,ownerKnownGames)}
  canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.width=width+'px';canvas.style.height=height+'px';ctx.setTransform(dpr,0,0,dpr,0,0);
  companion.x=clamp(companion.x,30,width-30);companion.y=clamp(companion.y,30,height-30);
  if(travel){refreshTravelGeometry(travel)}if(panelOpen){const p=panelProjection();anchorPanel(clamp(p.x,16,Math.max(16,width-350*zoom)),clamp(p.y,90,Math.max(90,height-430*zoom)))}
}
function camera(){return{zoom,pan:{...pan},parallax:{...parallax}}}
function layout(n,scene=level,view=camera()){
  const landscapeMobile=compactUniverse()&&width>height;
  const mobile=width<650,usableH=Math.max(210,height-(mobile?340:280));
  const rootSatellites=scene===root&&chessTarget&&system.chessNodeVisible;
  const xSpan=landscapeMobile&&scene===root?width:mobile?width*(scene===root?.54:.61):Math.min(width*(rootSatellites?.58:.52),rootSatellites?800:740),ySpan=mobile?usableH*(rootSatellites?.54:.81):usableH*.76;
  const offsetY=mobile?(rootSatellites?-Math.min(78,height*.095):30):0;
  let x=n.x,y=n.y;
  if(mobile&&scene===root){const rootPositions=[[0,-.4],[.49,-.1],[.32,.4],[-.36,.4],[-.49,-.1]];const innerPositions=scene.nodes.length===3?[[-.43,.16],[0,-.34],[.43,.16]]:[[-.12,-.05],[.44,-.34],[.4,.37],[-.46,.39],[-.5,-.37]];const index=scene.nodes.indexOf(n.data||n);[x,y]=(scene===root?rootPositions:innerPositions)[index]||[x,y]}
  if(mobile&&scene!==root&&!scene.system){const index=scene.nodes.indexOf(n.data||n),count=scene.nodes.length;if(count===1){x=0;y=.02}else if(count===2){x=index? .43:-.43;y=.02}else{const rows=Math.ceil(count/2);x=index%2?.49:-.49;y=-.43+Math.floor(index/2)*(.88/Math.max(1,rows-1));if(index===count-1&&count%2)x=0}}
  if(mobile&&scene.system){const points={browser:[0,-.52],traefik:[0,-.34],gateway:[-.46,-.14],redis:[.46,-.14],agent:[0,.05],n8n:[-.46,.26],llm:[.46,.26],postgres:[-.46,.49],owner_channel:[.46,.49]};[x,y]=points[n.id];const row={browser:0,traefik:1,gateway:2,redis:2,agent:3,n8n:4,llm:4,postgres:5,owner_channel:5}[n.id],top=Math.min(274,height*.34),bottom=height-282;y=(top+(bottom-top)*row/5-height*.53-30)/ySpan}
  if(mobile&&scene===root&&rootSatellites&&!n.generated&&!n.privatePanel){const index=scene.nodes.findIndex(node=>node.id===n.id),lift=height<720?40:ownerMode?32:0;if(index===2||index===3)y-=lift/ySpan}
  if(landscapeMobile&&scene===root&&!n.generated&&!n.privatePanel){const index=scene.nodes.findIndex(node=>node.id===n.id);x=.26+index*.155-.5;y=(height*.48-height*.53-offsetY)/ySpan}
  const mobileScale=rootSatellites?.48:scene===root&&scene.nodes.some(node=>node.generated)?.44:scene.architecture?.50:.60;
  return{x:width/2+x*xSpan*view.zoom+view.pan.x+view.parallax.x*(n.r/8),y:height*.53+(offsetY+y*ySpan)*view.zoom+view.pan.y+view.parallax.y*(n.r/8),r:n.r*(landscapeMobile&&scene===root?.30:mobile?mobileScale:Math.min(1.06,width/1250+.1))*view.zoom};
}
function instantiate(scene){return scene.nodes.map((n,i)=>({...n,data:n,dx:0,dy:0,vx:0,vy:0,seed:i*1.7+1.3,hover:0,sx:0,sy:0,sr:0}))}
function project(state){
  for(const n of state.nodes){
    const p=layout(n,state.level,state.camera);n.sx=p.x+n.dx*state.camera.zoom;n.sy=p.y+n.dy*state.camera.zoom;n.sr=p.r*(1+n.hover*.12);
    if(state.level===root&&(n.generated||n.privatePanel)){
      const position=projectWorld(rootWorldLayout(state.nodes).get(n.id),state.camera,n.seed);n.sx=position.x;n.sy=position.y;
    }
    if(n.generated&&n.birthOrigin){const u=smooth((performance.now()-n.born)/MOTION.generated);n.sx=lerp(n.birthOrigin.x,n.sx,u);n.sy=lerp(n.birthOrigin.y,n.sy,u);n.sr*=.15+.85*u;if(u>=1)n.birthOrigin=null}
  }
}
function bindNodes(){
  const focusedNode=nodes.find(n=>n.el===document.activeElement)?.id;
  const target=$('node-targets');target.replaceChildren();target.inert=!!travel;
  for(const n of nodes){
    const b=document.createElement('button');b.className='node-target'+(n.pending?' is-disabled':'')+(n.reference?' is-reference':'')+(n.generated?' is-generated':'')+(n.privatePanel?' is-owner-panel':'')+(n.ownerGame?(n.ownerGame.status!=='active'?' is-owner-finished':n.ownerGame.turn==='owner'?' is-owner-turn':' is-owner-waiting'):'');b.dataset.node=n.id;
    b.setAttribute('aria-label',n.name+(n.ownerGame?' · '+n.meta:'')+(n.disabled?t('nav.buildingSuffix'):n.reference?t('nav.relatedSuffix'):n.children?t('nav.exploreSuffix'):t('nav.detailsSuffix')));if(n.disabled)b.setAttribute('aria-disabled','true');b.style.setProperty('--node-color',rgba(n.color));
    const label=document.createElement('span');label.className='node-label';const title=document.createElement('span');title.className='node-name';const number=document.createElement('span');number.className='node-index';number.textContent=String(nodes.indexOf(n)+1).padStart(2,'0');title.append(number,document.createTextNode(n.name));const meta=document.createElement('span');meta.className='node-meta';meta.textContent=n.meta;label.append(title,meta);b.append(label);
    b.addEventListener('pointerenter',()=>setHover(n));b.addEventListener('pointerleave',()=>{if(!focusedId)setHover(null)});
    b.addEventListener('focus',()=>{focusedId=n.id;setHover(n)});b.addEventListener('blur',()=>{focusedId=null;setHover(null)});
    b.addEventListener('click',e=>activate(n,e.detail===0));target.append(b);n.el=b;if(n.id===focusedNode)b.focus({preventScroll:true});
  }
  bindEdges();syncGenerated();
}
function setHover(n){
  if(travel||systemTravel)return;hoverId=n?.id||null;
  if(n){hoverEdge=null;queueSpeech(n.name,n.description+(n.system&&system.traces.light(n.id).label?t('system.now',{text:system.traces.light(n.id).label}):''),'node:'+level.title+':'+n.id)}else releaseSpeech('node:');
  $('instruction-text').textContent=n?(n.disabled?t('nav.pending'):n.children?t('nav.enter',{name:n.name}):n.reference?t('nav.relatedHint'):t('nav.detailsHint')):t('nav.instruction');
}
function syncZoomUI(){
  $('zoom-label').textContent=Math.round(targetZoom*100)+'%';$('zoom-in').disabled=targetZoom>=2;$('zoom-out').disabled=targetZoom<=.5;
}
function updateUI(){
  syncMediaLevel();syncOwnerPagination();
  const crumbs=$('breadcrumbs');crumbs.replaceChildren();const items=level.system?[root,level]:[...stack.map(s=>s.level),level];
  items.forEach((item,i)=>{if(i){const slash=document.createElement('span');slash.className='slash';slash.textContent='/';crumbs.append(slash)}if(i<items.length-1){const b=document.createElement('button');b.textContent=i===0?t('common.home'):item.title;b.addEventListener('click',()=>level.system?exitSystem():goBackTo(i));crumbs.append(b)}else{const span=document.createElement('span');span.setAttribute('aria-current','location');span.textContent=i===0?t('common.home'):item.title;crumbs.append(span)}});
  $('level-title').textContent=level.title;$('level-description').textContent=level.description;$('example-badge').hidden=!(level.system&&system.simulated);$('example-badge').textContent=t('common.simulated');$('depth-number').textContent=String(level.system?1:stack.length).padStart(2,'0');$('depth-label').textContent=level.system?t('nav.system'):stack.length?t('nav.inner'):t('nav.overview');$('scene-number').textContent=String(stack.length+1).padStart(2,'0');$('node-count').textContent=t('nav.nodeCount',{count:nodes.filter(n=>!n.reference).length})+(nodes.some(n=>n.reference)?t('nav.linkCount',{count:nodes.filter(n=>n.reference).length}):'');$('edge-count').textContent=t('nav.edgeCount',{count:level.edges.length});$('back').hidden=!stack.length&&!level.system;$('back').innerHTML=icon('back')+'<span>'+t('common.back')+'</span><kbd>ESC</kbd>';flowLegend.hidden=!level.system;document.body.classList.toggle('system-scene',!!level.system);$('announcement').textContent=t('nav.announcement',{title:level.title,count:nodes.length,depth:stack.length});document.title='Nexo — '+level.title;document.body.classList.toggle('architecture-scene',!!level.architecture);renderSceneFacts();syncZoomUI();if(level.generated)showGenerated({generated:level.generatedRecord,generatedParent:level.id});syncFocusControls();
}
function activate(n,keyboard=false){if(travel||systemTravel||n.disabled)return;if(system.chess?.isOpen()){system.chess.closeForNavigation?.(()=>activate(n,keyboard));return}if(n.ownerGame){const source=()=>({x:n.sx,y:n.sy,r:n.sr,faces:meshFaces(n)});system.onOwnerGame?.(n.ownerGame.id,source(),source);return}if(n.privateEmpty)return;if(n.record?.type==='system'){enterSystem();return}if(n.record?.type==='live_chat'){system.onLiveOpen?.();return}if(n.reference){navigateTo(n.id);return}if(!n.children||(n.generated&&!n.children.nodes.length)){setHover(n);say(n.name,n.description,'node:'+level.title+':'+n.id,0);n.hover=1;showContent(n);return}startTravel(n,keyboard)}
function startTravel(n,keyboard){
  const parent={level,nodes,camera:camera(),targetZoom,entryId:n.id};
  const child={level:n.children,nodes:instantiate(n.children),camera:{zoom:1,pan:{x:0,y:0},parallax:{...parallax}},targetZoom:1};
  project(parent);project(child);parent.plan=createMorphPlan(n,child.nodes);parent.planIds=child.nodes.map(n=>n.id).join('|');stack.push(parent);
  beginTravel('in',parent,child,n,keyboard);
}
function goBack(){
  if(systemTravel)return;if(level.system){exitSystem();return}if(travel||!stack.length)return;const parent=stack.pop(),child={level,nodes,camera:camera(),targetZoom};
  parent.camera.parallax={...parallax};project(parent);project(child);
  if(parent.planIds!==child.nodes.map(n=>n.id).join('|'))parent.plan=createMorphPlan(parent.nodes.find(n=>n.id===parent.entryId),child.nodes);
  beginTravel('out',parent,child,parent.nodes.find(n=>n.id===parent.entryId),document.activeElement?.classList?.contains('node-target'));
}
function goBackTo(depth){if(travel)return;returnTarget=depth;goBack()}
function beginTravel(kind,parent,child,entry,keyboard){
  travel={kind,parent,child,entry,keyboard,start:performance.now(),duration:reduced.matches?MOTION.reduced:kind==='in'?MOTION.enter:MOTION.exit,switched:false};
  $('content-card').hidden=true;refreshTravelGeometry(travel);document.body.classList.add('is-traveling');$('node-targets').inert=true;$('edge-targets').inert=true;$('back').disabled=true;hoverId=null;focusedId=null;hoverEdge=null;
  say(kind==='in'?child.level.title:parent.level.title,kind==='in'?child.level.intro:t('nav.return',{title:parent.level.title}),'travel',0);
}
function switchLevel(){
  const panelPosition=panelOpen?panelProjection():null;const state=travel.kind==='in'?travel.child:travel.parent;level=state.level;nodes=state.nodes;pan={...state.camera.pan};zoom=state.camera.zoom;targetZoom=state.targetZoom;parallax={...state.camera.parallax};travel.switched=true;if(panelPosition)anchorPanel(panelPosition.x,panelPosition.y);bindNodes();updateUI();
}
function finishTravel(){
  if(!travel.switched)switchLevel();const finished=travel;travel=null;reconcileGenerated();
  document.body.classList.remove('is-traveling');$('node-targets').inert=false;$('edge-targets').inert=false;$('back').disabled=false;
  if(returnTarget!==null&&stack.length>returnTarget){goBack();return}
  returnTarget=null;if(navigationQueue.length){continueNavigation();return}navigationComplete?.(true);navigationComplete=null;system.onSceneChanged?.();say(level.title,level.intro,'level:'+level.title,11000);
  if(finished.keyboard){(finished.kind==='out'?nodes.find(n=>n.id===finished.entry.id):nodes[0])?.el.focus({preventScroll:true})}
  else{$('level-title').focus({preventScroll:true});setHover(null)}
}
function physics(dt){
  if(paused||reduced.matches||travel||systemTravel)return;
  for(const n of nodes){const tx=Math.sin(clock*.23+n.seed)*8,ty=Math.cos(clock*.19+n.seed*1.4)*9;n.vx+=(tx-n.dx)*.004*dt;n.vy+=(ty-n.dy)*.004*dt;n.vx*=Math.pow(.92,dt);n.vy*=Math.pow(.92,dt);n.dx+=n.vx*dt;n.dy+=n.vy*dt}
  for(const[a,b]of level.edges){const n=nodes[a],m=nodes[b],tx=(n.dx-m.dx)*.0005*dt,ty=(n.dy-m.dy)*.0005*dt;n.vx-=tx;m.vx+=tx;n.vy-=ty;m.vy+=ty}
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],p=layout(a),q=layout(b),dx=p.x+a.dx-q.x-b.dx,dy=p.y+a.dy-q.y-b.dy,d=Math.hypot(dx,dy)||1,min=p.r+q.r+30;if(d<min){const f=(min-d)*.008*dt;a.vx+=dx/d*f;b.vx-=dx/d*f;a.vy+=dy/d*f;b.vy-=dy/d*f}}
}
function rotate(v,rx,ry,rz){let[x,y,z]=v;[x,z]=[x*Math.cos(ry)+z*Math.sin(ry),-x*Math.sin(ry)+z*Math.cos(ry)];[y,z]=[y*Math.cos(rx)-z*Math.sin(rx),y*Math.sin(rx)+z*Math.cos(rx)];return[x*Math.cos(rz)-y*Math.sin(rz),x*Math.sin(rz)+y*Math.cos(rz),z]}
function meshFaces(n,time=clock){
  const shape=geometry(n.type),rot=time*MOTION.rotation+n.seed;
  const vertices=shape.vertices.map(v=>rotate(v,.2+Math.sin(rot*.6)*.12,rot,.13+Math.sin(rot*.35)*.15));
  return shape.faces.map((ids,i)=>{const local=ids.map(id=>vertices[id]);const center=local.reduce((a,b)=>a.map((v,j)=>v+b[j]/3),[0,0,0]);return{i,z:center[2],center,points:local.map(v=>[n.sx+v[0]*n.sr,n.sy+v[1]*n.sr,v[2]])}});
}
function drawGlow(x,y,r,c,alpha=1,h=0){
  if(alpha<.002)return;ctx.save();ctx.globalAlpha=alpha;
  const glow=ctx.createRadialGradient(x,y,r*.14,x,y,r*2.7);glow.addColorStop(0,rgba(c,.13+h*.11));glow.addColorStop(.38,rgba(c,.045+h*.05));glow.addColorStop(1,rgba(c,0));ctx.fillStyle=glow;ctx.fillRect(x-r*2.7,y-r*2.7,r*5.4,r*5.4);ctx.restore();
}
function trianglePath(p){ctx.beginPath();ctx.moveTo(p[0][0],p[0][1]);ctx.lineTo(p[1][0],p[1][1]);ctx.lineTo(p[2][0],p[2][1]);ctx.closePath()}
function paintFace(face,c,x,y,r,alpha=1,edge=1,h=0){
  ctx.save();ctx.globalAlpha=alpha;trianglePath(face.points);
  const lit=clamp((face.z+1)*.5),shade=.055+lit*.34+(face.tone??face.i%3)*.035+h*.06;
  const top=mix([8,13,20],c,shade),bottom=mix([7,11,17],c,shade*.32);
  const gradient=ctx.createLinearGradient(x-r,y-r,x+r,y+r);gradient.addColorStop(0,rgba(top,MOTION.faceAlphaTop));gradient.addColorStop(1,rgba(bottom,MOTION.faceAlphaBottom));ctx.fillStyle=gradient;ctx.fill();
  if(edge>0){ctx.strokeStyle=rgba(c,(.15+lit*.4+h*.24)*edge);ctx.lineWidth=.7+lit*.25;ctx.stroke()}ctx.restore();
}
function drawNode(n,alpha=1,obstacle=true){
  const forming=n.formation,phase=forming?formationPhase(performance.now()-forming.start,reduced.matches||paused):null;
  for(const state of formingRuns.values())if(formingSources(state).includes(n))n={...n,hover:Math.max(n.hover,formationPhase(performance.now()-state.start,reduced.matches||paused).light)};
  if(n.ownerGame){
    if(n.ownerGame.status!=='active')alpha*=.45;
    else if(n.ownerGame.turn!=='owner')alpha*=.55;
    else n={...n,hover:Math.max(n.hover,paused||reduced.matches?.5:.35+.35*(1+Math.sin(clock*2.5))/2)};
  }
  if(n.generated)alpha*=.62;
  if(n.system){const state=system.traces.light(n.id).state;n={...n,color:state==='error'?[240,115,125]:state==='done'?colors.mint:state==='active'?colors.cyan:n.color,active:state==='active',hover:state==='active'?Math.max(.7,n.hover):n.hover};alpha*=state==='idle'?(n.miniature?(n.hover>.1?.9:.7):(n.hover>.1?.85:.35)):1}
  if(alpha<.003||n.sr<.5||n.sx+n.sr*3<0||n.sx-n.sr*3>width||n.sy+n.sr*3<0||n.sy-n.sr*3>height)return;
  if(obstacle){const reach=Math.max(24,n.sr*1.65);occupiedNodeBounds.push({left:n.sx-reach,right:n.sx+reach,top:n.sy-reach,bottom:n.sy+reach})}
  drawGlow(n.sx,n.sy,n.sr,n.color,alpha,n.hover);
  const faces=meshFaces(n).sort((a,b)=>a.z-b.z);
  for(const [i,f]of faces.entries()){
    if(phase&&!phase.done){
      const reveal=clamp(phase.build*faces.length-i);if(!reveal)continue;
      ctx.save();trianglePath(f.points);ctx.strokeStyle=rgba(n.color,alpha*reveal*.85);ctx.lineWidth=1;ctx.stroke();ctx.restore();
      if(phase.build>.85)paintFace(f,n.color,n.sx,n.sy,n.sr,alpha*smooth((phase.build-.85)/.15),1,n.hover);
    }else paintFace(f,n.color,n.sx,n.sy,n.sr,alpha,1,n.hover);
  }
  if(n.weightTier>=2){
    ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=rgba(n.color,(n.weightTier===3?.42:.22)+n.hover*.2);ctx.lineWidth=n.weightTier===3?1.35:.8;
    const reach=n.sr*(n.weightTier===3?1.34:1.2);
    ctx.beginPath();ctx.ellipse(n.sx,n.sy,reach,reach*.72,-.35,.1,Math.PI*1.62);ctx.stroke();
    if(n.weightTier===3){ctx.beginPath();ctx.ellipse(n.sx,n.sy,reach*1.17,reach*.86,.55,Math.PI*.9,Math.PI*1.86);ctx.stroke()}
    ctx.restore();
  }
  if(n.active||n.id==='core'){const pulse=(Math.sin(clock*1.3)+1)/2;ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=rgba(n.color,.15);ctx.lineWidth=.7;for(const start of[-.2,Math.PI-.2]){ctx.beginPath();ctx.arc(n.sx,n.sy,n.sr*1.37+pulse*4,start,start+1.4);ctx.stroke()}ctx.restore()}
}

// Every source face is assigned permanently to a child. Tessellation gives both
// endpoints the same triangle count, so no fragment is swapped for a new node.
function createMorphPlan(parent,children){
  const faces=meshFaces(parent),groups=children.map(()=>[]),available=new Set(faces.map((_,i)=>i));
  const capacity=children.map((_,i)=>Math.floor(faces.length/children.length)+(i<faces.length%children.length?1:0));
  const pairs=[];
  children.forEach((n,child)=>{const angle=Math.atan2(n.sy-height*.53,n.sx-width/2);faces.forEach(f=>{const a=Math.atan2(f.center[1],f.center[0]);pairs.push({child,face:f.i,cost:1-Math.cos(a-angle)})})});
  pairs.sort((a,b)=>a.cost-b.cost);
  for(const p of pairs)if(available.has(p.face)&&groups[p.child].length<capacity[p.child]){groups[p.child].push(p.face);available.delete(p.face)}
  const plan=[];
  groups.forEach((group,child)=>{
    const targetFaces=meshFaces(children[child]),pieceCount=Math.max(group.length,targetFaces.length),sourcePieces=[],targetPieces=[];
    group.forEach((face,j)=>{const count=Math.floor(pieceCount/group.length)+(j<pieceCount%group.length?1:0);for(let k=0;k<count;k++)sourcePieces.push({face,bary:[[1,0,0],[0,1-k/count,k/count],[0,1-(k+1)/count,(k+1)/count]]})});
    targetFaces.forEach((face,j)=>{const count=Math.floor(pieceCount/targetFaces.length)+(j<pieceCount%targetFaces.length?1:0);for(let k=0;k<count;k++)targetPieces.push({face:face.i,bary:[[1,0,0],[0,1-k/count,k/count],[0,1-(k+1)/count,(k+1)/count]]})});
    sourcePieces.sort((a,b)=>Math.atan2(faces[a.face].center[1],faces[a.face].center[0])-Math.atan2(faces[b.face].center[1],faces[b.face].center[0]));
    targetPieces.sort((a,b)=>Math.atan2(targetFaces[a.face].center[1],targetFaces[a.face].center[0])-Math.atan2(targetFaces[b.face].center[1],targetFaces[b.face].center[0]));
    sourcePieces.forEach((piece,i)=>plan.push({...piece,child,target:targetPieces[i].face,targetBary:targetPieces[i].bary}));
  });
  return plan;
}
function refreshTravelGeometry(t){
  project(t.parent);project(t.child);t.parentFaces=meshFaces(t.entry);t.childFaces=t.child.nodes.map(n=>meshFaces(n));
  t.triangles=t.parent.plan.map(part=>{
    const source=t.parentFaces[part.face],face=t.childFaces[part.child][part.target];
    const target={...face,points:part.targetBary.map(weights=>[0,1,2].map(axis=>weights.reduce((sum,w,j)=>sum+w*face.points[j][axis],0)))};
    const points=part.bary.map(weights=>[0,1,2].map(axis=>weights.reduce((sum,w,j)=>sum+w*source.points[j][axis],0)));
    return{...part,source,target,points};
  });
}
function morphTriangle(t,part,u){
  const move=smooth((u-.2)/.8),cameraMove=smooth(u/.64),scale=1+.65*Math.sin(Math.PI*u);
  const cx=lerp(t.entry.sx,width/2,cameraMove),cy=lerp(t.entry.sy,height*.53,cameraMove);
  const bloom=Math.sin(Math.PI*clamp(u/.78))*.9*t.entry.sr;
  const lift=[part.source.center[0]*bloom,part.source.center[1]*bloom];
  const opened=part.points.map(p=>[cx+(p[0]-t.entry.sx)*scale+lift[0],cy+(p[1]-t.entry.sy)*scale+lift[1],p[2]]);
  return{points:opened.map((p,i)=>pointMix(p,part.target.points[i],move)),z:lerp(part.source.z,part.target.z,move),i:part.target.i,tone:lerp(part.source.i%3,part.target.i%3,move),move,cx,cy,scale,lift};
}
function morphMesh(t,u){return t.triangles.map(part=>({part,face:morphTriangle(t,part,u)})).sort((a,b)=>a.face.z-b.face.z)}
function morphCenters(t,mesh){
  const centers=t.child.nodes.map(()=>({x:0,y:0,count:0}));
  for(const {part,face}of mesh)for(const p of face.points){const c=centers[part.child];c.x+=p[0];c.y+=p[1];c.count++}
  return t.child.nodes.map((n,i)=>({...n,sx:centers[i].x/centers[i].count,sy:centers[i].y/centers[i].count}));
}
function drawMorph(t,u,mesh=morphMesh(t,u)){
  const bounds=t.child.nodes.map(()=>({left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity}));
  for(const {part,face} of mesh)for(const [x,y] of face.points){const box=bounds[part.child];box.left=Math.min(box.left,x);box.right=Math.max(box.right,x);box.top=Math.min(box.top,y);box.bottom=Math.max(box.bottom,y)}
  occupiedNodeBounds.push(...bounds);
  const move=smooth((u-.2)/.8),colorBlend=smooth((u-.23)/.77),edges=smooth((u-.07)/.34);
  const cx=lerp(t.entry.sx,width/2,smooth(u/.64)),cy=lerp(t.entry.sy,height*.53,smooth(u/.64));
  drawGlow(cx,cy,t.entry.sr*(1+.65*Math.sin(Math.PI*u)),t.entry.color,1-move,t.entry.hover);
  for(const n of t.child.nodes)drawGlow(lerp(cx,n.sx,move),lerp(cy,n.sy,move),lerp(t.entry.sr*.35,n.sr,move),n.color,move,n.hover);
  for(const{part,face}of mesh){const n=t.child.nodes[part.child],c=mix(t.entry.color,n.color,colorBlend);paintFace(face,c,lerp(cx,n.sx,move),lerp(cy,n.sy,move),lerp(t.entry.sr*face.scale,n.sr,move),1,edges,lerp(t.entry.hover,n.hover,move))}
  // Original seams remain visible while their surfaces unfold into smaller faces.
  if(edges<1){ctx.save();for(const f of t.parentFaces){const part={source:f,target:f,points:f.points};const transformed=morphTriangle(t,part,u);trianglePath(transformed.points);ctx.lineWidth=.7+clamp((f.z+1)*.5)*.25;ctx.strokeStyle=rgba(t.entry.color,(.15+clamp((f.z+1)*.5)*.4+t.entry.hover*.24)*(1-edges));ctx.stroke()}ctx.restore()}
}
function drawBackground(tint=colors[level.tint],includeSystem=true){
  ctx.fillStyle='#080b10';ctx.fillRect(0,0,width,height);
  const g=ctx.createRadialGradient(width*.51,height*.52,0,width*.51,height*.52,width*.62);g.addColorStop(0,rgba(tint,.036));g.addColorStop(.55,'rgba(16,25,39,.07)');g.addColorStop(1,'rgba(7,9,15,0)');ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
  for(const s of stars){const x=(Math.abs(s.x)*width+parallax.x*s.z*4+Math.sin(clock*.015+s.z)*3+width)%width,y=(Math.abs(s.y)*height+parallax.y*s.z*4+height)%height;ctx.beginPath();ctx.arc(x,y,s.r,0,Math.PI*2);ctx.fillStyle=`rgba(159,190,207,${.07+s.z*.14+Math.sin(clock*.28+s.x*80)*.035})`;ctx.fill()}
  ctx.strokeStyle='rgba(169,202,210,.065)';ctx.lineWidth=.65;for(const[x,y]of[[.23,.34],[.79,.68],[.16,.73],[.72,.32]]){const px=width*x,py=height*y;ctx.beginPath();ctx.moveTo(px-3,py);ctx.lineTo(px+3,py);ctx.moveTo(px,py-3);ctx.lineTo(px,py+3);ctx.stroke()}
  if(includeSystem)renderDistantSystem();
}
function bezier(a,b,t,bend){const mx=(a.sx+b.sx)/2-(b.sy-a.sy)*bend,my=(a.sy+b.sy)/2+(b.sx-a.sx)*bend;return{x:(1-t)**2*a.sx+2*(1-t)*t*mx+t*t*b.sx,y:(1-t)**2*a.sy+2*(1-t)*t*my+t*t*b.sy,mx,my}}
function drawSystemEdges(scene,items,alpha){
  for(let i=0;i<scene.edges.length;i++){
    const[from,to,note]=scene.edges[i],a=items[from],b=items[to],state=system.traces.edge(a.id,b.id),selected=hoverEdge===i||hoverId===a.id||hoverId===b.id;
    const c=state.state==='error'?[240,115,125]:state.state==='active'?colors.cyan:colors.mint,bend=(i%2?1:-1)*.11,p=bezier(a,b,.5,bend);
    ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=rgba(c,state.state==='idle'?(selected?.42:.10):.7);ctx.lineWidth=state.state==='active'||state.state==='error'?1.5:.7;if(note.event)ctx.setLineDash([3,5]);
    ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.quadraticCurveTo(p.mx,p.my,b.sx,b.sy);ctx.stroke();ctx.setLineDash([]);
    const arrow=bezier(a,b,.70,bend),before=bezier(a,b,.68,bend),angle=Math.atan2(arrow.y-before.y,arrow.x-before.x),length=a.miniature?2.5:6;ctx.beginPath();ctx.moveTo(arrow.x-Math.cos(angle-.5)*length,arrow.y-Math.sin(angle-.5)*length);ctx.lineTo(arrow.x,arrow.y);ctx.lineTo(arrow.x-Math.cos(angle+.5)*length,arrow.y-Math.sin(angle+.5)*length);ctx.stroke();
    if(state.state==='active'&&!reduced.matches){const q=bezier(a,b,state.from===b.id?1-state.progress:state.progress,bend);ctx.fillStyle=rgba(c,.95);ctx.shadowColor=rgba(c);ctx.shadowBlur=12;ctx.beginPath();ctx.arc(q.x,q.y,2.4,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}
      if(!a.miniature&&(selected||state.state==='active'||state.state==='error')){ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillStyle=rgba(c,.9);ctx.fillText(state.label||note.label,p.x,p.y-8,width<650?130:220)}
    ctx.restore();
  }
}

function drawEdges(scene,items,alpha=1){
  if(scene.system){drawSystemEdges(scene,items,alpha);return}
  if(alpha<.002)return;
  for(let i=0;i<scene.edges.length;i++){
    const note=scene.edges[i][2];const[a,b]=scene.edges[i].map(j=>items[j]),edgeActive=scene===level&&hoverEdge===i,active=edgeActive||hoverId===a.id||hoverId===b.id,dim=(hoverId||hoverEdge!==null)&&!active?.4:1,bend=(i%2?1:-1)*.085,p=bezier(a,b,.5,bend),c=mix(a.color,b.color,.5),fade=Math.min(1,400/(Math.hypot(a.sx-b.sx,a.sy-b.sy)||1));
    const gradient=ctx.createLinearGradient(a.sx,a.sy,b.sx,b.sy);gradient.addColorStop(0,rgba(a.color,edgeActive?.72:.28));gradient.addColorStop(.5,rgba(c,edgeActive?.55:.12));gradient.addColorStop(1,rgba(b.color,edgeActive?.72:.28));ctx.save();ctx.globalAlpha=clamp(alpha*dim*fade*(active?1.9:1));ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.quadraticCurveTo(p.mx,p.my,b.sx,b.sy);ctx.strokeStyle=gradient;if(note?.related)ctx.setLineDash([2,6]);ctx.lineWidth=edgeActive?1.65:active?1.1:.75;ctx.stroke();
    if(note?.directed){const t=.70,q=bezier(a,b,t,bend),prev=bezier(a,b,t-.035,bend),angle=Math.atan2(q.y-prev.y,q.x-prev.x);ctx.strokeStyle=rgba(c,.66);ctx.beginPath();ctx.moveTo(q.x-Math.cos(angle-.5)*7,q.y-Math.sin(angle-.5)*7);ctx.lineTo(q.x,q.y);ctx.lineTo(q.x-Math.cos(angle+.5)*7,q.y-Math.sin(angle+.5)*7);ctx.stroke();if(alpha>.8){ctx.font=(width<650?'9':'10')+'px sans-serif';ctx.textAlign='center';ctx.fillStyle=rgba(c,active?.95:.57);ctx.fillText(note.label,p.x,p.y-7,width<650?104:200)}}
    if(!a.pending&&!b.pending&&!note?.related&&scene.confidence!=='low'){const q=bezier(a,b,(clock*.055+i*.173)%1,bend),pulse=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,8);pulse.addColorStop(0,rgba(c,.7));pulse.addColorStop(.14,rgba(c,.6));pulse.addColorStop(.4,rgba(c,.15));pulse.addColorStop(1,rgba(c,0));ctx.fillStyle=pulse;ctx.fillRect(q.x-8,q.y-8,16,16)}ctx.restore();
  }
}
function placeTargets(alpha,transform){for(const n of nodes){const projected=transform?{sx:width/2+(n.sx-width/2)*transform.scale+transform.x,sy:height*.53+(n.sy-height*.53)*transform.scale+transform.y,sr:n.sr*transform.scale}:n;const forming=n.formation?formationPhase(performance.now()-n.formation.start,reduced.matches||paused):null;const opacity=alpha*(forming?forming.build:1)*(hoverId&&hoverId!==n.id?.55:1)*(n.ownerGame?(n.ownerGame.status!=='active'?.45:n.ownerGame.turn==='owner'?1:.65):1);n.el.style.transform=`translate(${projected.sx}px,${projected.sy}px) translate(-50%,-50%)`;const size=Math.max(48,projected.sr*2)+'px';if(n.el.style.width!==size)n.el.style.width=n.el.style.height=size;n.el.style.setProperty('--radius',projected.sr+'px');n.el.style.setProperty('--node-label-zoom',level===root?zoom:1);n.el.style.setProperty('--label-gap',(width<650?12:19)*(level===root?zoom:1)+'px');if(forming)n.el.disabled=!forming.done;n.el.style.opacity=opacity;n.el.style.visibility=opacity<.02?'hidden':'visible';const half=(width<650?82:115)*(level===root?zoom:1);placeChatUnderlay(n.el,{left:projected.sx-Math.max(half,projected.sr),right:projected.sx+Math.max(half,projected.sr),top:projected.sy-projected.sr,bottom:projected.sy+projected.sr+(width<650?60:80)*(level===root?zoom:1)})}}
function entryTransform(entry,u){const move=smooth(u/.5);return{scale:1+.6*move,x:(width/2-entry.sx)*move,y:(height*.53-entry.sy)*move}}
function drawChessWorld(now){
  const reveal=system.chess.progress(now),mobile=document.body.classList.contains('mobile-chess');
  if(!chessJourney){drawBackground();return}
  const journey=chessJourney;
  if(!journey.snapshot){
    // Capture once, excluding the system window. Its renderer stays live above
    // this frozen backdrop. Blur is prepared once, never animated per frame.
    project({level,nodes,camera:camera()});drawBackground(undefined,false);drawEdges(level,nodes);for(const n of nodes)drawNode(n);
    journey.snapshot=document.createElement('canvas');journey.snapshot.width=width;journey.snapshot.height=height;journey.snapshot.getContext('2d').drawImage(canvas,0,0,width,height);
    journey.soft=document.createElement('canvas');journey.soft.width=width;journey.soft.height=height;const layer=journey.soft.getContext('2d');layer.filter='blur(3px)';layer.drawImage(journey.snapshot,0,0);
  }
  drawBackground(undefined,false);
  const alpha=1-reveal*(mobile?1:.88),transform=entryTransform({sx:journey.source.x,sy:journey.source.y},reduced.matches?0:reveal);
  if(alpha>.001){ctx.save();ctx.translate(width/2+transform.x,height*.53+transform.y);ctx.scale(transform.scale,transform.scale);ctx.translate(-width/2,-height*.53);ctx.globalAlpha=alpha*(1-reveal);ctx.drawImage(journey.snapshot,0,0,width,height);ctx.globalAlpha=alpha*reveal;ctx.drawImage(journey.soft,0,0,width,height);ctx.restore()}
  placeTargets(alpha,transform);
  document.body.style.setProperty('--chess-world-reveal',String(reveal));
}
function renderTravel(now){
  const t=travel,p=clamp((now-t.start)/t.duration),u=t.kind==='in'?easeOut(p):1-easeOut(p);
  if(p>=.55&&!t.switched)switchLevel();
  drawBackground(mix(colors[t.parent.level.tint],colors[t.child.level.tint],smooth(u)));
  if(reduced.matches){const state=t.switched?(t.kind==='in'?t.child:t.parent):(t.kind==='in'?t.parent:t.child),alpha=t.switched?smooth((p-.55)/.45):1-smooth(p/.55);drawEdges(state.level,state.nodes,alpha);for(const n of state.nodes)drawNode(n,alpha);placeTargets(alpha)}
  else{
    const parentAlpha=1-smooth(u/.42),childAlpha=smooth((u-.56)/.44);
    const {scale,x:moveX,y:moveY}=entryTransform(t.entry,u);
    const parentBackdrop=t.parent.nodes.map(n=>({...n,sx:width/2+(n.sx-width/2)*scale+moveX,sy:height*.53+(n.sy-height*.53)*scale+moveY,sr:n.sr*scale}));
    drawEdges(t.parent.level,parentBackdrop,parentAlpha);
    for(const n of parentBackdrop)if(n.id!==t.entry.id)drawNode(n,parentAlpha);
    const mesh=morphMesh(t,u);
    drawEdges(t.child.level,morphCenters(t,mesh),childAlpha);
    drawMorph(t,u,mesh);
    placeTargets(t.switched?smooth((p-.78)/.22):1-smooth(p/.17));
  }
  if(p>=1)finishTravel();
}
let hoverEdge=null, panelOpen=false, speech=null, pendingSpeech=null;
const panelWorld={x:0,y:0};let panelDrag=null;
function panelProjection(){return{x:width/2+panelWorld.x*zoom+pan.x+parallax.x*6,y:height*.53+panelWorld.y*zoom+pan.y+parallax.y*6}}
function anchorPanel(x,y){panelWorld.x=(x-width/2-pan.x-parallax.x*6)/zoom;panelWorld.y=(y-height*.53-pan.y-parallax.y*6)/zoom}
function placePanel(){if(!panelOpen)return;if(document.body.classList.contains('chess-chat-open'))return;if(pinnedAgent){anchorPanel(pinnedAgent.x,pinnedAgent.y);$('companion-panel').style.transform=`translate(${pinnedAgent.x}px,${pinnedAgent.y}px) scale(1)`;return}const p=panelProjection();$('companion-panel').style.transform=`translate(${p.x}px,${p.y}px) scale(${zoom})`}

function say(title,text,key='context',duration=8500){
  if(!text)return;pendingSpeech=null;
  speech={title,text,key,expires:duration?performance.now()+duration:Infinity};
  $('speech-title').textContent=title;$('speech-text').textContent=text;
  $('panel-context').textContent=title;$('panel-message').textContent=text;
}
function queueSpeech(title,text,key){
  if(speech?.key===key){speech.expires=Infinity;pendingSpeech=null;return}
  if(pendingSpeech?.key!==key)pendingSpeech={title,text,key,at:performance.now()+180};
}
function releaseSpeech(prefix){
  if(pendingSpeech?.key.startsWith(prefix))pendingSpeech=null;
  if(speech?.key.startsWith(prefix))speech.expires=performance.now()+1700;
}
function openPanel(keyboard=false){
  if(system.chess?.isOpen()&&width<=900)return;

  if(system.chess?.isOpen()&&!document.body.classList.contains('chess-chat-open')){system.chess.closeForNavigation?.(()=>openPanel(keyboard));return}
  if(panelOpen){closePanel(keyboard);return}
  panelOpen=true;anchorPanel(width<650?Math.max(16,(width-320)/2):Math.max(30,width-662),Math.max(100,Math.min(height*.27,height-615)));placePanel();companion.locked=true;companion.keyboard=keyboard;
  $('companion-panel').hidden=false;$('speech-bubble').hidden=true;
  $('companion-target').setAttribute('aria-expanded','true');$('companion-target').setAttribute('aria-label',t('guide.close'));
  if(!speech)say(level.title,level.intro,'level');
  $('close-panel').focus({preventScroll:true});
}
function closePanel(keyboard=false){
  panelOpen=false;pinnedAgent=null;document.body.classList.remove('generated-camera-focused');$('companion-panel').hidden=true;
  $('companion-target').setAttribute('aria-expanded','false');$('companion-target').setAttribute('aria-label',t('guide.open'));
  companion.locked=keyboard;companion.keyboard=keyboard;
  if(keyboard)$('companion-target').focus({preventScroll:true});
}
function renderGuide(){
  const now=performance.now();if(pendingSpeech&&now>=pendingSpeech.at){const p=pendingSpeech;say(p.title,p.text,p.key,0)}
  const bubble=$('speech-bubble');bubble.hidden=panelOpen||livePanelOpen||!!chatMorph||!speech||now>speech.expires;
  if(bubble.hidden)return;
  const bw=bubble.offsetWidth||270,bh=bubble.offsetHeight||140,orbR=width<650?18:24;
  const left=clamp(companion.x-bw*.6,16,Math.max(16,width-bw-16));
  let top=companion.y-orbR-20-bh,below=top<90;
  if(below)top=companion.y+orbR+20;
  top=clamp(top,14,Math.max(14,height-bh-20));
  bubble.style.transform=`translate(${left}px,${top}px)`;bubble.style.setProperty('--tail-x',clamp(companion.x-left-7,18,bw-30)+'px');bubble.classList.toggle('tail-top',below);
}
function edgeLabel(i){const edge=level.edges[i];return edge[2]?.label||t('nav.pair',{from:nodes[edge[0]].name,to:nodes[edge[1]].name})}
function setEdgeHover(index){
  if(travel||systemTravel)return;if(hoverEdge===index)return;hoverEdge=index;
  const note=index===null?null:level.edges[index][2];
  if(note?.text){queueSpeech(note.label,note.text,'edge:'+level.title+':'+index);$('instruction-text').textContent=t('nav.edgeHint')}
  else releaseSpeech('edge:');
  canvas.style.cursor=index===null?'default':'pointer';
}
function hitEdge(x,y){
  if(travel||systemTravel||nodes.some(n=>Math.hypot(x-n.sx,y-n.sy)<n.sr+14))return null;
  let found=null,best=companion.touch?19:10;
  for(let i=0;i<level.edges.length;i++){
    const[a,b]=level.edges[i].map(j=>nodes[j]),bend=(i%2?1:-1)*.085;
    let prev=bezier(a,b,0,bend);
    for(let s=1;s<=28;s++){const p=bezier(a,b,s/28,bend),dx=p.x-prev.x,dy=p.y-prev.y,len=dx*dx+dy*dy,t=len?clamp(((x-prev.x)*dx+(y-prev.y)*dy)/len):0,d=Math.hypot(x-prev.x-t*dx,y-prev.y-t*dy);if(d<best){best=d;found=i}prev=p}
  }
  return found;
}
function bindEdges(){
  const target=$('edge-targets');target.replaceChildren();target.inert=!!travel;
  level.edges.forEach((edge,i)=>{if(!edge[2]?.text)return;const button=document.createElement('button');button.textContent=t('nav.explain',{text:edgeLabel(i)});button.addEventListener('focus',()=>setEdgeHover(i));button.addEventListener('blur',()=>setEdgeHover(null));button.addEventListener('click',()=>{setEdgeHover(i);say(edge[2].label,edge[2].text,'edge:'+level.title+':'+i,0)});target.append(button)});
}
$('companion-target').addEventListener('pointerenter',()=>{companion.locked=true});
$('companion-target').addEventListener('focus',()=>{companion.locked=true;companion.keyboard=true});
$('companion-target').addEventListener('blur',()=>{companion.keyboard=false;if(!panelOpen)companion.locked=false});
$('companion-target').addEventListener('click',e=>openPanel(e.detail===0));
$('close-panel').addEventListener('click',e=>closePanel(e.detail===0));

function drawCompanion(dt){
  const radius=width<650?18:24,margin=radius+12;
  let tx=companion.present?companion.tx+38:width*.82,ty=companion.present?companion.ty+43:height*.69;
  const selected=nodes.find(n=>n.id===hoverId);
  if(selected&&!travel){const dx=tx-selected.sx,dy=ty-selected.sy,d=Math.hypot(dx,dy)||1,min=selected.sr+radius+24;if(d<min){tx=selected.sx+dx/d*min;ty=selected.sy+dy/d*min}}
  tx=clamp(tx,margin,width-margin);ty=clamp(ty,margin,height-margin);
  if(panelOpen){const bounds=$('companion-panel').getBoundingClientRect();const dockX=clamp(bounds.left-radius-18,margin,width-margin),dockY=clamp(bounds.top+32,margin,height-margin),ease=reduced.matches?1:1-Math.exp(-dt*.18);companion.x=lerp(companion.x,dockX,ease);companion.y=lerp(companion.y,dockY,ease)}
  const chess=chessTarget&&!chessTarget.hidden?chessOrbit():null,shape=chessFootprint(),chessBox=chess?satelliteBox({x:chess.sx,y:chess.sy},{left:shape.left*zoom,right:shape.right*zoom,top:shape.top*zoom,bottom:shape.bottom*zoom}):null;
  const obstacles=[...fixedObstacles(),...(chessBox?[chessBox]:[]),...nodes.filter(node=>Number.isFinite(node.sx)).map(node=>({left:node.sx-node.sr-6,right:node.sx+node.sr+6,top:node.sy-node.sr-6,bottom:node.sy+node.sr+6}))],reach=radius+14;
  const blocked=obstacles.some(box=>companion.x+reach>box.left&&companion.x-reach<box.right&&companion.y+reach>box.top&&companion.y-reach<box.bottom);
  if((!paused&&!reduced.matches||blocked)&&!companion.locked&&!panelOpen){
    const ease=paused||reduced.matches?1:1-Math.exp(-dt*.055);
    if(chatPosition&&!livePanelOpen&&!chatMorph){
      obstacles.push(satelliteBox(chatPosition,satelliteFootprint(width<650?17:21,chatPosition.caption)));
      if(chatPosition.bubble&&previewTimer.visible)obstacles.push(satelliteBox(chatPosition,chatPosition.bubble));
    }
    const position=placeSatellite({width,height,obstacles,preferred:{x:tx,y:ty},previous:{x:companion.x,y:companion.y},footprint:{left:-reach,right:reach,top:-reach,bottom:reach},ease});
    if(position){companion.x=position.x;companion.y=position.y}
  }
  // A small delay and gaze keep the character alive without replacing the cursor.
  const bob=paused||reduced.matches||companion.locked||panelOpen?0:Math.sin(clock*1.8)*2;
  const reveal=system.chess?.progress?.()||0;
  const orb={type:'orb',seed:.8,color:colors.mint,hover:.18,sx:lerp(companion.x,width*(width<650?.5:.16),reveal),sy:lerp(companion.y+bob,height*(width<650?.24:.82),reveal),sr:lerp(radius,width<650?14:20,reveal)};
  drawNode(orb,.94,false);
  const gazeX=clamp((companion.tx-companion.x)*.04,-2.4,2.4),gazeY=clamp((companion.ty-companion.y)*.04,-2,2);
  const blink=paused||reduced.matches?1:1-Math.pow(Math.max(0,Math.cos(clock*1.1)),48)*.85;
  ctx.save();ctx.strokeStyle='rgba(227,255,246,.91)';ctx.lineWidth=2;ctx.lineCap='round';
  for(const eye of[-1,1]){const x=orb.sx+eye*radius*.23+gazeX,y=orb.sy+gazeY;ctx.beginPath();ctx.moveTo(x,y-1.6*blink);ctx.lineTo(x,y+1.6*blink);ctx.stroke()}ctx.restore();
  const hitSize=width<650?52:62;$('companion-target').style.transform=`translate(${orb.sx-hitSize/2}px,${orb.sy-hitSize/2}px)`;placeChatUnderlay($('companion-target'),{left:orb.sx-hitSize/2,right:orb.sx+hitSize/2,top:orb.sy-hitSize/2,bottom:orb.sy+hitSize/2});
}
function drawChatSatellite(now){
  const position=positionChat(now);
  if(livePanelOpen||chatMorph){chatTarget.hidden=true;return}
  if(!position){chatTarget.hidden=true;return}
  const {x,y,r:radius}=chatOrbit();chatTarget.hidden=false;
  const glow=liveUnread?1:.2;
  drawNode({type:'ico',seed:4.9,color:colors.rose,hover:glow,weightTier:liveUnread?2:1,sx:x,sy:y,sr:radius},.96,false);

  chatTarget.style.transform=`translate(${x-radius-8}px,${y-radius-8}px)`;
  if(morphCanvas&&!morphCanvas.hidden)morphCanvas.hidden=true;
}
let renderedChatProgress=-1;
function render(now){
  const dockProgress=chessChatProgress(now);
  if(Math.abs(dockProgress-renderedChatProgress)>.00001){renderedChatProgress=dockProgress;document.body.style.setProperty('--chess-chat-progress',dockProgress);if(typeof dispatchEvent==='function')dispatchEvent(new Event('nexo:chat-layout')); }
  frameId=null;
  if(disposed||document.hidden)return;
  gestures.flush();
  const obscured=(document.querySelectorAll?.('.welcome-overlay:not([hidden]), .access-overlay:not([hidden]), .account-overlay:not([hidden])')||[]).length>0;
  const restingChess=system.chess?.isOpen()&&!system.chess?.isAnimating?.();
  const interval=obscured||restingChess?1000/MOTION.idleFps:0;
  const cadence=interval?'30':'60';if(document.body.dataset.canvasFps!==cadence)document.body.dataset.canvasFps=cadence;
  if(now-lastPaint<interval-.5){frameId=requestAnimationFrame(render);return}
  lastPaint=now;
  if(pendingOwner&&!travel&&!systemTravel){const next=pendingOwner;pendingOwner=null;setOwnerGames(...next)}
  syncOwnerPagination();
  if(disposed)return;
  occupiedNodeBounds=[];occupiedMediaBounds=[];
  const elapsed=Math.max(0,now-last),dt=Math.min(elapsed/16.667||1,2.5);last=now;
  if(travel||systemTravel)for(const state of formingRuns.values())if(state.nodeId===generatedRequest?.id)state.start+=elapsed;
  if(!paused&&!document.hidden&&!travel)clock+=dt/60;
  system.traces.tick();system.portal.render();advanceGeneratedFocus(now);
  if(document.body.classList.contains('mobile-chess')){
    drawChessWorld(now);system.chess?.render?.(ctx,now,{zoom,pan,paused});
    if(!document.body.classList.contains('mobile-system-expanded'))renderDistantSystem();
    if(document.body.classList.contains('mobile-system-expanded'))renderDistantSystem(true);
    frameId=requestAnimationFrame(render);return;
  }
  if(chessJourney&&system.chess?.isOpen()){drawChessWorld(now);system.chess.render(ctx,now,{zoom,pan,paused,systemBounds:systemFrame()});renderDistantSystem();placePanel();drawChatSatellite(now);frameId=requestAnimationFrame(render);return}
  if(systemTravel)renderSystemTravel(now);else if(travel)renderTravel(now);
  else{
    if(!system.chess?.isOpen()){parallax.x=lerp(parallax.x,reduced.matches?0:pointer.x,.035*dt);parallax.y=lerp(parallax.y,reduced.matches?0:pointer.y,.035*dt)}zoom=lerp(zoom,targetZoom,.1*dt);physics(dt);
    for(const n of nodes)n.hover=lerp(n.hover,(hoverId===n.id||n.active)&&!n.disabled?1:0,.09*dt);
    project({level,nodes,camera:camera()});
    const chessReveal=system.chess?.progress?.(now)||0;
    if(chessReveal&&level===root){const points=width<650?[[.12,.28],[.88,.28],[.91,.70],[.77,.83],[.09,.70]]:[[.18,.34],[.72,.20],[.91,.76],[.78,.78],[.10,.68]];nodes.forEach((n,i)=>{if(!points[i])return;const[x,y]=points[i];n.sx=lerp(n.sx,width/2+(width*x-width/2)*zoom+pan.x,chessReveal);n.sy=lerp(n.sy,height*.53+(height*y-height*.53)*zoom+pan.y,chessReveal);n.sr*=lerp(1,width<650?.38:.43,chessReveal)})}
    drawBackground();drawEdges(level,nodes,1-chessReveal*.7);
    for(const n of[...nodes].sort((a,b)=>a.r-b.r))drawNode(n,(hoverId&&hoverId!==n.id?.55:1)*(1-chessReveal*.25));
    placeTargets(1);
  }
  drawFormations(now);drawGeneratedPulse(now);placePanel();drawCompanion(dt);drawChessSatellite();renderGuide();system.chess?.render?.(ctx,now,{zoom,pan,paused,systemBounds:!level.system?distantSystemBounds():undefined});renderMedia(now);drawChatSatellite(now);drawLiveMorph(now);frameId=requestAnimationFrame(render);
}
function setPaused(value){paused=value;$('pause').setAttribute('aria-pressed',String(value));$('pause').setAttribute('aria-label',value?t('motion.resume'):t('motion.pause'));$('pause').title=value?t('motion.resume'):t('motion.pause');$('pause').innerHTML=icon(value?'play':'pause');$('motion-status').textContent=value?t('motion.paused'):t('motion.running');document.querySelector('.live-dot').style.background=value?'#7d8790':'var(--mint)'}
function changeZoom(amount){if(travel||systemTravel)return;targetZoom=clampZoom(targetZoom+amount);syncZoomUI()}
$('pause').addEventListener('click',()=>setPaused(!paused));$('back').addEventListener('click',goBack);$('zoom-in').addEventListener('click',()=>changeZoom(.1));$('zoom-out').addEventListener('click',()=>changeZoom(-.1));
$('reset').addEventListener('click',()=>{if(travel||systemTravel)return;pan={x:0,y:0};if(panelOpen){panelWorld.x=(width<650?24:width-366)-width/2;panelWorld.y=Math.max(100,height*.32)-height*.53}targetZoom=1;changeZoom(0)});
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();if(travel||systemTravel)return;if(level.system){exitSystem();return}if(stack.length)goBackTo(0);else{pan={x:0,y:0};targetZoom=1;changeZoom(0)}});
function trackPointer(e){if(system.chess?.isOpen()||e.target?.closest?.('.live-panel, .chat-glass'))return;if(e.target?.closest?.('.floating-live-chat, .media-window, .media-viewer')){companion.locked=true;return}pointer={x:(e.clientX/width-.5)*2,y:(e.clientY/height-.5)*2};companion.tx=e.clientX;companion.ty=e.clientY;companion.present=true;companion.touch=e.pointerType==='touch';const d=Math.hypot(e.clientX-companion.x,e.clientY-companion.y),r=width<650?18:24;companion.keyboard=false;if(!panelOpen){if(d<r+15)companion.locked=true;else if(d>r+52)companion.locked=false}}
addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;trackPointer(e);if(drag&&!travel&&!systemTravel){pan.x=clamp(drag.px+e.clientX-drag.x,Math.min(-width*.5,drag.px-width*.5),Math.max(width*.5,drag.px+width*.5));pan.y=clamp(drag.py+e.clientY-drag.y,Math.min(-height*.4,drag.py-height*.4),Math.max(height*.4,drag.py+height*.4))}else if(e.target===canvas&&!travel)setEdgeHover(hitEdge(e.clientX,e.clientY));else if(!travel)setEdgeHover(null)});
addEventListener('pointerdown',trackPointer);
canvas.addEventListener('contextmenu',event=>event.preventDefault());
const cancelFocusInput=()=>{if(generatedRequest||generatedFocus)cancelGeneratedFocus()};
addEventListener('pointerdown',cancelFocusInput,{capture:true});addEventListener('wheel',cancelFocusInput,{capture:true,passive:true});addEventListener('keydown',cancelFocusInput,{capture:true});document.addEventListener('click',cancelFocusInput,{capture:true});
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||system.chess?.isOpen()||travel||systemTravel)return;const edge=hitEdge(e.clientX,e.clientY);if(edge!==null){setEdgeHover(edge);const note=level.edges[edge][2];if(note?.text)say(note.label,note.text,'edge:'+level.title+':'+edge,10000);return}drag={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';setHover(null);setEdgeHover(null)});
const gestures=createCameraGestures({root:document,canvas,eligible:target=>target===canvas||!!target?.closest?.('#node-targets, .floating-chess'),enabled:()=>!travel&&!systemTravel&&!system.chess?.isOpen()&&!document.querySelector?.('.welcome-overlay:not([hidden]), .access-overlay:not([hidden]), .account-overlay:not([hidden])'),read:()=>({...camera(),center:{x:width/2,y:height*.53}}),apply:view=>{zoom=targetZoom=view.zoom;pan={...view.pan};syncZoomUI()},onStart:()=>{drag=null;cancelGeneratedFocus();setHover(null);setEdgeHover(null)}});
canvas.addEventListener('click',e=>{if(e.pointerType!=='touch'||system.chess?.isOpen()||travel||systemTravel)return;const edge=hitEdge(e.clientX,e.clientY);if(edge!==null){const note=level.edges[edge][2];if(note?.text)say(note.label,note.text,'edge:'+level.title+':'+edge,10000)}});
const endDrag=()=>{gestures.cancel();drag=null;canvas.style.cursor='default'};canvas.addEventListener('pointerup',e=>{if(e.pointerType!=='touch')endDrag()});canvas.addEventListener('pointercancel',e=>{if(e.pointerType!=='touch')endDrag()});canvas.addEventListener('lostpointercapture',e=>{if(e.pointerType!=='touch')endDrag()});
document.addEventListener('mouseleave',()=>{pointer={x:0,y:0};companion.present=false});addEventListener('blur',()=>{endDrag();panelDrag=null;companion.present=false});
canvas.addEventListener('wheel',e=>{e.preventDefault();changeZoom(-Math.sign(e.deltaY)*.05)},{passive:false});
addEventListener('keydown',e=>{if(system.media?.isOpen()||system.chess?.isOpen())return;if(e.key==='Escape'){if(system.onEscape?.())return;e.preventDefault();if(panelOpen){closePanel(true);return}if(!$('content-card').hidden){closeContent();return}navigationQueue=[];returnTarget=null;goBack()}if(e.target.closest('button,a,input,textarea,[contenteditable]'))return;if(e.code==='Space'){e.preventDefault();setPaused(!paused)}if(e.key==='+'||e.key==='=')changeZoom(.1);if(e.key==='-')changeZoom(-.1)});
addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{
  const now=performance.now();
  if(document.hidden){hiddenAt=now;if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(frameId);frameId=null;return}
  const since=hiddenAt,elapsed=hiddenAt?now-hiddenAt:0;hiddenAt=0;last=now;lastPaint=0;
  for(const state of formingRuns.values())state.start=resumeStart(state.start,since,now);
  if(generatedFocus)generatedFocus.start=resumeStart(generatedFocus.start,since,now);if(generatedPulse)generatedPulse.start=resumeStart(generatedPulse.start,since,now);
  if(travel)travel.start=resumeStart(travel.start,since,now);if(systemTravel)systemTravel.start=resumeStart(systemTravel.start,since,now);if(chatMorph)chatMorph.start=resumeStart(chatMorph.start,since,now);
  system.chess?.pauseFor?.(elapsed,since);if(frameId===null&&!disposed)frameId=requestAnimationFrame(render);
});reduced.addEventListener('change',e=>setPaused(e.matches));
function ageValue(item,today=new Date()){
  if(!item.computed_age_from)return item.value;
  const [year,month,day]=item.computed_age_from.split('-').map(Number);
  let age=today.getFullYear()-year;if(today.getMonth()+1<month||(today.getMonth()+1===month&&today.getDate()<day))age--;
  return t('content.age',{age});
}
function addText(target,tag,text,className){const element=document.createElement(tag);element.textContent=text;if(className)element.className=className;target.append(element);return element}
function addFacts(target,items){const list=document.createElement('dl');list.className='facts-list';for(const item of items){addText(list,'dt',item.label);addText(list,'dd',ageValue(item))}target.append(list)}
function renderSceneFacts(){
  const facts=$('scene-facts'),highlights=$('scene-highlights');facts.replaceChildren();highlights.replaceChildren();
  const record=level.record;if(!record)return;
  if(record.content?.items)for(const item of record.content.items)addText(facts,'span',item.label+': '+ageValue(item));
  if(record.content?.body&&level.architecture)addText(facts,'p',record.content.body);
  for(const metric of record.content?.highlights||[])addText(highlights,'span',metric);
}
function showContent(node){
  openContentNode=node;
  if(node.generated){showGenerated(node);return}
  const record=node.record,body=$('content-body');body.replaceChildren();$('content-title').textContent=node.name;
  if(record&&!node.component&&!orderedChildren(record.id).length)system.media?.setNode(record,node.color);
  if(node.component){addText(body,'span',node.component.tech,'panel-context');addText(body,'p',node.description)}
  else if(record){
    if(record.type==='live_chat'){addText(body,'p',record.content.intro);addText(body,'span',t('chat.future'),'content-status');$('content-card').hidden=false;return}
    if(record.status)addText(body,'span',statuses[record.status],'content-status');
    if(record.status!=='en_construccion'){
      if(record.content?.body)addText(body,'p',record.content.body);
      if(record.content?.items)addFacts(body,record.content.items);
      if(record.type==='contact'){
        const contact=record.content,action=addText(body,contact.action==='open_new_tab'?'a':'button',contact.display,'contact-action');
        if(contact.action==='open_new_tab'){action.href=contact.href;action.target='_blank';action.rel='noopener noreferrer'}
        else action.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(contact.value);$('announcement').textContent=t('common.copied');feedback.textContent=t('common.copied');setTimeout(()=>{feedback.textContent=t('content.copy')},1800)}catch{feedback.textContent=t('content.select')}});
        const feedback=addText(body,'p',contact.action==='copy'?t('content.copy'):t('content.newTab'),'contact-feedback');
      }
      for(const id of record.links||[]){const relation=addText(body,'button',t('nav.explore',{name:records.get(id).label}),'related-action');relation.addEventListener('click',()=>navigateTo(id))}
    }
  }
  $('content-card').hidden=false;
}
function navigateTo(id){
  if(travel||!records.has(id))return;
  const path=[];let record=records.get(id);while(record){path.unshift(record.id);record=records.get(record.parent)}
  const current=stack.map(state=>state.entryId);let common=0;while(common<current.length&&common<path.length&&current[common]===path[common])common++;navigationQueue=path.slice(common);$('content-card').hidden=true;
  if(stack.length>common){returnTarget=common;goBack()}else if(navigationQueue.length)continueNavigation();else{navigationComplete?.(true);navigationComplete=null}
}
function continueNavigation(){const id=navigationQueue.shift(),next=nodes.find(n=>n.id===id&&!n.reference);if(!next){navigationQueue=[];navigationComplete?.(false);navigationComplete=null;return}activate(next,false);if(!travel&&!systemTravel&&!navigationQueue.length){navigationComplete?.(true);navigationComplete=null}}
$('close-content').addEventListener('click',closeContent);
const handle=$('panel-handle');
handle.addEventListener('pointerdown',event=>{
  if(event.button!==undefined&&event.button!==0)return;
  event.preventDefault();event.stopPropagation();pinnedAgent=null;document.body.classList.remove('generated-camera-focused');const position=panelProjection();
  panelDrag={id:event.pointerId,x:event.clientX,y:event.clientY,px:position.x,py:position.y};handle.setPointerCapture(event.pointerId);handle.focus({preventScroll:true});
});
handle.addEventListener('pointermove',event=>{if(!panelDrag||panelDrag.id!==event.pointerId)return;anchorPanel(panelDrag.px+event.clientX-panelDrag.x,panelDrag.py+event.clientY-panelDrag.y);placePanel()});
const stopPanelDrag=()=>{panelDrag=null};handle.addEventListener('pointerup',stopPanelDrag);handle.addEventListener('pointercancel',stopPanelDrag);handle.addEventListener('lostpointercapture',stopPanelDrag);
handle.addEventListener('keydown',event=>{const step=event.shiftKey?30:10,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];if(!delta)return;event.preventDefault();event.stopPropagation();panelWorld.x+=delta[0]/zoom;panelWorld.y+=delta[1]/zoom;placePanel()});


// Relabel the existing scene objects. Geometry, camera, travel endpoints and
// open panel state keep their identity throughout a locale change.
function refreshLanguage(){
  syncFocusControls();
  fixedCache=null;
  ownerScene.title=t('owner.games');ownerScene.description=ownerScene.intro=ownerKnownGames.some(g=>g.status==='active')?t('owner.description'):t('owner.empty');
  syncOwnerPagination();
  const seen=new Set();
  const relabel=node=>{
    if(!node||seen.has(node))return;seen.add(node);
    if(node.privatePanel){node.name=t('owner.panel');node.meta=t('owner.games');node.description=t('owner.description')}
    if(node.ownerGame){node.meta=ownerMeta(node.ownerGame)}
    if(node.privateEmpty){node.name=t('owner.empty')}
    if(node.generated){node.meta=t('generated.badge');return}
    const record=node.record,component=node.component;
    if(component){
      node.name=component.label;node.meta=component.tech;
      const contribution=component.contribution||record?.architecture?.contribution;
      node.description=node.system?component.what+(contribution?t('content.contribution',{text:contribution}):''):t('content.what',{tech:component.tech,what:component.what,contribution:contribution?t('content.contribution',{text:contribution}):''});
    }else if(record){
      node.name=record.label;node.meta=node.reference?t('nav.related'):record.content?.display||statuses[record.status]||record.tagline||'';
      node.description=record.status==='en_construccion'?statuses[record.status]:record.summary||record.content?.body||'';
    }
    if(node.el){
      const title=node.el.querySelector('.node-name');if(title){const number=title.querySelector('.node-index');title.replaceChildren(...(number?[number]:[]),document.createTextNode(node.name))}
      const meta=node.el.querySelector('.node-meta');if(meta)meta.textContent=node.meta;
      node.el.setAttribute('aria-label',node.name+(node.ownerGame?' · '+node.meta:'')+(node.disabled?t('nav.buildingSuffix'):node.reference?t('nav.relatedSuffix'):node.children?t('nav.exploreSuffix'):t('nav.detailsSuffix')));
    }
  };
  ownerScene.nodes.forEach(relabel);
  for(const scene of scenes.values()){
    if(scene===root){scene.title=portfolio.root.title;scene.description=portfolio.root.subtitle;scene.intro=t('guide.welcome')}
    else if(scene.record){scene.title=scene.record.label;scene.description=scene.record.summary||'';scene.intro=scene.description}
    scene.nodes.forEach(relabel);
    if(scene.record?.architecture)for(const [from,to,note] of scene.edges){
      const edge=scene.record.architecture.connections.find(edge=>edge.from===scene.nodes[from].id&&edge.to===scene.nodes[to].id);
      if(edge&&note){note.label=edge.label;note.text=scene.nodes[from].name+' →︎ '+scene.nodes[to].name+': '+edge.label+'.'}
    }
  }
  systemScene.title=t('system.title');systemScene.description=t('system.description');systemScene.intro=t('system.intro');
  systemScene.nodes.forEach(relabel);systemPopulation.forEach(relabel);
  systemScene.edges.forEach((edge,i)=>{edge[2].label=system.architecture.edges[i].label;edge[2].text=edge[2].label});
  const states=[...stack,travel?.parent,travel?.child,systemReturn,...(systemReturn?.stack||[]),systemTravel?.state];
  for(const state of states)state?.nodes?.forEach(relabel);nodes.forEach(relabel);relabel(openContentNode);
  for(const bubble of [speech,pendingSpeech])if(bubble){
    const node=nodes.find(node=>bubble.key?.endsWith(':'+node.id));
    const edge=bubble.key?.startsWith('edge:')?level.edges[Number(bubble.key.split(':').at(-1))]?.[2]:null;
    if(node){bubble.title=node.name;bubble.text=node.description}
    else if(edge){bubble.title=edge.label;bubble.text=edge.text}
    else if(bubble.key==='welcome'||bubble.key==='level'){bubble.title=bubble.key==='welcome'?t('guide.journey'):level.title;bubble.text=level.intro}
    else{bubble.title=translateText(bubble.title);bubble.text=translateText(bubble.text)}
  }
  if(speech){$('speech-title').textContent=speech.title;$('speech-text').textContent=speech.text;$('panel-context').textContent=speech.title;$('panel-message').textContent=speech.text}
  updateUI();
  if(openContentNode&&!$('content-card').hidden)showContent(openContentNode);
  // Preserve focus on node/edge buttons while replacing their descriptions.
  let edgeIndex=0;for(const element of $('edge-targets').children){const edge=level.edges.filter(edge=>edge[2]?.text)[edgeIndex++];if(edge)element.textContent=t('nav.explain',{text:edge[2].label})}
  Array.from(flowLegend.children).slice(1).forEach((item,i)=>{const flow=system.architecture.flows[i];if(flow){item.querySelector('summary').textContent=flow.label;item.querySelector('p').textContent=flow.description}});
  $('companion-target').setAttribute('aria-label',panelOpen?t('guide.close'):t('guide.open'));
  const hovered=nodes.find(node=>node.id===hoverId);$('instruction-text').textContent=hovered?(hovered.disabled?t('nav.pending'):hovered.children?t('nav.enter',{name:hovered.name}):hovered.reference?t('nav.relatedHint'):t('nav.detailsHint')):hoverEdge!==null?t('nav.edgeHint'):t('nav.instruction');
  syncGenerated();setPaused(paused);translateUI();measureSystemHeader();
}


// Private scene objects are client-only, outside the public records/ids map.
const ownerScene={id:'private_owner_games',title:t('owner.games'),description:t('owner.description'),intro:t('owner.description'),tint:'mint',privateOwner:true,nodes:[],edges:[]};
const ownerPageSize=()=>width<650?4:6;
let ownerSignature='',pendingOwner=null,ownerPage=0,ownerKnownGames=[],ownerMode=false;
const ownerPagination=document.createElement('div');ownerPagination.className='owner-pagination';ownerPagination.hidden=true;
const ownerPrevious=document.createElement('button'),ownerNext=document.createElement('button'),ownerPageLabel=document.createElement('span');ownerPrevious.type=ownerNext.type='button';
ownerPrevious.onclick=()=>{ownerPage--;ownerSignature='';setOwnerGames(ownerMode,ownerKnownGames)};ownerNext.onclick=()=>{ownerPage++;ownerSignature='';setOwnerGames(ownerMode,ownerKnownGames)};
ownerPagination.append(ownerPrevious,ownerPageLabel,ownerNext);document.body.append(ownerPagination);
function syncOwnerPagination(){
  ownerPagination.hidden=!level.privateOwner||ownerKnownGames.length<=ownerPageSize()||!!travel||!!systemTravel||system.chess?.isOpen();
  ownerPrevious.textContent=t('owner.previous');ownerNext.textContent=t('owner.next');ownerPrevious.disabled=ownerPage<=0;ownerNext.disabled=(ownerPage+1)*ownerPageSize()>=ownerKnownGames.length;
  ownerPageLabel.textContent=t('owner.page',{page:ownerPage+1,total:Math.max(1,Math.ceil(ownerKnownGames.length/ownerPageSize()))});
}
function ownerMeta(game){return t('owner.gameMeta',{moves:game.moves.length,state:t(game.status!=='active'?'owner.finished':game.turn==='owner'?'owner.youPlay':'owner.waiting')})}
function setOwnerGames(owner,games){
  if(disposed)return;
  if(travel||systemTravel){pendingOwner=[owner,games];return}
  const signature=JSON.stringify([owner,ownerPage,ownerPageSize(),t('owner.panel'),games.map(g=>[g.id,g.tag,g.player_hint,g.fen,g.moves.length,g.turn,g.status])]);if(signature===ownerSignature)return;ownerSignature=signature;
  ownerMode=owner;ownerKnownGames=[...games].sort((a,b)=>a.tag.localeCompare(b.tag));ownerPage=Math.max(0,Math.min(ownerPage,Math.ceil(games.length/ownerPageSize())-1));
  const pageGames=ownerKnownGames.slice(ownerPage*ownerPageSize(),(ownerPage+1)*ownerPageSize());
  ownerScene.title=t('owner.games');ownerScene.description=ownerScene.intro=games.some(g=>g.status==='active')?t('owner.description'):t('owner.empty');
  ownerScene.nodes=pageGames.length?pageGames.map((game,i)=>({id:'private_game_'+game.id,name:'#'+game.tag,meta:ownerMeta(game),description:game.player_hint,color:colors[game.status!=='active'?'gray':game.turn==='owner'?'mint':'blue'],...Object.fromEntries(['x','y'].map((key,j)=>[key,positions(pageGames.length)[i][j]])),r:32,type:'ico',ownerGame:game,children:null})): [{id:'private_owner_empty',name:t('owner.empty'),meta:'',description:t('owner.empty'),color:colors.gray,x:0,y:0,r:24,type:'oct',privateEmpty:true,children:null}];
  let visual=root.nodes.find(n=>n.privatePanel);
  if(owner&&!visual){visual={id:'private_owner_panel',name:t('owner.panel'),meta:t('owner.games'),description:t('owner.description'),color:colors.mint,x:.82,y:.35,r:27,type:'ico',children:ownerScene,privatePanel:true};root.nodes.push(visual)}
  if(visual){visual.name=t('owner.panel');visual.meta=t('owner.games');visual.description=t('owner.description')}
  if(!owner){
    root.nodes=root.nodes.filter(n=>!n.privatePanel);
    if(level.privateOwner){const saved=stack[0];level=root;stack=[];nodes=saved?saved.nodes.filter(n=>!n.privatePanel):instantiate(root);if(saved){pan={...saved.camera.pan};zoom=saved.camera.zoom;targetZoom=saved.targetZoom}bindNodes();updateUI();return}
  }
  if(level===root){nodes=nodes.filter(n=>!n.privatePanel||owner);if(owner){const current=nodes.find(n=>n.privatePanel);if(current){Object.assign(current,{name:visual.name,meta:visual.meta,description:visual.description})}else nodes.push(instantiate({nodes:[visual]})[0])}bindNodes();updateUI()}
  else if(level.privateOwner){const current=new Map(nodes.map(n=>[n.id,n]));nodes=ownerScene.nodes.map(visual=>{const old=current.get(visual.id);return old?Object.assign(old,visual,{data:visual}):instantiate({nodes:[visual]})[0]});bindNodes();updateUI()}
}


// Deep links use the same private scene and node activation as a pointer click.
function openOwnerGame(id,isCurrent=()=>true){return new Promise(resolve=>{
  const wait=()=>{
    if(disposed||!isCurrent()){resolve(false);return}
    if(travel||systemTravel||pendingOwner){setTimeout(wait,60);return}
    if(!ownerMode||!ownerKnownGames.some(game=>game.id===id)){resolve(false);return}
    if(system.chess?.isOpen()){system.chess.closeForNavigation?.(wait);return}
    if(level.system){exitSystem();setTimeout(wait,60);return}
    if(level!==root&&!level.privateOwner){goBackTo(0);setTimeout(wait,60);return}
    ownerPage=Math.floor(ownerKnownGames.findIndex(game=>game.id===id)/ownerPageSize());
    ownerSignature='';setOwnerGames(true,ownerKnownGames);
    if(level===root){activate(nodes.find(node=>node.privatePanel),true);setTimeout(wait,60);return}
    const node=nodes.find(node=>node.ownerGame?.id===id);
    if(!node){resolve(false);return}
    project({level,nodes,camera:camera()});node.el.focus({preventScroll:true});activate(node,true);resolve(true);
  };
  wait();
})}

$('companion-target').setAttribute('aria-label',t('guide.open'));
$('level-title').setAttribute('tabindex','-1');resize();nodes=instantiate(root);bindNodes();updateUI();setPaused(paused);say(t('guide.journey'),root.intro,'welcome',12000);frameId=requestAnimationFrame(render);
return {refreshLanguage,setOwnerGames,openChess,openOwnerGame,dispose(){gestures.dispose();formingRuns.clear();cancelGeneratedFocus();focusControls.remove();if(typeof removeEventListener==='function')removeEventListener('pointerdown',cancelFocusInput,{capture:true});if(typeof removeEventListener==='function')removeEventListener('wheel',cancelFocusInput,{capture:true});if(typeof removeEventListener==='function')removeEventListener('keydown',cancelFocusInput,{capture:true});document.removeEventListener?.('click',cancelFocusInput,{capture:true});disposed=true;if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(frameId);ownerPagination.remove();previewTimer.clear();system.media?.dispose();morphCanvas?.remove();chatTarget.remove();chessTarget?.remove()},navigate:navigateAsync,isSystem:()=>!!level.system,exitSystem:exitSystemAsync,openAgent:()=>{if(!panelOpen)openPanel(false)},closeAgent:()=>closePanel(false),spawnGenerated,removeGenerated,inspectGenerated,setUnread:(count)=>{liveUnread=count;chatTarget.dataset.unread=String(count);syncGenerated()},setChatMessage,setLiveOpen:(open)=>{livePanelOpen=open;if(open){drag=null;gestures.cancel();pointer={x:0,y:0};companion.present=false;chatHovered=false;chatFocused=false;previewTimer.hover(false);previewTimer.clear();chatPreview.hidden=true;pendingSpeech=null;if(speech)speech.expires=performance.now()}chatTarget.setAttribute('aria-expanded',String(open))},morphLivePanel,focusLiveNode:()=>{chatTarget.hidden=!chatPosition;chatTarget.focus({preventScroll:true})},firstRootNode:()=>level===root&&!travel&&!systemTravel&&!system.chess?.isOpen()?nodes.find(node=>!node.generated)?.el??null:null,nodeExists:(id)=>records.has(id),nodeLabel:(id)=>records.get(id)?.label||id,formGenerated,finishForming,clearFormations,focusGenerated,backGenerated,cancelGeneratedFocus};
}
