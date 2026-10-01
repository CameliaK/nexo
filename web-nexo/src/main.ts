import './style.css';
import architectureJSON from './data/backend-architecture.json';
import type { BackendArchitecture, ConnectionState } from './backend/types';
import { createBackend } from './backend';
import { TracePlayer } from './system/traces';
import { createSystemWindow, systemPositions } from './system/window';
import createUniverse from './universe.js';
import { Chats } from './chat';
import { createChessUI, CHESS_NODE_VISIBLE } from './chess';

async function start() {
  const setup = await createBackend(), backend = setup.backend;
  const architecture = architectureJSON as BackendArchitecture;
  const traces = new TracePlayer(architecture);
  const portal = createSystemWindow(architecture, traces, setup.simulated);
  let connection: ConnectionState = 'closed';
  let reconnectTimer:ReturnType<typeof setTimeout>|undefined,reconnectDelay=1000,stopped=false;
  const reconnect=()=>{if(stopped||reconnectTimer)return;reconnectTimer=setTimeout(async()=>{reconnectTimer=undefined;try{await backend.connect()}catch{reconnectDelay=Math.min(15000,reconnectDelay*2);reconnect()}},reconnectDelay)};
  let chats: Chats;
  const chess = createChessUI();
  const universe = createUniverse({ architecture, simulated: setup.simulated, traces, portal, positions: systemPositions(architecture), connection: () => connection,
    chess, chessNodeVisible: CHESS_NODE_VISIBLE,
    onLiveOpen:()=>chats.openLive(),onSceneChanged:()=>chats?.sceneChanged(),onDiscard:(id:string)=>void chats.discard(id),onEscape:()=>chats.escape() });
  chats=new Chats(backend,universe,traces,setup.simulated);
  const stopEvents = backend.onEvent(event => {traces.receive(event);chats.receive(event)});
  const stopConnection = backend.onConnectionChange(state => {
    if (connection === 'open' && state !== 'open') {traces.disconnect();reconnect()}
    if(state==='open'){clearTimeout(reconnectTimer);reconnectTimer=undefined;reconnectDelay=1000}
    connection = state; portal.connection(state);void chats.connection(state);
  });
  if (setup.development && import.meta.env.DEV) {
    const panel = document.createElement('details'); panel.className = 'development-panel';
    const summary = document.createElement('summary'); summary.textContent = 'LAB · ESCENARIOS SIMULADOS';
    const help = document.createElement('p'); help.textContent = 'Prueba el recorrido. live-in recibe una respuesta sin mover la cámara.';
    const buttons = document.createElement('div'); buttons.className = 'scenario-buttons';
    const status = document.createElement('p'); status.className = 'development-status';status.setAttribute('role','status');
    for (const id of setup.development.scenarios) {
      const button = document.createElement('button'); button.textContent = id; button.type = 'button';
      button.onclick = () => { try { const accepted = setup.development!.play(id); chats.register(accepted.run_id, id !== 'live-in'); status.textContent = 'Reproduciendo: ' + id; } catch (error) { status.textContent = error instanceof Error ? error.message : 'No se pudo iniciar.'; } };
      buttons.append(button);
    }
    for (const code of ['/409','/429']) {
      const button=document.createElement('button');button.textContent=code;button.type='button';button.onclick=async()=>{try{await backend.sendMessage(code)}catch(error){status.textContent=error instanceof Error?error.message:'Error simulado'}};buttons.append(button);
    }
    panel.append(summary,help,buttons,status);document.body.append(panel);
  }
  try { await backend.connect(); } catch { portal.connection('closed'); }
  addEventListener('pagehide', event => { if(event.persisted)return;stopped=true;clearTimeout(reconnectTimer);stopEvents(); stopConnection(); backend.disconnect(); chats.dispose();universe.dispose();chess.dispose(); });
}
start().catch(error => { console.error(error);document.getElementById('announcement')!.textContent='No se pudo iniciar el explorador.'; });
