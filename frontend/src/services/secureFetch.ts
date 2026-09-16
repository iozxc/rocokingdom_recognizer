/**
 * 安全资源加载器：自动识别并解密加密的静态资源。
 *
 * 仅 web 端（IS_STATIC）使用。构建脚本会把指定资源加密为 "RENC" 格式，
 * 本模块在 fetch 后自动检测魔数并解密，对上层调用透明。
 *
 * 未加密的资源（魔数不符）会原样返回，便于调试和灰度。
 */
import axios from 'axios';
import { decryptData, decryptToJson, isEncrypted } from './crypto';

/**
 * 以 ArrayBuffer 形式获取资源，自动解密。
 * @param url 资源 URL
 * @param timeout 超时毫秒
 */
export async function fetchArrayBuffer(url: string, timeout = 30000): Promise<ArrayBuffer> {
  const resp = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout,
  });
  const buf = resp.data;
  if (isEncrypted(buf)) {
    return decryptData(buf);
  }
  return buf;
}

/**
 * 获取 JSON 资源，自动解密。
 * 加密的 JSON 在构建时被序列化为二进制密文，这里解密后 JSON.parse。
 * @param url 资源 URL
 * @param timeout 超时毫秒
 */
export async function fetchJson<T = unknown>(url: string, timeout = 20000): Promise<T> {
  const buf = await fetchArrayBuffer(url, timeout);
  // 解密后是原始 JSON 文本的字节
  const text = new TextDecoder().decode(buf);
  return JSON.parse(text) as T;
}

/**
 * 获取文本资源，自动解密。
 */
export async function fetchText(url: string, timeout = 20000): Promise<string> {
  const buf = await fetchArrayBuffer(url, timeout);
  return new TextDecoder().decode(buf);
}

/**
 * 以 Blob URL 形式获取图片（解密后创建 object URL）。
 * 调用方负责在适当时机 revokeObjectURL。
 * @param url 图片 URL
 * @param mimeType MIME 类型，默认 image/png
 */
export async function fetchImageBlobUrl(
  url: string,
  mimeType = 'image/png',
  timeout = 30000,
): Promise<string> {
  const buf = await fetchArrayBuffer(url, timeout);
  const blob = new Blob([buf], { type: mimeType });
  return URL.createObjectURL(blob);
}

// 重新导出，方便上层直接用
export { decryptData, decryptToJson, isEncrypted };
