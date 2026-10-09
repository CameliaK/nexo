/** Fixed columns; the user prioritizes a 520 px center between 1180 and 1363 px. */
export function desktopChatRegions(width:number,height:number){
 const margin=40,gap=32,compact=width<1180;
 const lateral=Math.min(700,width-2*margin-2*gap-520);
 const leftWidth=compact?220:lateral*360/700,rightWidth=compact?220:lateral*340/700;
 const top=height<560?148:180,bottom=height<740?24:40,tabsHeight=52;
 const left=margin,centerLeft=left+leftWidth+gap,centerWidth=width-2*margin-2*gap-leftWidth-rightWidth,rightLeft=width-margin-rightWidth;
 const verticalGap=height<740?24:32,available=height-top-bottom;
 const systemHeight=Math.max(height<740?64:96,Math.min(compact?160:190,available-verticalGap-300));
 return {reserved:0,left,width:leftWidth,top,panelTop:top+tabsHeight,bottom,tabsHeight,compact,
  center:{left:centerLeft,right:centerLeft+centerWidth,top,bottom:height-bottom},
  header:{left:margin,top:116,width:width-margin*2-160,height:height<560?32:48},
  close:{left:width-margin,top:116},
  system:{left:rightLeft,top,width:rightWidth,height:systemHeight},
  aside:{left:rightLeft,top:top+systemHeight+verticalGap,width:rightWidth,height:Math.max(80,available-systemHeight-verticalGap)}};
}
