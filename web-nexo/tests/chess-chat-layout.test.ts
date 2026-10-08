import test from 'node:test';
import assert from 'node:assert/strict';
import {chessChatProgress,setChessChatLayout,chessChatAnimating,desktopChatRegions} from '../src/chess-chat-layout';
import {chessBounds,chessLayout} from '../src/chess/layout';
import {motion} from '../src/motion';
test('Chess, system and chat share a 250 ms ease-out clock; reduced motion is immediate',()=>{
 setChessChatLayout(false,true,0);setChessChatLayout(true,false,100);
 assert.equal(chessChatProgress(100),0);assert.ok(chessChatProgress(225)>.5);assert.equal(chessChatAnimating(225),true);
 assert.equal(chessChatProgress(100+motion.chessChat),1);assert.equal(chessChatAnimating(350),false);
 setChessChatLayout(false,false,400);assert.equal(chessChatProgress(400),1);assert.equal(chessChatProgress(650),0);
 setChessChatLayout(true,true,700);assert.equal(chessChatProgress(700),1);assert.equal(chessChatAnimating(700),false);
 setChessChatLayout(false,true,800);
});
test('Desktop chat reservation keeps the entire board and game controls left of its column at every camera zoom',()=>{
 for(const [width,height]of [[1440,900],[1366,768],[1280,720],[1024,700],[1440,550]])for(const zoom of [.5,1,2]){
  const dock=desktopChatRegions(width,height),layout=chessLayout({width,height},{zoom,pan:{x:width*.25,y:-height*.2}},dock.reserved),bounds=chessBounds(layout.camera);
  assert.ok(bounds.right<dock.left);assert.ok(bounds.left>=0);
  for(const r of [layout.header,layout.black,layout.white,layout.aside])assert.ok(r.left+r.width<dock.left,'Game information clears glass column');
  assert.ok(dock.system.left+dock.system.width<dock.left);assert.ok(dock.system.top+dock.system.height<height);
 }
});
