/** Fixed columns; the user prioritizes a 520 px center between 1180 and 1363 px. */
export function desktopChatRegions(width:number,height:number){
 const margin=40,gap=32,compact=width<1180;
 const lateral=Math.min(700,width-2*margin-2*gap-520);
 const leftWidth=compact?220:lateral*360/700,rightWidth=compact?220:lateral*340/700;
 const top=height<600?132:180,bottom=40,tabsHeight=compact?64:52;
 const left=margin,centerLeft=left+leftWidth+gap,centerWidth=width-2*margin-2*gap-leftWidth-rightWidth,rightLeft=width-margin-rightWidth;
 const systemHeight=compact?160:190;
 return {reserved:0,left,width:leftWidth,top,panelTop:top+tabsHeight,bottom,tabsHeight,compact,
  center:{left:centerLeft,right:centerLeft+centerWidth,top,bottom:height-bottom},
  header:{left:margin,top:height<600?72:116,width:width-margin*2-160,height:48},
  close:{left:width-margin,top:height<600?72:116},
  system:{left:rightLeft,top,width:rightWidth,height:systemHeight},
  aside:{left:rightLeft,top:top+systemHeight+32,width:rightWidth,height:Math.max(120,height-bottom-top-systemHeight-32)}};
}
