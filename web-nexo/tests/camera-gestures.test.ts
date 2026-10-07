import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraGestures,pinchView,clampZoom,type GestureView} from '../src/camera-gestures';
function fixture(){
 const handlers=new Map<string,EventListener>(),canvas={setPointerCapture(){}},root={hidden:false,defaultView:{addEventListener:(type:string,fn:EventListener)=>handlers.set('window:'+type,fn),removeEventListener:(type:string)=>handlers.delete('window:'+type)},addEventListener:(type:string,fn:EventListener)=>handlers.set(type,fn),removeEventListener:(type:string)=>handlers.delete(type)};
 let view:GestureView={zoom:1,pan:{x:0,y:0},center:{x:180,y:320}},applies=0;
 const gestures=createCameraGestures({root:root as unknown as Document,canvas:canvas as unknown as HTMLCanvasElement,eligible:target=>target===canvas as unknown as EventTarget,enabled:()=>true,read:()=>view,apply:v=>{view=v;applies++},onStart(){}});
 function send(type:string,id:number,x:number,y:number,timeStamp?:number){let prevented=false;handlers.get(type)?.({type,pointerType:'touch',pointerId:id,timeStamp,target:canvas,clientX:x,clientY:y,detail:1,preventDefault(){prevented=true},stopImmediatePropagation(){prevented=true}} as unknown as Event);return prevented}
 return {gestures,send,view:()=>view,applies:()=>applies,handlers,root};
}
test('Pinch anchors its world point to the moving midpoint and uses the same 50–200% limits',()=>{
 const before={zoom:1,pan:{x:20,y:-10},center:{x:180,y:320}},old={x:100,y:200},next={x:140,y:210};
 const after=pinchView(before,old,next,1.5);
 for(const axis of ['x','y'] as const)assert.equal((old[axis]-before.center[axis]-before.pan[axis])/before.zoom,(next[axis]-after.center[axis]-after.pan[axis])/after.zoom);
 assert.equal(clampZoom(.1),.5);assert.equal(clampZoom(8),2);
});
test('Two-pointer samples apply only in RAF, consume taps and rebase the remaining finger without jumps',()=>{
 const f=fixture();f.send('pointerdown',1,100,200);f.send('pointerdown',2,200,200);
 f.send('pointermove',1,80,220);f.send('pointermove',2,240,220);assert.equal(f.applies(),0);f.gestures.flush();assert.equal(f.applies(),1);assert.equal(f.view().zoom,1.6);
 assert.equal(f.send('click',1,80,220),true);
 f.send('pointerup',2,240,220);const before={...f.view().pan};f.send('pointermove',1,90,225);f.gestures.flush();assert.equal(f.view().pan.x,before.x+10);assert.equal(f.view().pan.y,before.y+5);
 f.send('pointerup',1,90,225);assert.equal(f.send('click',1,90,225),true);f.send('pointerdown',1,90,225);f.send('pointerup',1,90,225);assert.equal(f.send('click',1,90,225),false,'the next deliberate tap is not blocked');f.gestures.dispose();assert.equal(f.handlers.size,0);
});
test('Cancellation, capture loss and a third finger cannot leave a gesture running; a single tap stays clickable',()=>{
 const f=fixture();f.send('pointerdown',1,100,200);f.send('pointerup',1,100,200);assert.equal(f.send('click',1,100,200),false);
 f.send('pointerdown',1,100,200);f.send('pointerdown',2,200,200);f.send('pointerdown',3,300,200);f.send('pointermove',3,400,400);f.gestures.flush();assert.equal(f.applies(),0);
 f.send('pointercancel',2,200,200);f.send('lostpointercapture',1,100,200);f.send('pointermove',1,300,300);f.gestures.flush();assert.equal(f.applies(),0);f.gestures.dispose();
});

test('A tap allows sub-8px movement under 500ms, but a hold or drag does not activate a node',()=>{
 const f=fixture();f.send('pointerdown',1,100,200,100);f.send('pointerup',1,107,200,250);assert.equal(f.send('click',1,107,200),false);
 f.send('pointerdown',1,100,200,300);f.send('pointerup',1,100,200,900);assert.equal(f.send('click',1,100,200),true);
 f.send('pointerdown',1,100,200,1000);f.send('pointerup',1,100,200,1050);assert.equal(f.send('click',1,100,200),false);f.gestures.dispose();
});

import {mobileChessLayout,chessBounds} from '../src/chess/layout';
test('Mobile board stays clear of system, player rows, control rail and safe areas in portrait and landscape',()=>{
 for(const [width,height]of [[390,844],[360,640],[844,390],[393,851],[851,393]]){
  const layout=mobileChessLayout({width,height,safeTop:12,safeBottom:8}),bounds=chessBounds(layout.camera);
  assert.ok(bounds.left>=0&&bounds.right<=width&&bounds.top>=layout.area.top-.001&&bounds.bottom<=layout.area.bottom+.001);
  if(width<height){assert.ok(bounds.top>=12+84);assert.ok(layout.white.top>=bounds.bottom);assert.ok(layout.aside.top>=layout.white.top+layout.white.height)}
  else {assert.ok(bounds.left>=148);assert.ok(bounds.right<=layout.aside.left)}
  assert.ok(layout.aside.top+layout.aside.height<=height-8);
 }
});

test('A portrait keyboard viewport does not turn the board into a landscape rail and leaves it above the chat dock',()=>{
 const layout=mobileChessLayout({width:390,height:320,chat:true,landscape:false});
 assert.equal(layout.stacked,true);assert.equal(layout.area.left,6);assert.ok(chessBounds(layout.camera).bottom<=160);
});

test('A deliberate mouse click and blur/visibility reset cannot inherit touch suppression',()=>{
 const f=fixture();f.send('pointerdown',1,100,200);f.send('pointerdown',2,200,200);f.send('pointerup',2,200,200);f.send('pointerup',1,100,200);
 f.handlers.get('pointerdown')?.({pointerType:'mouse'} as unknown as Event);assert.equal(f.send('click',1,100,200),false);
 f.send('pointerdown',1,100,200);f.send('pointerdown',2,200,200);const beforeBlur=f.applies();f.handlers.get('window:blur')?.({} as Event);f.send('pointermove',1,300,200);f.gestures.flush();assert.equal(f.applies(),beforeBlur);
 f.send('pointerdown',1,100,200);f.send('pointerdown',2,200,200);f.root.hidden=true;f.handlers.get('visibilitychange')?.({} as Event);f.root.hidden=false;f.send('pointerdown',1,100,200);f.send('pointermove',1,107,200);f.send('pointerup',1,107,200);assert.equal(f.send('click',1,107,200),false);f.gestures.dispose();
});

import {chessPhase} from '../src/chess/transition';
import {motion} from '../src/motion';
test('Chess unfolds over 1.4 seconds before its pieces fade in; the same phases reverse',()=>{
 assert.equal(motion.chessApproach+motion.chessUnfold+motion.chessPieces,motion.chessOpen);assert.equal(motion.chessOpen,1400);assert.equal(motion.chessClose,1400);
 assert.equal(chessPhase(0).board,0);assert.equal(chessPhase(.2).pieces,0);assert.ok(chessPhase(.6).unfold>0);assert.equal(chessPhase(.6).pieces,0);assert.equal(chessPhase(1).pieces,1);
 assert.deepEqual(chessPhase(.4,true),{approach:0,unfold:1,board:.4,pieces:.4,pulse:0});
});
