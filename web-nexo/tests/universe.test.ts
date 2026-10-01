// @ts-nocheck -- This lightweight DOM fixture exercises the unchanged Canvas renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import portfolio from '../src/data/portfolio-content.json';
import architecture from '../src/data/backend-architecture.json';
import { TracePlayer } from '../src/system/traces';
import { systemPositions } from '../src/system/window';

function fixture(withChess=false){
 let activeElement,now=0,raf;
 class Element{
  children=[];handlers={};attributes={};style={setProperty(k,v){this[k]=v}};dataset={};hidden=false;textContent='';classes=new Set();offsetWidth=260;offsetHeight=125;
  classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,v)=>v?this.classes.add(x):this.classes.delete(x),contains:x=>this.classes.has(x)};
  append(...c){this.children.push(...c)}replaceChildren(){this.children=[]}setAttribute(k,v){this.attributes[k]=v}addEventListener(k,f){this.handlers[k]=f}focus(){activeElement=this;this.handlers.focus?.()}click(){this.handlers.click?.({detail:1,preventDefault(){}})}setPointerCapture(){}
  getBoundingClientRect(){return{left:1120,top:530,width:258,height:170,right:1378,bottom:700}}
 }
 const elements={},el=id=>elements[id]??=new Element(),gradient={addColorStop(){}};
 const context=new Proxy({createRadialGradient:()=>gradient,createLinearGradient:()=>gradient},{get:(t,k)=>t[k]||((...args)=>{for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v),'Canvas coordinates stay finite')})});
 el('space').getContext=()=>context;
 const listeners={},traces=new TracePlayer(architecture,()=>now),bridge={architecture,simulated:true,traces,positions:systemPositions(architecture),portal:{element:new Element(),button:new Element(),render(){}},connection:()=> 'open'};
 let chessOpen=false,closeChess;
 if(withChess){bridge.chessNodeVisible=true;bridge.chess={isOpen:()=>chessOpen,open:origin=>{assert.equal(origin.faces.length,80);chessOpen=true},setOnClosed:fn=>closeChess=fn};}
 const sandbox={console,Math,Date,portfolio,bridge,setTimeout,innerWidth:1440,innerHeight:900,devicePixelRatio:1,performance:{now:()=>now},matchMedia:()=>({matches:false,addEventListener(){}}),requestAnimationFrame:f=>raf=f,addEventListener:(k,f)=>listeners[k]=f,document:{getElementById:el,querySelector:el,createElement:tag=>{const item=new Element();if(tag==='canvas')item.getContext=()=>context;return item},createTextNode:t=>t,addEventListener(){},body:el('body'),hidden:false,get activeElement(){return activeElement}}};
 let source=fs.readFileSync('src/universe.js','utf8').replace("import portfolio from './data/portfolio-content.json';",'').replace('export default function createUniverse(system) {','(function(system){');
 source=source.replace('return {dispose(){', 'globalThis.api={apertureNodes,distantSystemBounds,systemPopulation,meshFaces,navigateAsync,spawnGenerated,removeGenerated,generatedRegistry,activate,enterSystem,exitSystem,camera,goBack,setCamera:(p,z)=>{pan=p;zoom=z;targetZoom=z},openPanel,panelProjection,ageValue,scenes,records,geometry,createMorphPlan,refreshTravelGeometry,morphTriangle,instantiate,project,morphLivePanel,chatTarget,setLiveOpen:open=>{livePanelOpen=open},getMorphCanvas:()=>morphCanvas,getLevel:()=>level,getNodes:()=>nodes,getSystemTravel:()=>systemTravel,getTravel:()=>travel,panelOpen:()=>panelOpen};return {dispose(){');
 source=source.trim().replace(/\}$/, '})(bridge);');vm.runInNewContext(source,sandbox);
 const frames=(ms=2700)=>{const end=now+ms;while(now<end){now=Math.min(end,now+50);raf(now)}};
 const enter=id=>{el('node-targets').children.find(e=>e.dataset.node===id).click();frames()};
 return {api:sandbox.api,el,frames,enter,traces,sandbox,listeners,closeChess:()=>{chessOpen=false;closeChess()},chessTarget:()=>el('body').children.find(e=>e.id==='floating-chess')};
}
test('Chess satellite stays disconnected, freezes the camera, and returns without changing portfolio nodes',()=>{
 const {api,frames,chessTarget,closeChess,enter}=fixture(true);frames(100);
 assert.equal(api.records.size,54);assert.equal(api.getNodes().length,5);assert.equal(api.getLevel().edges.length,5);assert.equal(chessTarget().hidden,false);
 api.setCamera({x:75,y:-30},1.2);frames(100);const camera=JSON.stringify(api.camera());chessTarget().click();frames(1500);assert.equal(chessTarget().hidden,true);assert.equal(JSON.stringify(api.camera()),camera);
 closeChess();frames(100);assert.equal(chessTarget().hidden,false);assert.equal(api.getNodes().length,5);assert.equal(api.getLevel().edges.length,5);
 enter('experiencia');assert.equal(chessTarget().hidden,true);api.goBack();frames();assert.equal(chessTarget().hidden,false);
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
