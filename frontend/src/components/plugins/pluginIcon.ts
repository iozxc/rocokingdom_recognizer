import {
  Activity, Antenna, BookOpen, Cable, Dna, Egg, Network, Puzzle, Radar, Radio, ScanLine, Satellite, Sprout,
  Waypoints, Wifi, type LucideIcon,
} from 'lucide-react';

/**
 * 插件图标：插件清单的 `ui.icon` 可以写一个语义图标名（如 radar / radio / wifi），
 * 这里映射成内置图标；写的是图片相对路径或没写时回退到 Puzzle。
 *
 * 之前不管什么插件都硬套一个 Puzzle，语义不清；换成由插件自己声明。
 */
const PLUGIN_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  antenna: Antenna,
  bookopen: BookOpen,
  cable: Cable,
  dna: Dna,
  // 生育规划类插件用蛋/幼苗，语义比 Puzzle 清楚
  egg: Egg,
  eggoff: Egg,
  sprout: Sprout,
  network: Network,
  puzzle: Puzzle,
  radar: Radar,
  radio: Radio,
  scanline: ScanLine,
  satellite: Satellite,
  waypoints: Waypoints,
  wifi: Wifi,
};

export function pluginIconOf(plugin: { icon?: string } | null | undefined): LucideIcon {
  const raw = String(plugin?.icon || '').trim().toLowerCase();
  // 图片路径（有 / 或扩展名）不参与映射
  if (!raw || raw.includes('/') || raw.includes('.')) return Puzzle;
  const key = raw.replace(/[\s_-]/g, '');
  return PLUGIN_ICONS[key] || Puzzle;
}
