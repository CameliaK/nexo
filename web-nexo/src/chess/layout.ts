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
  const margin=width<650?18:28,footer=short?78:width<650?height<720?86:100:118;
  const headerTop=short?76:stacked?194:142,headerHeight=short?42:stacked?56:64;
  const playerHeight=short?30:stacked?height<720?32:40:44,helpHeight=short||stacked?0:34;
  const asideWidth=short?174:220,asideHeight=height<720?98:156;
  const asideLeft=stacked?margin:width-margin-asideWidth;
  const left=stacked?margin:Math.min(280,width*.22);
  const right=stacked?width-margin:asideLeft-24;
  const playerGap=short?8:12,headingGap=short?4:8;
  const top=headerTop+headerHeight+playerHeight+playerGap+headingGap;
  const bottom=height-footer-playerHeight-helpHeight-(stacked?asideHeight+playerGap+10:0);
  // Extremely short viewports still get a finite board and a scrollable control rail.
  const area={left:left+8,right:right-8,top,bottom:Math.max(top+24,bottom)};
  const projection={x:0,y:0,scale:1,tilt:stacked?.62:.72,yaw:stacked?-.045:-.10,distance:22};
  const unit=chessBounds(projection);
  const scale=Math.min((area.right-area.left)/(unit.right-unit.left),(area.bottom-area.top)/(unit.bottom-unit.top))*.9;
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
