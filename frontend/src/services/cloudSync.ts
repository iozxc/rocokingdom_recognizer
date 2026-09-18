import { IS_STATIC, PLATFORM } from './staticMode';
import { getWebDeviceCode } from './webDevice';
import { storage } from './storage';
import { webAccounts, MAX_ACCOUNTS } from './webAccounts';
import type { EncounterRecord } from '../types';

const AUTH_SERVER: string =
    ((import.meta.env.VITE_ROCO_AUTH_SERVER as string | undefined) ?? '').replace(/\/+$/, '') ||
    'https://api.omisheep.cn';

const TOKEN_KEY = 'roco_cloud_sync_v1';
const AGREED_KEY = 'roco_cloud_sync_agreed_v1';
const LAST_PUSH_KEY = 'roco_cloud_last_push_v1';
/** 本机最近一次同步（拉取或上传）的时间，同样持久化 —— 刷新页面后仍能参与时间对比。 */
const LAST_SYNC_KEY = 'roco_cloud_last_sync_v1';
const LAST_SEEN_CLOUD_TS_KEY = 'roco_cloud_last_seen_cloud_ts_v1';

function readPersistedMs(key: string): number | null {
  try {
    const t = Number(localStorage.getItem(key));
    return Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

function persistMs(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}
const REQUEST_TIMEOUT_MS = 12000;

export interface CloudSyncState {
  /** 是否已经用配对码绑定过 */
  bound: boolean;
  /** 正在同步 */
  syncing: boolean;
  /** 上次同步成功的时间戳（ms） */
  lastSyncAt: number | null;
  /** 上次同步失败原因 */
  lastError: string | null;
  cloudVersion: number;
  cloudUpdatedAt: string | null;
  lastPushAt: number | null;
  cloudAhead: boolean;
  cloudBytes: number;
  agreed: boolean;
}

interface StoredToken {
  token: string;
  boundAt: number;
}

type Listener = (s: CloudSyncState) => void;

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string' && parsed.token.length >= 16) {
      return { token: parsed.token, boundAt: Number(parsed.boundAt) || 0 };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeToken(v: StoredToken | null): void {
  try {
    if (v) localStorage.setItem(TOKEN_KEY, JSON.stringify(v));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** 稳定序列化（key 排序），用于「内容有没有变」的比较。 */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

function localArchive(): Record<string, unknown> {
  return webAccounts.exportArchiveObject();
}

/** 账号数超上限就拒绝上传（不主动删用户已有账号）。 */
function accountLimitError(archive: Record<string, unknown>): string | null {
  const count = Array.isArray(archive.accounts) ? archive.accounts.length : 0;
  if (count > MAX_ACCOUNTS) {
    return `本机有 ${count} 个账号，超过了 ${MAX_ACCOUNTS} 个的上限。请先删到只剩 ${MAX_ACCOUNTS} 个再同步。`;
  }
  return null;
}

class CloudSyncService {
  private listeners = new Set<Listener>();
  private state: CloudSyncState = {
    bound: false,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    cloudVersion: 0,
    cloudUpdatedAt: null,
    lastPushAt: null,
    cloudAhead: false,
    cloudBytes: 0,
    agreed: false,
  };
  private applying = false;
  private lastPushServerTime: string | null = null;
  private lastPushServerTs = 0;

  private markCloudSeen(ts: number): void {
    const v = Number(ts) || 0;
    if (v <= 0) return;
    try {
      localStorage.setItem(LAST_SEEN_CLOUD_TS_KEY, String(v));
    } catch {
      /* ignore */
    }
  }

  constructor() {
    this.state.bound = !!readToken();
    this.state.agreed = this.isAgreed();
    this.state.lastPushAt = readPersistedMs(LAST_PUSH_KEY);
    this.state.lastSyncAt = readPersistedMs(LAST_SYNC_KEY);
  }

  // ---------------- 状态订阅 ----------------

  getState(): CloudSyncState {
    return { ...this.state };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private patch(next: Partial<CloudSyncState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((fn) => {
      try {
        fn(this.getState());
      } catch {
        /* ignore */
      }
    });
  }

  isSupported(): boolean {
    return IS_STATIC && typeof fetch === 'function';
  }

  isBound(): boolean {
    return !!readToken();
  }

  // ---------------- HTTP ----------------

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(`${AUTH_SERVER}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        mode: 'cors',
        credentials: 'omit',
      });
      let data: Record<string, unknown> = {};
      try {
        data = (await resp.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      if (!resp.ok) {
        const msg = typeof data.msg === 'string' ? data.msg : `云端返回 ${resp.status}`;
        const err = new Error(msg) as Error & { status?: number; version?: number };
        err.status = resp.status;
        if (typeof data.version === 'number') err.version = data.version;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  private authBody(): Record<string, unknown> {
    const t = readToken();
    if (!t) throw new Error('尚未绑定云端同步');
    return { web_code: getWebDeviceCode(), token: t.token };
  }

  // ---------------- 绑定 ----------------

  /** 用桌面端显示的 6 位配对码绑定本浏览器。 */
  async bind(code: string): Promise<{ ok: boolean; msg: string }> {
    const gate = this.requireAgreement();
    if (!gate.ok) return gate;
    const clean = (code || '').replace(/\D/g, '');
    if (clean.length !== 6) return { ok: false, msg: '配对码应该是 6 位数字' };
    if (!this.isSupported()) return { ok: false, msg: '当前环境不支持云端同步' };
    try {
      const res = await this.post('/api/user_data/bind', {
        code: clean,
        web_code: getWebDeviceCode(),
      });
      const token = String(res.token || '');
      if (!token) return { ok: false, msg: '云端未返回令牌' };
      writeToken({ token, boundAt: Date.now() });
      this.patch({ bound: true, lastError: null });
      const r = await this.pullOverwrite();
      return { ok: true, msg: r.ok ? '绑定成功，已用云端数据覆盖本地' : `绑定成功（${r.msg}）` };
    } catch (e) {
      const msg = (e as Error)?.message || '绑定失败';
      this.patch({ lastError: msg });
      return { ok: false, msg };
    }
  }

  async unbind(): Promise<void> {
    const t = readToken();
    if (t) {
      try {
        await this.post('/api/user_data/unbind', { web_code: getWebDeviceCode(), token: t.token });
      } catch {
      }
    }
    writeToken(null);
    this.patch({ bound: false, cloudVersion: 0, cloudUpdatedAt: null, cloudBytes: 0, lastError: null });
  }

  // ---------------- 同步 ----------------

  private async pull(): Promise<{
    exists: boolean; version: number; payload: Record<string, unknown>;
    updatedAt: string | null; ts: number; bytes: number;
  }> {
    const res = await this.post('/api/user_data/get', this.authBody());
    return {
      exists: !!res.exists,
      version: Number(res.version) || 0,
      payload: (res.payload || {}) as Record<string, unknown>,
      updatedAt: typeof res.updated_at === 'string' ? res.updated_at : null,
      ts: Number(res.updated_at_ts) || 0,
      bytes: Number(res.bytes) || 0,
    };
  }

  private async push(payload: Record<string, unknown>, version: number): Promise<number> {
    const res = await this.post('/api/user_data/put', {
      ...this.authBody(),
      version,
      platform: PLATFORM,
      payload,
    });
    this.lastPushServerTime = typeof res.updated_at === 'string' ? res.updated_at : null;
    this.lastPushServerTs = Number(res.updated_at_ts) || 0;
    return Number(res.version) || version;
  }

  async refreshMeta(): Promise<{ ok: boolean; msg?: string }> {
    if (!this.isAgreed()) return { ok: false, msg: '请先阅读并同意《云端同步协议》' };
    if (!this.isBound()) return { ok: false, msg: '尚未绑定云端同步' };
    try {
      const res = await this.post('/api/user_data/meta', this.authBody());
      const cloudTs = Number(res.updated_at_ts) || 0;
      let seen = 0;
      try {
        seen = Number(localStorage.getItem(LAST_SEEN_CLOUD_TS_KEY)) || 0;
      } catch {
        /* ignore */
      }
      this.patch({
        cloudVersion: Number(res.version) || 0,
        cloudBytes: Number(res.bytes) || 0,
        cloudUpdatedAt: typeof res.updated_at === 'string' ? res.updated_at : null,
        cloudAhead: !!(res.exists && cloudTs > seen && seen > 0),
      });
      return { ok: true };
    } catch (e) {
      // 元信息拉不到不影响使用，但手动刷新时要把原因告诉用户
      return { ok: false, msg: (e as Error)?.message || '云端不可达' };
    }
  }

  async pullOverwrite(): Promise<{ ok: boolean; msg: string }> {
    const gate = this.requireAgreement();
    if (!gate.ok) return gate;
    if (!this.isBound()) return { ok: false, msg: '尚未绑定云端同步' };
    if (this.state.syncing) return { ok: false, msg: '正在同步中，请稍候' };
    this.patch({ syncing: true, lastError: null });
    try {
      const cloud = await this.pull();
      if (!cloud.exists) {
        this.patch({ lastSyncAt: Date.now(), cloudVersion: 0 });
        return { ok: false, msg: '云端还没有数据，请先在本机点「用本地覆盖云端」' };
      }
      const localSettings = (storage.getPayload() as unknown as Record<string, unknown>).appSettings;
      this.applying = true;
      let msg = '已用云端数据覆盖本地';
      try {
        if (cloud.payload && (cloud.payload as Record<string, unknown>).app === 'roco-multi-account') {
          const res = webAccounts.replaceAllFromArchive(cloud.payload);
          msg = `已用云端数据覆盖本地（${res.count} 个账号）`;
        } else {
          storage.loadPayload({
            encounteredPets: (cloud.payload.encounteredPets || {}) as Record<string, EncounterRecord>,
            thresholds: (cloud.payload.thresholds || {}) as Record<string, number>,
            appSettings: localSettings as Record<string, never>,
          });
        }
      } finally {
        this.applying = false;
      }
      persistMs(LAST_SYNC_KEY, Date.now());
      this.markCloudSeen(cloud.ts);
      this.patch({
        lastSyncAt: Date.now(),
        cloudVersion: cloud.version,
        cloudUpdatedAt: cloud.updatedAt,
        cloudBytes: cloud.bytes,
        cloudAhead: false,
        lastError: null,
      });
      console.info('[cloudSync] ' + msg);
      return { ok: true, msg };
    } catch (e) {
      const msg = (e as Error)?.message || '拉取失败';
      this.patch({ lastError: msg });
      return { ok: false, msg };
    } finally {
      this.patch({ syncing: false });
    }
  }

  async pushOverwrite(): Promise<{ ok: boolean; msg: string }> {
    const gate = this.requireAgreement();
    if (!gate.ok) return gate;
    if (!this.isBound()) return { ok: false, msg: '尚未绑定云端同步' };
    if (this.state.syncing) return { ok: false, msg: '正在同步中，请稍候' };
    this.patch({ syncing: true, lastError: null });
    try {
      const payload = localArchive();
      const limitMsg = accountLimitError(payload);
      if (limitMsg) {
        this.patch({ lastError: limitMsg });
        return { ok: false, msg: limitMsg };
      }
      const cloud = await this.pull().catch(() => ({ exists: false, version: 0, payload: {}, updatedAt: null, bytes: 0 }));
      const version = Math.max(Date.now(), Number(cloud.version || 0) + 1);
      const savedVersion = await this.push(payload, version);
      const now = Date.now();
      persistMs(LAST_PUSH_KEY, now);
      persistMs(LAST_SYNC_KEY, now);
      this.markCloudSeen(this.lastPushServerTs);
      this.patch({
        lastSyncAt: now,
        lastPushAt: now,
        cloudAhead: false,
        cloudVersion: savedVersion,
        cloudUpdatedAt: this.lastPushServerTime || this.state.cloudUpdatedAt,
        lastError: null,
      });
      const count = Array.isArray(payload.accounts) ? payload.accounts.length : 0;
      console.info(`[cloudSync] 已用本地数据覆盖云端（${count} 个账号）`);
      return { ok: true, msg: `已用本地数据覆盖云端（${count} 个账号）` };
    } catch (e) {
      const msg = (e as Error)?.message || '上传失败';
      this.patch({ lastError: msg });
      return { ok: false, msg };
    } finally {
      this.patch({ syncing: false });
    }
  }

  // ---------------- 同步协议同意 ----------------

  isAgreed(): boolean {
    try {
      return localStorage.getItem(AGREED_KEY) === '1';
    } catch {
      return false;
    }
  }

  setAgreed(agreed: boolean): void {
    try {
      if (agreed) localStorage.setItem(AGREED_KEY, '1');
      else localStorage.removeItem(AGREED_KEY);
    } catch {
      /* ignore */
    }
    this.patch({ agreed: !!agreed });
  }

  refreshAgreed(): void {
    this.patch({ agreed: this.isAgreed() });
  }

  private requireAgreement(): { ok: boolean; msg: string } {
    if (this.isAgreed()) return { ok: true, msg: '' };
    return { ok: false, msg: '请先阅读并同意《云端同步协议》' };
  }
}

export const cloudSync = new CloudSyncService();
