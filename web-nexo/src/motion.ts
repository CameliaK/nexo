/** Shared timing in ms. Travel and chess timings are 30% shorter than the baseline. */
export const motion = {
  hover: 150, panel: 245, language: 196,
  enter: 1715, exit: 1575, system: 1540, livePanel: 504, generated: 840,
  formingSources: 600, formingThreads: 800, formingBuild: 600, formingPulse: 400, generatedFocus: 900, formingWait: 15000,
  chessOpen: 1085, chessClose: 805, chessMove: 364, chessReady: 140,
  reduced: 100, idleFps: 30, maxDpr: 2,
  rotation: .085, faceAlphaTop: .48, faceAlphaBottom: .58,
  easeOut: 'cubic-bezier(.16,1,.3,1)',
} as const;
export const easeOut = (value: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 3);
export function applyMotionTokens(doc: Document = document) {
  for (const key of ['hover','panel','language','enter','exit','system','livePanel','generated','formingSources','generatedFocus','formingThreads','formingBuild','formingPulse','chessOpen','chessClose','chessMove','chessReady','reduced'] as const) { const value=motion[key]; doc.documentElement.style.setProperty('--motion-' + key, value + 'ms'); }
  doc.documentElement.style.setProperty('--motion-ease-out', motion.easeOut);
}

/** Events may create a new animation while hidden; never shift it into the future. */
export function resumeStart(start:number,hiddenSince:number,now:number){
  return hiddenSince>0?start+Math.max(0,now-Math.max(start,hiddenSince)):start;
}
