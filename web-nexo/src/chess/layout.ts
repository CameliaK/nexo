import { mobileSystemBox, mobileViewport, type MobileViewport } from '../mobile-layout';
import { box, project3D, type Camera } from './spatial';

export interface Rect {left:number;right:number;top:number;bottom:number}
export interface ChessViewport {width:number;height:number}
export interface ChessView {zoom:number;pan:{x:number;y:number}}

// Includes the board thickness, tallest piece (also while dragged), and ranks/files.
const envelope=box(-.42,-.36,-.15,8.2,1.2,8.34).vertices;
export function chessBounds(camera:Camera):Rect{
  const points=envelope.map(vertex=>project3D(vertex,camera).point);
  return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
}

/** Camera changes never push the board through its surrounding game controls. */
export function fitChessCamera(camera:Camera,area:Rect):Camera{
  const unit=chessBounds({...camera,x:0,y:0,scale:1});
  const scale=Math.min(camera.scale,(area.right-area.left)/(unit.right-unit.left),(area.bottom-area.top)/(unit.bottom-unit.top));
  const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
  return {...camera,scale,x:clamp(camera.x,area.left-unit.left*scale,area.right-unit.right*scale),y:clamp(camera.y,area.top-unit.top*scale,area.bottom-unit.bottom*scale)};
}

export function chessLayout({width,height}:ChessViewport,view:ChessView={zoom:1,pan:{x:0,y:0}}){
  const short=height<600,stacked=width<960&&!(width>=700&&height<650);
  const margin=width<650?12:28,footer=short?84:width<650?height<720?86:100:104;
  const headerTop=short?64:stacked?82:108,headerHeight=short?26:56;
  const playerHeight=short?28:40,helpHeight=0;
  const asideWidth=short?174:220,asideHeight=height<720?98:156;
  const asideLeft=stacked?margin:width-margin-asideWidth;
  const left=stacked?margin:Math.min(260,width*.17);
  const right=stacked?width-margin:asideLeft-24;
  const playerGap=short?8:12,headingGap=short?4:8;
  const top=headerTop+headerHeight+playerHeight+playerGap+headingGap;
  const bottom=height-footer-playerHeight-helpHeight-(stacked?asideHeight+playerGap+10:0);
  // Extremely short viewports still get a finite board and a scrollable control rail.
  const area={left:left+8,right:right-8,top,bottom:Math.max(top+24,bottom)};
  const projection={x:0,y:0,scale:1,tilt:stacked?.62:1.0,yaw:stacked?-.045:-.10,distance:22};
  const unit=chessBounds(projection);
  const desired=Math.min(880,height*.78,width*.70);
  const scale=Math.min((area.right-area.left)/(unit.right-unit.left),(area.bottom-area.top)/(unit.bottom-unit.top),stacked?Infinity:desired/(unit.right-unit.left))*.98;
  const base={...projection,scale,x:(area.left+area.right)/2-(unit.left+unit.right)*scale/2,y:(area.top+area.bottom)/2-(unit.top+unit.bottom)*scale/2};
  const camera=fitChessCamera({...base,x:width/2+(base.x-width/2)*view.zoom+view.pan.x,y:height*.53+(base.y-height*.53)*view.zoom+view.pan.y,scale:base.scale*view.zoom},area);
  // Anchor information to the fitted silhouette, including its pieces and labels.
  // The reserved area remains the limit for camera travel, not the UI anchor.
  const bounds=chessBounds(camera),boardWidth=bounds.right-bounds.left;
  const contentWidth=Math.max(boardWidth,Math.min(260,right-left));
  const contentLeft=stacked?Math.max(left,Math.min(right-contentWidth,(bounds.left+bounds.right-contentWidth)/2)):bounds.left;
  const blackTop=bounds.top-playerHeight-playerGap,headingTop=blackTop-headerHeight-headingGap;
  const whiteTop=bounds.bottom+playerGap,asideTop=stacked?whiteTop+playerHeight+10:bounds.top+8;
  return {camera,area,stacked,compact:short,
    header:{left:contentLeft,top:headingTop,width:contentWidth-44,height:headerHeight},
    close:{left:contentLeft+contentWidth,top:headingTop+(short?0:14)},
    black:{left:contentLeft,top:blackTop,width:contentWidth,height:playerHeight},
    white:{left:contentLeft,top:whiteTop,width:contentWidth,height:playerHeight},
    help:{left:contentLeft,top:whiteTop+playerHeight+5,width:contentWidth},
    aside:{left:stacked?contentLeft:bounds.right+20,top:asideTop,width:stacked?contentWidth:asideWidth,height:stacked?asideHeight:Math.max(80,height-footer-asideTop)}};
}

/** Mobile keeps the camera independent of the universe underneath the game. */
export function mobileChessLayout({width,height,safeTop=0,safeBottom=0,offsetTop=0,chat=false,landscape=width>height,browserInset}:MobileViewport){
 const compactChat=chat&&height<480,headerHeight=44,playerHeight=24;
 const {bottom}=mobileViewport({width,height,safeBottom,offsetTop,chat,landscape,browserInset});
 const top=offsetTop+safeTop,system=mobileSystemBox({width,height,safeTop,offsetTop,chat,landscape});
 const left=landscape?164:6,right=landscape?width-196:compactChat?system.left-10:width-6;
 const area={left,right,top:landscape||compactChat?top+44:system.top+system.height+12,bottom:Math.max(top+72,bottom-(chat?6:landscape?12:104))};
 const projection={x:0,y:0,scale:1,tilt:.55,yaw:0,distance:100},unit=chessBounds(projection);
 const scale=Math.max(.01,Math.min((right-left)/(unit.right-unit.left),(area.bottom-area.top)/(unit.bottom-unit.top)));
 const camera={...projection,scale,x:(left+right)/2-(unit.left+unit.right)*scale/2,y:landscape?(area.top+area.bottom)/2-(unit.top+unit.bottom)*scale/2:area.top+Math.min(24,(area.bottom-area.top-(unit.bottom-unit.top)*scale)/2)-unit.top*scale};
 const bounds=chessBounds(camera),railLeft=landscape?width-184:12,railTop=landscape?top+52:bounds.bottom+8;
 return {camera,area,system,stacked:!landscape,compact:true,
  header:{left:landscape?164:12,top:top+4,width:landscape?width-290:width-132,height:headerHeight},
  close:{left:width-12,top:top+4},
  black:{left:12,top:top+(landscape?4:50),width:landscape?140:system.left-24,height:playerHeight},
  white:{left:12,top:top+(landscape?30:76),width:landscape?140:system.left-24,height:playerHeight},
  status:{left:12,top:top+(landscape?56:102),width:landscape?140:system.left-24,height:28},
  help:{left:12,top:bottom-12,width:width-24},
  aside:{left:railLeft,top:railTop,width:landscape?172:width-24,height:Math.max(64,bottom-railTop)}};
}
