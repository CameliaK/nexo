import {inflateSync} from 'node:zlib';
/** Read 8-bit RGB/RGBA browser PNGs without another test dependency. */
export function pngPixels(buffer){
 const chunks=[];let width,height,bpp;
 for(let p=8;p<buffer.length;){const n=buffer.readUInt32BE(p),type=buffer.toString('ascii',p+4,p+8),data=buffer.subarray(p+8,p+8+n);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);if(data[8]!==8||![2,6].includes(data[9]))throw Error('Expected an 8-bit RGB/RGBA screenshot');bpp=data[9]===6?4:3}if(type==='IDAT')chunks.push(data);p+=n+12}
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*bpp,pixels=Buffer.alloc(height*stride);
 const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){const a=x>=bpp?pixels[y*stride+x-bpp]:0,b=y?pixels[(y-1)*stride+x]:0,c=y&&x>=bpp?pixels[(y-1)*stride+x-bpp]:0;pixels[y*stride+x]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255}}
 return {width,height,mean(rect){const sum=[0,0,0];let n=0;for(let y=Math.floor(rect.y);y<rect.y+rect.height;y++)for(let x=Math.floor(rect.x);x<rect.x+rect.width;x++){if(x<0||y<0||x>=width||y>=height)throw Error('Sample outside screenshot');const i=(y*width+x)*bpp;sum.forEach((_,c)=>sum[c]+=pixels[i+c]);n++}return sum.map(v=>v/n)}};
}
