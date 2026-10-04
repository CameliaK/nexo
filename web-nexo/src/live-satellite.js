// Screen-space geometry keeps this satellite independent of portfolio IDs.
export const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const distance = (a, b) => (a.x-b.x)**2+(a.y-b.y)**2;
const inset = 12;

export function satelliteFootprint(radius, caption = true) {
  return {left:caption?-58:-radius-10,right:caption?58:radius+10,top:-radius-12,bottom:caption?radius+39:radius+10};
}

// A straight drift may only pass through free space, even when both ends fit.
function clearPath(from, to, forbidden) {
  return forbidden.every(box => {
    let lo=0,hi=1;
    for(const [start,delta,min,max] of [[from.x,to.x-from.x,box.left,box.right],[from.y,to.y-from.y,box.top,box.bottom]]){
      if(!delta){if(start<=min||start>=max)return true;continue}
      const a=(min-start)/delta,b=(max-start)/delta;
      lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
      if(lo>=hi)return true;
    }
    return hi<=0||lo>=1;
  });
}

export function placeSatellite({width,height,obstacles,preferred,previous,footprint,preview=null,ease=1}) {
  const bubbles=preview?[
    {left:footprint.left-preview.width-10,right:footprint.left-10,top:-preview.height/2,bottom:preview.height/2},
    {left:footprint.right+10,right:footprint.right+10+preview.width,top:-preview.height/2,bottom:preview.height/2},
    {left:-preview.width/2,right:preview.width/2,top:footprint.top-preview.height-10,bottom:footprint.top-10},
    {left:-preview.width/2,right:preview.width/2,top:footprint.bottom+10,bottom:footprint.bottom+10+preview.height},
  ]:[null];
  if(previous?.bubble&&preview)bubbles.sort((a,b)=>distance({x:a.left,y:a.top},{x:previous.bubble.left,y:previous.bubble.top})-distance({x:b.left,y:b.top},{x:previous.bubble.left,y:previous.bubble.top}));
  let best=null;
  for(const bubble of bubbles){
    const shapes=bubble?[footprint,bubble]:[footprint];
    const bounds={left:inset-Math.min(...shapes.map(s=>s.left)),right:width-inset-Math.max(...shapes.map(s=>s.right)),top:inset-Math.min(...shapes.map(s=>s.top)),bottom:height-inset-Math.max(...shapes.map(s=>s.bottom))};
    if(bounds.left>bounds.right||bounds.top>bounds.bottom)continue;
    const forbidden=obstacles.flatMap(o=>shapes.map(s=>({left:o.left-s.right-8,right:o.right-s.left+8,top:o.top-s.bottom-8,bottom:o.bottom-s.top+8})));
    const free=p=>p.x>=bounds.left&&p.x<=bounds.right&&p.y>=bounds.top&&p.y<=bounds.bottom&&!forbidden.some(o=>p.x>o.left&&p.x<o.right&&p.y>o.top&&p.y<o.bottom);
    const constrain=p=>({x:Math.max(bounds.left,Math.min(bounds.right,p.x)),y:Math.max(bounds.top,Math.min(bounds.bottom,p.y))});
    const target=constrain(preferred),stable=previous&&free(previous);
    if(free(target)&&(!stable||clearPath(previous,target,forbidden))){
      const point=stable?{x:previous.x+(target.x-previous.x)*ease,y:previous.y+(target.y-previous.y)*ease}:target;
      return {...point,bubble};
    }
    const candidates=[target,constrain(previous||preferred),{x:bounds.left,y:bounds.top},{x:bounds.right,y:bounds.top},{x:bounds.left,y:bounds.bottom},{x:bounds.right,y:bounds.bottom}];
    for(const o of forbidden){
      for(const x of [o.left,o.right])for(const y of [o.top,o.bottom,target.y])candidates.push(constrain({x,y}));
      for(const y of [o.top,o.bottom])candidates.push(constrain({x:target.x,y}));
    }
    // Edge intersections find narrow gaps between several moving obstacles.
    const xs=[bounds.left,bounds.right,...forbidden.flatMap(o=>[o.left,o.right])].filter(x=>x>=bounds.left&&x<=bounds.right);
    const ys=[bounds.top,bounds.bottom,...forbidden.flatMap(o=>[o.top,o.bottom])].filter(y=>y>=bounds.top&&y<=bounds.bottom);
    const consider=p=>{
      if(!free(p)||(stable&&!clearPath(previous,p,forbidden)))return;
      const score=distance(p,target)+(previous?distance(p,previous)*.35:0);
      if(!best||score<best.score){
        const point=stable?{x:previous.x+(p.x-previous.x)*ease,y:previous.y+(p.y-previous.y)*ease}:p;
        best={...point,bubble,score};
      }
    };
    for(const p of candidates)consider(p);
    if(!best)for(const x of xs)for(const y of ys)consider({x,y});
    if(best&&best.score<1)break;
  }
  // On a crowded small viewport, keep the node accessible even if text cannot fit.
  if(!best&&preview)return placeSatellite({width,height,obstacles,preferred,previous,footprint,ease});
  return best;
}

export class LivePreview {
  constructor(now=()=>performance.now()){this.now=now;this.expires=0;this.remaining=0;this.hovered=false;this.visible=false}
  show(){this.visible=true;this.remaining=5000;this.expires=this.now()+5000}
  clear(){this.visible=false;this.remaining=0}
  hover(value){
    if(value===this.hovered)return;
    if(value)this.remaining=Math.max(0,this.expires-this.now());
    else this.expires=this.now()+this.remaining;
    this.hovered=value;
  }
  opacity(reduced=false){
    if(!this.visible)return 0;
    const remaining=this.hovered?this.remaining:this.expires-this.now();
    if(remaining<=0){this.clear();return 0}
    return reduced?1:Math.min(1,remaining/350);
  }
}
