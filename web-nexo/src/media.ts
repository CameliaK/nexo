import { t, translateUI } from './i18n';
import { placeSatellite } from './live-satellite.js';

export interface NodeMedia {
  id: string;
  src: string;
  alt: string;
  caption?: string;
  placeholder?: boolean;
}
type Point = {x:number;y:number};
export type MediaRect = {left:number;right:number;top:number;bottom:number};
interface MediaNode {id:string;label:string;media?:unknown}
interface Tile {entry:NodeMedia;button:HTMLButtonElement;image:HTMLImageElement;failed:boolean;position:Point|null;hovered:boolean}

export function nodeMedia(value:unknown):NodeMedia[] {
  if(!Array.isArray(value))return [];
  const ids=new Set<string>(),result:NodeMedia[]=[];
  for(const entry of value){
    if(!entry||typeof entry.id!=='string'||!entry.id.trim()||ids.has(entry.id)||typeof entry.alt!=='string'||!entry.alt.trim()||typeof entry.src!=='string')continue;
    if(!/^\/media\/[\w.-]+\/[\w./-]+\.webp$/.test(entry.src)||entry.src.split('/').some((part:string)=>part==='..'||part==='.'))continue;
    ids.add(entry.id);result.push({id:entry.id,src:entry.src,alt:entry.alt,...(typeof entry.caption==='string'?{caption:entry.caption}:{}),...(entry.placeholder===true?{placeholder:true}:{})});
    if(result.length===6)break;
  }
  return result;
}

// Small conservative boxes follow the actual curve, leaving its open sides usable.
export function curveObstacles(points:Point[],padding=10):MediaRect[] {
  return points.slice(1).map((point,i)=>({left:Math.min(points[i].x,point.x)-padding,right:Math.max(points[i].x,point.x)+padding,top:Math.min(points[i].y,point.y)-padding,bottom:Math.max(points[i].y,point.y)+padding}));
}

export function createMediaUI(doc:Document=document) {
  const create=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text='')=>{const element=doc.createElement(tag);element.className=className;element.textContent=text;return element};
  const layer=create('section','media-windows');layer.hidden=true;layer.setAttribute('aria-label',t('media.node'));
  const viewer=create('dialog','media-viewer');viewer.setAttribute('aria-labelledby','media-viewer-title');
  const surface=create('div','media-viewer-surface'),header=create('header','media-viewer-header'),title=create('h2','',t('media.images'));title.id='media-viewer-title';
  const closeButton=create('button','media-viewer-close','×');closeButton.type='button';closeButton.setAttribute('aria-label',t('media.close'));
  const figure=create('figure'),image=create('img','media-viewer-image');image.width=1600;image.height=1067;image.decoding='async';
  const caption=create('figcaption','media-viewer-caption'),navigation=create('nav','media-viewer-navigation'),previous=create('button','','←'),next=create('button','','→'),counter=create('span');
  navigation.setAttribute('aria-label',t('media.navigation'));counter.setAttribute('aria-live','polite');
  previous.type=next.type='button';previous.setAttribute('aria-label',t('media.previous'));next.setAttribute('aria-label',t('media.next'));
  header.append(title,closeButton);figure.append(image,caption);navigation.append(previous,counter,next);surface.append(header,figure,navigation);viewer.append(surface);doc.body.append(layer,viewer);
  let tiles:Tile[]=[],key='',nodeLabel='',index=0,returnFocus:HTMLElement|null=null,last=0;
  const usable=()=>tiles.filter(tile=>!tile.failed);
  function close(){
    if(viewer.open)viewer.close();image.removeAttribute('src');
    const target=returnFocus?.hidden?doc.getElementById('level-title'):returnFocus;
    target?.focus({preventScroll:true});returnFocus=null;
  }
  function show(tile:Tile){
    index=tiles.indexOf(tile);image.style.visibility='hidden';image.alt=tile.entry.alt;
    image.onload=()=>{image.style.visibility='visible'};image.onerror=()=>fail(tile);
    image.src=tile.entry.src;
    caption.textContent=(tile.entry.placeholder?t('media.prefix'):'')+(tile.entry.caption||tile.entry.alt);
    const visible=usable();counter.textContent=(visible.indexOf(tile)+1)+' / '+visible.length;
    previous.disabled=next.disabled=visible.length<2;
  }
  function step(direction:number){const visible=usable();if(!visible.length){close();return}const current=visible.indexOf(tiles[index]);show(visible[(current+direction+visible.length)%visible.length])}
  function fail(tile:Tile){
    if(!tiles.includes(tile))return;
    tile.failed=true;tile.button.hidden=true;tile.image.removeAttribute('src');
    if(viewer.open&&tiles[index]===tile){const replacement=usable()[0];if(replacement)show(replacement);else close()}
  }
  function open(tile:Tile){
    if(tile.failed)return;
    returnFocus=tile.button;title.textContent=nodeLabel;show(tile);
    if(!viewer.open)viewer.showModal();closeButton.focus({preventScroll:true});
  }
  closeButton.addEventListener('click',close);previous.addEventListener('click',()=>step(-1));next.addEventListener('click',()=>step(1));
  viewer.addEventListener('click',event=>{if(event.target===viewer)close()});
  viewer.addEventListener('cancel',event=>{event.preventDefault();close()});
  viewer.addEventListener('keydown',event=>{
    if(event.key==='Escape'||event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();event.stopPropagation();if(event.key==='Escape')close();else step(event.key==='ArrowLeft'?-1:1);
    }
  });
  function setNode(node:MediaNode|null,color:number[]=[174,241,210]){
    const entries=nodeMedia(node?.media),identity=node?.id+':'+JSON.stringify(entries.map(({id,src})=>({id,src})));
    if(identity===key){
      nodeLabel=node?.label||'';layer.setAttribute('aria-label',t('media.caption',{name:nodeLabel}));
      tiles.forEach((tile,i)=>{tile.entry=entries[i];tile.image.alt=tile.entry.alt;tile.button.setAttribute('aria-label',t('media.open',{alt:tile.entry.alt}));tile.button.querySelector('.media-window-caption')!.textContent=tile.entry.caption||tile.entry.alt});
      if(viewer.open){title.textContent=nodeLabel;image.alt=tiles[index].entry.alt;caption.textContent=(tiles[index].entry.placeholder?t('media.prefix'):'')+(tiles[index].entry.caption||tiles[index].entry.alt)}
      translateUI(layer);translateUI(viewer);return;
    }
    close();key=identity;nodeLabel=node?.label||'';tiles=[];last=0;layer.replaceChildren();layer.hidden=!entries.length;
    layer.dataset.node=node?.id||'';layer.setAttribute('aria-label',t('media.caption',{name:nodeLabel}));layer.style.setProperty('--media-rgb',color.join(','));
    for(const entry of entries){
      const button=create('button','media-window');button.type='button';button.hidden=true;button.dataset.mediaId=entry.id;button.setAttribute('aria-label',t('media.open',{alt:entry.alt}));
      const thumbnail=create('img');thumbnail.width=600;thumbnail.height=400;thumbnail.loading='lazy';thumbnail.decoding='async';thumbnail.alt=entry.alt;
      const footer=create('span','media-window-caption',entry.caption||entry.alt);
      button.append(thumbnail,footer);if(entry.placeholder)button.append(create('span','media-placeholder',t('media.placeholder')));
      const tile:Tile={entry,button,image:thumbnail,failed:false,position:null,hovered:false};tiles.push(tile);layer.append(button);
      thumbnail.onload=()=>{if(tiles.includes(tile))button.classList.add('is-loaded')};thumbnail.onerror=()=>fail(tile);
      button.addEventListener('click',()=>open(tile));button.addEventListener('pointerenter',()=>tile.hovered=true);button.addEventListener('pointerleave',()=>tile.hovered=false);
      button.addEventListener('focus',()=>tile.hovered=true);button.addEventListener('blur',()=>tile.hovered=false);
    }
  }
  function render({width,height,clock,now,obstacles,hidden=false,reduced=false,paused=false}:{width:number;height:number;clock:number;now:number;obstacles:MediaRect[];hidden?:boolean;reduced?:boolean;paused?:boolean}):MediaRect[]{
    layer.hidden=hidden||!tiles.length;const occupied:MediaRect[]=[];
    const dt=Math.min(Math.max(now-last,0),50);last=now;
    if(layer.hidden)return occupied;
    for(const [i,tile] of tiles.entries()){
      if(tile.failed)continue;
      const drift=reduced||paused||tile.hovered||viewer.open?0:1;
      const anchor={x:width*(i%2?.88:.12),y:height*(.38+Math.floor(i/2)*.19)};
      const preferred=(tile.hovered||reduced||paused||viewer.open)&&tile.position?tile.position:{x:anchor.x+Math.sin(clock*.18+i*1.9)*10*drift,y:anchor.y+Math.cos(clock*.15+i*1.3)*12*drift};
      let size=width<650?116:170;
      const place=()=>placeSatellite({width,height,obstacles:[...obstacles,...occupied],preferred,previous:tile.position,footprint:{left:-size/2-3,right:size/2+3,top:-size/3-3,bottom:size/3+3},ease:reduced?1:1-Math.exp(-dt/450)});
      let position=place();if(!position){size=96;position=place()}
      tile.position=position;tile.button.hidden=!position;
      if(!position)continue;
      const box={left:position.x-size/2-3,right:position.x+size/2+3,top:position.y-size/3-3,bottom:position.y+size/3+3};occupied.push(box);
      Object.assign(tile.button.style,{width:size+'px',height:size*2/3+'px',transform:`translate(${position.x-size/2}px,${position.y-size/3}px)`});
      if(!tile.image.getAttribute('src'))tile.image.src=tile.entry.src;
    }
    return occupied;
  }
  return {hasMedia:()=>tiles.some(tile=>!tile.failed),setNode,render,curveObstacles,isOpen:()=>viewer.open,close,dispose(){close();tiles=[];layer.remove();viewer.remove()}};
}
