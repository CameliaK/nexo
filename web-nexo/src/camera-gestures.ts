export const clampZoom=(value:number)=>Math.max(.5,Math.min(2,value));
type Point={x:number;y:number};
export type GestureView={zoom:number;pan:Point;center:Point};
/** Preserve the world point underneath the old midpoint while panning to the new one. */
export function pinchView(view:GestureView,previous:Point,next:Point,ratio:number):GestureView{
 const zoom=clampZoom(view.zoom*ratio),scale=zoom/view.zoom;
 return {...view,zoom,pan:{x:next.x-view.center.x-(previous.x-view.center.x-view.pan.x)*scale,y:next.y-view.center.y-(previous.y-view.center.y-view.pan.y)*scale}};
}
/** Events only collect coordinates. The universe calls flush from its existing RAF. */
export function createCameraGestures(options:{root:Document;canvas:HTMLCanvasElement;eligible:(target:EventTarget|null)=>boolean;enabled:()=>boolean;read:()=>GestureView;apply:(view:GestureView)=>void;onStart:()=>void}){
 const {root,canvas}=options,points=new Map<number,Point>();
 let baseline:Point[]=[],dirty=false,moved=false,pinched=false,start:Point|null=null,suppressUntil=0;
 const snapshot=()=>[...points.values()].map(p=>({...p}));
 const middle=(a:Point,b:Point)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
 const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
 function flush(){
  if(!dirty||!points.size)return;dirty=false;
  const next=snapshot(),view=options.read();
  if(next.length===2&&baseline.length===2){
   const oldDistance=distance(...baseline as [Point,Point]);
   options.apply(pinchView(view,middle(...baseline as [Point,Point]),middle(...next as [Point,Point]),oldDistance?distance(...next as [Point,Point])/oldDistance:1));
  }else if(next.length===1&&baseline.length===1&&moved){
   options.apply({...view,pan:{x:view.pan.x+next[0].x-baseline[0].x,y:view.pan.y+next[0].y-baseline[0].y}});
  }
  if(moved||pinched)baseline=next;
 }
 const capture=(id:number)=>{try{canvas.setPointerCapture(id)}catch{/* A canceled pointer is no longer capturable. */}};
 function down(e:PointerEvent){
  if(e.pointerType!=='touch'||!options.enabled()||!options.eligible(e.target)||points.size>=2)return;
  flush();points.set(e.pointerId,{x:e.clientX,y:e.clientY});baseline=snapshot();dirty=false;
  if(points.size===1){suppressUntil=0;start={x:e.clientX,y:e.clientY};moved=false;pinched=false;options.onStart();}
  else {moved=pinched=true;suppressUntil=Infinity;for(const id of points.keys())capture(id);e.preventDefault();options.onStart();}
 }
 function move(e:PointerEvent){
  if(!points.has(e.pointerId))return;
  points.set(e.pointerId,{x:e.clientX,y:e.clientY});dirty=true;
  if(!moved&&start&&distance(start,{x:e.clientX,y:e.clientY})>6){moved=true;suppressUntil=Infinity;capture(e.pointerId);options.onStart();}
  if(moved||pinched)e.preventDefault();
 }
 function end(e:PointerEvent){
  if(!points.has(e.pointerId))return;
  if(e.type==='pointerup'){points.set(e.pointerId,{x:e.clientX,y:e.clientY});dirty=true;flush();}
  points.delete(e.pointerId);baseline=snapshot();dirty=false;start=baseline[0]||null;
  if(!points.size){if(moved||pinched)suppressUntil=performance.now()+800;moved=pinched=false;}
  else {moved=true;pinched=true;}
 }
 function cancel(){const ids=[...points.keys()];points.clear();for(const id of ids){try{if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id)}catch{/* A canceled capture may already have been released. */}}baseline=[];dirty=false;start=null;if(moved||pinched)suppressUntil=performance.now()+800;moved=pinched=false;}
 function click(e:MouseEvent){if(e.detail!==0&&options.eligible(e.target)&&performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}}
 const listeners=[['pointerdown',down],['pointermove',move],['pointerup',end],['pointercancel',end],['lostpointercapture',end],['click',click]] as const;
 for(const [type,fn]of listeners)root.addEventListener(type,fn as EventListener,{capture:true,passive:false});
 return {flush,cancel,dispose(){cancel();for(const [type,fn]of listeners)root.removeEventListener?.(type,fn as EventListener,{capture:true})}};
}
