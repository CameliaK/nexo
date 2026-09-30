import type { PortfolioBackend } from './types';
import { RealBackend } from './real';
export interface BackendSetup {
  backend: PortfolioBackend;
  simulated: boolean;
  development?: { scenarios: string[]; play: (id: string) => { run_id: string }; };
}
export async function createBackend(): Promise<BackendSetup> {
  const choice = import.meta.env.VITE_BACKEND || 'mock';
  if (import.meta.env.DEV && choice === 'mock') {
    const { MockBackend, scenarioIds } = await import('./mock');
    let storage: Storage | undefined;
    try { storage = localStorage; } catch { /* Browser privacy mode. */ }
    const backend = new MockBackend(undefined, storage);
    return { backend, simulated: true, development: { scenarios: scenarioIds, play: id => backend.playScenario(id) } };
  }
  return { backend: new RealBackend(), simulated: false };
}
