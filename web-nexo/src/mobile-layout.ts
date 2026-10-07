export interface MobileViewport {width:number;height:number;safeTop?:number;safeBottom?:number;offsetTop?:number;chat?:boolean;landscape?:boolean}
/** The existing system window keeps its compact composition in every location. */
export function mobileSystemBox({width,height,safeTop=0,offsetTop=0,chat=false,landscape=width>height}:MobileViewport){
  const scale=chat? .86:1;
  return {left:landscape?8:width-12-138*scale,top:offsetTop+safeTop+(landscape?84:48),width:138*scale,height:88*scale};
}
