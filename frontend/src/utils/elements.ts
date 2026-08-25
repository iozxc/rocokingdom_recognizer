/**
 * 精灵属性展示工具：属性中文名 -> 代表色。
 *
 * 属性名与 datasets/roco_all_pets_info.json 里的 elements 一致（中文）。
 * 目前用颜色徽章代替真实属性 icon；后续拿到官方属性 icon 后，
 * 可在此处把 bg 换成 icon 图片地址 / 图标组件。
 */

export interface ElementStyle {
  /** 主背景色 */
  bg: string;
  /** 前景文字色 */
  fg?: string;
}

export const ELEMENT_COLORS: Record<string, ElementStyle> = {
  '光': { bg: '#F5B93A' },
  '冰': { bg: '#6FD1F0' },
  '地': { bg: '#B4824A' },
  '幻': { bg: '#9B7BF0' },
  '幽': { bg: '#7E5BD8' },
  '恶': { bg: '#6B7280' },
  '普通': { bg: '#94A3B8' },
  '机械': { bg: '#76839B' },
  '武': { bg: '#D07A4B' },
  '毒': { bg: '#A855F7' },
  '水': { bg: '#4AA3E8' },
  '火': { bg: '#F27B4B' },
  '电': { bg: '#F5C542', fg: '#7C5A00' },
  '翼': { bg: '#6FC3F5' },
  '草': { bg: '#6FC968' },
  '萌': { bg: '#F49BC0' },
  '虫': { bg: '#A9C84A' },
  '龙': { bg: '#6B8AF0' },
};

/** 属性图标 CDN 前缀：图标放在前端 public/elements 与后端 static/elements。 */
export const ELEMENT_ICON_BASE = '/elements/';

/** 取某个属性官方图标 URL（中文名需 URL 编码）。 */
export function getElementIconUrl(element: string): string {
  return `${ELEMENT_ICON_BASE}${encodeURIComponent(element)}.png`;
}

/** 英文枚举 -> 中文属性名（用于离线兜底 / 旧 mock 兼容）。 */
export const ELEMENT_EN_TO_CN: Record<string, string> = {
  grass: '草',
  fire: '火',
  water: '水',
  electric: '电',
  normal: '普通',
  ghost: '幽',
  dragon: '龙',
  light: '光',
  stone: '地',
  ice: '冰',
  ground: '地',
  steel: '机械',
  fighting: '武',
  poison: '毒',
  illusion: '幻',
  fairy: '萌',
  bug: '虫',
  flying: '翼',
};

/** 取某个属性的展示色；未知属性回退灰色。 */
export function getElementColor(element: string): ElementStyle {
  return ELEMENT_COLORS[element] || { bg: '#9CA3AF' };
}

/** 把英文枚举（可能存在的旧字段）换成中文属性列表。 */
export function elementsFromLegacy(element?: string): string[] {
  if (!element) return [];
  const cn = ELEMENT_EN_TO_CN[element];
  return cn ? [cn] : [];
}
