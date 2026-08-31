import { IS_STATIC, PLATFORM } from './staticMode';
import { APP_VERSION } from '../version';

/**
 * Web 端“打开 / 心跳”上报（仅统计流量，不做授权、存储、反馈）。
 *
 * 说明：
 * - 网页没有 App 内置的本地服务器，因此直接 POST 到【远端鉴权/统计服务器】的
 *   /api/auth/status 接口上报 open / heartbeat 事件。
 * - 由于签名密钥不能公开（桌面端刻意不写进源码），Web 端【不带 sign】；你需要让
 *   远端服务器对 platform=web 的事件放开签名校验，并允许跨域(CORS)，且必须是 HTTPS
 *   域名（网页为 https，不能请求明文 http，否则会被浏览器拦截为混合内容）。
 * - 默认打【同源】/api/auth/status（Vercel 的 serverless 代理转发到远端统计服务器）；
 *   也可用 Vercel 环境变量 VITE_ROCO_AUTH_SERVER 指定独立的 HTTPS 统计域名。
 * - machine_code 用浏览器本地持久化 ID 代替桌面端硬盘序列号，用于统计“web 设备/会话”。
 */

// 优先用 VITE_ROCO_AUTH_SERVER（如需指定其它 HTTPS 统计域名）；
// 否则默认直连 https://api.omisheep.cn（已是 HTTPS，浏览器可直接请求，无需 Vercel 代理）。
const AUTH_SERVER: string =
    ((import.meta.env.VITE_ROCO_AUTH_SERVER as string | undefined) ?? '')
        .replace(/\/+$/, '') ||
    'https://api.omisheep.cn';
const EVENT_PATH = '/api/auth/status';
const HEARTBEAT_MS = 180_000; // 与桌面端 _HEARTBEAT_INTERVAL 一致：约 3 分钟
const MACHINE_CODE_KEY = 'roco_web_machine_code_v1';

let started = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let closed = false;

function getMachineCode(): string {
  try {
    let code = localStorage.getItem(MACHINE_CODE_KEY);
    if (code) return code;
    code = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(MACHINE_CODE_KEY, code);
    return code;
  } catch {
    return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

async function report(event: 'open' | 'heartbeat'): Promise<void> {
  if (!IS_STATIC || !AUTH_SERVER) return;
  const payload = {
    machine_code: getMachineCode(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    version: APP_VERSION,
    event,
    platform: PLATFORM, // 'web'
  };
  try {
    // fire-and-forget；仅统计，失败静默忽略
    await fetch(`${AUTH_SERVER}${EVENT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
    });
  } catch {
    // 网络/跨域失败忽略
  }
}

/** 页面关闭/卸载时上报 close，立即结束在线会话（避免依赖 10 分钟空闲超时）。 */
function reportClose(): void {
  if (closed) return;
  closed = true;
  stopWebTelemetry();
  if (!IS_STATIC || !AUTH_SERVER) return;
  const payload = {
    machine_code: getMachineCode(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    version: APP_VERSION,
    event: 'close',
    platform: PLATFORM,
  };
  const body = JSON.stringify(payload);
  try {
    // 统一用 fetch keepalive：能正确触发并处理跨域预检，且可存活于页面卸载
    void fetch(`${AUTH_SERVER}${EVENT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      mode: 'cors',
      credentials: 'omit',
    });
  } catch {
    // 忽略
  }
}

/** 页面加载后调用一次：上报 open 并启动心跳。 */
export function startWebTelemetry(): void {
  if (!IS_STATIC || started) return;
  started = true;
  if (!AUTH_SERVER) {
    console.warn('[webTelemetry] 缺少上报地址（同源与 VITE_ROCO_AUTH_SERVER 均为空），跳过');
    return;
  }
  void report('open');
  heartbeatTimer = setInterval(() => void report('heartbeat'), HEARTBEAT_MS);
  // 页面真正关闭/卸载时上报 close（pagehide 在关闭/跳转时可靠触发）
  window.addEventListener('pagehide', reportClose);
  window.addEventListener('beforeunload', reportClose);
}

/** 停止心跳（便于测试/卸载时清理）。 */
export function stopWebTelemetry(): void {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
