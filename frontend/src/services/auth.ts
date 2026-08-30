import { useSyncExternalStore } from 'react';
import axios from 'axios';
import { AuthState } from '../types';

const initialState: AuthState = {
  status: 'pending',
  machine_code: '',
  auth_code: '',
  expire_time: '',
  qq_id: '',
  msg: '',
  error: '',
  is_authorized: false,
  offline_badge: false,
};

export function defaultAuthState(): AuthState {
  return { ...initialState };
}

const FAST_POLL_MS = 1000;
const SLOW_POLL_MS = 5000;
const OFFLINE_POLL_MS = 10000;
const WAIT_TIMEOUT_MS = 2 * 60 * 1000;

function resolveApiBase(): string {
  if (import.meta.env.DEV) {
    return 'http://127.0.0.1:5000';
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://127.0.0.1:5000';
}

async function fetchAuthStatus(): Promise<AuthState> {
  try {
    const res = await axios.get<{ data?: AuthState }>(
        `${resolveApiBase()}/api/local/auth_status`,
        { timeout: 4000 }
    );
    if (res.data?.data) {
      return res.data.data;
    }
  } catch {
    // 后端离线时静默忽略
  }
  return defaultAuthState();
}

async function retryAuth(): Promise<AuthState> {
  try {
    const res = await axios.post<{ data?: AuthState }>(
        `${resolveApiBase()}/api/local/auth_retry`,
        {},
        { timeout: 4000 }
    );
    if (res.data?.data) {
      return res.data.data;
    }
  } catch {
    // 忽略
  }
  return defaultAuthState();
}

async function reauthorizeAuth(): Promise<AuthState> {
  try {
    const res = await axios.post<{ data?: AuthState }>(
        `${resolveApiBase()}/api/local/auth_reauthorize`,
        {},
        { timeout: 4000 }
    );
    if (res.data?.data) {
      return res.data.data;
    }
  } catch {
    // 忽略
  }
  return defaultAuthState();
}

async function refreshCodeAuth(): Promise<AuthState> {
  try {
    const res = await axios.post<{ data?: AuthState }>(
        `${resolveApiBase()}/api/local/auth_refresh`,
        {},
        { timeout: 6000 }
    );
    if (res.data?.data) {
      return res.data.data;
    }
  } catch {
    // 忽略
  }
  return defaultAuthState();
}

async function unbindAuth(): Promise<AuthState> {
  try {
    const res = await axios.post<{ data?: AuthState }>(
        `${resolveApiBase()}/api/local/auth_unbind`,
        {},
        { timeout: 6000 }
    );
    if (res.data?.data) {
      return res.data.data;
    }
  } catch {
    // 忽略
  }
  return defaultAuthState();
}

async function setPollMode(mode: 'fast' | 'slow'): Promise<void> {
  try {
    await axios.post(
        `${resolveApiBase()}/api/local/auth_poll_mode`,
        { mode },
        { timeout: 4000 }
    );
  } catch {
    // 忽略
  }
}

type Listener = () => void;

/**
 * 设备授权状态 store。
 * 打开时拉取一次；随后按弹窗开关低频轮询（打开=1s，关闭=5s），
 * 达到终态或 2 分钟未授权则停止轮询，驱动 AuthGate 弹窗与“已授权/未授权”角标。
 */
class AuthStore {
  private state: AuthState = { ...initialState };
  private listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private engageMode: 'fast' | 'slow' = 'slow';
  private startAt = Date.now();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): AuthState => this.state;

  private setState(patch: Partial<AuthState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private refresh = async () => {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
      const next = await fetchAuthStatus();
      if (JSON.stringify(next) !== JSON.stringify(this.state)) {
        this.setState(next);
      }
      // 授权服务器故障/断网（offline 宽限）：继续每 10s 轮询，服务器/网络恢复后自动回正常。
      // 不视为终态，也不受 2 分钟超时限制（无需用户手动点重试）。
      if (next.status === 'offline') {
        this._startTimer(OFFLINE_POLL_MS);
        return;
      }
      // 终态（授权/拉黑/过期/异常）停止轮询；或在等待超时（2 分钟未授权）后停止。
      const terminal = ['authorized', 'banned', 'expired', 'error'].includes(next.status);
      const waitTimeout = Date.now() - this.startAt > WAIT_TIMEOUT_MS && next.status !== 'authorized';
      if (terminal || waitTimeout) {
        this.stop();
      }
    } catch {
      // 后端离线时静默忽略，等下一轮轮询
    } finally {
      this.refreshing = false;
    }
  };

  private _startTimer(ms: number) {
    this.stop();
    this.pollTimer = setInterval(this.refresh, ms);
  }

  /** 当前状态对应的轮询间隔：offline 宽限固定 10s，其余按弹窗开关快/慢。 */
  private _pollInterval(): number {
    if (this.state.status === 'offline') {
      return OFFLINE_POLL_MS;
    }
    return this.engageMode === 'fast' ? FAST_POLL_MS : SLOW_POLL_MS;
  }

  /** 非终态时确保存在轮询计时器（手动重试/重新授权后恢复轮询）。 */
  private _ensureTimer() {
    if (['waiting', 'pending', 'offline'].includes(this.state.status)) {
      this._startTimer(this._pollInterval());
    }
  }

  /** 打开 App 只拉一次状态，随后按当前模式（默认慢 5s）低频轮询。 */
  init() {
    if (this.state.status === 'authorized') {
      this.refresh();
      return;
    }
    if (this.pollTimer) {
      return;
    }
    this.startAt = Date.now();
    this._startTimer(this._pollInterval());
    this.refresh();
    // 打开时弹窗未开，默认后端也用慢速轮询（5s）
    setPollMode(this.engageMode);
  }

  /** 由“未授权”弹窗开关控制轮询快慢：打开=1s，关闭=5s。 */
  setEngaged(engaged: boolean) {
    this.engageMode = engaged ? 'fast' : 'slow';
    this.startAt = Date.now(); // 重新打开弹窗时重新给 2 分钟预算
    if (this.state.status !== 'authorized') {
      this._startTimer(this._pollInterval());
    }
    setPollMode(engaged ? 'fast' : 'slow');
  }

  /** 手动刷新一次（重试后立即拉取）。 */
  async refreshNow() {
    await this.refresh();
  }

  /** 网络异常后重试授权校验。 */
  async retry() {
    this.startAt = Date.now();
    const next = await retryAuth();
    this.setState(next);
    await this.refresh();
    this._ensureTimer();
  }

  /** 主动“重新授权”：强制进入绑定流程（用于过期/删除后重新绑定）。 */
  async reauthorize() {
    this.startAt = Date.now();
    const next = await reauthorizeAuth();
    this.setState(next);
    await this.refresh();
    this._ensureTimer();
  }

  /** 授权前“换授权码”：重新生成授权码并重置为未绑定。 */
  async refreshCode() {
    this.startAt = Date.now();
    const next = await refreshCodeAuth();
    this.setState(next);
    await this.refresh();
    this._ensureTimer();
  }

  /** 解绑当前设备：清空绑定并进入待重新绑定状态。 */
  async unbind() {
    this.startAt = Date.now();
    const next = await unbindAuth();
    this.setState(next);
    await this.refresh();
    // 解绑后立即用快轮询(1s)，让“等待授权”弹窗/状态尽快出现，不再等慢速 5s
    this.setEngaged(true);
    this._ensureTimer();
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export const authStore = new AuthStore();

/** React Hook：订阅授权状态。 */
export function useAuthStatus(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.getState);
}

/** React Hook：识别类功能是否被锁定（未授权则锁定）。 */
export function useFeatureLock(): { isAuthorized: boolean; locked: boolean } {
  const auth = useAuthStatus();
  // 服务器故障（offline）也暂时放行：识别可用，但前端不会显示已授权/未授权角标。
  const usable = auth.status === 'authorized' || auth.status === 'offline';
  return {
    isAuthorized: usable,
    locked: !usable,
  };
}
