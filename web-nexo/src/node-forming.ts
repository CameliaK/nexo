import { motion, easeOut } from './motion';
const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function formationPhase(age: number, reduced = false) {
  const threadEnd = motion.formingSources + motion.formingThreads;
  const buildEnd = threadEnd + motion.formingBuild;
  const end = buildEnd + motion.formingPulse;
  const done = reduced || age >= end;
  return {
    sources: reduced ? 1 : easeOut(age / motion.formingSources),
    threads: reduced ? 1 : easeOut((age - motion.formingSources) / motion.formingThreads),
    build: reduced ? 1 : clamp((age - threadEnd) / motion.formingBuild),
    pulse: reduced ? 1 : clamp((age - buildEnd) / motion.formingPulse),
    light: done ? 0 : easeOut(age / motion.formingSources) * (1 - clamp((age - buildEnd) / motion.formingPulse)) * .8,
    done,
  };
}
