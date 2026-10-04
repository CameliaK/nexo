// @ts-nocheck -- The fixture exercises DOM behavior without loading a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMediaUI, nodeMedia, curveObstacles } from '../src/media';
import portfolio from '../src/data/portfolio-content.json';

const entry=(i=0)=>({id:'image-'+i,src:'/media/test/image-'+i+'.webp',alt:'Imagen '+i,caption:'Pie de foto '+i});
function fixture(){
 let focused;
 class Element{
   children=[];attributes={};style={setProperty(k,v){this[k]=v}};dataset={};handlers={};hidden=false;open=false;className='';textContent='';
   classes=new Set();classList={add:name=>this.classes.add(name)};
   append(...children){for(const child of children){child.parent=this;this.children.push(child)}}
   replaceChildren(){this.children=[]}setAttribute(k,v){this.attributes[k]=v}getAttribute(k){return this.attributes[k]??null}removeAttribute(k){delete this.attributes[k]}
   set src(value){this.attributes.src=value}get src(){return this.attributes.src}
   addEventListener(name,fn){this.handlers[name]=fn}focus(){focused=this}showModal(){this.open=true}close(){this.open=false}
   remove(){this.parent.children=this.parent.children.filter(child=>child!==this)}
   dispatch(name,event={}){this.handlers[name]?.({target:this,preventDefault(){},stopPropagation(){},...event})}
 }
 const doc={body:new Element(),createElement:()=>new Element(),getElementById:()=>null};
 const ui=createMediaUI(doc);const layer=doc.body.children[0],viewer=doc.body.children[1],surface=viewer.children[0];
 const header=surface.children[0],figure=surface.children[1],nav=surface.children[2];
 return {ui,layer,viewer,image:figure.children[0],caption:figure.children[1],nav,closeButton:header.children[1],focused:()=>focused};
}
const args={width:1440,height:900,clock:1,now:100,obstacles:[]};
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;

test('Media schema requires alt, local WebP paths and unique IDs; at most six entries',()=>{
 const values=[{},entry(),{...entry(1),alt:' '},{...entry(2),src:'https://example.com/x.webp'},{...entry(3),src:'/media/test/../x.webp'},entry(),...Array.from({length:9},(_,i)=>entry(i+10))];
 const accepted=nodeMedia(values);assert.equal(accepted.length,6);assert.equal(accepted[0].id,'image-0');assert.equal(new Set(accepted.map(x=>x.id)).size,6);
 assert.deepEqual(nodeMedia(undefined),[]);assert.equal(nodeMedia([{...entry(),caption:42,placeholder:true}])[0].caption,undefined);
});

test('Windows load lazily with fixed dimensions, avoid diagrams and each other, and stay static with reduced motion',()=>{
 const {ui,layer}=fixture();ui.setNode({id:'test',label:'Prueba',media:Array.from({length:6},(_,i)=>entry(i))},[141,163,245]);
 assert.equal(layer.children.length,6);assert.equal(layer.style['--media-rgb'],'141,163,245');
 for(const button of layer.children){const image=button.children[0];assert.equal(image.loading,'lazy');assert.equal(image.decoding,'async');assert.equal(image.width,600);assert.equal(image.height,400);assert.equal(image.getAttribute('src'),null)}
 const components=[{left:480,right:930,top:280,bottom:630}];
 const connections=curveObstacles([{x:130,y:400},{x:400,y:440},{x:650,y:410},{x:1100,y:400}]);
 const obstacles=[...components,...connections,{left:0,right:1440,top:0,bottom:130},{left:0,right:1440,top:790,bottom:900}];
 const placed=ui.render({...args,obstacles,reduced:true});assert.equal(placed.length,6);
 for(const [i,rect] of placed.entries()){
   assert.ok(rect.left>=12&&rect.right<=1432&&rect.top>=12&&rect.bottom<=888);
   for(const obstacle of [...obstacles,...placed.slice(0,i)])assert.equal(overlap(rect,obstacle),false);
 }
 const transforms=layer.children.map(button=>button.style.transform);ui.render({...args,obstacles,clock:500,now:20000,reduced:true});
 assert.deepEqual(layer.children.map(button=>button.style.transform),transforms);
 assert.equal(layer.children[0].children[0].src,entry().src);
 ui.render({...args,hidden:true});assert.equal(layer.hidden,true);
 ui.setNode(null);assert.equal(layer.children.length,0);assert.equal(layer.hidden,true);
});

test('Viewer has captions, wraps arrows, closes on ESC or outside click, and restores focus',()=>{
 const {ui,layer,viewer,image,caption,nav,focused}=fixture();ui.setNode({id:'test',label:'Proyecto',media:[{...entry(),placeholder:true},entry(1),entry(2)]});ui.render(args);
 const origin=layer.children[0];origin.dispatch('click');assert.equal(ui.isOpen(),true);assert.equal(image.src,entry().src);assert.equal(image.alt,entry().alt);assert.match(caption.textContent,/IMAGEN DE PRUEBA/);
 let prevented=0,stopped=0;
 viewer.dispatch('keydown',{key:'ArrowLeft',preventDefault(){prevented++},stopPropagation(){stopped++}});assert.equal(image.src,entry(2).src);assert.equal(nav.children[1].textContent,'3 / 3');
 viewer.dispatch('keydown',{key:'ArrowRight'});assert.equal(image.src,entry().src);nav.children[2].dispatch('click');assert.equal(image.src,entry(1).src);
 assert.equal(caption.textContent,'Pie de foto 1');assert.equal(prevented,1);assert.equal(stopped,1);
 viewer.dispatch('keydown',{key:'Escape'});assert.equal(ui.isOpen(),false);assert.equal(focused(),origin);assert.equal(image.getAttribute('src'),null);
 origin.dispatch('click');viewer.dispatch('click',{target:nav});assert.equal(ui.isOpen(),true);
 viewer.dispatch('click');assert.equal(ui.isOpen(),false);assert.equal(focused(),origin);
});

test('Failed images disappear, are skipped by the viewer and cannot affect a later node',()=>{
 const {ui,layer,viewer,image,nav}=fixture();ui.setNode({id:'one',label:'Uno',media:[entry(),entry(1)]});ui.render(args);
 const broken=layer.children[0],oldImage=broken.children[0];oldImage.onerror();assert.equal(broken.hidden,true);assert.equal(oldImage.getAttribute('src'),null);
 layer.children[1].dispatch('click');assert.equal(image.src,entry(1).src);assert.equal(nav.children[0].disabled,true);assert.equal(nav.children[1].textContent,'1 / 1');
 image.onerror();assert.equal(ui.isOpen(),false);assert.equal(layer.children[1].hidden,true);
 ui.setNode({id:'two',label:'Dos',media:[entry(2)]});oldImage.onerror();ui.render(args);assert.equal(layer.children[0].hidden,false);
 layer.children[0].dispatch('click');ui.setNode(null);assert.equal(viewer.open,false);assert.equal(layer.children.length,0);ui.dispose();
});

test('Media reflows safely after resize and crowded viewports never force an overlap',()=>{
 const {ui,layer}=fixture();ui.setNode({id:'test',label:'Prueba',media:[entry(),entry(1),entry(2)]});
 for(const [width,height] of [[1440,900],[390,844],[844,390]]){
   const obstacles=[{left:width*.35,right:width*.65,top:height*.25,bottom:height*.70}];
   const placed=ui.render({...args,width,height,obstacles});assert.ok(placed.length);
   for(const [i,rect] of placed.entries()){
     assert.ok(rect.left>=12&&rect.right<=width-12&&rect.top>=12&&rect.bottom<=height-12);
     for(const obstacle of [...obstacles,...placed.slice(0,i)])assert.equal(overlap(rect,obstacle),false);
   }
 }
 const placed=ui.render({...args,obstacles:[{left:0,right:1440,top:0,bottom:900}]});assert.equal(placed.length,0);assert.ok(layer.children.every(button=>button.hidden));
});

test('Three small WebP placeholders are attached to exactly two existing project nodes',()=>{
 const nodes=portfolio.nodes.filter(n=>n.media);assert.equal(nodes.length,2);
 assert.deepEqual(nodes.map(n=>n.id),['aprendizaje.proyectos-academicos.astralis','proyectos-personales.qfb-app']);
 const paths=new Set();for(const node of nodes)for(const item of nodeMedia(node.media)){assert.equal(item.placeholder,true);paths.add(item.src)}assert.equal(paths.size,3);
 for(const path of paths){const bytes=fs.readFileSync('public'+path);assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');assert.ok(bytes.length<250*1024)}
 const nginx=fs.readFileSync('nginx.conf','utf8');assert.match(nginx,/location \^~ \/media\//);assert.match(nginx,/try_files \$uri =404/);assert.match(nginx,/expires 1y/);assert.match(nginx,/public, immutable/);
});
