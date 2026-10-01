import type { Move, Square, Color, PieceSymbol } from 'chess.js';
import { ChessGame, type Promotion, type PositionPiece } from './game';
import { squareAt, squareCoords, subdivideSource, type Triangle, type Point } from './geometry';
import { pieceSolids, box, normal, project3D, unprojectBoard, cellPolygon, insideTriangle, type Camera, type Mesh, type Vec3, type Tri3 } from './spatial';
import './style.css';

export const CHESS_NODE_VISIBLE = true;
const names: Record<PieceSymbol,string>={p:'Peón',r:'Torre',n:'Caballo',b:'Alfil',q:'Reina',k:'Rey'};
const white=[182,241,218],black=[157,170,236];
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{v=clamp(v);return v*v*(3-2*v)};
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const rgba=(c:number[],a=1)=>`rgba(${c.join(',')},${a})`;
const blend=(a:number[],b:number[],t:number)=>a.map((v,i)=>lerp(v,b[i],t));
const center=(t:Triangle):Point=>[(t[0][0]+t[1][0]+t[2][0])/3,(t[0][1]+t[1][1]+t[2][1])/3];
interface Face { points:Triangle; color:number[]; alpha:number; depth:number; edge?:boolean; square?:Square }
interface OpeningOrigin { x:number;y:number;r:number;faces:{points:number[][]}[] }
interface Animation { move:Move; before:PositionPiece[]; start:number; duration:number }
interface Morph { opening:boolean; start:number; duration:number; source:Triangle[]; color:number[] }
interface Drag { from:Square; id:number; start:Point; current:Point; moved:boolean }

export function createChessUI() {
  const game=new ChessGame();
  const dialog=document.createElement('section');dialog.className='chess-scene';dialog.id='chess-scene';dialog.hidden=true;
  dialog.tabIndex=-1;
  dialog.setAttribute('role','region');
  dialog.setAttribute('aria-labelledby','chess-title');
  dialog.innerHTML=`
    <div class="chess-shell">
      <div class="chess-heading"><span class="chess-eyebrow">AJEDREZ / NODO LIBRE</span><h2 id="chess-title">Una partida en mi universo.</h2><span class="chess-local">LOCAL · DOS JUGADORES</span></div>
      <button class="chess-close" type="button" aria-label="Replegar tablero">↙ <span>Replegar</span> <kbd>ESC</kbd></button>
      <div class="chess-layout">
        <div class="chess-play">
          <div class="chess-player" data-color="b"><span class="chess-avatar chess-avatar-black">K</span><div><strong>Kirbith</strong><span>Negras · anfitrión</span></div><span class="chess-captures" data-captured-by="b" aria-label="Piezas capturadas por Kirbith"></span><span class="chess-turn-dot"></span></div>
          <div class="chess-board" role="grid" aria-label="Tablero de ajedrez en perspectiva" aria-rowcount="8" aria-colcount="8"></div>
          <div class="chess-player" data-color="w"><span class="chess-avatar">V</span><div><strong>Visitante</strong><span>Blancas · tu lado</span></div><span class="chess-captures" data-captured-by="w" aria-label="Piezas capturadas por el visitante"></span><span class="chess-turn-dot"></span></div>
        </div>
        <aside class="chess-aside">
          <div class="chess-status"><span class="chess-eyebrow">EN EL TABLERO</span><h2 class="chess-status-title"></h2><p class="chess-status-detail"></p></div>
          <details class="chess-history"><summary class="chess-history-heading"><span class="chess-eyebrow">MOVIMIENTOS</span><span class="chess-move-count">00</span></summary><div class="chess-history-scroll"><p class="chess-empty">Las blancas mueven primero.</p><ol class="chess-moves" aria-label="Registro de movimientos"></ol></div></details>
          <div class="chess-actions"><button type="button" class="chess-flip">⇄ <span>Girar tablero</span></button><button type="button" class="chess-restart">↻ <span>Nueva partida</span></button><button type="button" class="chess-claim" hidden>Reclamar tablas</button></div>
          <p class="chess-local-note">Visitante vs. Kirbith · partida local</p>
        </aside>
      </div>
      <div class="chess-help">Selecciona o arrastra una pieza · los destinos brillan</div>
    </div>
    <div class="chess-popover-backdrop" hidden><section class="chess-popover" role="dialog" aria-modal="true" aria-labelledby="chess-popover-title"></section></div>
    <div class="sr-only chess-announcement" role="status" aria-live="polite" aria-atomic="true"></div>`;
  document.body.append(dialog);
  const $=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
  let ctx:CanvasRenderingContext2D;
  const board=$('.chess-board'),popover=$('.chess-popover'),backdrop=$('.chess-popover-backdrop');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let selected:Square|null=null,flipped=false,animation:Animation|null=null,morph:Morph|null=null;
  let drag:Drag|null=null,origin:OpeningOrigin|null=null,active=false,disposed=false,claimMode=false;
  let originProvider:(()=>OpeningOrigin)|undefined;
  let pendingTap:Square|null=null,suppressClick=false;
  let focusSquare:Square='e2',returnFocus:HTMLElement|null=null,popoverReturn:HTMLElement|null=null;
  let viewPieces=game.pieces,viewHistory=game.history,viewCheck=game.check,destinations=new Set<Square>();
  let camera:Camera={x:0,y:0,scale:1,tilt:.72,yaw:-.10,distance:22};
  let baseCamera={...camera},cachedFaces:Face[]|null=null;
  let picking:Face[]=[],queuedExit:(()=>void)|null=null;
  const buttons=new Map<Square,HTMLButtonElement>();
  const busy=()=>!!morph||!!animation||!backdrop.hidden;
  const announce=(text:string)=>{$('.chess-announcement').textContent=text};
  const legal=()=>selected?game.legal(selected):[];
  const resize=()=>{
    const mobile=innerWidth<650,short=innerHeight<550;
    camera={x:innerWidth*(mobile?.50:.47),y:innerHeight*(short?.57:mobile?.49:.53),scale:mobile?Math.min(innerWidth/11.2,(innerHeight-280)/7.4):Math.min((innerWidth-360)/10.7,Math.max(22,(innerHeight-305)/9.2)),tilt:mobile?.62:.72,yaw:mobile?-.045:-.10,distance:22};
    baseCamera={...camera};
    placeBoard();
  };
  const at=(square:Square):Point=>{const [col,row]=squareCoords(square,flipped);return[col+.5,row+.5]};
  const hit=(x:number,y:number,ignorePiece?:Square):Square|null=>{
    for(let i=picking.length-1;i>=0;i--)if(picking[i].square&&picking[i].square!==ignorePiece&&insideTriangle([x,y],picking[i].points))return picking[i].square!;
    const [px,pz]=unprojectBoard([x,y],camera),col=Math.floor(px),row=Math.floor(pz);
    return col>=0&&col<8&&row>=0&&row<8?squareAt(row,col,flipped):null;
  };
  function placeBoard(){
    cachedFaces=null;picking=[];
    const corners=[[0,0,0],[8,0,0],[8,0,8],[0,0,8]].map(p=>project3D(p as Vec3,camera).point);
    const left=Math.min(...corners.map(p=>p[0])),right=Math.max(...corners.map(p=>p[0])),top=Math.min(...corners.map(p=>p[1]))-camera.scale*.8,bottom=Math.max(...corners.map(p=>p[1]));
    for(const [key,value] of Object.entries({left,right,top,bottom,cx:camera.x,cy:camera.y}))dialog.style.setProperty(`--board-${key}`,value+'px');
    Object.assign(board.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});
    buttons.forEach((b,square)=>{
      const [col,row]=squareCoords(square,flipped),polygon=cellPolygon(col,row,camera);
      const x=Math.min(...polygon.map(p=>p[0])),y=Math.min(...polygon.map(p=>p[1])),w=Math.max(...polygon.map(p=>p[0]))-x,h=Math.max(...polygon.map(p=>p[1]))-y;
      Object.assign(b.style,{left:(x-left)+'px',top:(y-top)+'px',width:w+'px',height:h+'px',clipPath:`polygon(${polygon.map(p=>`${(p[0]-x)/w*100}% ${(p[1]-y)/h*100}%`).join(',')})`});
    });
  }
  function buildBoard(){
    buttons.clear();board.replaceChildren();
    for(let row=0;row<8;row++){
      const line=document.createElement('div');line.className='chess-row';line.setAttribute('role','row');
      for(let col=0;col<8;col++){
        const square=squareAt(row,col,flipped),b=document.createElement('button');b.type='button';b.className='chess-square';
        b.dataset.square=square;b.setAttribute('role','gridcell');b.setAttribute('aria-rowindex',String(row+1));b.setAttribute('aria-colindex',String(col+1));
        b.addEventListener('focus',()=>{focusSquare=square;buttons.forEach((item,s)=>item.tabIndex=s===square?0:-1)});
        b.addEventListener('keydown',e=>{
          const offsets:Record<string,Point>={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
          const offset=offsets[e.key];if(!offset)return;e.preventDefault();
          const [x,y]=squareCoords(square,flipped);buttons.get(squareAt(Math.max(0,Math.min(7,y+offset[1])),Math.max(0,Math.min(7,x+offset[0])),flipped))?.focus();
        });
        line.append(b);buttons.set(square,b);
      }
      board.append(line);
    }
    syncBoard();placeBoard();
  }
  function syncBoard(){
    cachedFaces=null;
    destinations=new Set(legal().map(m=>m.to));const pieces=new Map(viewPieces.map(p=>[p.square,p]));
    buttons.forEach((b,s)=>{
      const p=pieces.get(s),available=destinations.has(s);
      b.setAttribute('aria-label',`${s}: ${p?`${names[p.type]} ${p.color==='w'?'blanco':'negro'}`:'vacía'}${available?', destino legal':''}${game.check&&p?.type==='k'&&p.color===game.turn?', en jaque':''}`);
      b.setAttribute('aria-selected',String(s===selected));b.tabIndex=s===focusSquare?0:-1;
    });
  }
  function icon(type:PieceSymbol,color:Color){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('aria-hidden','true');
    svg.style.color=rgba(color==='w'?white:black);
    const mesh=pieceSolids[type],iconCamera:Camera={x:50,y:75,scale:52,tilt:.48,yaw:-.35,distance:50};
    const faces=mesh.faces.map(f=>{const vertices=f.map(i=>mesh.vertices[i].map((v,axis)=>v+(axis===1?0:4)) as Vec3) as Tri3;const projected=vertices.map(p=>project3D(p,iconCamera));return{points:projected.map(p=>p.point),depth:projected.reduce((sum,p)=>sum+p.depth,0)/3}}).sort((a,b)=>a.depth-b.depth);
    for(const [i,face] of faces.entries()){const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');polygon.setAttribute('points',face.points.map(p=>p.join(',')).join(' '));polygon.setAttribute('fill','currentColor');polygon.setAttribute('fill-opacity',String(.22+(i%5)*.08));polygon.setAttribute('stroke','currentColor');polygon.setAttribute('stroke-width','.3');svg.append(polygon)}
    return svg;
  }
  function refresh(){
    viewPieces=game.pieces;viewHistory=game.history;viewCheck=game.check;
    const status=game.status;
    $('.chess-status-title').textContent=status.title;$('.chess-status-detail').textContent=claimMode?'Selecciona la jugada con la que reclamarás tablas.':status.detail;
    dialog.classList.toggle('chess-ended',status.ended);dialog.classList.toggle('chess-in-check',game.check&&!status.ended);
    for(const color of ['w','b'] as Color[]){
      const player=$(`[data-color="${color}"]`);player.classList.toggle('is-turn',!status.ended&&game.turn===color);
      const tray=$(`[data-captured-by="${color}"]`);tray.replaceChildren();
      const captured=game.history.filter(m=>m.color===color&&m.captured).sort((a,b)=>'pnbrq'.indexOf(a.captured!)-'pnbrq'.indexOf(b.captured!));
      for(const m of captured){const svg=icon(m.captured!,color==='w'?'b':'w');const label=document.createElement('span');label.title=names[m.captured!];label.setAttribute('aria-label',names[m.captured!]);label.append(svg);tray.append(label)}
    }
    const history=game.history,list=$('.chess-moves');list.replaceChildren();
    for(let i=0;i<history.length;i+=2){const item=document.createElement('li');for(const text of [String(i/2+1).padStart(2,'0'),history[i].san,history[i+1]?.san||'—']){const s=document.createElement('span');s.textContent=text;item.append(s)}list.append(item)}
    $('.chess-empty').hidden=history.length>0;$('.chess-move-count').textContent=String(history.length).padStart(2,'0');
    const scroll=$('.chess-history-scroll');scroll.scrollTop=scroll.scrollHeight;
    $('.chess-claim').hidden=!(status.claimable||game.canAnnounceClaim||claimMode);
    $('.chess-claim').textContent=claimMode?'Cancelar reclamación':'Reclamar tablas';
    syncBoard();announce(`${status.title}. ${status.detail}`);
  }
  function choose(square:Square){
    if(game.status.ended){announce(game.status.title);return}
    if(selected===square){selected=null;syncBoard();return}
    const destination=legal().filter(m=>m.to===square);
    if(selected&&destination.length){
      const from=selected;
      if(destination.some(m=>m.promotion)){
        showPopover('Elige tu nueva pieza','Tu peón llegó al otro lado.',(['q','r','b','n'] as Promotion[]).map(type=>({label:names[type],action:()=>commit(from,square,type),piece:type})),true);
      }else commit(from,square);
      return;
    }
    const piece=game.pieces.find(p=>p.square===square);
    if(piece?.color===game.turn){selected=square;syncBoard();announce(`${names[piece.type]} en ${square}. ${game.legal(square).map(m=>m.to).filter((s,i,a)=>a.indexOf(s)===i).join(', ')||'Sin destinos legales'}.`)}
    else {announce(selected?'Movimiento no permitido. Elige un destino resaltado.':'Selecciona una pieza del bando que tiene el turno.');}
  }
  function commit(from:Square,to:Square,promotion:Promotion='q'){
    if(claimMode){
      if(game.claim(from,to,promotion)){claimMode=false;selected=null;refresh()}
      else announce('Esa jugada no permite reclamar tablas. Selecciona otra o cancela la reclamación.');
      return;
    }
    const before=game.pieces,move=game.move(from,to,promotion);if(!move)return;
    selected=null;focusSquare=to;animation={move,before,start:performance.now(),duration:reduced.matches?0:520};
    board.inert=true;dialog.focus({preventScroll:true});refresh();announce(`${move.san}. ${game.status.title}. ${game.status.detail}`);
  }
  function hidePopover(){backdrop.hidden=true;popover.replaceChildren();$('.chess-shell').inert=false;popoverReturn?.focus({preventScroll:true})}
  function showPopover(title:string,detail:string,actions:{label:string;action:()=>void;piece?:PieceSymbol}[],cancel=true){
    popoverReturn=document.activeElement as HTMLElement;popover.replaceChildren();
    const h=document.createElement('h2');h.id='chess-popover-title';h.textContent=title;
    const p=document.createElement('p');p.textContent=detail;
    const choices=document.createElement('div');choices.className=actions.some(a=>a.piece)?'chess-promotions':'chess-confirm-actions';
    actions.forEach(action=>{const b=document.createElement('button');b.type='button';if(action.piece)b.append(icon(action.piece,game.turn));const label=document.createElement('span');label.textContent=action.label;b.append(label);b.addEventListener('click',()=>{hidePopover();action.action()});choices.append(b)});
    popover.append(h,p,choices);
    if(cancel){const b=document.createElement('button');b.type='button';b.className='chess-popover-cancel';b.textContent='Cancelar';b.onclick=hidePopover;popover.append(b)}
    $('.chess-shell').inert=true;backdrop.hidden=false;popover.querySelector('button')?.focus();
  }
  function reset(){game.reset();selected=null;claimMode=false;focusSquare=flipped?'e7':'e2';refresh();buttons.get(focusSquare)?.focus()}
  $('.chess-restart').addEventListener('click',()=>{if(busy())return;if(!game.history.length&&!game.status.ended){reset();return}showPopover('¿Otra partida?','El tablero volverá a su posición inicial.',[{label:'Empezar de nuevo',action:reset}])});
  $('.chess-flip').addEventListener('click',()=>{if(busy())return;flipped=!flipped;buildBoard();resize();announce(flipped?'Tablero desde el lado de las negras.':'Tablero desde el lado de las blancas.')});
  $('.chess-claim').addEventListener('click',()=>{
    if(busy())return;
    if(claimMode){claimMode=false;refresh();return}
    if(game.status.claimable){showPopover('Reclamar tablas','La posición permite terminar la partida en tablas.',[{label:'Reclamar tablas',action:()=>{game.claim();selected=null;refresh()}}]);return}
    claimMode=true;refresh();announce('Selecciona una jugada que produzca triple repetición o 50 movimientos sin capturas ni movimientos de peón.');
  });
  board.addEventListener('pointerdown',e=>{
    pendingTap=null;suppressClick=false;
    if(e.button!==0||busy()||game.status.ended)return;
    const from=hit(e.clientX,e.clientY);if(!from||game.pieces.find(p=>p.square===from)?.color!==game.turn)return;
    drag={from,id:e.pointerId,start:[e.clientX,e.clientY],current:[e.clientX,e.clientY],moved:false};board.setPointerCapture(e.pointerId);
  });
  board.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;drag.current=[e.clientX,e.clientY];
    if(Math.hypot(e.clientX-drag.start[0],e.clientY-drag.start[1])>6){drag.moved=true;selected=drag.from;syncBoard();board.classList.add('is-dragging')}
  });
  board.addEventListener('pointerup',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const previous=drag;drag=null;board.classList.remove('is-dragging');
    if(board.hasPointerCapture(e.pointerId))board.releasePointerCapture(e.pointerId);
    if(!previous.moved){pendingTap=hit(e.clientX,e.clientY);return}
    suppressClick=true;
    const to=hit(e.clientX,e.clientY,previous.from);
    if(to&&to!==previous.from&&game.legal(previous.from).some(m=>m.to===to)){choose(to);buttons.get(to)?.focus()}
    else {syncBoard();announce('Pieza devuelta a su casilla. Elige un destino legal.')}
  });
  // A captured click can target the grid rather than its original cell. Handle
  // mouse, touch and keyboard clicks once here; a completed drag consumes its click.
  board.addEventListener('click',e=>{
    if(suppressClick&&e.detail!==0){suppressClick=false;pendingTap=null;return}
    if(busy())return;
    const square=(e.target as HTMLElement).closest<HTMLButtonElement>('.chess-square')?.dataset.square as Square|undefined;
    const target=e.detail===0?square:hit(e.clientX,e.clientY)||pendingTap;pendingTap=null;
    if(target){choose(target);if(!board.inert&&backdrop.hidden)buttons.get(target)?.focus({preventScroll:true})}
  });
  const cancelDrag=()=>{drag=null;board.classList.remove('is-dragging')};
  board.addEventListener('pointercancel',cancelDrag);board.addEventListener('lostpointercapture',cancelDrag);
  function meshFaces(mesh:Mesh,color:number[],offset:Vec3=[0,0,0],alpha=1,square?:Square):Face[]{
    const transformed=mesh.vertices.map(p=>p.map((v,i)=>(square&&i===1?v*.78:v)+offset[i]) as Vec3);
    return mesh.faces.map(indices=>{
      const vertices=indices.map(i=>transformed[i]) as Tri3,n=normal(vertices),projected=vertices.map(p=>project3D(p,camera));
      const light=Math.max(0,n[0]*-.35+n[1]*.82+n[2]*.45);
      const facing=n[1]*Math.cos(camera.tilt)+(-n[0]*Math.sin(camera.yaw)+n[2]*Math.cos(camera.yaw))*Math.sin(camera.tilt);
      return {points:projected.map(p=>p.point) as Triangle,depth:projected.reduce((sum,p)=>sum+p.depth,0)/3,
        color:blend(color,[223,255,243],light*.24),alpha:alpha*(square?(facing>0?.27+light*.28:.09):.25+light*.2),edge:true,square};
    });
  }
  function pieceFaces(piece:PositionPiece,x:number,z:number,lift=0,alpha=1):Face[]{
    return meshFaces(pieceSolids[piece.type],piece.color==='w'?white:black,[x,lift,z],alpha,piece.square);
  }
  function targetFaces():Face[]{
    const faces:Face[]=meshFaces(box(-.15,-.34,-.15,8.15,-.20,8.15),[68,132,119],undefined,.32);
    const last=viewHistory.at(-1);
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      const square=squareAt(row,col,flipped),check=viewCheck&&viewPieces.some(p=>p.square===square&&p.type==='k'&&p.color===game.turn);
      let color=(row+col)%2?[20,44,53]:[61,113,100];
      if(square===last?.from||square===last?.to)color=blend(color,white,.19);
      if(square===selected)color=blend(color,white,.48);
      if(check)color=blend(color,[236,113,147],.5);
      faces.push(...meshFaces(box(col+.025,-.18,row+.025,col+.975,0,row+.975),color,undefined,(row+col)%2?.52:.80));
    }
    return faces;
  }
  function paint(face:Face){
    ctx.beginPath();face.points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();
    ctx.fillStyle=rgba(face.color,face.alpha);ctx.fill();
    ctx.strokeStyle=rgba(face.color,face.square?Math.min(.50,face.alpha+.10):Math.min(.28,face.alpha+.025));
    ctx.lineWidth=face.square?.65:.55;ctx.stroke();
  }
  function strokeCell(square:Square,color:number[],opacity:number,width=1.2){
    const [col,row]=squareCoords(square,flipped),polygon=cellPolygon(col,row,camera);
    ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.strokeStyle=rgba(color,opacity);ctx.lineWidth=width;ctx.stroke();
  }
  function renderBoard(now:number):Face[]{
    if(!animation&&!drag?.moved&&cachedFaces)return cachedFaces;
    const faces=targetFaces(),progress=animation?clamp((now-animation.start)/Math.max(1,animation.duration)):1;
    const move=animation?.move,castle=move?.isKingsideCastle()||move?.isQueensideCastle();
    const rookTo=castle?`${move!.isKingsideCastle()?'f':'d'}${move!.to[1]}` as Square:null;
    for(const piece of viewPieces){
      if(drag?.moved&&piece.square===drag.from)continue;
      if(animation&&(piece.square===move?.to||piece.square===rookTo))continue;
      const [x,z]=at(piece.square);faces.push(...pieceFaces(piece,x,z));
    }
    if(animation&&move){
      const [x,z]=at(move.from),[tx,tz]=at(move.to),p=smooth(progress);
      const captureSquare=move.isEnPassant()?`${move.to[0]}${move.from[1]}` as Square:move.to;
      const captured=animation.before.find(piece=>piece.square===captureSquare&&piece.color!==move.color);
      if(captured){
        const [cx,cz]=at(captureSquare),burst=smooth((progress-.25)/.65);
        pieceFaces(captured,cx,cz).forEach((face,i)=>{
          const c=center(face.points),angle=i*2.39996,dist=burst*camera.scale*(.32+(i%5)*.1),rotation=burst*(i%2?1:-1)*.9;
          const points=face.points.map(([px,py])=>{const dx=(px-c[0])*(1-burst*.35),dy=(py-c[1])*(1-burst*.35);return[c[0]+dx*Math.cos(rotation)-dy*Math.sin(rotation)+Math.cos(angle)*dist,c[1]+dx*Math.sin(rotation)+dy*Math.cos(rotation)+Math.sin(angle)*dist-burst*camera.scale*.15]}) as Triangle;
          faces.push({...face,points,alpha:face.alpha*(1-burst)});
        });
      }
      const piece={square:move.to,color:move.color,type:move.piece},px=lerp(x,tx,p),pz=lerp(z,tz,p),lift=Math.sin(Math.PI*progress)*.26;
      if(move.promotion){const change=smooth((progress-.55)/.4);faces.push(...pieceFaces(piece,px,pz,lift,1-change),...pieceFaces({...piece,type:move.promotion},px,pz,lift,change))}
      else faces.push(...pieceFaces(piece,px,pz,lift));
      if(rookTo){const from=`${move.isKingsideCastle()?'h':'a'}${move.to[1]}` as Square,[rx,rz]=at(from),[rtx,rtz]=at(rookTo);faces.push(...pieceFaces({square:rookTo,type:'r',color:move.color},lerp(rx,rtx,p),lerp(rz,rtz,p)))}
      if(progress>=1){animation=null;board.inert=false;syncBoard();if(document.activeElement===dialog)buttons.get(focusSquare)?.focus({preventScroll:true});if(queuedExit)close()}
    }
    if(drag?.moved){
      const piece=viewPieces.find(p=>p.square===drag!.from);
      if(piece){const [x,z]=unprojectBoard(drag.current,camera);faces.push(...pieceFaces(piece,x,z,.18))}
    }
    faces.sort((a,b)=>a.depth-b.depth);
    if(!animation&&!drag?.moved)cachedFaces=faces;
    return faces;
  }
  function drawGuides(){
    if(selected)strokeCell(selected,white,.75);
    const focused=document.activeElement as HTMLElement;
    if(focused?.classList.contains('chess-square')&&focused.matches(':focus-visible'))strokeCell(focusSquare,[220,255,242],.8,1.5);
    for(const square of destinations){
      const [x,z]=at(square),p=project3D([x,.02,z],camera).point;
      ctx.beginPath();ctx.ellipse(p[0],p[1],camera.scale*.09,camera.scale*.06,0,0,Math.PI*2);
      ctx.fillStyle=rgba(white,.65);ctx.fill();strokeCell(square,white,.32,.9);
    }
    ctx.font="9px 'Space Grotesk',sans-serif";ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='rgba(159,193,179,.65)';
    for(let i=0;i<8;i++){
      const file=project3D([i+.5,-.02,8.30],camera).point,rank=project3D([-.28,-.02,i+.5],camera).point;
      ctx.fillText('abcdefgh'[flipped?7-i:i],...file);ctx.fillText(String(flipped?i+1:8-i),...rank);
    }
  }
  function progress(now=performance.now()){
    if(!active)return 0;
    if(!morph)return 1;
    const t=clamp((now-morph.start)/Math.max(1,morph.duration));return smooth(morph.opening?t:1-t);
  }
  function render(context:CanvasRenderingContext2D,now:number,view?:{zoom:number;pan:{x:number;y:number}}){
    if(!active||disposed)return;
    if(view){
      const x=innerWidth/2+(baseCamera.x-innerWidth/2)*view.zoom+view.pan.x,y=innerHeight*.53+(baseCamera.y-innerHeight*.53)*view.zoom+view.pan.y,scale=baseCamera.scale*view.zoom;
      if(Math.abs(camera.x-x)+Math.abs(camera.y-y)+Math.abs(camera.scale-scale)>.01){camera={...baseCamera,x,y,scale};placeBoard()}
    }
    ctx=context;ctx.save();
    if(morph){
      const m=morph,t=clamp((now-m.start)/Math.max(1,m.duration)),u=smooth(m.opening?t:1-t);
      const targets=renderBoard(now),sources=subdivideSource(m.source,targets.length);
      picking=[];
      targets.forEach((face,i)=>{
        const source=sources[i],a=center(source),b=center(face.points),scatter=Math.sin(Math.PI*u)*(12+i%7*3),angle=i*2.39996;
        const move=smooth((u-.02)/.93),shape=smooth((u-.22)/.78),cx=lerp(a[0],b[0],move)+Math.cos(angle)*scatter,cy=lerp(a[1],b[1],move)+Math.sin(angle)*scatter;
        const points=source.map((p,j)=>[cx+lerp(p[0]-a[0],face.points[j][0]-b[0],shape),cy+lerp(p[1]-a[1],face.points[j][1]-b[1],shape)]) as Triangle;
        paint({...face,points,color:blend(m.color,face.color,u),alpha:lerp(.38,face.alpha,u)});
      });
      dialog.style.setProperty('--chess-reveal',String(smooth((u-.72)/.28)));
      if(t>=1){const opening=m.opening;morph=null;if(opening){dialog.classList.add('is-ready');board.inert=false;buttons.get(focusSquare)?.focus({preventScroll:true});if(queuedExit)close()}else finishClose()}
    }else{
      const faces=renderBoard(now);picking=faces.filter(face=>face.square&&face.alpha>.1);
      faces.forEach(paint);drawGuides();
      if(queuedExit&&!animation)close();
    }
    ctx.restore();
  }
  function open(value:OpeningOrigin,getOrigin?:()=>OpeningOrigin){
    if(active||disposed)return;
    origin=value;originProvider=getOrigin;returnFocus=document.activeElement as HTMLElement;active=true;selected=null;claimMode=false;
    dialog.hidden=false;document.body.classList.add('is-chess');dialog.classList.remove('is-ready');dialog.style.setProperty('--chess-reveal','0');buildBoard();refresh();resize();board.inert=true;dialog.focus({preventScroll:true});
    morph={opening:true,start:performance.now(),duration:reduced.matches?0:1550,source:value.faces.map(f=>f.points.map(p=>[p[0],p[1]]) as Triangle),color:white};
  }
  function close(){
    if(!active||morph||animation)return;
    if(!backdrop.hidden){hidePopover();return}
    cancelDrag();selected=null;claimMode=false;board.inert=true;dialog.classList.remove('is-ready');
    if(originProvider)origin=originProvider();
    morph={opening:false,start:performance.now(),duration:reduced.matches?0:1150,source:origin!.faces.map(f=>f.points.map(p=>[p[0],p[1]]) as Triangle),color:white};
  }
  function finishClose(){
    active=false;dialog.hidden=true;picking=[];document.body.classList.remove('is-chess');onClosed?.();returnFocus?.focus({preventScroll:true});returnFocus=null;
    const next=queuedExit;queuedExit=null;next?.();
  }
  let onClosed:(()=>void)|undefined;
  $('.chess-close').addEventListener('click',close);
  dialog.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Escape'){e.preventDefault();if(!backdrop.hidden)hidePopover();else if(selected){selected=null;syncBoard()}else close();return}
    if(e.key==='Tab'&&!backdrop.hidden){const items=[...popover.querySelectorAll<HTMLButtonElement>('button')],index=items.indexOf(document.activeElement as HTMLButtonElement);e.preventDefault();items[(index+(e.shiftKey?-1:1)+items.length)%items.length]?.focus()}
  });
  const onEscape=(e:KeyboardEvent)=>{if(active&&e.key==='Escape'&&!dialog.contains(e.target as Node)){e.preventDefault();close()}};
  const onResize=()=>{if(active){cancelDrag();resize();if(morph&&originProvider)morph.source=originProvider().faces.map(f=>f.points.map(p=>[p[0],p[1]]) as Triangle)}};
  const onBlur=()=>cancelDrag();
  const onMotion=()=>{if(animation)animation.duration=0;if(morph&&reduced.matches)morph.duration=0};
  addEventListener('resize',onResize);addEventListener('blur',onBlur);addEventListener('keydown',onEscape);reduced.addEventListener('change',onMotion);
  return {open,render,progress,isOpen:()=>active,closeForNavigation:(fn:()=>void)=>{queuedExit=fn;close()},setOnClosed:(fn:()=>void)=>{onClosed=fn},dispose(){disposed=true;removeEventListener('resize',onResize);removeEventListener('blur',onBlur);removeEventListener('keydown',onEscape);reduced.removeEventListener('change',onMotion);document.body.classList.remove('is-chess');dialog.remove()}};
}
