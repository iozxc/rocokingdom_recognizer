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
 * 地图感知的本地兜底地图配置：正常由后端 /api/trials 下发，
 * 后端不可用或字段缺失时才使用这里。
 * 注意：地图感知是开放世界跑图工具（按小地图定位玩家世界坐标），
 * 不是徽章试炼；这里只是复用 Trial/MapConfig 的展示结构，
 * trialKey 'map' 仅为前端内部伪 key，后端 config.TRIALS 中并不存在该试炼。
 */
export const WORLD_MAP_CONFIG: MapConfig[] = [
  {
    id: 'map1',
    num: 1,
    name: '世界实时地图',
    description: '实时感知你在洛克王国世界中的位置、朝向与周围刷新的精灵。',
    themeColor: '#7ABCF4',
    bgGradient: 'from-sky-500/20 via-blue-400/10 to-cyan-500/20',
    badgeBg: 'bg-sky-500/15 text-sky-700 border-sky-400',
    iconName: 'Map',
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
  if (trialKey === 'map') {
    return WORLD_MAP_CONFIG;
  }
  return MAP_CONFIGS;
}
