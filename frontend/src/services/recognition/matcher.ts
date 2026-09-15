/**
 * 特征匹配 —— 1:1 复刻后端 core/vision/recognizer.py::_rank_features
 * 与 core/api/predict.py 的「全库匹配 -> 当前地图白名单过滤 -> 取 topK」。
 *
 * 关键：query 已 L2 归一化，特征【库】向量未归一化，相似度 = 库行 · query（直接点积，
 * 不能再对库归一化，否则分数尺度与后端不一致）。
 *
 * M1 增强（与后端结果一致的前提下补足可用性）：
 *  1) 主路径与后端一致：先取放宽的候选池 pool_k，再按白名单收窄；
 *  2) 池内白名单不足 topK 时，用「白名单内全局名次」补齐候选，避免只给 0~1 个候选；
 *  3) 额外回传「不属于当前地图、但确实高分命中」的候选（outOfMap），
 *     让用户看到「识别到了谁，只是不在本图」而不是一句"未找到匹配"。
 */
import { featureStore, FeatureEntry } from './featureStore';
import { splitPetFilename } from './petPath';
import { formatPetName } from '../../utils/petHelper';

export interface MatchCandidate {
  filename: string;   // 展示用数据集文件名（非 _shot 本体名）
  match_path: string;
  score: number;      // round(4)
}

/** 当前地图白名单：id->形态序号集合（null 表示该 id 不分形态），外加展示名集合兜底。 */
export interface MapWhitelist {
  id2seqs: Map<number, Set<number | null>>;
  names: Set<string>;
}

export interface MatchOutcome {
  /** 白名单内候选（主结果），最多 topK 个。 */
  candidates: MatchCandidate[];
  /** 白名单外但过阈值的全局高分候选（最多 5 个，仅供提示"不在当前地图"）。 */
  outOfMap: MatchCandidate[];
  /** 全局最高分候选（含是否在当前地图内），用于诊断与提示文案。 */
  bestGlobal: { candidate: MatchCandidate; inMap: boolean } | null;
  libraryCount: number;
  whitelistCount: number;
}

export function buildWhitelist(pets: { id?: number | null; seq?: number | null; name?: string }[]): MapWhitelist {
  const id2seqs = new Map<number, Set<number | null>>();
  const names = new Set<string>();
  for (const p of pets || []) {
    if (p.id != null) {
      const seq = p.seq == null ? null : Number(p.seq);
      if (!id2seqs.has(Number(p.id))) id2seqs.set(Number(p.id), new Set());
      id2seqs.get(Number(p.id))!.add(seq);
    }
    if (p.name) names.add(formatPetName(p.name).toLowerCase());
  }
  return { id2seqs, names };
}

export function whitelistSize(wl: MapWhitelist): number {
  let n = 0;
  wl.id2seqs.forEach((seqs) => {
    n += Math.max(1, seqs.size);
  });
  return n + wl.names.size;
}

export function isEntryInWhitelist(e: FeatureEntry, wl: MapWhitelist): boolean {
  if (e.id != null) {
    const seqs = wl.id2seqs.get(e.id);
    if (seqs && (seqs.has(null) || seqs.has(e.seq))) return true;
  }
  // 名字兜底（_shot 的 name 带后缀，比较时去掉）
  const base = e.name.replace(/_shot$/i, '').toLowerCase();
  return wl.names.has(base);
}

interface Merged {
  score: number;
  path: string;
  name: string;
  shot: boolean;
  key: string;
  entry: FeatureEntry;
}

/** 与后端一致的 (id,seq) 去重键；拿不到 id 时退回文件路径当键。 */
function mergeKeyOf(e: FeatureEntry): string {
  const info = splitPetFilename(e.path);
  return info && info.id != null ? `${info.id}_${info.seq == null ? 'x' : info.seq}` : e.path;
}

/** 把某个特征库条目并入 merged 表（_shot 与本体同键合并，取最高分，本体优先展示）。 */
function mergeInto(merged: Map<string, Merged>, e: FeatureEntry, score: number): void {
  const key = mergeKeyOf(e);
  const rounded = Math.round(score * 10000) / 10000;
  const isShot = e.shot || /_shot\.png$/i.test(e.path);
  const exist = merged.get(key);
  if (!exist) {
    merged.set(key, { score: rounded, path: e.path, name: e.name, shot: isShot, key, entry: e });
    return;
  }
  exist.entry = e;
  if (rounded > exist.score) {
    exist.score = rounded;
    if (!isShot) {
      // 非 _shot 本体作为展示名（更干净）
      exist.path = e.path;
      exist.name = e.name;
      exist.shot = false;
    }
  }
}

/** merged -> 展示候选：_shot 命中时展示名回落到本体文件名。 */
function toCandidate(m: Merged): MatchCandidate {
  let filename = m.path;
  let matchPath = m.path;
  if (m.shot && /_shot\.png$/i.test(filename)) {
    filename = filename.replace('_shot.png', '.png');
    matchPath = matchPath.replace('_shot', '');
  }
  return { filename, match_path: matchPath, score: m.score };
}

/**
 * 全库点积 → 候选池 → 白名单 → 补齐 → out-of-map。
 * @param query L2 归一化后的 query 特征（384 维）
 */
export function matchFeaturesEx(
    query: Float32Array,
    whitelist: MapWhitelist,
    threshold: number,
    topK: number
): MatchOutcome {
  const store = featureStore;
  if (!store.meta || !store.matrix) throw new Error('特征库未加载');
  const { dim, entries } = store.meta;
  const mat = store.matrix;
  const n = entries.length;

  // 1) 全库点积（库行未归一化，直接点积即后端相似度）
  const sims = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * dim;
    for (let d = 0; d < dim; d++) s += mat[base + d] * query[d];
    sims[i] = s;
  }

  // 2) 候选池 pool_k = min(max(topK*4,24), n)，按分降序（N≈6.3k，全排序开销可忽略）
  const poolK = Math.min(Math.max(topK * 4, 24), n);
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => sims[b] - sims[a]);
  const pool = order.slice(0, poolK);

  // 3) 候选池内合并去重
  const poolMerged = new Map<string, Merged>();
  for (const idx of pool) {
    if (sims[idx] < threshold) continue;
    mergeInto(poolMerged, entries[idx], sims[idx]);
  }

  // 4) 白名单过滤（与后端顺序一致：先放宽池、再收窄）
  const inMap: Merged[] = [];
  const outOfMap: Merged[] = [];
  poolMerged.forEach((m) => {
    (isEntryInWhitelist(m.entry, whitelist) ? inMap : outOfMap).push(m);
  });

  const globalMerged = Array.from(poolMerged.values()).sort((a, b) => b.score - a.score);
  const bestGlobal = globalMerged.length
      ? { candidate: toCandidate(globalMerged[0]), inMap: inMap.includes(globalMerged[0]) }
      : null;

  // 5) 白名单内不足 topK：用白名单内全局名次补齐（保持已选顺序在前）
  const picked: Merged[] = inMap.sort((a, b) => b.score - a.score).slice(0, topK);
  if (picked.length < topK) {
    const pickedKeys = new Set(picked.map((m) => m.key));
    const fill: Merged[] = [];
    for (const idx of order) {
      if (sims[idx] < threshold) break; // order 已降序，后面的分数只会更低
      const e = entries[idx];
      if (!isEntryInWhitelist(e, whitelist)) continue;
      const key = mergeKeyOf(e);
      if (pickedKeys.has(key)) continue;
      const merged = new Map<string, Merged>();
      mergeInto(merged, e, sims[idx]);
      const m = merged.get(key)!;
      pickedKeys.add(key);
      fill.push(m);
      if (picked.length + fill.length >= topK) break;
    }
    picked.push(...fill);
  }

  return {
    candidates: picked.map(toCandidate),
    outOfMap: outOfMap
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(toCandidate),
    bestGlobal,
    libraryCount: n,
    whitelistCount: whitelistSize(whitelist),
  };
}

/** 兼容旧签名：只取当前地图内的候选。 */
export function matchFeatures(
  query: Float32Array,
  whitelist: MapWhitelist,
  threshold: number,
  topK: number
): MatchCandidate[] {
  return matchFeaturesEx(query, whitelist, threshold, topK).candidates;
}
