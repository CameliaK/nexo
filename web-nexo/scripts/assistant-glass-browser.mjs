import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {pngPixels} from './qa-pixels.mjs';
import {mobileFixture,chromium,webkit} from './mobile-fixture.mjs';
const reports=[];
export async function checkAssistantGlass(page){
 const panel=page.locator('#companion-panel');
 await page.locator('#companion-target').focus();await page.keyboard.press('Enter');await panel.waitFor();
 await panel.locator('.panel-body').evaluate(body=>{
  for(let i=0;i<30;i++){const row=document.createElement('p');row.textContent='Respuesta larga del asistente para comprobar el fondo uniforme al desplazar el historial. '+i;body.append(row)}
  const backdrop=document.createElement('div');backdrop.id='qa-backdrop';Object.assign(backdrop.style,{position:'fixed',inset:'0',zIndex:'39',background:'rgb(120,150,160)',pointerEvents:'none'});document.body.append(backdrop);
 });
 const surface=await panel.locator('.panel-surface').boundingBox(),sample={x:surface.x+5,y:surface.y+surface.height*.4,width:7,height:18};
 const colors=[],positions=[];
 for(const value of ['top','bottom']){
  await panel.locator('.panel-body').evaluate((body,value)=>body.scrollTop=value==='top'?0:body.scrollHeight,value);await page.waitForTimeout(50);
  colors.push(pngPixels(await page.screenshot({scale:'css'})).mean(sample));
  positions.push(await panel.locator('.panel-body').evaluate(e=>e.scrollTop));
 }
 assert.ok(positions[1]>positions[0],'Body scrolls');
 const alphas=colors.map(rgb=>(120-rgb[0])/(120-8));assert.ok(Math.abs(alphas[0]-alphas[1])<.05,'Effective opacity varies by less than 5%');
 const styles=await panel.evaluate(e=>[e,e.firstElementChild,e.querySelector('.panel-body')].map(n=>{const s=getComputedStyle(n);return{element:n.className,background:s.backgroundColor,clip:s.clipPath,mask:s.maskImage,filter:s.filter,willChange:s.willChange,transform:s.transform,opacity:s.opacity,blur:s.backdropFilter||s.webkitBackdropFilter,overflow:s.overflowY,scroll:n.scrollTop}}));
 for(const s of styles){assert.equal(s.clip,'none');assert.equal(s.filter,'none');assert.equal(s.willChange,'auto');assert.equal(s.transform,'none');assert.equal(s.opacity,'1')}
 assert.match(styles[1].blur,/blur\((16|20)px\)/);assert.equal(styles[1].scroll,0);assert.equal(styles[2].background,'rgba(0, 0, 0, 0)');
 await page.locator('#qa-backdrop').evaluate(e=>e.remove());
 const labels=await page.locator('.node-target,.floating-chess,.language-node,.account-node,.welcome-help,.orientation,.level-mark,.privacy-footer,.instruction').evaluateAll(nodes=>{const pane=document.querySelector('#companion-panel').getBoundingClientRect();return nodes.filter(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&r.width&&r.left<pane.right&&r.right>pane.left&&r.top<pane.bottom&&r.bottom>pane.top}).map(n=>n.className)});
 assert.deepEqual(labels,[],'Intersecting universe labels are occluded');
 return {styles,sample,colors,effectiveOpacity:alphas,difference:Math.abs(alphas[0]-alphas[1]),positions};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 for(const [engine,provider]of [['chromium',chromium],['webkit',webkit]]){const browser=await provider.launch();try{for(const [width,height]of [[1440,900],[1280,720],[390,844]]){const f=await mobileFixture(browser,{viewport:{width,height},hasTouch:true});reports.push({engine,width,height,...await checkAssistantGlass(f.page)});assert.deepEqual(f.errors,[]);await f.context.close();console.log(engine+' '+width+' uniform assistant glass OK')}}finally{await browser.close()}}
 await writeFile(fileURLToPath(new URL('../docs/chess-layout/D-glass.json',import.meta.url)),JSON.stringify(reports,null,2)+'\n');
}
