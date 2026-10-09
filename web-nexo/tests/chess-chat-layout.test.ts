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
test('Three columns reserve the same board geometry with chat closed/open and keep the center at least 520 px',()=>{
 for(const [width,height]of [[1920,1080],[1440,900],[1280,720],[1024,768]])for(const zoom of [.5,1,2]){
  const dock=desktopChatRegions(width,height),layout=chessLayout({width,height},{zoom,pan:{x:width*.25,y:-height*.2}}),bounds=chessBounds(layout.camera);
  assert.ok(bounds.left>=dock.center.left&&bounds.right<=dock.center.right);assert.ok(dock.left+dock.width<bounds.left);
  assert.ok(bounds.right<dock.system.left);assert.ok(dock.system.top+dock.system.height<layout.aside.top);
  assert.ok(layout.aside.top+layout.aside.height<=height-40);if(width>=1180)assert.ok(dock.center.right-dock.center.left>=520);
  assert.deepEqual(chessLayout({width,height},{zoom,pan:{x:0,y:0}},0),chessLayout({width,height},{zoom,pan:{x:0,y:0}},428));
 }
});
