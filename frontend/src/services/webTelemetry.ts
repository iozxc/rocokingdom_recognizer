import { IS_STATIC, PLATFORM } from './staticMode';
import { APP_VERSION } from '../version';
import { getWebDeviceCode } from './webDevice';


const AUTH_SERVER: string =
    ((import.meta.env.VITE_ROCO_AUTH_SERVER as string | undefined) ?? '')
        .replace(/\/+$/, '') ||
    'https://api.omisheep.cn';
const EVENT_PATH = '/api/auth/status';
const HEARTBEAT_MS = 180_000; // 与桌面端 _HEARTBEAT_INTERVAL 一致：约 3 分钟

let started = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let closed = false;

async function report(event: 'open' | 'heartbeat' | 'close'): Promise<boolean> {
  if (!IS_STATIC || !AUTH_SERVER) return;
  const payload = {
    machine_code: getWebDeviceCode(),
    timestamp: String(Math.floor(Date.now() / 1000)),
    version: APP_VERSION,
    event,
    platform: PLATFORM, // 'web'
  };
  try {
    const resp = await fetch(`${AUTH_SERVER}${EVENT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function reportOpenWithRetry(attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await report('open')) return;
    await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
  }
}

/** 页面关闭/卸载时上报 close，立即结束在线会话（避免依赖 10 分钟空闲超时）。 */
function reportClose(): void {
  if (closed) return;
  closed = true;
  stopWebTelemetry();
  if (!IS_STATIC || !AUTH_SERVER) return;
  const payload = {
    machine_code: getWebDeviceCode(),
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
  const startHeartbeat = () => {
    if (heartbeatTimer != null) return;
    heartbeatTimer = setInterval(() => {
      // 后台标签页不发心跳（切回来时再补一次 open）
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void report('heartbeat');
    }, HEARTBEAT_MS);
  };
  const stopHeartbeat = () => {
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  void reportOpenWithRetry();
  startHeartbeat();

  // 页面真正关闭/卸载时上报 close（pagehide 在关闭/跳转时可靠触发）
  window.addEventListener('pagehide', reportClose);
  window.addEventListener('beforeunload', reportClose);

  /**
   * 切到后台/最小化/锁屏时**立即上报 close**，切回来再报 open。
   *
   * 之前只在页面卸载时上报 close：用户把标签页开着一整天不关，心跳就一直发，
   * 统计里就成了"整天在线"。实际上人根本没在用，所以按可见性来算更准。
   */
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopHeartbeat();
        if (!closed) void report('close');
      } else if (!closed) {
        void reportOpenWithRetry();
        startHeartbeat();
      }
    });
  }
}

/** 停止心跳（便于测试/卸载时清理）。 */
export function stopWebTelemetry(): void {
  if (heartbeatTimer != null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
