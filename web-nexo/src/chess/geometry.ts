import type { Square } from 'chess.js';

export type Point = [number, number];
export type Triangle = [Point, Point, Point];
const cross = (a: Point, b: Point, c: Point) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export const triangleArea = (t: Triangle) => Math.abs(cross(...t))/2;

// Ear clipping keeps concave silhouettes (especially the knight / crowns) intact.
export function triangulate(outline: Point[]): Triangle[] {
  const points = [...outline];
  const signed = points.reduce((sum,p,i)=>sum+p[0]*points[(i+1)%points.length][1]-points[(i+1)%points.length][0]*p[1],0);
  if(signed<0)points.reverse();
  const result: Triangle[] = [];
  while(points.length>3){
    let clipped=false;
    for(let i=0;i<points.length;i++){
      const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
      if(cross(a,b,c)<=1e-10)continue;
      if(points.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=-1e-10&&cross(b,c,p)>=-1e-10&&cross(c,a,p)>=-1e-10))continue;
      result.push([a,b,c]);points.splice(i,1);clipped=true;break;
    }
    if(!clipped)throw new Error('Invalid chess silhouette');
  }
  result.push(points as Triangle);
  return result;
}
export function squareAt(row: number,col: number,flipped=false): Square {
  return `${'abcdefgh'[flipped?7-col:col]}${flipped?row+1:8-row}` as Square;
}
export function squareCoords(square: Square,flipped=false): Point {
  const col='abcdefgh'.indexOf(square[0]),row=8-Number(square[1]);
  return flipped?[7-col,7-row]:[col,row];
}
/** Reuse every source face, subdividing it without gaps to match target count. */
export function subdivideSource(faces: Triangle[],count: number): Triangle[] {
  const result:Triangle[]=[];
  faces.forEach(([a,b,c],i)=>{
    const parts=Math.floor(count/faces.length)+(i<count%faces.length?1:0);
    for(let j=0;j<parts;j++){
      const point=(t:number):Point=>[b[0]+(c[0]-b[0])*t,b[1]+(c[1]-b[1])*t];
      result.push([a,point(j/parts),point((j+1)/parts)]);
    }
  });
  return result;
}
