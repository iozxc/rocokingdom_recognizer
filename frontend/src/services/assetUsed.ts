/**
 * 「识别时真正加载成功过」的资源标记。
 *
 * 为什么不查浏览器缓存：Chrome 不暴露某 URL 是否命中 HTTP 缓存（HEAD 走 CDN 命中
 * 时 transferSize 同样 >0），wasm / colors.bin 又由 ORT 和 fetch 内部加载，界面无法感知。
 * 所以统一用「识别链路真的成功加载过」作为已缓存的事实依据；清缓存时一并清掉。
 */
const KEY = 'roco_assets_used_v1';

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set<string>(); }
}

/** 记录某资源已被识别链路成功加载（path 传不带 ?v= 的站点相对路径）。 */
export function markAssetUsed(path: string): void {
  try {
    const set = read(); set.add(path.split('?')[0]);
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

export function isAssetUsed(path: string): boolean {
  return read().has(path.split('?')[0]);
}

export function clearAssetsUsed(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
