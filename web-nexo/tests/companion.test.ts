import test from 'node:test';
import assert from 'node:assert/strict';
import {companionDestination,followCompanion,companionHold} from '../src/companion';
import {motion} from '../src/motion';
test('Companion follows a continuous offset, stays on screen, and has a camera-independent dock',()=>{
 let point={x:250,y:300};for(let i=0;i<90;i++){const next=followCompanion(point,companionDestination(1440,900,{x:400+i,y:320},false),1);assert.ok(Math.hypot(next.x-point.x,next.y-point.y)<30);point=next}
 for(const [w,h]of [[1440,900],[390,844],[360,640]]){const a=companionDestination(w,h,{x:0,y:0},true),b=companionDestination(w,h,{x:999,y:999},true);assert.deepEqual(a,b);assert.ok(a.x<w&&a.y<h-100);const edge=companionDestination(w,h,{x:w,y:h},false);assert.ok(edge.x<w&&edge.y<h)}
});
test('Long holds toggle once, suppress the generated click, and movement/cancellation never toggle',context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 const target=new EventTarget() as unknown as HTMLElement;target.setPointerCapture=()=>{};target.releasePointerCapture=()=>{};
 let toggles=0,holding=false,clicks=0;const dispose=companionHold(target,{delay:motion.companionHold,toggle:()=>toggles++,holding:v=>holding=v});
 target.addEventListener('click',()=>clicks++);
 const send=(type:string,x=20)=>{const e=Object.assign(new Event(type,{cancelable:true}),{pointerId:1,button:0,isPrimary:true,clientX:x,clientY:30,detail:1});target.dispatchEvent(e);return e};
 send('pointerdown');context.mock.timers.tick(motion.companionHold-1);assert.equal(toggles,0);context.mock.timers.tick(1);assert.equal(toggles,1);assert.equal(holding,true);send('pointerup');assert.equal(send('click').defaultPrevented,true);assert.equal(clicks,0);assert.equal(holding,false);
 send('pointerdown');send('pointermove',40);context.mock.timers.tick(1000);send('pointerup');send('click');assert.equal(toggles,1);assert.equal(clicks,1);
 send('pointerdown');send('pointercancel');context.mock.timers.tick(1000);assert.equal(toggles,1);
 send('pointerdown');context.mock.timers.tick(motion.companionHold);send('pointerup');send('click');assert.equal(toggles,2);dispose();
});
