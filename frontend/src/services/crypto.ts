/**
 * 纯前端 Web 版资源加解密核心。
 *
 * 仅用于 IS_STATIC（mode=web）构建产物的静态资源保护：
 *   - JSON 图鉴数据 / 识别资产清单
 *   - ONNX 模型 / features.bin 特征库
 *   - 雪碧图 PNG
 *
 * 加密格式（小端）：
 *   [0:4]   魔数 "RENC"
 *   [4:8]   版本 uint32 = 1
 *   [8:12]  原始长度 uint32
 *   [12:]   加密载荷
 *
 * 算法：XOR 密钥流，密钥流 = key[(i*7+3) % keyLen] ^ (i & 0xFF)
 * XOR 对称，加密解密同一函数。PC 端（mode=production）完全不引用本模块。
 */

const MAGIC = new Uint8Array([0x52, 0x45, 0x4e, 0x43]); // "RENC"
const VERSION = 1;
const HEADER_LEN = 12;

// 主密钥：构建脚本（Python）与前端（JS）必须保持完全一致。
const MASTER_KEY = 'RocoKingdom_WebGuard_v1_2026';

let keyBytes: Uint8Array | null = null;

function getKey(): Uint8Array {
  if (!keyBytes) {
    keyBytes = new TextEncoder().encode(MASTER_KEY);
  }
  return keyBytes;
}

/** 对明文/密文载荷做 XOR（in-place，返回同一 ArrayBuffer 视图）。 */
function xorPayload(buf: Uint8Array, offset: number): void {
  const key = getKey();
  const klen = key.length;
  for (let i = 0; i < buf.length; i++) {
    const pos = offset + i;
    const kb = key[((pos * 7 + 3) % klen + klen) % klen] ^ (pos & 0xff);
    buf[i] ^= kb;
  }
}

/** 判断一段二进制是否是加密格式（检查魔数）。 */
export function isEncrypted(buf: ArrayBuffer | Uint8Array): boolean {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (view.length < HEADER_LEN) return false;
  for (let i = 0; i < 4; i++) {
    if (view[i] !== MAGIC[i]) return false;
  }
  return true;
}

/**
 * 加密一段明文，返回带头部的密文 ArrayBuffer。
 */
export function encryptData(plain: ArrayBuffer | Uint8Array): ArrayBuffer {
  const src = plain instanceof Uint8Array ? plain : new Uint8Array(plain);
  const out = new ArrayBuffer(HEADER_LEN + src.length);
  const view = new Uint8Array(out);
  // 头部
  view.set(MAGIC, 0);
  const dv = new DataView(out);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, src.length, true);
  // 载荷（拷贝后 in-place XOR）
  view.set(src, HEADER_LEN);
  const payload = view.subarray(HEADER_LEN);
  xorPayload(payload, 0);
  return out;
}

/**
 * 解密一段密文。如果不是加密格式（魔数不符），原样返回（兼容未加密资源）。
 * 返回解密后的 ArrayBuffer（新分配，不修改输入）。
 */
export function decryptData(encrypted: ArrayBuffer | Uint8Array): ArrayBuffer {
  const src = encrypted instanceof Uint8Array ? encrypted : new Uint8Array(encrypted);
  if (!isEncrypted(src)) {
    // 未加密：拷贝一份返回，保持"返回新 buffer"的语义
    return src.slice().buffer;
  }
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const version = dv.getUint32(4, true);
  const origLen = dv.getUint32(8, true);
  if (version !== VERSION) {
    throw new Error(`不支持的加密版本: ${version}`);
  }
  const payloadLen = src.length - HEADER_LEN;
  if (payloadLen < origLen) {
    throw new Error(`加密数据损坏: 期望载荷>=${origLen}, 实际${payloadLen}`);
  }
  // 拷贝载荷并 in-place XOR
  const out = new Uint8Array(origLen);
  out.set(src.subarray(HEADER_LEN, HEADER_LEN + origLen));
  xorPayload(out, 0);
  return out.buffer;
}

/** 解密为文本（JSON 等）。 */
export function decryptToText(encrypted: ArrayBuffer | Uint8Array): string {
  const buf = decryptData(encrypted);
  return new TextDecoder().decode(buf);
}

/** 解密为 JSON 对象。 */
export function decryptToJson<T = unknown>(encrypted: ArrayBuffer | Uint8Array): T {
  return JSON.parse(decryptToText(encrypted)) as T;
}
