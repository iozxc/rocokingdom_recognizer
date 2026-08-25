import { FirePokedexEntry } from '../types';
import { api } from './api';

/**
 * 火系全图鉴数据缓存：应用启动时预取一次，
 * 进入火系徽章试炼时可直接同步读取，避免切换页面时闪现加载页。
 */
let cachedFirePets: FirePokedexEntry[] | null = null;
let pendingPromise: Promise<FirePokedexEntry[]> | null = null;

export function getCachedFirePets(): FirePokedexEntry[] | null {
  return cachedFirePets;
}

export function getFireTrialPetsCached(): Promise<FirePokedexEntry[]> {
  if (cachedFirePets) {
    return Promise.resolve(cachedFirePets);
  }
  if (!pendingPromise) {
    pendingPromise = api
        .getFireTrialPets()
        .then((res) => {
          cachedFirePets = Array.isArray(res.pets) ? res.pets : [];
          return cachedFirePets;
        })
        .finally(() => {
          pendingPromise = null;
        });
  }
  return pendingPromise;
}

export function invalidateFireTrialData(): void {
  cachedFirePets = null;
  pendingPromise = null;
}
