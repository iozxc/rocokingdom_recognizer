import { IS_STATIC } from './staticMode';

// 统一 web 设备码的 key（沿用旧 webTelemetry 的 key，避免换 key 后旧用户被当成新设备）
const WEB_CODE_KEY = 'roco_web_machine_code_v1';
// 兼容旧的 atlas 设备 hash key，作为迁移来源
const ATLAS_LEGACY_KEY = 'roco_atlas_device_hash_v1';

let cached: string | null = null;

/**
 * Web 端唯一、稳定的设备码。
 *
 * 浏览器没有可靠的硬件/系统级设备标识，因此用【随机 UUID 持久化到 localStorage】作为
 * 设备码：同一浏览器（同一存储）永远是同一个设备码，与 IP / 代理 / 会话无关。
 *
 * - 优先认领旧 key（roco_web_machine_code_v1），其次迁移旧的 atlas hash，最后才生成新 UUID；
 * - 桌面端（非 IS_STATIC）不在此生成，由后端真实机器码 machine_code 决定。
 */
export function getWebDeviceCode(): string {
  if (cached != null) return cached;
  if (!IS_STATIC) {
    cached = '';
    return cached;
  }
  try {
    let code = localStorage.getItem(WEB_CODE_KEY);
    if (!code) {
      code = localStorage.getItem(ATLAS_LEGACY_KEY) ?? '';
    }
    if (!code) {
      code = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    localStorage.setItem(WEB_CODE_KEY, code);
    cached = code;
    return code;
  } catch {
    cached = cached ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return cached;
  }
}
