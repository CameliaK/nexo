import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame, type Promotion } from '../src/chess/game';
import { squareAt, squareCoords, triangleArea, subdivideSource, type Triangle } from '../src/chess/geometry';
import type { Square } from 'chess.js';
import { pieceSolids, box, project3D, unprojectBoard, normal, type Camera, type Tri3 } from '../src/chess/spatial';

function play(game:ChessGame,...moves:string[]){for(const move of moves)assert.ok(game.move(move.slice(0,2) as Square,move.slice(2,4) as Square,(move[4]||'q') as Promotion),move)}
test('Initial position, turn ownership, illegal moves, and reset',()=>{
  const game=new ChessGame();assert.equal(game.pieces.length,32);assert.equal(game.legal().length,20);
  const before=game.fen;assert.equal(game.move('e7','e5'),null);assert.equal(game.move('e2','e5'),null);assert.equal(game.fen,before);
  play(game,'e2e4','e7e5');assert.equal(game.history[0].san,'e4');assert.equal(game.turn,'w');
  game.reset();assert.equal(game.fen,before);assert.equal(game.history.length,0);
});
test('Pinned pieces cannot expose the king; kings cannot move into attack',()=>{
  const game=new ChessGame('4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1');
  assert.equal(game.move('e2','d2'),null);assert.ok(game.legal('e2').every(m=>m.to[0]==='e'));
  const king=new ChessGame('4r1k1/8/8/8/8/8/8/4K3 w - - 0 1');assert.equal(king.move('e1','e2'),null);assert.ok(king.check);
});
test('Both castling sides move the rook; attacked path and lost rights forbid castling',()=>{
  for(const to of ['g1','c1'] as Square[]){const game=new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    assert.ok(game.move('e1',to));assert.ok(game.pieces.some(p=>p.square===(to==='g1'?'f1':'d1')&&p.type==='r'));}
  const attacked=new ChessGame('r3kr1r/8/8/8/8/8/8/R3K2R w KQ - 0 1');assert.equal(attacked.move('e1','g1'),null);
  const rights=new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');play(rights,'h1h2','h8h7','h2h1','h7h8');assert.equal(rights.move('e1','g1'),null);
});
test('En passant captures the correct pawn, expires, and cannot expose the king',()=>{
  const game=new ChessGame();play(game,'e2e4','a7a6','e4e5','d7d5');const move=game.move('e5','d6');assert.ok(move?.isEnPassant());assert.ok(!game.pieces.some(p=>p.square==='d5'));assert.equal(game.pieces.length,31);
  const expired=new ChessGame();play(expired,'e2e4','a7a6','e4e5','d7d5','h2h3','a6a5');assert.equal(expired.move('e5','d6'),null);
  const pinned=new ChessGame('k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');assert.equal(pinned.move('e5','d6'),null);
});
test('All four promotions, including a capture underpromotion',()=>{
  for(const promotion of ['q','r','b','n'] as Promotion[]){const game=new ChessGame('7k/P7/8/8/8/8/8/7K w - - 0 1');assert.ok(game.move('a7','a8',promotion));assert.ok(game.pieces.some(p=>p.square==='a8'&&p.type===promotion));}
  const capture=new ChessGame('1r5k/P7/8/8/8/8/8/7K w - - 0 1');assert.equal(capture.move('a7','b8','n')?.captured,'r');
});
test('Checkmate ends play and takes precedence over the 75-move rule',()=>{
  const game=new ChessGame();play(game,'f2f3','e7e5','g2g4','d8h4');assert.match(game.status.title,/Jaque mate/);assert.match(game.status.title,/Kirbith/);assert.equal(game.legal().length,0);assert.equal(game.move('a2','a3'),null);
  const threshold=new ChessGame('7k/8/5KQ1/8/8/8/8/8 w - - 149 1');play(threshold,'g6g7');assert.match(threshold.status.title,/Jaque mate/);
});
test('Stalemate and insufficient material are automatic draws',()=>{
  assert.match(new ChessGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status.title,/ahogado/);
  for(const fen of ['4k3/8/8/8/8/8/8/4K3 w - - 0 1','4k3/8/8/8/8/8/8/3BK3 w - - 0 1','4k3/8/8/8/8/8/8/3NK3 w - - 0 1'])assert.match(new ChessGame(fen).status.title,/material insuficiente/);
});
test('Triple repetition is claimable; fivefold repetition is automatic',()=>{
  const game=new ChessGame(),cycle=['g1f3','g8f6','f3g1','f6g8'];play(game,...cycle,...cycle);
  assert.equal(game.status.ended,false);assert.equal(game.status.claimable,true);assert.ok(game.claim());assert.equal(game.legal().length,0);
  game.reset();for(let i=0;i<4;i++)play(game,...cycle);assert.match(game.status.title,/quíntuple/);
});
test('50-move claim, announced-move claim, and 75-move automatic draw',()=>{
  const claim=new ChessGame('4k3/8/8/8/8/8/8/R3K3 w - - 100 1');assert.equal(claim.status.ended,false);assert.ok(claim.status.claimable);assert.ok(claim.claim());
  const intended=new ChessGame('4k3/8/8/8/8/8/8/R3K3 w - - 99 1');assert.equal(intended.claim(),false);const fen=intended.fen;assert.ok(intended.canClaimWith('a1','a2'));assert.ok(intended.claim('a1','a2'));assert.equal(intended.fen,fen);
  const repeat=new ChessGame();play(repeat,'g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1');assert.ok(repeat.canClaimWith('f6','g8'));assert.ok(repeat.claim('f6','g8'));
  const automatic=new ChessGame('4k3/8/8/8/8/8/8/R3K3 w - - 149 1');play(automatic,'a1a2');assert.match(automatic.status.title,/75 movimientos/);
});
test('Draw claims ignore positions with changed castling rights',()=>{
  const game=new ChessGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');play(game,'h1h2','h8h7','h2h1','h7h8','h1h2','h8h7','h2h1','h7h8');assert.equal(game.status.claimable,false);
});
test('Source fragments conserve area; flipped square coordinates remain reversible',()=>{
  const source:Triangle[]=[[[0,0],[2,0],[0,2]],[[2,0],[2,2],[0,2]]],parts=subdivideSource(source,1547);
  assert.equal(parts.length,1547);assert.ok(Math.abs(parts.reduce((sum,t)=>sum+triangleArea(t),0)-4)<1e-9);
  for(const flipped of [false,true])for(let row=0;row<8;row++)for(let col=0;col<8;col++)assert.deepEqual(squareCoords(squareAt(row,col,flipped),flipped),[col,row]);
});
test('Chess solids have volume and finite, non-degenerate faces on all three axes',()=>{
  assert.equal(new Set(Object.values(pieceSolids).map(m=>JSON.stringify(m))).size,6);
  for(const mesh of [...Object.values(pieceSolids),box(0,-.2,0,1,0,1)]){
    for(let axis=0;axis<3;axis++)assert.ok(Math.max(...mesh.vertices.map(p=>p[axis]))-Math.min(...mesh.vertices.map(p=>p[axis]))>.1);
    for(const f of mesh.faces){const t=f.map(i=>mesh.vertices[i]) as Tri3;assert.ok(t.flat().every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...normal(t))-1)<1e-9)}
  }
});
test('Perspective picking recovers every square after camera pan, zoom and rotation',()=>{
  for(const camera of [{x:450,y:320,scale:50,tilt:.72,yaw:-.10,distance:22},{x:195,y:430,scale:38,tilt:.62,yaw:-.045,distance:22},{x:600,y:470,scale:80,tilt:.83,yaw:.28,distance:19}] satisfies Camera[]){
    for(let row=0;row<8;row++)for(let col=0;col<8;col++){
      const [x,z]=unprojectBoard(project3D([col+.5,0,row+.5],camera).point,camera);
      assert.ok(Math.abs(x-col-.5)<1e-10&&Math.abs(z-row-.5)<1e-10);
    }
  }
});

import { chessLayout, chessBounds, fitChessCamera } from '../src/chess/layout';
const contained=(point:number[],rect:{left:number;right:number;top:number;bottom:number})=>point[0]>=rect.left-1e-7&&point[0]<=rect.right+1e-7&&point[1]>=rect.top-1e-7&&point[1]<=rect.bottom+1e-7;

test('Chess layout reserves players and game information outside the complete board at every zoom and viewport',()=>{
  for(const [width,height] of [[1210,1146],[1440,900],[1920,1080],[960,720],[900,1000],[390,844],[375,667],[320,568],[844,390],[740,430]]){
    for(const zoom of [.65,1,1.6])for(const pan of [{x:0,y:0},{x:width*.5,y:-height*.4},{x:-width*.5,y:height*.4}]){
      const view={zoom,pan},before=JSON.stringify(view),layout=chessLayout({width,height},view),bounds=chessBounds(layout.camera);
      assert.equal(JSON.stringify(view),before,'Fitting the board does not mutate the universe camera');assert.ok(layout.camera.scale>0);
      assert.ok(contained([bounds.left,bounds.top],layout.area));assert.ok(contained([bounds.right,bounds.bottom],layout.area));
      assert.ok(layout.header.top+layout.header.height<=layout.black.top,'Heading leaves room for the player row');
      assert.ok(layout.black.top+layout.black.height<bounds.top,'Black player stays above even the highest piece');
      assert.ok(layout.white.top>bounds.bottom,'White player stays below the board and file labels');
      if(layout.stacked){assert.ok(layout.aside.top>layout.white.top);assert.ok(layout.aside.top+layout.aside.height<=height)}
      else assert.ok(layout.aside.left>bounds.right,'Status, history and actions have their own side rail');
      for(const mesh of Object.values(pieceSolids))for(const x of [.5,7.5])for(const z of [.5,7.5])for(const vertex of mesh.vertices){
        const p=project3D([vertex[0]+x,vertex[1]*.78+.18,vertex[2]+z],layout.camera).point;assert.ok(contained(p,layout.area),'Every solid, including a raised piece, stays out of the UI');
      }
    }
  }
});

test('Chess information follows the visible board with comfortable gaps on tall, wide and panned views',()=>{
  for(const [width,height] of [[1210,1146],[1920,1080],[1440,1600],[900,1000],[390,844],[375,667],[1024,568],[844,390]]){
    for(const zoom of [.65,1,1.6])for(const pan of [{x:0,y:0},{x:width*.35,y:height*.2},{x:-width*.35,y:-height*.2}]){
      const layout=chessLayout({width,height},{zoom,pan}),bounds=chessBounds(layout.camera);
      const blackGap=bounds.top-layout.black.top-layout.black.height,whiteGap=layout.white.top-bounds.bottom;
      assert.ok(blackGap>=8-1e-7&&blackGap<=12+1e-7,'Host stays close to the tallest piece without covering it');
      assert.ok(whiteGap>=8-1e-7&&whiteGap<=12+1e-7,'Visitor stays close to the board coordinates');
      assert.ok(layout.black.top-layout.header.top-layout.header.height<=8+1e-7,'Heading stays with the player row');
      if(layout.stacked){
        assert.ok(Math.abs(layout.aside.top-layout.white.top-layout.white.height-10)<1e-7,'Stacked controls follow the player row');
        const centerOffset=Math.abs((layout.aside.left+layout.aside.width/2)-(bounds.left+bounds.right)/2);
        assert.ok(centerOffset<=(layout.aside.width-(bounds.right-bounds.left))/2+1e-7,'Stacked information stays with the board, allowing room at viewport edges');
      }else{
        assert.ok(Math.abs(layout.aside.left-bounds.right-20)<1e-7,'Side controls follow the actual right edge');
        assert.ok(Math.abs(layout.aside.top-bounds.top-8)<1e-7,'Side controls start next to the board');
      }
      for(const row of [layout.header,layout.black,layout.white]){
        assert.ok(row.left>=0&&row.left+row.width<=width,'Information stays inside the viewport');
      }
    }
  }
});

test('Camera fitting keeps board picking correct and preserves the same perspective',()=>{
  const area={left:250,right:940,top:280,bottom:920},original={x:1400,y:-100,scale:220,tilt:.72,yaw:-.10,distance:22};
  const fitted=fitChessCamera(original,area);assert.equal(fitted.tilt,original.tilt);assert.equal(fitted.yaw,original.yaw);assert.equal(original.scale,220);
  for(let row=0;row<8;row++)for(let col=0;col<8;col++){
    const point=project3D([col+.5,0,row+.5],fitted).point;const [x,z]=unprojectBoard(point,fitted);assert.ok(Math.abs(x-col-.5)<1e-9&&Math.abs(z-row-.5)<1e-9);
  }
});
