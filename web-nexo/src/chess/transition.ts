import { motion, easeOut } from '../motion';
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
/** One reversible timeline, with the same endpoint geometry for entry and exit. */
export function chessPhase(reveal:number,reduced=false){
  const age=clamp(reveal)*motion.chessOpen;
  return reduced?{approach:0,unfold:1,board:reveal,pieces:reveal,pulse:0}:{
    approach:easeOut(age/motion.chessApproach),
    unfold:easeOut((age-motion.chessApproach)/motion.chessUnfold),
    board:easeOut((age-motion.chessApproach-motion.chessUnfold*.55)/(motion.chessUnfold*.45)),
    pieces:easeOut((age-motion.chessApproach-motion.chessUnfold)/motion.chessPieces),
    pulse:Math.sin(Math.PI*clamp((age-motion.chessApproach-motion.chessUnfold)/motion.chessPieces)),
  };
}
