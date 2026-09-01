import { FirePokedexEntry } from '../types';
import { api } from './api';
import { IS_STATIC } from './staticMode';

/**
 * 火系全图鉴数据缓存：应用启动时预取一次，
 * 进入火系徽章试炼时可直接同步读取，避免切换页面时闪现加载页。
 */
let cachedFirePets: FirePokedexEntry[] | null = null;
let pendingPromise: Promise<FirePokedexEntry[]> | null = null;
let cachedFireMapPets: Record<string, Record<string, { id?: number; name?: string; seq?: number | null }>> | null = null;
let pendingMapPets: Promise<Record<string, Record<string, { id?: number; name?: string; seq?: number | null }>>> | null = null;

export function getCachedFirePets(): FirePokedexEntry[] | null {
  return cachedFirePets;
}

export function getFireTrialPetsCached(): Promise<FirePokedexEntry[]> {
  if (IS_STATIC) {
    return Promise.resolve([]);
  }
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

/** 火系每张地图的精灵名单（来自后端 load_map_pets -> datasets/map_pets2.json）。 */
export function getFireMapPets(): Promise<Record<string, Record<string, { id?: number; name?: string; seq?: number | null }>>> {
  if (IS_STATIC) {
    return Promise.resolve({});
  }
  if (cachedFireMapPets) {
    return Promise.resolve(cachedFireMapPets);
  }
  if (!pendingMapPets) {
    pendingMapPets = api
        .getTrialMapPets('fire')
        .then((res) => {
          cachedFireMapPets = res.map_pets || {};
          return cachedFireMapPets;
        })
        .finally(() => {
          pendingMapPets = null;
        });
  }
  return pendingMapPets;
}

export function invalidateFireTrialData(): void {
  cachedFirePets = null;
  pendingPromise = null;
  cachedFireMapPets = null;
  pendingMapPets = null;
}
