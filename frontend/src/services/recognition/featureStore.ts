/**
 * 特征库加载（纯前端）。
 *
 * features.meta.json：维度/条数/是否归一化 + 每行 {path,id,seq,name,shot,maps}
 * features.bin     ：count×dim 的 float32 行主序矩阵（库向量【未】L2 归一化，与后端一致）
 *
 * M2：改走 assetStore —— 按清单版本缓存进 IndexedDB，版本不变则二次进入零下载。
 * 内存里保持单例，识别期间不重复解析。
 */
import { loadAsset } from './assetStore';
import { fetchJson } from '../secureFetch';
import { withVersionParam } from '../assetUrl';

export interface FeatureEntry {
  path: string;
  id: number | null;
  seq: number | null;
  name: string;
  shot: boolean;
  /** 该 (id,seq) 出现在哪些地图（草系 t1 的 1/2/3），用于 OCR 候选按图收窄。 */
  maps?: number[];
}

export interface FeatureMeta {
  version: number;
  dim: number;
  count: number;
  dtype: string;
  dbNormalized: boolean;
  queryNormalized: boolean;
  entries: FeatureEntry[];
}

class FeatureStoreClass {
  meta: FeatureMeta | null = null;
  matrix: Float32Array | null = null;
  /** 已加载的资产版本，用于判断是否需要重载。 */
  loadedVersion: number | null = null;
  private loading: Promise<void> | null = null;
  private loadingVersion: number | null = null;

  get ready(): boolean {
    return !!(this.meta && this.matrix);
  }

  async ensureLoaded(version: number, onProgress?: (pct: number) => void): Promise<void> {
    if (this.ready && this.loadedVersion === version) return;
    if (this.loading && this.loadingVersion === version) return this.loading;
    this.loadingVersion = version;
    this.loading = this._load(version, onProgress);
    try {
      await this.loading;
    } finally {
      this.loading = null;
      this.loadingVersion = null;
    }
  }

  private async _load(version: number, onProgress?: (pct: number) => void): Promise<void> {
    const base = import.meta.env.BASE_URL || '/';
    // 带清单版本：/data/ 就可以长期缓存，改资产即换 URL
    const meta = await fetchJson<FeatureMeta>(withVersionParam(`${base}data/features.meta.json`, version), 20000);
    if (!meta || !Array.isArray(meta.entries) || meta.dim <= 0) {
      throw new Error('特征库 meta 格式异常');
    }

    // 二进制矩阵：走版本化缓存（首次下载，之后命中 IndexedDB 瞬间完成）
    const buf = await loadAsset('data/features.bin', version, (p) => {
      if (onProgress) onProgress(p.total ? Math.min(99, Math.round((p.loaded / p.total) * 100)) : 0);
    });

    const expect = meta.count * meta.dim * 4;
    if (buf.byteLength !== expect) {
      throw new Error(`特征库字节数不符：期望 ${expect}，实际 ${buf.byteLength}`);
    }
    this.matrix = new Float32Array(buf);
    this.meta = meta;
    this.loadedVersion = version;
    onProgress?.(100);
  }
}

export const featureStore = new FeatureStoreClass();
