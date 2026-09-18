/**
 * 试炼配置（纯前端版跟随识别用）—— 从 config.py::TRIALS 抄出识别真正用到的字段。
 *
 * 只保留「关卡判定 + 地图展示」需要的最小集合：
 *  - map_list / maps：关卡 id、序号与展示名
 *  - scene_features：关卡标题的独有字符（OCR 标题命中任一独有字即判定为该关卡）
 *
 * 白名单不在这里：它跟着 assets 走（features.meta.json 每条目的 maps 字段，
 * 由 tools/export_web_recognizer.py 从 datasets/map_pets1.json 生成）。
 */

export interface TrialMapDef {
  id: string;
  num: number;
  name: string;
  /** 地图切换按钮上的短名（与桌面版 ScannerApp 的写法一致） */
  short: string;
  /** 关卡标题的独有字符集合（含 OCR 常见错字，如 索->素） */
  uniqueChars: string[];
}

export interface TrialDef {
  key: string;
  title: string;
  mapList: string[];
  maps: TrialMapDef[];
}

export const TRIALS: TrialDef[] = [
  {
    key: 'grass',
    title: '草系徽章试炼',
    mapList: ['map1', 'map2', 'map3'],
    maps: [
      {
        id: 'map1',
        num: 1,
        name: '记忆中的索米亚草原',
        short: '索米亚',
        // 索、米、亚；OCR 经常把「索」识别成「素」
        uniqueChars: ['索', '米', '亚', '素'],
      },
      {
        id: 'map2',
        num: 2,
        name: '记忆中的巨石阵',
        short: '巨石阵',
        uniqueChars: ['巨', '石', '阵'],
      },
      {
        id: 'map3',
        num: 3,
        name: '记忆中的普拉塔草原',
        short: '普拉塔',
        uniqueChars: ['普', '拉', '塔'],
      },
    ],
  },
];

export function getTrial(trialKey: string): TrialDef | null {
  return TRIALS.find((t) => t.key === trialKey) || null;
}

export function getTrialOrDanger(trialKey: string): TrialDef {
  return getTrial(trialKey) || TRIALS[0];
}

/** 去掉所有空白（复刻 core/infra/capture.py::clean_text） */
function cleanText(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/[\s\u3000]+/g, '');
}

/**
 * 关卡判定：对标题 OCR 文本做独有单字匹配，命中任一独有字即返回 mapN；都不命中返回 null。
 * 复刻 core/infra/capture.py::match_scene_unique_char。
 */
export function matchSceneUniqueChar(ocrRawText: string | null | undefined, trialKey = 'grass'): string | null {
  const txt = cleanText(ocrRawText);
  if (!txt) return null;
  const trial = getTrial(trialKey);
  if (!trial) return null;
  for (const map of trial.maps) {
    for (const c of map.uniqueChars) {
      if (txt.includes(c)) return map.id;
    }
  }
  return null;
}

/** 'map2' -> 2；解析失败返回 fallback。 */
export function mapIdToNum(mapId: string | null, fallback = 1): number {
  const m = /^map(\d+)$/.exec(mapId || '');
  return m ? Number(m[1]) : fallback;
}
