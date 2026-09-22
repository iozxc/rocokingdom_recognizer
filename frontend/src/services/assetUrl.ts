import { IS_STATIC } from './staticMode';
import { APP_VERSION } from '../version';

/**
 * Web 端静态数据 URL（自动带缓存版本参数）。
 *
 * 为什么需要：`/data/*.json`（图鉴、术语表、雪碧图坐标等）内容会变但文件名不变，
 * 不加版本参数就不敢让 CDN / 浏览器长期缓存它们，只能每次重新请求。
 * 加上 `?v=<前端版本>` 之后，改前端版本号即等于换 URL，缓存可以放心设长。
 *
 * 桌面端（IS_STATIC=false）原样返回：那些 JSON 由本机 Flask 提供，
 * 加参数没有任何收益，也不该让 PC 端行为跟着变。
 */
export function dataUrl(relPath: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const url = `${base}${relPath.replace(/^\/+/, '')}`;
  return IS_STATIC ? `${url}?v=${encodeURIComponent(APP_VERSION)}` : url;
}

/** 给任意 URL 追加版本参数（已带查询串时用 & 连接）。 */
export function withVersionParam(url: string, version: string | number): string {
  const v = encodeURIComponent(String(version));
  return `${url}${url.includes('?') ? '&' : '?'}v=${v}`;
}
