import { MapConfig, PetItem } from '../types';

export const MAP_CONFIGS: MapConfig[] = [
  {
    id: 'map1',
    num: 1,
    name: '记忆中的索米亚草原',
    description: '绿草如茵的古老草原，微风中飘荡着青草香气，常能遇到草系与萌系小精灵。',
    themeColor: '#10b981', // Emerald
    bgGradient: 'from-emerald-500/20 via-teal-500/10 to-green-600/20',
    badgeBg: 'bg-emerald-500/15 text-emerald-700 border-emerald-400',
    iconName: 'Sparkles',
  },
  {
    id: 'map2',
    num: 2,
    name: '记忆中的巨石阵',
    description: '庄严神秘的古代巨石遗迹，凝聚着古老的石系与土系魔力，隐藏着坚毅的守卫者。',
    themeColor: '#f59e0b', // Amber/Stone
    bgGradient: 'from-amber-500/20 via-orange-500/10 to-stone-600/20',
    badgeBg: 'bg-amber-500/15 text-amber-800 border-amber-400',
    iconName: 'Shield',
  },
  {
    id: 'map3',
    num: 3,
    name: '记忆中的普拉塔草原',
    description: '王国最广袤的试炼草原，阳光明媚，栖息着各种活泼灵动、身手敏捷的初级精灵。',
    themeColor: '#3b82f6', // Sky/Grass blue
    bgGradient: 'from-sky-500/20 via-indigo-500/10 to-blue-600/20',
    badgeBg: 'bg-sky-500/15 text-sky-800 border-sky-400',
    iconName: 'Compass',
  },
];

// Helper to generate colorful pet avatars using SVG data URLs matching Roco Kingdom pet styles
export const createSvgPetAvatar = (
  name: string,
  element: string,
  bgHue: number,
  accentColor: string,
  emoji: string
) => {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
    <defs>
      <linearGradient id="g_${bgHue}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="hsl(${bgHue}, 85%, 92%)" />
        <stop offset="100%" stop-color="hsl(${bgHue}, 75%, 78%)" />
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="3" stdDeviation="2" flood-opacity="0.15" />
      </filter>
    </defs>
    <rect width="120" height="120" rx="24" fill="url(#g_${bgHue})" />
    <circle cx="60" cy="56" r="42" fill="#ffffff" fill-opacity="0.75" />
    <circle cx="60" cy="56" r="38" fill="hsl(${bgHue}, 80%, 96%)" />
    <!-- Magic sparkles -->
    <path d="M24,28 Q30,28 30,22 Q30,28 36,28 Q30,28 30,34 Q30,28 24,28 Z" fill="${accentColor}" opacity="0.6"/>
    <path d="M92,86 Q96,86 96,82 Q96,86 100,86 Q96,86 96,90 Q96,86 92,86 Z" fill="${accentColor}" opacity="0.6"/>
    <!-- Pet Avatar Graphics -->
    <text x="60" y="68" font-size="44" text-anchor="middle" dominant-baseline="central" filter="url(#shadow)">${emoji}</text>
    <!-- Element Mini Orb -->
    <circle cx="94" cy="26" r="14" fill="${accentColor}" />
    <circle cx="94" cy="26" r="12" fill="#ffffff" fill-opacity="0.25" />
    <text x="94" y="30" font-size="10" font-weight="bold" fill="#ffffff" text-anchor="middle">${element.slice(0, 1)}</text>
  </svg>
  `.trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

// Fallback catalog for all 3 maps
export const FALLBACK_MAPS_DATA: Record<string, { count: number; items: PetItem[] }> = {
  map1: {
    count: 8,
    items: [
      {
        name: '喵喵',
        element: 'grass',
        elements: ['草'],
        url: createSvgPetAvatar('喵喵', '草', 140, '#10b981', '🐱'),
        rarity: 'rare',
      },
      {
        name: '奇丽草',
        element: 'grass',
        elements: ['草'],
        url: createSvgPetAvatar('奇丽草', '草', 155, '#059669', '🌱'),
        rarity: 'common',
      },
      {
        name: '丢丢',
        element: 'grass',
        elements: ['草'],
        url: createSvgPetAvatar('丢丢', '草', 120, '#65a30d', '🍃'),
        rarity: 'common',
      },
      {
        name: '蒲公英',
        element: 'grass',
        elements: ['草'],
        url: createSvgPetAvatar('蒲公英', '草', 80, '#84cc16', '🌼'),
        rarity: 'common',
      },
      {
        name: '呼呼猪',
        element: 'normal',
        elements: ['普通'],
        url: createSvgPetAvatar('呼呼猪', '普', 340, '#ec4899', '🐷'),
        rarity: 'common',
      },
      {
        name: '蹦蹦种子',
        element: 'grass',
        elements: ['草', '毒'],
        url: createSvgPetAvatar('蹦蹦种子', '草', 130, '#16a34a', '🐸'),
        rarity: 'rare',
      },
      {
        name: '小蘑菇',
        element: 'grass',
        elements: ['草'],
        url: createSvgPetAvatar('小蘑菇', '草', 20, '#ea580c', '🍄'),
        rarity: 'common',
      },
      {
        name: '草娃娃',
        element: 'grass',
        elements: ['草'],
        url: createSvgPetAvatar('草娃娃', '草', 100, '#4ade80', '🌾'),
        rarity: 'rare',
      },
    ],
  },
  map2: {
    count: 8,
    items: [
      {
        name: '罗达球',
        element: 'stone',
        elements: ['地'],
        url: createSvgPetAvatar('罗达球', '石', 35, '#d97706', '🗿'),
        rarity: 'common',
      },
      {
        name: '蜗石贝',
        element: 'stone',
        elements: ['地'],
        url: createSvgPetAvatar('蜗石贝', '石', 45, '#b45309', '🐚'),
        rarity: 'common',
      },
      {
        name: '板板壳',
        element: 'stone',
        elements: ['水'],
        url: createSvgPetAvatar('板板壳', '石', 25, '#ca8a04', '🐢'),
        rarity: 'rare',
      },
      {
        name: '护主犬',
        element: 'fire',
        elements: ['火'],
        url: createSvgPetAvatar('护主犬', '火', 15, '#ef4444', '🐕'),
        rarity: 'rare',
      },
      {
        name: '音速犬',
        element: 'fire',
        elements: ['火'],
        url: createSvgPetAvatar('音速犬', '火', 10, '#dc2626', '🐺'),
        rarity: 'epic',
      },
      {
        name: '岩铠领主',
        element: 'stone',
        elements: ['地'],
        url: createSvgPetAvatar('岩铠领主', '石', 30, '#78350f', '🪨'),
        rarity: 'epic',
      },
      {
        name: '阿米亚特',
        element: 'stone',
        elements: ['地'],
        url: createSvgPetAvatar('阿米亚特', '石', 40, '#a16207', '🛡️'),
        rarity: 'rare',
      },
      {
        name: '独角兽',
        element: 'light',
        elements: ['光'],
        url: createSvgPetAvatar('独角兽', '光', 280, '#8b5cf6', '🦄'),
        rarity: 'legendary',
      },
    ],
  },
  map3: {
    count: 8,
    items: [
      {
        name: '水蓝蓝',
        element: 'water',
        elements: ['水'],
        url: createSvgPetAvatar('水蓝蓝', '水', 200, '#0284c7', '💧'),
        rarity: 'rare',
      },
      {
        name: '火花',
        element: 'fire',
        elements: ['火'],
        url: createSvgPetAvatar('火花', '火', 12, '#ea580c', '🔥'),
        rarity: 'rare',
      },
      {
        name: '咔咔雀',
        element: 'normal',
        elements: ['普通'],
        url: createSvgPetAvatar('咔咔雀', '普', 45, '#f59e0b', '🐤'),
        rarity: 'common',
      },
      {
        name: '逍遥水母',
        element: 'water',
        elements: ['水'],
        url: createSvgPetAvatar('逍遥水母', '水', 190, '#06b6d4', '🪼'),
        rarity: 'rare',
      },
      {
        name: '电极球',
        element: 'electric',
        elements: ['电'],
        url: createSvgPetAvatar('电极球', '电', 50, '#eab308', '⚡'),
        rarity: 'common',
      },
      {
        name: '迪莫',
        element: 'light',
        elements: ['光'],
        url: createSvgPetAvatar('迪莫', '光', 210, '#38bdf8', '⭐'),
        rarity: 'legendary',
      },
      {
        name: '闪电鸟',
        element: 'electric',
        elements: ['电'],
        url: createSvgPetAvatar('闪电鸟', '电', 55, '#facc15', '🦅'),
        rarity: 'epic',
      },
      {
        name: '幽灵胆小鬼',
        element: 'ghost',
        elements: ['幽'],
        url: createSvgPetAvatar('幽灵胆小鬼', '幽', 270, '#7c3aed', '👻'),
        rarity: 'rare',
      },
    ],
  },
};

// Preset sample images for immediate test recognition without needing local files
export const SAMPLE_TEST_PRESETS = [
  {
    title: '喵喵',
    mapNum: 1,
    filename: '喵喵',
    previewUrl: createSvgPetAvatar('喵喵', '草', 140, '#10b981', '🐱'),
    score: 0.985,
  },
  {
    title: '奇丽草',
    mapNum: 1,
    filename: '奇丽草',
    previewUrl: createSvgPetAvatar('奇丽草', '草', 155, '#059669', '🌱'),
    score: 0.942,
  },
  {
    title: '音速犬',
    mapNum: 2,
    filename: '音速犬',
    previewUrl: createSvgPetAvatar('音速犬', '火', 10, '#dc2626', '🐺'),
    score: 0.968,
  },
  {
    title: '迪莫',
    mapNum: 3,
    filename: '迪莫',
    previewUrl: createSvgPetAvatar('迪莫', '光', 210, '#38bdf8', '⭐'),
    score: 0.991,
  },
];
