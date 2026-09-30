import type { BackendArchitecture, ConnectionState } from '../backend/types';
import type { TracePlayer } from './traces';
export function systemPositions(architecture: BackendArchitecture) {
  return architecture.components.map(component => {
    const peers=architecture.components.filter(c=>c.layer===component.layer),index=peers.indexOf(component);
    return {id:component.id,x:22+component.layer*53,y:67+(index-(peers.length-1)/2)*33};
  });
}
/** Accessible entrance only: the universe draws the actual meshes, sharing its
 * renderer, rotation clock and trace state with the expanded architecture. */
export function createSystemWindow(architecture:BackendArchitecture,traces:TracePlayer,simulated:boolean){
  const portal=document.createElement('aside');portal.id='system-window';portal.className='system-aperture';
  const enter=document.createElement('button');enter.className='system-enter';enter.type='button';enter.setAttribute('aria-label','Acercar sistema distante');
  const caption=document.createElement('span');caption.className='system-caption';caption.textContent='SISTEMA DISTANTE · ACERCAR ↗';
  const status=document.createElement('span');status.className='sr-only';status.id='system-connection';
  const activity=document.createElement('span');activity.className='sr-only';activity.id='system-activity';
  enter.setAttribute('aria-describedby','system-connection system-activity');enter.append(caption);portal.append(enter,status,activity);document.body.append(portal);
  return{element:portal,button:enter,
    connection(state:ConnectionState){status.textContent=state==='open'?(simulated?'Sistema simulado':'En línea'):state==='connecting'?'Conectando':'Sin conexión';},
    render(){activity.textContent=traces.latest;portal.dataset.active=String(architecture.components.some(c=>traces.light(c.id).state==='active'));}
  };
}
