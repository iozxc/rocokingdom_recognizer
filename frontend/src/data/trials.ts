import { MapConfig, Trial } from '../types';
import { MAP_CONFIGS } from './mockPets';

/**
 * 火系地图的本地兜底配置：正常情况由后端 /api/trials 下发，
 * 后端不可用或字段缺失时才使用这里。
 */
export const FIRE_MAP_CONFIGS: MapConfig[] = [
  {
    id: 'map1',
    num: 1,
    name: '火系徽章试炼图一',
    description: '火系徽章试炼第一张地图，全图鉴精灵均可在此自选点亮。',
    themeColor: '#f97316',
    bgGradient: 'from-orange-500/20 via-red-500/10 to-amber-600/20',
    badgeBg: 'bg-orange-500/15 text-orange-700 border-orange-400',
    iconName: 'Flame',
  },
  {
    id: 'map2',
    num: 2,
    name: '火系徽章试炼图二',
    description: '火系徽章试炼第二张地图，全图鉴精灵均可在此自选点亮。',
    themeColor: '#ef4444',
    bgGradient: 'from-red-500/20 via-rose-500/10 to-orange-600/20',
    badgeBg: 'bg-red-500/15 text-red-700 border-red-400',
    iconName: 'Flame',
  },
  {
    id: 'map3',
    num: 3,
    name: '火系徽章试炼图三',
    description: '火系徽章试炼第三张地图，全图鉴精灵均可在此自选点亮。',
    themeColor: '#ea580c',
    bgGradient: 'from-amber-500/20 via-orange-500/10 to-red-600/20',
    badgeBg: 'bg-amber-500/15 text-amber-800 border-amber-400',
    iconName: 'Flame',
  },
];

/**
 * 根据后端下发的试炼列表解析某个试炼的地图展示配置；
 * 后端未下发时按试炼 key 回退到本地默认配置。
 */
export function resolveTrialMaps(trials: Trial[], trialKey: string): MapConfig[] {
  const trial = trials.find((t) => t.key === trialKey);
  if (trial?.maps && trial.maps.length > 0) {
    return trial.maps.map((m) => ({ ...m }));
  }
  if (trialKey === 'fire') {
    return FIRE_MAP_CONFIGS;
  }
  return MAP_CONFIGS;
}

