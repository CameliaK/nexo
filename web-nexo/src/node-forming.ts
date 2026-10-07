import { motion, easeOut } from './motion';
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function formationPhase(age: number, reduced = false) {
  const buildEnd = motion.formingThreads + motion.formingBuild;
  const end = buildEnd + motion.formingPulse;
  const done = reduced || age >= end;
  return {
    threads: reduced ? 1 : easeOut(age / motion.formingThreads),
    build: reduced ? 1 : clamp((age - motion.formingThreads) / motion.formingBuild),
    pulse: reduced ? 1 : clamp((age - buildEnd) / motion.formingPulse),
    light: done ? 0 : (1 - clamp((age - buildEnd) / motion.formingPulse)) * .8,
    done,
  };
}
