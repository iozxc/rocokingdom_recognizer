/**
 * 雪碧图加载器（纯前端 web 版）。
 *
 * 构建时雪碧图 PNG 被加密为 "RENC" 格式，CSS background-image 无法直接用。
 * 本模块负责：fetch → 解密 → Blob URL → 缓存，供 SpriteIcon 组件使用。
 *
 * 缓存策略：
 *   - 进程内 Map 缓存已解密的 Blob URL，同一张雪碧图只解密一次
 *   - 页面卸载时统一 revoke（避免内存泄漏）
 *   - 未加密的雪碧图（调试/灰度）也走这里，返回原始 URL
 */
import { IS_STATIC } from './staticMode';
import { isEncrypted, decryptData } from './crypto';

const blobUrlCache = new Map<string, string>();
const loadingPromises = new Map<string, Promise<string>>();

/**
 * 获取雪碧图的可用 URL（解密后的 Blob URL，或原始 URL）。
 * 同一 name 并发调用共享同一次 fetch。
 */
export function getSpriteImageUrl(name: string): Promise<string> {
  // 非 web 端不做解密（理论上不会走到这里，防御性处理）
  if (!IS_STATIC) {
    return Promise.resolve(getRawSpriteUrl(name));
  }

  const cached = blobUrlCache.get(name);
  if (cached) return Promise.resolve(cached);

  const pending = loadingPromises.get(name);
  if (pending) return pending;

  const promise = loadAndDecrypt(name)
    .then((url) => {
      blobUrlCache.set(name, url);
      return url;
    })
    .finally(() => {
      loadingPromises.delete(name);
    });

  loadingPromises.set(name, promise);
  return promise;
}

/** 原始雪碧图 URL（不解密，用于非加密回退）。 */
function getRawSpriteUrl(name: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}/icons/${name}`;
}

async function loadAndDecrypt(name: string): Promise<string> {
  const url = getRawSpriteUrl(name);
  try {
    // 先 HEAD 或直接 GET 探测是否加密。
    // fetchImageBlobUrl 内部会自动检测魔数并解密。
    // 但如果文件未加密，我们希望直接用原始 URL（省内存、省一次 Blob 拷贝）。
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    if (isEncrypted(buf)) {
      // 加密：解密后创建 Blob URL
      const plain = decryptData(buf);
      const blob = new Blob([plain], { type: 'image/png' });
      return URL.createObjectURL(blob);
    }
    // 未加密：直接用原始 URL（浏览器缓存友好）
    return url;
  } catch (err) {
    console.warn(`[spriteLoader] 加载雪碧图失败: ${name}`, err);
    // 失败时回退原始 URL，让浏览器自己尝试（可能是缓存或网络瞬断）
    return url;
  }
}

/** 页面卸载时释放所有 Blob URL。 */
function revokeAll(): void {
  for (const url of blobUrlCache.values()) {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
  blobUrlCache.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', revokeAll);
}
