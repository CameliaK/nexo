export function companionDestination(width:number,height:number,pointer:{x:number;y:number}|null,pinned:boolean){
 const mobile=width<650,radius=mobile?18:24,margin=radius+12;
 const clamp=(n:number,max:number)=>Math.max(margin,Math.min(max-margin,n));
 return {x:clamp(pinned?width-48:pointer?pointer.x+48:width*.82,width),y:clamp(pinned?height-(mobile?230:152):pointer?pointer.y+48:height*.69,height)};
}
export function followCompanion(from:{x:number;y:number},to:{x:number;y:number},dt:number){
 const ease=1-Math.exp(-Math.max(0,dt)*.12);return{x:from.x+(to.x-from.x)*ease,y:from.y+(to.y-from.y)*ease};
}
/** A hold never also opens the assistant. Movement/cancel keeps normal taps intact. */
export function companionHold(target:HTMLElement,options:{delay:number;toggle():void;holding(value:boolean):void}){
 let timer:ReturnType<typeof setTimeout>|undefined,pointer:number|null=null,start={x:0,y:0},suppress=false;
 const clear=()=>{clearTimeout(timer);timer=undefined};
 const down=(e:PointerEvent)=>{if(pointer!==null||e.button>0||e.isPrimary===false)return;pointer=e.pointerId;start={x:e.clientX,y:e.clientY};suppress=false;options.holding(true);try{target.setPointerCapture?.(e.pointerId)}catch{/* A canceled pointer cannot be captured. */}timer=setTimeout(()=>{timer=undefined;suppress=true;options.toggle()},options.delay)};
 const move=(e:PointerEvent)=>{if(pointer===e.pointerId&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)clear()};
 const end=(e:PointerEvent)=>{if(pointer!==e.pointerId)return;clear();pointer=null;options.holding(false);try{target.releasePointerCapture?.(e.pointerId)}catch{/* Capture may already be released. */}};
 const click=(e:MouseEvent)=>{if(suppress&&e.detail!==0){suppress=false;e.preventDefault();e.stopImmediatePropagation()}};
 const cancel=()=>{clear();pointer=null;suppress=false;options.holding(false)};
 target.addEventListener('pointerdown',down);target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);target.addEventListener('lostpointercapture',end);target.addEventListener('click',click,{capture:true});
 if(typeof window!=='undefined')window.addEventListener('blur',cancel);
 return()=>{cancel();target.removeEventListener?.('pointerdown',down);target.removeEventListener?.('pointermove',move);target.removeEventListener?.('pointerup',end);target.removeEventListener?.('pointercancel',end);target.removeEventListener?.('lostpointercapture',end);target.removeEventListener?.('click',click,{capture:true});if(typeof window!=='undefined')window.removeEventListener('blur',cancel)};
}
