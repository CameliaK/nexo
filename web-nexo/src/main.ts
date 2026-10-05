import { AccountChess, errorText, chessGate, chessNode } from './auth/session';
import { createAccessPanel } from './auth/panel';
import { t, translateUI, languageStore } from './i18n';
import './style.css';
import './auth/style.css';
import './media.css';
import './welcome.css';
import { createWelcome } from './welcome';
import { architecture, applyContent, registerTranslations } from './i18n/content';
import { initializeLanguage } from './i18n';
import { createLanguageNode } from './i18n/node';
import type { ConnectionState } from './backend/types';
import { createBackend } from './backend';
import { TracePlayer } from './system/traces';
import { createSystemWindow, systemPositions } from './system/window';
import createUniverse from './universe.js';
import { Chats } from './chat';
import { createChessUI, CHESS_NODE_VISIBLE } from './chess';
import { createMediaUI } from './media';

async function start() {
  const translations=import.meta.glob('./data/*.en.json',{eager:true,import:'default'});
  registerTranslations(translations['./data/portfolio-content.en.json'],translations['./data/backend-architecture.en.json']);
  const stopPersistence=initializeLanguage();applyContent(languageStore.language);
  const stopContent=languageStore.subscribe(applyContent);
  const languageNode=createLanguageNode();
  const welcome=createWelcome();
  const setup = await createBackend(), backend = setup.backend;

  const traces = new TracePlayer(architecture);
  const portal = createSystemWindow(architecture, traces, setup.simulated);
  let connection: ConnectionState = 'closed';
  let reconnectTimer:ReturnType<typeof setTimeout>|undefined,reconnectDelay=1000,stopped=false;
  const reconnect=()=>{if(stopped||reconnectTimer)return;reconnectTimer=setTimeout(async()=>{reconnectTimer=undefined;try{await backend.connect()}catch{reconnectDelay=Math.min(15000,reconnectDelay*2);reconnect()}},reconnectDelay)};
  let chats: Chats;
  const account = new AccountChess(backend);
  const chess = createChessUI(account);
  const media = createMediaUI();
  const universe = createUniverse({ architecture, simulated: setup.simulated, traces, portal, positions: systemPositions(architecture), connection: () => connection,
    chess,
    chessAccess:()=>chessNode(account),
    onChessAccess:()=>{if(chessGate(account)==='login'){access.open();return false}if(!account.available||account.error)void account.refresh();account.selectPlayer();return true},
    onOwnerGame:(id:string,origin:any,provider:any)=>{if(account.selectOwner(id))chess.open(origin,provider)},
    chessNodeVisible: CHESS_NODE_VISIBLE, media,
    onLiveOpen:()=>chats.openLive(),onSceneChanged:()=>chats?.sceneChanged(),onDiscard:(id:string)=>void chats.discard(id),onEscape:()=>chats.escape() });
  const access=createAccessPanel(account,{simulatedLink:setup.development?.simulatedLink,onRoute:()=>{if(!welcome.element.hidden)welcome.close()},onIdentity:()=>{chats.resetIdentity();void chats.connection(connection)}});
  let identityKey='guest';
  const stopAccount=account.subscribe(()=>{const key=account.me.mode+':'+(account.me.email_hint||'');if(key!==identityKey){chats?.resetIdentity();identityKey=key}universe.setOwnerGames(account.me.mode==='owner',account.ownerGames)});
  welcome.attachUniverse(()=>universe.firstRootNode());
  chats=new Chats(backend,universe,traces,setup.simulated);
  let transitionTimer:ReturnType<typeof setTimeout>;
  const stopLanguage=languageStore.subscribe(()=>{
    document.documentElement.lang=languageStore.language;
    traces.refreshLanguage();universe.refreshLanguage();chats.refreshLanguage();chess.refreshLanguage();portal.connection(connection);translateUI();
    document.body.classList.remove('is-language-changing');void document.body.offsetWidth;document.body.classList.add('is-language-changing');
    clearTimeout(transitionTimer);transitionTimer=setTimeout(()=>document.body.classList.remove('is-language-changing'),280);
    document.getElementById('announcement')!.textContent=t('language.changed');
  });
  const stopEvents = backend.onEvent(event => {if(event.type!=='chess.move'&&event.type!=='owner.chess'){traces.receive(event);chats.receive(event)}});
  const stopConnection = backend.onConnectionChange(state => {
    if (connection === 'open' && state !== 'open') {traces.disconnect();reconnect()}
    if(state==='open'){clearTimeout(reconnectTimer);reconnectTimer=undefined;reconnectDelay=1000}
    connection = state; portal.connection(state);void chats.connection(state);
    if(state==='open')void account.refresh();
  });
  let stopDevelopment:(()=>void)|undefined;
  if (setup.development && import.meta.env.DEV) {
    const panel = document.createElement('details'); panel.className = 'development-panel';
    const summary = document.createElement('summary'); summary.textContent = t('lab.title');
    const help = document.createElement('p'); help.textContent = t('lab.help');
    const buttons = document.createElement('div'); buttons.className = 'scenario-buttons';
    const status = document.createElement('p'); status.className = 'development-status';status.setAttribute('role','status');
    for (const id of setup.development.scenarios) {
      const button = document.createElement('button'); button.textContent = id; button.type = 'button';
      button.onclick = () => { try { const accepted = setup.development!.play(id); chats.register(accepted.run_id, id !== 'live-in'); status.textContent = t('lab.play',{id}); } catch (error) { status.textContent = error instanceof Error ? error.message : t('lab.failed'); } };
      buttons.append(button);
    }
    for (const code of ['/409','/429']) {
      const button=document.createElement('button');button.textContent=code;button.type='button';button.onclick=async()=>{try{await backend.sendMessage(code,languageStore.language)}catch(error){status.textContent=error instanceof Error?error.message:t('error.unexpected')}};buttons.append(button);
    }
    const linkButton=document.createElement('button');linkButton.type='button';linkButton.textContent=t('lab.loginLink');linkButton.onclick=()=>{const link=setup.development!.simulatedLink();if(link)location.hash=link;else status.textContent=t('lab.noLoginLink')};
    const googleButton=document.createElement('button');googleButton.type='button';googleButton.textContent=t('lab.google');googleButton.onclick=()=>void backend.startGoogleLogin();
    const ownerLabel=document.createElement('label'),ownerToggle=document.createElement('input'),ownerText=document.createElement('span');ownerToggle.type='checkbox';ownerText.textContent=t('lab.owner');ownerLabel.append(ownerToggle,ownerText);ownerToggle.checked=account.me.mode==='owner';ownerToggle.onchange=async()=>{await setup.development!.setOwnerMode(ownerToggle.checked);chats.resetIdentity();await account.refresh()};
    const replyButton=document.createElement('button');replyButton.type='button';replyButton.textContent=t('lab.chessReply');replyButton.onclick=async()=>{try{await setup.development!.simulateReply()}catch(error){status.textContent=errorText(error)}};
    stopDevelopment=account.subscribe(()=>ownerToggle.checked=account.me.mode==='owner');
    buttons.append(linkButton,googleButton,ownerLabel,replyButton);
    panel.append(summary,help,buttons,status);document.body.append(panel);
  }
  access.readRoute();
  try { await backend.connect(); } catch { portal.connection('closed'); }
  await account.refresh();
  addEventListener('pagehide', event => { if(event.persisted)return;stopped=true;clearTimeout(transitionTimer);stopDevelopment?.();stopAccount();account.dispose();access.dispose();stopLanguage();stopContent();stopPersistence();welcome.dispose();languageNode.dispose();clearTimeout(reconnectTimer);stopEvents(); stopConnection(); backend.disconnect(); chats.dispose();universe.dispose();chess.dispose(); });
}
start().catch(error => { console.error(error);document.getElementById('announcement')!.textContent=t('app.startFailed'); });
