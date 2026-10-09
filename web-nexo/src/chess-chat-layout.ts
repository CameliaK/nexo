import { easeOut, motion } from './motion';
/** One clock for the canvas board, system window and the sliding chat column. */
let from=0,to=0,start=0;
export function chessChatProgress(now=performance.now()){
 return from+(to-from)*easeOut((now-start)/motion.chessChat);
}
export function setChessChatLayout(open:boolean,reduced=false,now=performance.now()){
 from=chessChatProgress(now);to=open?1:0;start=now;
 if(reduced)from=to;
}
export function chessChatAnimating(now=performance.now()){return from!==to&&now-start<motion.chessChat}
export function desktopChatRegions(width:number,height:number){
 const column=Math.min(380,Math.max(280,width*.30)),reserved=column+48,top=height<650?72:164;
 return {reserved,left:width-column-24,width:column,top,panelTop:top+52,bottom:24,
  system:{left:width-reserved-242,top:height<650?112:192,width:218,height:120}};
}
