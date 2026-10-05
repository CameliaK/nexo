// @ts-nocheck -- This lightweight DOM fixture exercises the unchanged Canvas renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { portfolio, architecture, applyContent, registerTranslations } from '../src/i18n/content';
import { t, translateText, translateUI, languageStore } from '../src/i18n';
const english=fs.existsSync('src/data/portfolio-content.en.json')?JSON.parse(fs.readFileSync('src/data/portfolio-content.en.json','utf8')):undefined;
const englishArchitecture=fs.existsSync('src/data/backend-architecture.en.json')?JSON.parse(fs.readFileSync('src/data/backend-architecture.en.json','utf8')):undefined;

import { TracePlayer } from '../src/system/traces';
import { systemPositions } from '../src/system/window';
import { Chats } from '../src/chat';
import { createMediaUI } from '../src/media';
const satelliteSource=fs.readFileSync('src/live-satellite.js','utf8').replaceAll('export ', '');
const satellite=vm.runInNewContext(satelliteSource+';({LivePreview,placeSatellite,satelliteFootprint,intersects})',{performance:{now:()=>0}});

function fixture(withChess=false,reducedMotion=false,withMedia=false){
 let activeElement,now=0,raf;
 class Element{
  children=[];handlers={};attributes={};style={setProperty(k,v){this[k]=v}};dataset={};hidden=false;textContent='';classes=new Set();offsetWidth=260;offsetHeight=125;
  classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,v)=>v?this.classes.add(x):this.classes.delete(x),contains:x=>this.classes.has(x)};
  append(...c){this.children.push(...c);for(const child of c)if(typeof child==='object')child.parent=this}replaceChildren(){this.children=[]}setAttribute(k,v){this.attributes[k]=v}addEventListener(k,f){this.handlers[k]=f}focus(){activeElement=this;this.handlers.focus?.()}click(){this.handlers.click?.({detail:1,preventDefault(){}})}setPointerCapture(){}
  getBoundingClientRect(){
   if(this.className==='node-label'){
     const match=this.parent?.style.transform?.match(/translate\(([-\d.]+)px,([-\d.]+)px\)/);
     if(match){const x=Number(match[1]),y=Number(match[2]),r=parseFloat(this.parent.style['--radius']),mobile=sandbox.innerWidth<650,compact=this.parent.className.includes('is-generated')&&mobile,w=compact?76:mobile?145:160;return{left:x-w/2,top:y+r+(compact?12:19),width:w,height:compact?32:35}}
   }
   return this.rect||{left:1120,top:530,width:258,height:170,right:1378,bottom:700};
  }
  querySelector(selector){return this.children.find(e=>e&&typeof e==='object'&&(selector==='.'+e.className||selector===e.tagName))||this.children.map(e=>e?.querySelector?.(selector)).find(Boolean)}remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}blur(){}
  getAttribute(k){return this.attributes[k]??null}removeAttribute(k){delete this.attributes[k]}set src(value){this.attributes.src=value}get src(){return this.attributes.src}showModal(){this.open=true}close(){this.open=false}
 }
 const elements={},el=id=>elements[id]??=new Element(),gradient={addColorStop(){}};
 const context=new Proxy({createRadialGradient:()=>gradient,createLinearGradient:()=>gradient},{get:(t,k)=>t[k]||((...args)=>{for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v),'Canvas coordinates stay finite')})});
 el('space').getContext=()=>context;
 const listeners={},traces=new TracePlayer(architecture,()=>now),bridge={architecture,simulated:true,traces,positions:systemPositions(architecture),portal:{element:new Element(),button:new Element(),render(){}},connection:()=> 'open'};
 let chessOpen=false,closeChess;
 if(withChess){bridge.chessNodeVisible=true;bridge.chess={isOpen:()=>chessOpen,open:origin=>{assert.equal(origin.faces.length,80);chessOpen=true},setOnClosed:fn=>closeChess=fn};}
 const sandbox={t,translateText,translateUI:root=>translateUI(root||sandbox.document),languageStore,console,Math,Date,portfolio,bridge,setTimeout,innerWidth:1440,innerHeight:900,devicePixelRatio:1,performance:{now:()=>now},matchMedia:()=>({matches:reducedMotion,addEventListener(){}}),requestAnimationFrame:f=>raf=f,addEventListener:(k,f)=>listeners[k]=f,document:{getElementById:el,querySelector:el,createElement:tag=>{const item=new Element();item.tagName=tag;if(tag==='canvas')item.getContext=()=>context;return item},createTextNode:t=>t,addEventListener(){},body:el('body'),hidden:false,get activeElement(){return activeElement}}};
 let mediaFrame;
 if(withMedia){bridge.media=createMediaUI(sandbox.document);const render=bridge.media.render;bridge.media.render=args=>{mediaFrame=args;return render(args)}}
 vm.runInNewContext(satelliteSource+';globalThis.satellite={LivePreview,placeSatellite,satelliteFootprint}',sandbox);Object.assign(sandbox,sandbox.satellite);
 let source=fs.readFileSync('src/universe.js','utf8').replace("import { portfolio } from './i18n/content';",'').replace("import { t, translateText, translateUI } from './i18n';",'').replace('export default function createUniverse(system) {','globalThis.universe=(function(system){');
 source=source.replace("import { LivePreview, placeSatellite, satelliteFootprint } from './live-satellite.js';",'');
 source=source.replace('return {refreshLanguage,setOwnerGames,dispose(){', 'globalThis.api={apertureNodes,distantSystemBounds,systemPopulation,meshFaces,navigateAsync,spawnGenerated,removeGenerated,generatedRegistry,activate,enterSystem,exitSystem,camera,goBack,setCamera:(p,z)=>{pan=p;zoom=z;targetZoom=z},openPanel,panelProjection,ageValue,scenes,records,geometry,createMorphPlan,refreshTravelGeometry,morphTriangle,instantiate,project,morphLivePanel,companion,chessOrbit,chatTarget,chatPreview,chatMessage,chatOrbit,chatObstacles,getMediaBounds:()=>occupiedMediaBounds,getChatPosition:()=>chatPosition,getMorphCanvas:()=>morphCanvas,getLevel:()=>level,getNodes:()=>nodes,getSystemTravel:()=>systemTravel,getTravel:()=>travel,panelOpen:()=>panelOpen};return {refreshLanguage,setOwnerGames,dispose(){');
 source=source.trim().replace(/\}$/, '})(bridge);');vm.runInNewContext(source,sandbox);Object.assign(sandbox.api,sandbox.universe);
 const frames=(ms=2700)=>{const end=now+ms;while(now<end){now=Math.min(end,now+50);raf(now)}};
 const enter=id=>{el('node-targets').children.find(e=>e.dataset.node===id).click();frames()};
 return {api:sandbox.api,el,frames,enter,traces,sandbox,listeners,mediaFrame:()=>mediaFrame,mediaLayer:()=>el('body').children.find(e=>e.className==='media-windows'),mediaViewer:()=>el('body').children.find(e=>e.className==='media-viewer'),closeChess:()=>{chessOpen=false;closeChess()},chessTarget:()=>el('body').children.find(e=>e.id==='floating-chess')};
}
test('Chess satellite stays disconnected, freezes the camera, and returns without changing portfolio nodes',()=>{
 const {api,frames,chessTarget,closeChess,enter}=fixture(true);frames(100);
 assert.equal(api.records.size,54);assert.equal(api.getNodes().length,5);assert.equal(api.getLevel().edges.length,5);assert.equal(chessTarget().hidden,false);
 api.setCamera({x:75,y:-30},1.2);frames(100);const camera=JSON.stringify(api.camera());chessTarget().click();frames(1500);assert.equal(chessTarget().hidden,true);assert.equal(JSON.stringify(api.camera()),camera);
 closeChess();frames(100);assert.equal(chessTarget().hidden,false);assert.equal(api.getNodes().length,5);assert.equal(api.getLevel().edges.length,5);
 enter('experiencia');assert.equal(chessTarget().hidden,true);api.goBack();frames();assert.equal(chessTarget().hidden,false);
});

test('Welcome hints use the first existing root node and never a deeper scene or open chess board',()=>{
 const {api,frames,enter,chessTarget,closeChess}=fixture(true);frames(100);
 const first=api.getNodes()[0];assert.equal(api.firstRootNode(),first.el);assert.equal(first.id,portfolio.nodes.find(n=>n.parent===portfolio.root.id)?.id);
 enter('experiencia');assert.equal(api.firstRootNode(),null);api.goBack();frames();assert.equal(api.firstRootNode(),api.getNodes()[0].el);
 chessTarget().click();assert.equal(api.firstRootNode(),null);closeChess();frames(100);assert.equal(api.firstRootNode(),api.getNodes()[0].el);
 assert.equal(api.records.size,54);
});
test('Live chat fragments into its panel and reassembles as a node',()=>{
 const {api,el,frames}=fixture();frames(100);
 const panel=el('live-panel');panel.hidden=false;let opened=0,closed=0;
 api.setLiveOpen(true);api.morphLivePanel(panel,true,()=>opened++);
 assert.equal(api.chatTarget.hidden,true);assert.equal(panel.style.pointerEvents,'none');
 frames(800);assert.equal(opened,1);assert.equal(api.getMorphCanvas().hidden,true);assert.equal(panel.style.opacity,'');
 api.morphLivePanel(panel,false,()=>{closed++;api.setLiveOpen(false)});
 frames(800);assert.equal(closed,1);assert.equal(api.chatTarget.hidden,false);assert.equal(api.getMorphCanvas().hidden,true);
});
test('System portal preserves camera and level; live-in never navigates; both entry points share the view',()=>{
 const {api,el,frames,enter,traces}=fixture();frames(100);enter('experiencia');api.setCamera({x:75,y:-30},1.2);const previous=JSON.stringify(api.camera());api.openPanel();api.enterSystem();frames();assert.equal(api.getLevel().id,'system');assert.equal(api.getNodes().length,9);assert.equal(api.panelOpen(),true);
 assert.equal(el('depth-number').textContent,'01');
 for(const n of api.getNodes())assert.ok(n.sx>100&&n.sx<1200,'System node remains inside large view');
 traces.receive({v:2,type:'run.start',run_id:'live',seq:1,ts:'now',data:{kind:'live_in',content_version:3}});traces.receive({v:2,type:'trace.hop',run_id:'live',seq:2,ts:'now',data:{hop_id:'h',from:'owner_channel',to:'n8n',phase:'start'}});frames(700);assert.equal(api.getLevel().id,'system');assert.equal(traces.light('n8n').state,'active');
 api.exitSystem();frames();assert.equal(api.getLevel().id,'experiencia');assert.equal(JSON.stringify(api.camera()),previous);assert.equal(api.panelOpen(),true);
 const before=api.getLevel().id;traces.receive({v:2,type:'run.start',run_id:'live2',seq:1,ts:'now',data:{kind:'live_in',content_version:3}});frames(500);assert.equal(api.getLevel().id,before);
 api.goBack();frames();enter('proyectos-personales');enter('proyectos-personales.este-portafolio');assert.equal(api.getLevel().id,'system');api.goBack();frames();assert.equal(api.getLevel().id,'proyectos-personales');
});
test('Portfolio keeps 54 IDs, seven single-layer architectures and exact face conservation',()=>{
 const {api,frames}=fixture();frames(100);assert.equal(api.records.size,54);let architectures=0;
 const area=p=>Math.abs((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[2][0]-p[0][0])*(p[1][1]-p[0][1]))/2;
 for(const scene of api.scenes.values()){
   if(scene.architecture){architectures++;assert.ok(scene.nodes.every(n=>!n.children))}
   for(const n of scene.nodes)if(n.children){const parent={...n,sx:400,sy:450,sr:50,seed:1,dx:0,dy:0,hover:0},children=api.instantiate(n.children),camera={zoom:1,pan:{x:0,y:0},parallax:{x:0,y:0}};api.project({level:n.children,nodes:children,camera});const t={entry:parent,parent:{plan:api.createMorphPlan(parent,children),nodes:[parent],level:scene,camera},child:{nodes:children,level:n.children,camera}};api.refreshTravelGeometry(t);for(const face of t.parentFaces)assert.ok(Math.abs(t.triangles.filter(p=>p.face===face.i).reduce((s,p)=>s+area(p.points),0)-area(face.points))<1e-7)}
 }
 assert.equal(architectures,7);assert.equal(api.ageValue({computed_age_from:'2003-10-02'},new Date(2026,9,2)),'23 años');
});

test('Agent route uses the common ancestor and generated nodes survive camera travel without edges',async()=>{
  const {api,frames,enter}=fixture();frames(100);
  let done=api.navigateAsync('experiencia');frames();await done;assert.equal(api.getLevel().id,'experiencia');
  done=api.navigateAsync('experiencia.infosys');assert.equal(api.getTravel().kind,'in');frames();await done;assert.equal(api.getLevel().id,'experiencia.infosys');
  api.goBack();frames();api.goBack();frames();
  const generated={id:'gen_test',generated:true,label:'Prueba',summary:'Resumen',created_at:'2026-09-29T00:00:00Z',sources:[{title:'CV'}],layout:'text',content:{body:'Texto'}};
  api.enterSystem();frames();api.spawnGenerated(generated);assert.equal(api.getNodes().length,9);api.exitSystem();frames();assert.ok(api.getNodes().some(n=>n.id==='gen_test'));assert.equal(api.getLevel().edges.length,5);
  api.enterSystem();frames();api.removeGenerated('gen_test');api.exitSystem();frames();assert.ok(!api.getNodes().some(n=>n.id==='gen_test'));
  api.activate(api.getNodes().find(n=>n.id==='experiencia'));frames(1500);const edgeCount=api.getLevel().edges.length;api.spawnGenerated({...generated,id:'gen_during_travel'});frames();assert.ok(api.getNodes().some(n=>n.id==='gen_during_travel'));assert.equal(api.getLevel().edges.length,edgeCount);
  api.spawnGenerated({...generated,id:'gen_family',children:[{...generated,id:'gen_child_a'},{...generated,id:'gen_child_b'}]});enter('gen_family');api.removeGenerated('gen_child_a');assert.equal(api.getNodes().length,1);api.goBack();frames();assert.equal(api.getLevel().id,'experiencia');
});

test('Distant and expanded system share meshes, rotation and node identity',()=>{
 const {api,frames}=fixture();frames(100);const bounds=api.distantSystemBounds();
 const small=api.apertureNodes(bounds);assert.equal(small.length,9);
 const shifted=api.distantSystemBounds({...api.camera(),pan:{x:85,y:-25},zoom:1.3});
 assert.ok(shifted.left>bounds.left&&shifted.top<bounds.top&&shifted.width>bounds.width,'Distant nodes respond to camera pan and zoom');
 api.enterSystem();frames();assert.equal(api.getNodes(),api.systemPopulation);
 for(let i=0;i<small.length;i++){
  const large=api.getNodes()[i];assert.equal(small[i].id,large.id);assert.equal(small[i].seed,large.seed);assert.equal(small[i].type,large.type);
  const a=api.meshFaces(small[i]),b=api.meshFaces(large);assert.equal(a.length,b.length);
  for(let f=0;f<a.length;f++)for(let v=0;v<3;v++){
   assert.ok(Math.abs((a[f].points[v][0]-small[i].sx)/small[i].sr-(b[f].points[v][0]-large.sx)/large.sr)<1e-8);
   assert.ok(Math.abs((a[f].points[v][1]-small[i].sy)/small[i].sr-(b[f].points[v][1]-large.sy)/large.sr)<1e-8);
  }
 }
 api.exitSystem();frames();assert.equal(api.getLevel().id,portfolio.root.id);
});

test('Live preview fades at five seconds, replaces previous text and pauses while hovered',()=>{
 const {api,frames}=fixture();frames(100);
 api.setChatMessage('Primero','visitor');frames(4700);
 assert.equal(api.chatPreview.hidden,false);assert.equal(api.chatPreview.style.visibility,'visible');assert.ok(Number(api.chatPreview.style.opacity)<1);
 api.chatTarget.handlers.pointerenter();const opacity=api.chatPreview.style.opacity;frames(7000);
 assert.equal(api.chatPreview.hidden,false);assert.equal(api.chatPreview.style.opacity,opacity);
 api.setChatMessage('Segundo','owner');frames(7000);
 assert.equal(api.chatMessage.textContent,'Segundo');assert.equal(api.chatPreview.hidden,false);assert.equal(api.chatPreview.style.opacity,'1');
 api.chatTarget.handlers.pointerleave();frames(4950);assert.equal(api.chatPreview.hidden,false);
 frames(50);assert.equal(api.chatPreview.hidden,true);
 assert.equal(api.chatTarget.children.filter(e=>e.className==='floating-live-preview').length,1);
});

test('Unread indicator survives preview expiry and clears only when Chats opens the panel',()=>{
 const {api,frames,el,sandbox}=fixture();frames(100);
 const chats=Object.assign(Object.create(Chats.prototype),{universe:api,liveRows:new Map(),unread:new Set(),liveOpen:false,liveTransition:null,livePanel:el('live-panel'),liveHistory:el('live-history'),liveInput:el('live-input')});
 const originalDocument=globalThis.document;globalThis.document=sandbox.document;
 try{
   chats.addLive({id:'owner-1',from:'owner',text:'Hola','ts':new Date().toISOString()});
   frames(5000);assert.equal(api.chatPreview.hidden,true);assert.equal(api.chatTarget.classList.contains('has-unread'),true);
   assert.equal(api.chatTarget.querySelector('.unread-badge').textContent,'1');
   chats.addLive({id:'visitor-1',from:'visitor',text:'Respuesta','ts':new Date().toISOString()});
   frames(100);assert.equal(api.chatMessage.textContent,'Respuesta');assert.equal(api.chatPreview.hidden,false);
   frames(5000);assert.equal(api.chatPreview.hidden,true);assert.equal(api.chatTarget.classList.contains('has-unread'),true);
   api.chatTarget.handlers.pointerenter();chats.openLive();frames(800);assert.equal(api.chatTarget.classList.contains('has-unread'),false);assert.equal(api.chatTarget.querySelector('.unread-badge'),undefined);assert.equal(api.chatPreview.hidden,true);
   chats.addLive({id:'owner-open',from:'owner',text:'Ya visible en el panel','ts':new Date().toISOString()});assert.equal(api.chatPreview.hidden,true);
   chats.addLive({id:'visitor-open',from:'visitor',text:'Enviado desde el panel','ts':new Date().toISOString()});
   chats.closeLive();frames(800);assert.equal(api.chatPreview.hidden,false);
   frames(5000);assert.equal(api.chatPreview.hidden,true,'Opening the panel releases any stale hover pause');
   chats.addLive({id:'history-1',from:'owner',text:'Histórico','ts':'2020-01-01T00:00:00Z'},'sent',true);
   assert.equal(api.chatPreview.hidden,true,'History restoration does not revive expired text');
 }finally{globalThis.document=originalDocument}
});

test('Reduced motion keeps preview timing and hover pause without a fade animation',()=>{
 const {api,frames}=fixture(false,true);frames(100);api.setChatMessage('Mensaje','owner');frames(4950);
 assert.equal(api.chatPreview.style.opacity,'1');api.chatTarget.handlers.pointerenter();frames(2000);assert.equal(api.chatPreview.hidden,false);
 api.chatTarget.handlers.pointerleave();frames(50);assert.equal(api.chatPreview.hidden,true);
});

const translated=(shape,p)=>({left:shape.left+p.x,right:shape.right+p.x,top:shape.top+p.y,bottom:shape.bottom+p.y});
function assertFree(position,width,height,obstacles,footprint){
 assert.ok(position,'There is a free zone for the chat node');
 for(const shape of [footprint,...(position.bubble?[position.bubble]:[])]){
   const rect=translated(shape,position);assert.ok(rect.left>=12&&rect.right<=width-12&&rect.top>=12&&rect.bottom<=height-12,'Satellite and bubble fit the viewport');
   for(const obstacle of obstacles)assert.equal(satellite.intersects(rect,obstacle),false,'Satellite and bubble avoid every obstacle');
 }
}
test('Satellite evades nodes, labels, aperture, center and controls as level, zoom and viewport change',()=>{
 const {api,frames,enter,listeners,sandbox}=fixture();frames(100);
 for(const [w,h,z,id] of [[1440,900,1,null],[1440,900,1.6,'experiencia'],[390,844,.65,null],[390,844,1.6,'system'],[844,390,1,null]]){
   if(id==='system'){api.enterSystem();frames()}else if(id)enter(id);
   sandbox.innerWidth=w;sandbox.innerHeight=h;listeners.resize();api.setCamera({x:40,y:-15},z);frames(500);
   const position=api.getChatPosition();assertFree(position,w,h,api.chatObstacles(),satellite.satelliteFootprint(w<650?17:21,position?.caption));
 }
});

test('Satellite remains clickable while hovered, then evades new obstacles when the pointer leaves',()=>{
 const {api,frames,el,sandbox}=fixture();const control=el('zoom-tools');
 control.rect={left:1000,top:720,width:300,height:100};sandbox.document.querySelectorAll=()=>[control];sandbox.getComputedStyle=()=>({display:'block',visibility:'visible'});
 frames(1000);let position=api.getChatPosition();assertFree(position,1440,900,api.chatObstacles(),satellite.satelliteFootprint(21,position.caption));
 api.chatTarget.handlers.pointerenter();const held={x:position.x,y:position.y};control.rect={left:position.x-75,top:position.y-75,width:150,height:150};frames(50);
 assert.equal(api.chatTarget.hidden,false);assert.equal(api.getChatPosition().x,held.x);assert.equal(api.getChatPosition().y,held.y);
 api.chatTarget.handlers.pointerleave();frames(50);position=api.getChatPosition();assertFree(position,1440,900,api.chatObstacles(),satellite.satelliteFootprint(21,position.caption));
});

test('Approaching companion and speech never displace or hide chat before hover',()=>{
 const control=fixture(),approached=fixture();control.frames(1000);approached.frames(1000);
 const {api,frames,el,sandbox}=approached,position=api.getChatPosition();
 Object.assign(api.companion,{x:position.x,y:position.y,tx:position.x-38,ty:position.y-43,present:true,locked:true});
 el('companion-target').rect={left:position.x-31,top:position.y-31,width:62,height:62};
 el('speech-bubble').rect={left:position.x-90,top:position.y-80,width:180,height:160};
 frames(500);control.frames(500);
 assert.equal(api.chatTarget.hidden,false);
 assert.equal(api.getChatPosition().x,control.api.getChatPosition().x);
 assert.equal(api.getChatPosition().y,control.api.getChatPosition().y);
 let opens=0;sandbox.bridge.onLiveOpen=()=>opens++;api.chatTarget.click();assert.equal(opens,1);
 api.companion.locked=false;frames(1000);
 const chat=translated(satellite.satelliteFootprint(21,api.getChatPosition().caption),api.getChatPosition());
 const orb={left:api.companion.x-24,right:api.companion.x+24,top:api.companion.y-26,bottom:api.companion.y+26};
 assert.equal(satellite.intersects(chat,orb),false,'The companion yields to the chat target');
 assert.equal(api.chatTarget.hidden,false);
});

test('Root chess and generated satellites leave space around graph bodies and labels',()=>{
 for(const [w,h,reduced,elapsed=1500] of [[1440,900,true],[1210,1146,true],[390,844,true],[1440,900,false],[390,844,false],[390,844,false,8000]]){
   const {api,frames,el,sandbox,listeners}=fixture(true,reduced);
   sandbox.innerWidth=w;sandbox.innerHeight=h;listeners.resize();
   el('companion-panel').hidden=true;el('content-card').hidden=true;
   const controls=[{left:0,top:0,width:w,height:w<650?78:104},
     {left:w<650?24:46,top:w<650?103:139,width:w<650?300:450,height:w<650?100:126},
     {left:0,top:h-(w<650?108:102),width:w,height:w<650?108:102}].map(rect=>({rect,getBoundingClientRect(){return this.rect}}));
   sandbox.document.querySelectorAll=()=>controls;sandbox.getComputedStyle=()=>({display:'block',visibility:'visible'});
   frames(100);
   api.spawnGenerated({id:'gen_outer',generated:true,label:'Creado para ti',summary:'Resumen',created_at:'2026-10-04T00:00:00Z',sources:[],layout:'text',content:{body:'Texto'}},null,true);frames(elapsed);
   const canonical=api.getNodes().filter(n=>!n.generated),generated=api.getNodes().find(n=>n.generated),chess=api.chessOrbit();
   const half=w<650?38:80,gap=w<650?6:20;
   const generatedRect={left:generated.sx-half,right:generated.sx+half,top:generated.sy-generated.sr*1.65,bottom:generated.sy+generated.sr+(w<650?44:54)};
   const chessRect={left:chess.sx-(w<650?50:75),right:chess.sx+(w<650?50:75),top:chess.sy-(w<650?40:50),bottom:chess.sy+(w<650?90:86)};
   for(const rect of [generatedRect,chessRect]){
     assert.ok(rect.left>=12&&rect.right<=w-12&&rect.top>=12&&rect.bottom<=h-12,`Satellite fits ${w}×${h}`);
     for(const n of canonical){
       const reach=n.sr*1.65,body={left:n.sx-reach-gap,right:n.sx+reach+gap,top:n.sy-reach-gap,bottom:n.sy+reach+gap};
       const b=n.el.querySelector('.node-label').getBoundingClientRect(),label={left:b.left-gap,right:b.left+b.width+gap,top:b.top,bottom:b.top+b.height+gap};
       assert.equal(satellite.intersects(rect,body),false,`${w}×${h}: satellite clears ${n.id} body`);
       assert.equal(satellite.intersects(rect,label),false,`${w}×${h}: satellite clears ${n.id} label`);
     }
     for(const c of controls){const b=c.rect;assert.equal(satellite.intersects(rect,{left:b.left,right:b.left+b.width,top:b.top,bottom:b.top+b.height}),false,'Satellite clears fixed UI')}
     const b=api.distantSystemBounds();assert.equal(satellite.intersects(rect,{left:b.left,right:b.left+b.width,top:b.top,bottom:b.top+b.height+20}),false,`Satellite clears the system window ${w}×${h}`);
   }
   assert.equal(satellite.intersects(generatedRect,chessRect),false);
   assert.equal(api.getLevel().edges.length,5);assert.equal(api.records.size,54);
 }
});

test('Free-zone search fits a bubble and rejects a drift that would cross an obstacle',()=>{
 const footprint=satellite.satelliteFootprint(21),wall={left:260,right:310,top:100,bottom:500};
 const previous={x:140,y:250};
 const placed=satellite.placeSatellite({width:800,height:600,obstacles:[wall],preferred:{x:450,y:250},previous,footprint,ease:.2});
 assertFree(placed,800,600,[wall],footprint);assert.ok(placed.x<260,'Evasion does not interpolate through the wall');
 const bubble=satellite.placeSatellite({width:800,height:600,obstacles:[wall],preferred:{x:450,y:250},footprint,preview:{width:190,height:74}});
 assert.ok(bubble.bubble);assertFree(bubble,800,600,[wall],footprint);
 const blocked=satellite.placeSatellite({width:200,height:200,obstacles:[{left:0,right:200,top:0,bottom:200}],preferred:previous,footprint});
 assert.equal(blocked,null,'A fully occupied viewport never forces an overlap');
});

test('Media opens only in terminal architecture/project views, reserves connections and closes independently of navigation',()=>{
 const {api,el,frames,enter,mediaLayer,mediaViewer,mediaFrame,listeners,sandbox}=fixture(false,false,true);frames(100);
 assert.equal(mediaLayer().hidden,true);enter('aprendizaje');enter('aprendizaje.proyectos-academicos');assert.equal(mediaLayer().hidden,true);
 enter('aprendizaje.proyectos-academicos.astralis');assert.equal(mediaLayer().dataset.node,'aprendizaje.proyectos-academicos.astralis');assert.equal(mediaLayer().hidden,false);
 assert.equal(mediaLayer().children.length,3);assert.ok(api.getMediaBounds().length>0);
 for(const rect of api.getMediaBounds())for(const obstacle of mediaFrame().obstacles)assert.equal(satellite.intersects(rect,obstacle),false,'Real scene components, labels, aperture, panels and connection curves remain uncovered');
 api.setCamera({x:70,y:-20},1.4);frames(100);
 for(const rect of api.getMediaBounds())for(const obstacle of mediaFrame().obstacles)assert.equal(satellite.intersects(rect,obstacle),false);
 for(const [width,height,zoom] of [[390,844,.8],[844,390,1.2],[1440,900,1]]){
   sandbox.innerWidth=width;sandbox.innerHeight=height;listeners.resize();api.setCamera({x:0,y:0},zoom);frames(50);
   assert.ok(api.getMediaBounds().length>0,'At least one image fits the real final architecture on desktop, portrait and landscape');
   for(const rect of api.getMediaBounds())for(const obstacle of mediaFrame().obstacles)assert.equal(satellite.intersects(rect,obstacle),false);
 }
 const level=api.getLevel().id,camera=JSON.stringify(api.camera());mediaLayer().children.find(button=>!button.hidden).click();
 assert.equal(mediaViewer().open,true);listeners.keydown({key:'Escape',preventDefault(){assert.fail('Viewer ESC must not propagate into universe navigation')}});
 assert.equal(api.getLevel().id,level);assert.equal(JSON.stringify(api.camera()),camera);
 mediaViewer().handlers.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(mediaViewer().open,false);
 api.goBack();frames();assert.equal(mediaLayer().hidden,true);api.goBack();frames();api.goBack();frames();enter('proyectos-personales');
 assert.equal(mediaLayer().hidden,true);enter('proyectos-personales.qfb-app');assert.equal(api.getLevel().id,'proyectos-personales');assert.equal(mediaLayer().dataset.node,'proyectos-personales.qfb-app');assert.ok(api.getMediaBounds().length>0);
 el('close-content').click();frames(100);assert.equal(mediaLayer().hidden,true);
 api.dispose();assert.equal(el('body').children.some(child=>child.className==='media-windows'),false);
});


test('Language switch preserves camera, scene objects, depth, focused node and open content/companion panels',()=>{
 registerTranslations(english,englishArchitecture);languageStore.set('es');applyContent('es');
 const {api,el,frames,enter}=fixture();frames(100);enter('personal');enter('personal.contacto');
 const email=api.getNodes().find(n=>n.id==='personal.contacto.correo');api.activate(email);api.openAgent();
 api.setCamera({x:47,y:-23},1.25);frames(100);el('nexo-input').value='Borrador sin enviar';email.el.focus();
 const camera=JSON.stringify(api.camera()),nodes=api.getNodes(),level=api.getLevel(),button=email.el,depth=el('depth-number').textContent;
 try{
  languageStore.set('en');applyContent('en');api.refreshLanguage();
  assert.equal(JSON.stringify(api.camera()),camera);assert.equal(api.getNodes(),nodes);assert.equal(api.getLevel(),level);assert.equal(el('depth-number').textContent,depth);
  assert.equal(api.panelOpen(),true);assert.equal(el('content-card').hidden,false);assert.equal(el('content-title').textContent,'Email');assert.equal(el('nexo-input').value,'Borrador sin enviar');assert.equal(api.getNodes().find(n=>n.id===email.id).el,button);assert.equal(email.name,'Email');assert.match(button.getAttribute('aria-label'),/Email/);
  languageStore.set('es');applyContent('es');api.refreshLanguage();assert.equal(email.name,'Correo');assert.equal(JSON.stringify(api.camera()),camera);
 }finally{api.dispose();languageStore.set('es');applyContent('es')}
});

test('Switching language in a terminal architecture keeps media viewer, active image and window positions',()=>{
 registerTranslations(english,englishArchitecture);languageStore.set('es');applyContent('es');
 const {api,frames,enter,mediaLayer,mediaViewer}=fixture(false,true,true);frames(100);enter('aprendizaje');enter('aprendizaje.proyectos-academicos');enter('aprendizaje.proyectos-academicos.astralis');frames(100);
 const layer=mediaLayer(),viewer=mediaViewer(),tiles=[...layer.children],positions=tiles.map(tile=>tile.style.transform);
 tiles[1].click();const image=viewer.children[0].children[1].children[0],src=image.src,camera=JSON.stringify(api.camera());
 try{
  languageStore.set('en');applyContent('en');api.refreshLanguage();
  assert.equal(viewer.open,true);assert.equal(image.src,src);assert.equal(image.alt,english.nodes.find(node=>node.id==='aprendizaje.proyectos-academicos.astralis').media[1].alt);
  assert.deepEqual(layer.children,tiles);assert.deepEqual(layer.children.map(tile=>tile.style.transform),positions);assert.equal(JSON.stringify(api.camera()),camera);
 }finally{api.dispose();languageStore.set('es');applyContent('es')}
});

test('Locale toggled during camera travel also relabels its destination without interrupting the transition',()=>{
 registerTranslations(english,englishArchitecture);languageStore.set('es');applyContent('es');const {api,frames}=fixture();frames(100);
 api.activate(api.getNodes().find(node=>node.id==='experiencia'));frames(400);const transition=api.getTravel();
 try{languageStore.set('en');applyContent('en');api.refreshLanguage();assert.equal(api.getTravel(),transition);frames(2700);assert.equal(api.getLevel().id,'experiencia');assert.equal(api.getLevel().title,'Experience');assert.equal(api.getNodes().find(node=>node.id==='experiencia.infosys').name,'Infosys')}
 finally{api.dispose();languageStore.set('es');applyContent('es')}
});


test('Approaching the message node stops companion pursuit and keeps the same visible target through pointerdown and click',()=>{
 const {api,frames,listeners,sandbox}=fixture();frames(600);const held={x:api.getChatPosition().x,y:api.getChatPosition().y};let opened=0;sandbox.bridge.onLiveOpen=()=>opened++;
 api.chatTarget.handlers.pointerenter();
 const target={closest:selector=>selector.includes('.floating-live-chat')?api.chatTarget:null};
 for(let i=0;i<5;i++){listeners.pointermove({clientX:held.x+i,clientY:held.y,pointerType:'mouse',target});frames(300);assert.equal(api.chatTarget.hidden,false);assert.equal(api.getChatPosition().x,held.x);assert.equal(api.getChatPosition().y,held.y)}
 listeners.pointerdown({clientX:held.x,clientY:held.y,pointerType:'mouse',target});frames(150);api.chatTarget.click();assert.equal(opened,1);api.dispose();
});

test('Message node keeps its position on keyboard focus and recalculates safely after a viewport resize',()=>{
 const {api,frames,sandbox,listeners}=fixture();frames(600);const held={x:api.getChatPosition().x,y:api.getChatPosition().y};api.chatTarget.focus();frames(1400);
 assert.equal(api.chatTarget.hidden,false);assert.equal(api.getChatPosition().x,held.x);assert.equal(api.getChatPosition().y,held.y);
 sandbox.innerWidth=390;sandbox.innerHeight=844;listeners.resize();frames(50);
 const resized=api.getChatPosition();assert.equal(api.chatTarget.hidden,false);assert.ok(resized.x>12&&resized.x<378&&resized.y>12&&resized.y<832);
 api.chatTarget.handlers.blur();api.dispose();
});

test('Guest chess lock opens access without unfolding the board; incoming badge changes neither level nor camera',()=>{
 languageStore.set('es');const {api,frames,sandbox,chessTarget}=fixture(true);let logins=0;
 sandbox.bridge.chessAccess=()=>({locked:true,unread:false,label:t('auth.required')});sandbox.bridge.onChessAccess=()=>{logins++;return false};frames(100);const target=chessTarget();assert.equal(target.classList.contains('is-locked'),true);assert.equal(target.querySelector('small').textContent,t('auth.required'));target.click();assert.equal(logins,1);assert.equal(sandbox.bridge.chess.isOpen(),false);
 api.setCamera({x:83,y:-21},1.1);frames(100);const camera=JSON.stringify(api.camera()),level=api.getLevel();sandbox.bridge.chessAccess=()=>({locked:false,unread:true,label:t('chess.newMove')});frames(100);assert.equal(target.classList.contains('has-chess-unread'),true);assert.equal(JSON.stringify(api.camera()),camera);assert.equal(api.getLevel(),level);
});
test('Owner dashboard is a private constellation, updates in place, and disappears without changing public ids',()=>{
 const {api,frames,enter,sandbox}=fixture(true);frames(100);const ids=[...api.records.keys()].join('|'),rootNodes=api.getNodes().length;
 const game={id:'example',tag:'A3F2',player_hint:'k***@gmail.com',color:'w',fen:'start',moves:[{san:'e4'}],turn:'owner',status:'active',updated_at:'now'};
 api.setOwnerGames(false,[]);assert.equal(api.getNodes().length,rootNodes);api.setOwnerGames(true,[game]);assert.equal(api.getNodes().length,rootNodes+1);const node=api.getNodes().find(n=>n.privatePanel);assert.equal(node.name,t('owner.panel'));assert.equal([...api.records.keys()].join('|'),ids);enter(node.id);assert.equal(api.getLevel().title,t('owner.games'));assert.equal(api.getNodes()[0].name,'#A3F2');assert.ok(api.getNodes()[0].el.className.includes('is-owner-turn'));
 const camera=JSON.stringify(api.camera());api.setOwnerGames(true,[{...game,moves:[{san:'e4'},{san:'e5'}],turn:'player'}]);assert.equal(JSON.stringify(api.camera()),camera);assert.match(api.getNodes()[0].meta,/2/);let opened='';sandbox.bridge.onOwnerGame=id=>opened=id;api.getNodes()[0].el.click();assert.equal(opened,game.id);
 api.setOwnerGames(false,[]);assert.equal(api.getLevel().id,portfolio.root.id);assert.equal(api.getNodes().length,rootNodes);assert.equal([...api.records.keys()].join('|'),ids);
});

test('Private games stay localized and mobile pages avoid crowding while preserving the focused game',()=>{
 languageStore.set('es');const {api,frames,enter,sandbox,el,listeners}=fixture(true);frames(100);const games=Array.from({length:11},(_,i)=>({id:'game'+i,tag:String(i).padStart(4,'0'),player_hint:'k***@gmail.com',color:'w',fen:'start',moves:[],turn:'owner',status:'active'}));
 api.setOwnerGames(true,games);enter('private_owner_panel');assert.equal(api.getNodes().length,6);api.getNodes()[0].el.focus();const focusedId=api.getNodes()[0].id;
 languageStore.set('en');api.refreshLanguage();assert.equal(api.getLevel().title,'Games');assert.match(api.getNodes()[0].meta,/Your turn/);
 api.setOwnerGames(true,games.map((g,i)=>i===0?{...g,moves:[{san:'e4'}]}:g));assert.equal(sandbox.document.activeElement.dataset.node,focusedId);
 sandbox.innerWidth=390;sandbox.innerHeight=844;listeners.resize();frames(100);assert.equal(api.getNodes().length,4);const pager=el('body').children.find(n=>n.className==='owner-pagination');assert.equal(pager.hidden,false);pager.children[2].onclick();frames(100);assert.equal(api.getNodes().length,4);assert.equal(api.getNodes()[0].ownerGame.id,'game4');api.dispose();languageStore.set('es');
});
