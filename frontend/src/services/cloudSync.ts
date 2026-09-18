/**
 * 云端同步（纯前端版）—— 把图鉴点亮记录在「桌面端 ↔ 网页版」之间打通。
 *
 * 服务端：RocoKingdom_Server 的 /api/user_data/*（SQLite 存储，每个归属设备只保留 1 份）
 *
 * 身份认证：
 *   网页端拿不到桌面端的签名密钥（SECRET_KEY 刻意不下发），所以走「配对」：
 *     1) 桌面端（已授权设备）申请 6 位一次性配对码（10 分钟有效）；
 *     2) 用户把配对码填到网页版，网页端用自己持久化的设备码换一个长期令牌；
 *     3) 之后所有读写都带 { web_code, token }，服务端据此解析出归属设备。
 *   服务端每次都会重新确认「归属设备仍然已授权且未过期」，所以解绑/到期后网页端立刻失效。
 *
 * 同步语义：**覆盖，不合并**；同步单位是**多账号存档**（所有账号一起）。
 *   - 「用云端覆盖本地」：直接拿云端那份替换本地**全部账号**
 *   - 「用本地覆盖云端」：把本地**全部账号**打包推上去（账号数 > 5 时拒绝并提示先删）
 *   - **只支持手动同步**：不拉取、不上传，只有用户点按钮才会动数据（没有自动同步）。
 *     并且首次使用必须先在界面上同意《云端同步协议》。
 *   thresholds 一起同步；appSettings 不同步（两端的设置项差异大，混用会出问题）。
 */
import { IS_STATIC, PLATFORM } from './staticMode';
import { getWebDeviceCode } from './webDevice';
import { storage } from './storage';
import { webAccounts, MAX_ACCOUNTS } from './webAccounts';
import type { EncounterRecord } from '../types';

const AUTH_SERVER: string =
    ((import.meta.env.VITE_ROCO_AUTH_SERVER as string | undefined) ?? '').replace(/\/+$/, '') ||
    'https://api.omisheep.cn';

const TOKEN_KEY = 'roco_cloud_sync_v1';
/**
 * 《云端同步协议》同意标记。
 *
 * **必须独立存一个 key**：早先存在 appSettings 里，而 appSettings 会随
 * 「切换账号」「云端覆盖本地」被账号档案里的那份整份替换掉 —— 用户明明同意过了，
 * 标记却被冲掉，于是出现「按钮还能点、一点就提示请先同意协议」的怪现象。
 * 同意与否属于本机客户端状态，不应该跟着用户数据一起被覆盖。
 */
const AGREED_KEY = 'roco_cloud_sync_agreed_v1';
/** 本机最近一次「上传（本地覆盖云端）」的时间，持久化保存供用户对比。 */
const LAST_PUSH_KEY = 'roco_cloud_last_push_v1';
/** 本机最近一次同步（拉取或上传）的时间，同样持久化 —— 刷新页面后仍能参与时间对比。 */
const LAST_SYNC_KEY = 'roco_cloud_last_sync_v1';
/**
 * 本机上次同步完成时「云端那份数据」的时间戳（服务端 unix 秒）。
 *
 * 用它当基线而不是本机时钟：浏览器时区和服务器不一致、或者两边时钟有偏差时，
 * 拿本机时间跟云端时间直接比会得出错误结论（比如明明是自己刚传的却提示"云端更新"）。
 * 比较「当前云端时间戳 vs 上次同步时看到的云端时间戳」则完全不受这类偏差影响。
 */
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
  /** 云端数据版本（服务端给的毫秒时间戳） */
  cloudVersion: number;
  /** 云端数据最后更新时间（服务端返回，任何设备写入都会刷新它） */
  cloudUpdatedAt: string | null;
  /** 本机最近一次「上传」的时间（ms 时间戳，只有本机推送到云端才会变） */
  lastPushAt: number | null;
  /** true = 云端被别的设备改过（比本机上次同步时看到的那份更新） */
  cloudAhead: boolean;
  /** 云端数据占用字节数 */
  cloudBytes: number;
  /** 是否已同意《云端同步协议》（未同意则整个功能不可用） */
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

/**
 * 云端同步的单位是「多账号存档」，不是单个账号 ——
 * 一次同步就是所有账号一起（服务端会校验账号数不超过 MAX_ACCOUNTS）。
 */
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
  /** 应用云端数据期间置位，避免「应用 → 触发变更 → 又上传」的自激循环 */
  private applying = false;
  /** 最近一次上传时服务端回传的写入时间（用于「云端最后更新」显示） */
  private lastPushServerTime: string | null = null;
  private lastPushServerTs = 0;

  /** 记住「这份云端数据我已经同步过了」的云端时间戳（比对基线）。 */
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

  /** 云端同步只在纯前端版启用（桌面端由 Python 侧用机器签名同步，不需要配对）。 */
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
      // 绑定成功后立刻拉一次：按产品约定「云端覆盖本地」，不做合并
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
        /* 服务端删不掉也要把本地令牌清掉，避免卡在"已绑定但用不了" */
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

  /**
   * 只刷新云端元信息（版本 / 大小 / 最后更新时间），不拉取数据。
   *
   * 「数据管理」打开时调用：这样用户在对比「本机最近上传 vs 云端最后更新」时，
   * 看到的云端时间是**当前**的（可能是另一台设备刚传的），而不是上次同步时的旧值。
   */
  async refreshMeta(): Promise<void> {
    if (!this.isAgreed() || !this.isBound()) return;
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
        // 云端比"上次同步时看到的那份"更新 → 中间有别的设备写过
        cloudAhead: !!(res.exists && cloudTs > seen && seen > 0),
      });
    } catch {
      /* 元信息拉不到不影响使用 */
    }
  }

  /** 用云端那份直接覆盖本地（不合并）。 */
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
          // 兼容早期的单账号云端数据
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

  /** 用本地那份直接覆盖云端（不合并）。 */
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
      // 明确要让本地覆盖云端：版本取「云端版本 + 1」，即使云端更新也照覆盖
      const cloud = await this.pull().catch(() => ({ exists: false, version: 0, payload: {}, updatedAt: null, bytes: 0 }));
      const version = Math.max(Date.now(), Number(cloud.version || 0) + 1);
      const savedVersion = await this.push(payload, version);
      const now = Date.now();
      persistMs(LAST_PUSH_KEY, now);
      persistMs(LAST_SYNC_KEY, now);
      // 这次上传已经把云端改成当前内容 → 基线就是服务端刚写入的时间
      this.markCloudSeen(this.lastPushServerTs);
      this.patch({
        lastSyncAt: now,
        lastPushAt: now,
        cloudAhead: false,
        cloudVersion: savedVersion,
        // 这次上传已经把云端改成当前内容，云端最后更新时间就是服务端刚写入的时间
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

  /** 是否已同意《云端同步协议》。未同意前不展示同步按钮，也不允许读写云端。 */
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

  /**
   * 重新从 localStorage 读一次同意状态并广播。
   * 界面在打开「数据管理」时调用，避免 UI 上的缓存值与真实状态不一致
   * （账号切换/云端覆盖都不会再影响它，但多窗口下别的地方写入时仍需要重读）。
   */
  refreshAgreed(): void {
    this.patch({ agreed: this.isAgreed() });
  }

  /** 所有云端读写前的统一门禁：没同意过一律拒绝。 */
  private requireAgreement(): { ok: boolean; msg: string } {
    if (this.isAgreed()) return { ok: true, msg: '' };
    return { ok: false, msg: '请先阅读并同意《云端同步协议》' };
  }
}

export const cloudSync = new CloudSyncService();
