export interface MobileViewport {width:number;height:number;safeTop?:number;safeBottom?:number;offsetTop?:number;chat?:boolean;landscape?:boolean;browserInset?:number;composerHeight?:number}
/** The existing system window keeps its compact composition in every location. */
export function mobileSystemBox({width,height,safeTop=0,offsetTop=0,chat=false,landscape=width>height}:MobileViewport){
  const scale=chat? .86:1;
  return {left:landscape?8:width-12-138*scale,top:offsetTop+safeTop+(landscape?84:48),width:138*scale,height:88*scale};
}

/** Stable mobile geometry shared by the game and its docked surfaces. */
export function mobileViewport({height,safeBottom=0,offsetTop=0,chat=false,landscape=false,browserInset,composerHeight=0}:MobileViewport){
 const inset=browserInset??(chat&&height<480&&!landscape?8:Math.max(safeBottom,16)+(landscape?16:56));
 const usable=Math.max(120,height-inset),base=Math.min(usable*.55,460);
 const dock=chat?Math.min(usable-(composerHeight?84:44),Math.max(base,composerHeight?composerHeight+160:0)):0;
 return {inset,bottom:offsetTop+usable-dock,dock,dockTop:offsetTop+usable-dock};
}
