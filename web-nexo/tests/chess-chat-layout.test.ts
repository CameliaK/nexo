import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopChatRegions} from '../src/chess-chat-layout';
import {chessBounds,chessLayout} from '../src/chess/layout';
import {motion} from '../src/motion';
test('The shared chess node-to-panel token is 900 ms',()=>assert.equal(motion.chessChat,900));
test('Three columns reserve the same board geometry with chat closed/open and keep the center at least 520 px',()=>{
 for(const [width,height]of [[1920,1080],[1440,900],[1280,720],[1024,768]])for(const zoom of [.5,1,2]){
  const dock=desktopChatRegions(width,height),layout=chessLayout({width,height},{zoom,pan:{x:width*.25,y:-height*.2}}),bounds=chessBounds(layout.camera);
  assert.ok(bounds.left>=dock.center.left&&bounds.right<=dock.center.right);assert.ok(dock.left+dock.width<bounds.left);
  assert.ok(bounds.right<dock.system.left);assert.ok(dock.system.top+dock.system.height<layout.aside.top);
  assert.ok(layout.aside.top+layout.aside.height<=height-dock.bottom);if(width>=1180)assert.ok(dock.center.right-dock.center.left>=520);
  assert.deepEqual(chessLayout({width,height},{zoom,pan:{x:0,y:0}},0),chessLayout({width,height},{zoom,pan:{x:0,y:0}},428));
 }
});
