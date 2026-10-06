import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';

// Run against `npm run build && npm run preview`, never Vite's development server.
const url=process.env.PERF_URL||'http://127.0.0.1:4175';
const runs=Number(process.env.PERF_RUNS||3),output=process.argv[2]||'docs/performance-results.json';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const generated=Array.from({length:12},(_,i)=>({id:'gen_perf_'+i,generated:true,label:'Generated '+(i+1),summary:'Performance fixture',created_at:'2026-10-05T18:00:00Z',sources:[{title:'Fixture',ref:'aprendizaje'}],layout:'text',content:{body:'Neutral reproducible fixture.'}}));
const game={id:'perf-game',color:'w',fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',moves:[],turn:'player',status:'active',updated_at:'2026-10-05T18:00:00Z'};
const results=[];
try{
 for(let run=0;run<runs;run++){
  const context=await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:2});
  const page=await context.newPage();
  page.on("pageerror",error=>console.error(error.message));
  await page.route('**/*',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/v1/ws-ticket')return route.fulfill({json:{ticket:crypto.randomUUID(),expires_in:30}});
   if(path==='/auth/guest')return route.fulfill({json:{token:'fixture-guest'}});
   if(path==='/api/v1/auth/me')return route.fulfill({json:{mode:'user',email_hint:'v***@example.com'}});
   if(path==='/api/v1/account/notifications')return route.fulfill({json:{chess_email:true}});
   if(path==='/api/v1/session/nodes')return route.fulfill({json:{nodes:generated}});
   if(path==='/api/v1/live/messages')return route.fulfill({json:{conversation_id:'fixture',messages:[]}});
   if(path==='/api/v1/chess/game')return route.fulfill({json:{game}});
   return route.continue();
  });
  let firstSocket=true;
  await page.routeWebSocket(/\/ws\?/,ws=>{ws.onMessage(()=>{});if(firstSocket){firstSocket=false;setTimeout(()=>ws.close({code:1000}),500)}});
  await page.addInitScript(()=>{
   localStorage.setItem('nexo.welcome.dismissed.v1','1');localStorage.setItem('nexo.auth.token','fixture-account');localStorage.setItem('nexo.language','en');
   const perf=window.__perf={frames:[],budgets:[],tasks:[],start:0};
   const original=CanvasRenderingContext2D.prototype.fillRect;
   CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){
    if(this.canvas.id==='space'&&x===0&&y===0&&w===innerWidth&&h===innerHeight){const now=performance.now();if(!perf.frames.length||now-perf.frames.at(-1)>2){perf.frames.push(now);perf.budgets.push(Number(document.body?.dataset.canvasFps)||60)}}
    return original.call(this,x,y,w,h);
   };
   new PerformanceObserver(list=>{for(const task of list.getEntries())perf.tasks.push({start:task.startTime,duration:task.duration})}).observe({type:'longtask',buffered:true});
   document.addEventListener('click',event=>{if(event.target.closest?.('#floating-chess'))perf.start=performance.now()},true);
  });
  await page.goto(url);await page.waitForFunction(()=>document.querySelectorAll('.node-target.is-generated').length===12).catch(async error=>{console.error(await page.evaluate(()=>({nodes:document.querySelectorAll('.node-target.is-generated').length,text:document.body.innerText.slice(-1500)})));throw error});
  await page.waitForTimeout(1500);
  const cameraStart=await page.evaluate(()=>performance.now());
  await page.mouse.move(1050,160);await page.mouse.down();
  const start=Date.now();
  for(let i=0;i<300;i++){await page.mouse.move(1050+Math.sin(i/24)*100,160+Math.cos(i/30)*60);const remaining=start+(i+1)*1000/60-Date.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining))}
  await page.mouse.up();const cameraEnd=await page.evaluate(()=>performance.now());
  const fps=await page.evaluate(({cameraStart,cameraEnd})=>{const f=window.__perf.frames.filter(t=>t>=cameraStart&&t<=cameraEnd);return (f.length-1)*1000/(f.at(-1)-f[0])},{cameraStart,cameraEnd});
  await page.locator('#floating-chess').click({force:true});
  const interactive=await page.evaluate(()=>new Promise(resolve=>{
   const poll=()=>{const scene=document.querySelector('#chess-scene'),square=scene?.querySelector('[data-square="e2"]');if(square&&scene.classList.contains('is-ready')&&!square.closest('[inert]')){square.click();if(square.getAttribute('aria-selected')==='true'){resolve(performance.now()-window.__perf.start);return}}requestAnimationFrame(poll)};poll();
  }));
  await page.waitForTimeout(1800);
  const opening=await page.evaluate(()=>{
   const {start,frames,budgets,tasks}=window.__perf,end=start+1800,f=frames.filter(t=>t>=start&&t<=end),intervals=f.slice(1).map((v,i)=>v-f[i]);
   return {unexpectedLostFrames:intervals.reduce((sum,gap,i)=>sum+Math.max(0,Math.round(gap/(1000/(budgets[frames.indexOf(f[i+1])]||60)))-1),0),lostFrames:intervals.reduce((sum,gap)=>sum+Math.max(0,Math.round(gap/(1000/60))-1),0),frameIntervals:intervals.length,longTasks:tasks.filter(t=>t.start>=start&&t.start<end&&t.duration>50),maxFrameMs:Math.max(...intervals)};
  });
  const board=await page.locator('.chess-board').boundingBox();
  results.push({run:run+1,interactiveMs:interactive,cameraFps:fps,...opening,board});
  if(run===0)await page.screenshot({path:output.replace(/\.json$/,'.png'),scale:'css'});
  await context.close();
 }
 const average=key=>results.reduce((sum,r)=>sum+r[key],0)/results.length;
 const report={at:new Date().toISOString(),url,browser:await browser.version(),machine:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model,cores:os.cpus().length},viewport:'1366x768',dpr:2,generatedNodes:12,openingWindowMs:1800,summary:{interactiveMs:average('interactiveMs'),cameraFps:average('cameraFps'),lostFrames:average('lostFrames'),unexpectedLostFrames:average('unexpectedLostFrames'),longTasks:results.reduce((sum,r)=>sum+r.longTasks.length,0)},results};
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary,null,2));
}finally{await browser.close()}
