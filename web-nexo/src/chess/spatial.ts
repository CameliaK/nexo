import type { PieceSymbol } from 'chess.js';
import { triangulate, type Point, type Triangle } from './geometry';

export type Vec3 = [number, number, number];
export type Tri3 = [Vec3, Vec3, Vec3];
export interface Mesh { vertices: Vec3[]; faces: [number,number,number][] }
export interface Camera { x:number; y:number; scale:number; tilt:number; yaw:number; distance:number }
export const normal=([a,b,c]:Tri3):Vec3=>{
  const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);
  const n:Vec3=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n)||1;
  return n.map(x=>x/length) as Vec3;
};
function meshBuilder(){
  const mesh:Mesh={vertices:[],faces:[]};
  const triangle=(a:Vec3,b:Vec3,c:Vec3)=>{
    const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);
    if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-8)return;
    const index=mesh.vertices.length;mesh.vertices.push(a,b,c);mesh.faces.push([index,index+1,index+2]);
  };
  const quad=(a:Vec3,b:Vec3,c:Vec3,d:Vec3)=>{triangle(a,b,c);triangle(a,c,d)};
  return {mesh,triangle,quad};
}
/** Faceted solids of revolution, with closed bases and heads. */
function lathe(profile:Point[],sides=8):Mesh{
  const out=meshBuilder();
  const ring=(r:number,y:number,i:number):Vec3=>[Math.cos(i/sides*Math.PI*2)*r,y,Math.sin(i/sides*Math.PI*2)*r];
  for(let row=0;row<profile.length-1;row++)for(let i=0;i<sides;i++){
    const [r,y]=profile[row],[rr,yy]=profile[row+1];
    out.quad(ring(r,y,i),ring(rr,yy,i),ring(rr,yy,i+1),ring(r,y,i+1));
  }
  return out.mesh;
}
function extrude(outline:Point[],depth:number):Mesh{
  const out=meshBuilder();
  for(const [a,b,c] of triangulate(outline)){
    out.triangle([c[0],c[1],-depth/2],[b[0],b[1],-depth/2],[a[0],a[1],-depth/2]);
    out.triangle([a[0],a[1],depth/2],[b[0],b[1],depth/2],[c[0],c[1],depth/2]);
  }
  const signed=outline.reduce((sum,p,i)=>sum+p[0]*outline[(i+1)%outline.length][1]-outline[(i+1)%outline.length][0]*p[1],0);
  const wall=signed>0?[...outline].reverse():outline;
  wall.forEach((a,i)=>{const b=wall[(i+1)%wall.length];out.quad([a[0],a[1],-depth/2],[a[0],a[1],depth/2],[b[0],b[1],depth/2],[b[0],b[1],-depth/2])});
  return out.mesh;
}
function merge(...meshes:Mesh[]):Mesh{
  const result:Mesh={vertices:[],faces:[]};
  for(const mesh of meshes){const offset=result.vertices.length;result.vertices.push(...mesh.vertices);result.faces.push(...mesh.faces.map(face=>face.map(i=>i+offset) as [number,number,number]))}
  return result;
}
const base:Point[]=[[0,0],[.30,0],[.32,.07],[.27,.14],[.24,.18],[.20,.22]];
function crown(kind:'r'|'q'):Mesh{
  const out=meshBuilder(),sides=kind==='r'?16:12;
  const lower=(i:number):Vec3=>[Math.cos(i/sides*Math.PI*2)*(kind==='r'?.27:.14),kind==='r'?.68:.72,Math.sin(i/sides*Math.PI*2)*(kind==='r'?.27:.14)];
  const upper=(i:number):Vec3=>[Math.cos(i/sides*Math.PI*2)*.29,kind==='r'?(i%4<2?.99:.83):(i%2? .88:1.09),Math.sin(i/sides*Math.PI*2)*.29];
  for(let i=0;i<sides;i++){
    out.quad(lower(i),upper(i),upper(i+1),lower(i+1));
    out.triangle(upper(i),[0,kind==='r'?.80:.87,0],upper(i+1));
  }
  return out.mesh;
}
export const pieceSolids:Record<PieceSymbol,Mesh>={
  p:lathe([...base,[.13,.29],[.09,.48],[.15,.54],[.15,.59],[.09,.62],[.16,.67],[.18,.77],[.13,.88],[0,.92]]),
  r:merge(lathe([...base,[.16,.29],[.17,.62],[.27,.68],[.27,.72],[0,.72]]),crown('r')),
  n:merge(lathe([...base,[.16,.28],[0,.28]]),extrude([[-.20,.21],[-.10,.45],[-.15,.64],[-.29,.66],[-.34,.78],[-.10,.97],[-.09,1.14],[.02,1.04],[.11,1.12],[.29,.88],[.32,.67],[.15,.21]],.30)),
  b:lathe([...base,[.13,.30],[.08,.55],[.18,.59],[.18,.65],[.08,.69],[.20,.80],[.13,.94],[.03,1.07],[0,1.09]]),
  q:merge(lathe([...base,[.13,.31],[.08,.56],[.18,.61],[.18,.66],[.13,.72],[0,.72]]),crown('q'),lathe([[0,1.03],[.055,1.07],[0,1.13]])),
  k:merge(lathe([...base,[.14,.32],[.09,.58],[.19,.64],[.19,.71],[.10,.76],[.12,.86],[0,.90]]),extrude([[-.06,.85],[.06,.85],[.06,.96],[.19,.96],[.19,1.07],[.06,1.07],[.06,1.20],[-.06,1.20],[-.06,1.07],[-.19,1.07],[-.19,.96],[-.06,.96]],.15)),
};
export function box(x0:number,y0:number,z0:number,x1:number,y1:number,z1:number):Mesh{
  return {vertices:[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],faces:[[4,7,6],[4,6,5],[0,1,2],[0,2,3],[3,2,6],[3,6,7],[0,4,5],[0,5,1],[0,3,7],[0,7,4],[1,5,6],[1,6,2]]};
}
export function project3D(p:Vec3,camera:Camera):{point:Point;depth:number}{
  const x=p[0]-4,z=p[2]-4,c=Math.cos(camera.yaw),s=Math.sin(camera.yaw);
  const rx=x*c+z*s,rz=z*c-x*s,depth=rz*Math.sin(camera.tilt)+p[1]*Math.cos(camera.tilt);
  const perspective=camera.distance/(camera.distance-depth);
  return {point:[camera.x+rx*camera.scale*perspective,camera.y+(rz*Math.cos(camera.tilt)-p[1]*Math.sin(camera.tilt))*camera.scale*perspective],depth};
}
/** Inverse projection onto the board's y=0 surface for click / drag picking. */
export function unprojectBoard(point:Point,camera:Camera):Point{
  const u=(point[0]-camera.x)/camera.scale,v=(point[1]-camera.y)/camera.scale;
  const rz=v*camera.distance/(Math.cos(camera.tilt)*camera.distance+v*Math.sin(camera.tilt));
  const rx=u*(camera.distance-rz*Math.sin(camera.tilt))/camera.distance;
  const c=Math.cos(camera.yaw),s=Math.sin(camera.yaw);
  return [rx*c-rz*s+4,rx*s+rz*c+4];
}
export function cellPolygon(col:number,row:number,camera:Camera):Point[]{
  return [[col,0,row],[col+1,0,row],[col+1,0,row+1],[col,0,row+1]].map(p=>project3D(p as Vec3,camera).point);
}
export function insideTriangle(point:Point,t:Triangle){
  const cross=(a:Point,b:Point)=>(b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0]);
  const signs=t.map((p,i)=>cross(p,t[(i+1)%3]));return signs.every(n=>n>=0)||signs.every(n=>n<=0);
}
