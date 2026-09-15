/**
 * OCR 文本相似度（M3）—— 1:1 复刻 Python difflib.SequenceMatcher.ratio()
 * 与 core/infra/utils.py::get_top_k_matches / fuse_ocr_feat 的加权规则。
 *
 * ratio() = 2 * M / T：M 为匹配块总长度，T = len(a) + len(b)。
 * Python 默认 autojunk 只对长度 ≥ 200 的序列生效，精灵名远小于该阈值，
 * 因此这里实现「无 junk」的标准版即可与后端逐位对齐。
 */

/** 单个字符序列的最长匹配块（与 difflib.find_longest_match 同构）。 */
function findLongestMatch(
    a: string,
    b: string,
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
    b2j: Map<string, number[]>
): { besti: number; bestj: number; bestsize: number } {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    const js = b2j.get(a[i]) || [];
    for (const j of js) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) || 0) + 1;
      newj2len.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = newj2len;
  }
  // 向两侧扩展（无 junk 时 simply 逐字符比较即可，与 difflib 行为一致）
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti--;
    bestj--;
    bestsize++;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
    bestsize++;
  }
  return { besti, bestj, bestsize };
}

function getMatchingBlocks(a: string, b: string): { size: number; total: number } {
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j];
    const arr = b2j.get(ch);
    if (arr) arr.push(j);
    else b2j.set(ch, [j]);
  }

  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  let totalMatched = 0;
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const m = findLongestMatch(a, b, alo, ahi, blo, bhi, b2j);
    if (m.bestsize > 0) {
      totalMatched += m.bestsize;
      if (alo < m.besti && blo < m.bestj) queue.push([alo, m.besti, blo, m.bestj]);
      if (m.besti + m.bestsize < ahi && m.bestj + m.bestsize < bhi) {
        queue.push([m.besti + m.bestsize, ahi, m.bestj + m.bestsize, bhi]);
      }
    }
  }
  return { size: totalMatched, total: a.length + b.length };
}

/** 等价于 difflib.SequenceMatcher(None, a, b).ratio()。 */
export function sequenceRatio(a: string, b: string): number {
  const sa = a ?? '';
  const sb = b ?? '';
  const total = sa.length + sb.length;
  if (total === 0) return 1;
  const { size } = getMatchingBlocks(sa, sb);
  return (2 * size) / total;
}

export interface OcrTextMatch {
  name: string;
  score: number;
  seq_tag: boolean;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * 复刻 core/infra/utils.py::get_top_k_matches。
 * 只比「基名」（去掉 _形态后缀）：基名匹配成功时无后缀记 100%、有后缀记 98% 并打 seq_tag。
 */
export function getTopKMatches(userName: string, candidates: string[], k: number): OcrTextMatch[] {
  const user = (userName || '').trim();
  const scored: OcrTextMatch[] = [];
  for (const candidate of candidates || []) {
    const full = String(candidate);
    const base = full.split('_')[0].trim();
    const raw = sequenceRatio(user, base);
    const hasSuffix = full !== base;
    const ok = raw >= 0.75;
    const score = hasSuffix && ok ? 0.98 : ok ? 1.0 : raw;
    scored.push({ name: full, score: round4(score), seq_tag: hasSuffix && ok });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, Math.max(0, k));
}

/**
 * 复刻 core/infra/utils.py::fuse_ocr_feat：
 * OCR 候选的基名若同时被图像（特征）命中，且该 OCR 项带 seq_tag（多形态），
 * 则用 score + (1-score)*featureScore 加权提升。
 */
export function fuseOcrFeat<T extends { name?: string; score: number; seq_tag?: boolean }>(
    ocrResults: T[],
    featResults: { name?: string; score: number }[]
): T[] {
  const baseScore = new Map<string, number>();
  for (const f of featResults || []) {
    const b = String(f?.name || '').split('_')[0].trim();
    const s = Number(f?.score || 0);
    if (b && (!baseScore.has(b) || s > (baseScore.get(b) as number))) baseScore.set(b, s);
  }
  return (ocrResults || []).map((item) => {
    const b = String(item?.name || '').split('_')[0].trim();
    const fs = baseScore.get(b) || 0;
    if (fs > 0 && item.seq_tag) {
      return { ...item, score: round4(item.score + (1 - item.score) * fs) };
    }
    return { ...item };
  });
}
