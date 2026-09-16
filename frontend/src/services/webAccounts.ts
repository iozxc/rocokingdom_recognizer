import { EncounterRecord, AppSettings } from '../types';
import { storage } from './storage';
import { fireStorage } from './fireStorage';

const PROFILES_KEY = 'roco_account_profiles_v1';
const CURRENT_KEY = 'roco_current_account_name';
export const DEFAULT_ACCOUNT = '默认账号';
const MULTI_APP = 'roco-multi-account';
const AUTOSAVE_DELAY = 400;

// 一次性迁移标记：老版本（线上）只在扁平 localStorage 键里写日常进度、几乎不回写账号档案，
// 且「导入存档且存档 current == 当前账号」时又只更新档案，两侧都可能偏新/偏旧。
// 首次升级到本版本时做一次并集合并把两边都收拢；之后扁平键就是权威数据源，
// 再无条件合并会把用户「清空/重置」的意图复活，所以用这个标记区分「迁移」与「日常」。
const MIGRATION_KEY = 'roco_accounts_migrated_v1';

export interface AccountPayload {
  encounteredPets: Record<string, EncounterRecord>;
  encounteredPets2: Record<string, EncounterRecord>;
  thresholds: Record<string, number>;
  appSettings: AppSettings;
}

export interface AccountProfile {
  name: string;
  payload: AccountPayload;
  updatedAt: string;
}

export interface AccountMeta {
  name: string;
  updatedAt: string;
  maps: Record<string, number>;
  fireMaps: Record<string, number>;
}

function emptyMaps(): Record<string, number> {
  return { map1: 0, map2: 0, map3: 0 };
}

function countMaps(records: Record<string, EncounterRecord> | undefined): Record<string, number> {
  const counts = emptyMaps();
  if (!records || typeof records !== 'object') return counts;
  Object.entries(records).forEach(([key, rec]) => {
    if (!rec || !rec.encountered) return;
    const mapId = String(rec.mapId || key.split('_')[0] || '');
    if (mapId in counts) counts[mapId] += 1;
  });
  return counts;
}

function normalizePayload(raw: any): AccountPayload {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    encounteredPets: source.encounteredPets && typeof source.encounteredPets === 'object' ? source.encounteredPets : {},
    encounteredPets2: source.encounteredPets2 && typeof source.encounteredPets2 === 'object' ? source.encounteredPets2 : {},
    thresholds: source.thresholds && typeof source.thresholds === 'object' ? source.thresholds : {},
    appSettings: source.appSettings && typeof source.appSettings === 'object' ? source.appSettings : {},
  };
}

/**
 * 合并两份精灵记录：键取并集；同一个键取 lastSeenAt 较新的一条（相同则取 live 侧）。
 *
 * 账号档案与扁平 localStorage 都可能是「更新的那一份」：
 * - 平时进度只写扁平键，档案停在最后一次 切换/导入/导出 时的状态（档案偏旧）；
 * - 但老版本「导入存档且存档 current 就是当前账号」时只更新档案、不碰扁平键（档案偏新）。
 * 迁移时若二选一，必然会清空另一侧的数据，所以这里做并集合并。
 * 取较新的 lastSeenAt 也能正确保留「重置地图」这类 encountered=false 的较新状态。
 */
function mergeRecords(
  archived: Record<string, EncounterRecord> | undefined,
  live: Record<string, EncounterRecord> | undefined,
): Record<string, EncounterRecord> {
  const out: Record<string, EncounterRecord> = {};
  const keys = new Set([...Object.keys(archived || {}), ...Object.keys(live || {})]);
  keys.forEach((key) => {
    const a = archived?.[key];
    const b = live?.[key];
    if (a && b) {
      const aAt = String(a.lastSeenAt || '');
      const bAt = String(b.lastSeenAt || '');
      out[key] = aAt > bAt ? a : b;
    } else {
      out[key] = (b || a) as EncounterRecord;
    }
  });
  return out;
}

function readProfiles(): AccountProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((a) => a && typeof a.name === 'string')
      .map((a) => ({ name: a.name, payload: normalizePayload(a.payload), updatedAt: a.updatedAt || '' }));
  } catch {
    return [];
  }
}

function writeProfiles(list: AccountProfile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
  } catch {
    /* 容量超限等异常静默忽略 */
  }
}

function readCurrent(): string {
  try {
    return localStorage.getItem(CURRENT_KEY) || DEFAULT_ACCOUNT;
  } catch {
    return DEFAULT_ACCOUNT;
  }
}

function writeCurrent(name: string): void {
  try {
    localStorage.setItem(CURRENT_KEY, name);
  } catch {
    /* 忽略 */
  }
}

class WebAccounts {
  private _initialized = false;
  private _applying = false;
  private _autoTimer: ReturnType<typeof setTimeout> | null = null;

  init(): void {
    if (this._initialized || typeof window === 'undefined') return;
    this._initialized = true;

    const live = this.collect();
    const now = new Date().toISOString();
    let profiles = readProfiles();
    const migrated = this.isMigrated();
    if (profiles.length === 0) {
      profiles = [{ name: DEFAULT_ACCOUNT, payload: live, updatedAt: now }];
      writeProfiles(profiles);
      writeCurrent(DEFAULT_ACCOUNT);
    } else {
      let cur = readCurrent();
      if (!profiles.some((p) => p.name === cur)) cur = profiles[0].name;
      writeCurrent(cur);
      const idx = profiles.findIndex((p) => p.name === cur);
      const prev = profiles[idx];
      // 首次升级（未迁移）：档案与扁平键都可能各自偏新，做并集合并把两边都保住。
      // 已迁移：本版本会自动把扁平键写回档案，扁平键是权威源；此时若再合并，
      // 用户刚清空/重置的数据会被档案里的旧记录「复活」，所以直接以扁平键为准。
      const payload = migrated
        ? live
        : normalizePayload({
            encounteredPets: mergeRecords(prev?.payload.encounteredPets, live.encounteredPets),
            encounteredPets2: mergeRecords(prev?.payload.encounteredPets2, live.encounteredPets2),
            thresholds: live.thresholds,
            appSettings: live.appSettings,
          });
      profiles[idx] = { name: cur, payload, updatedAt: now };
      writeProfiles(profiles);
      // 让内存与扁平键也反映结果；否则下一次自动保存又会用旧的扁平数据把档案覆盖回去。
      this.applyPayload(payload);
    }
    this.markMigrated();

    storage.subscribe(() => this.scheduleAutoSave());
    fireStorage.subscribe(() => this.scheduleAutoSave());
  }

  private isMigrated(): boolean {
    try {
      return localStorage.getItem(MIGRATION_KEY) === '1';
    } catch {
      return true; // 读不到（隐私模式等）时按已迁移处理，避免反复合并复活旧数据
    }
  }

  private markMigrated(): void {
    try {
      localStorage.setItem(MIGRATION_KEY, '1');
    } catch {
      /* 忽略 */
    }
  }

  private collect(): AccountPayload {
    const base = JSON.parse(storage.exportData());
    return normalizePayload({
      encounteredPets: base.encounteredPets || {},
      encounteredPets2: fireStorage.getAll() || {},
      thresholds: base.thresholds || {},
      appSettings: base.appSettings || {},
    });
  }

  private applyPayload(payload: AccountPayload): void {
    this._applying = true;
    try {
      storage.loadPayload({
        encounteredPets: payload.encounteredPets,
        thresholds: payload.thresholds,
        appSettings: payload.appSettings,
      });
      fireStorage.loadRecords(payload.encounteredPets2);
    } finally {
      queueMicrotask(() => {
        this._applying = false;
      });
    }
  }

  private scheduleAutoSave(): void {
    if (this._applying) return;
    if (this._autoTimer) clearTimeout(this._autoTimer);
    this._autoTimer = setTimeout(() => {
      this._autoTimer = null;
      if (!this._applying) this.saveCurrent();
    }, AUTOSAVE_DELAY);
  }

  current(): string {
    const cur = readCurrent();
    const profiles = readProfiles();
    return profiles.some((p) => p.name === cur) ? cur : (profiles[0]?.name || DEFAULT_ACCOUNT);
  }

  saveCurrent(name?: string): AccountProfile[] {
    const cur = name || this.current();
    const profiles = readProfiles();
    const item: AccountProfile = { name: cur, payload: this.collect(), updatedAt: new Date().toISOString() };
    const idx = profiles.findIndex((p) => p.name === cur);
    if (idx >= 0) profiles[idx] = item;
    else profiles.push(item);
    writeProfiles(profiles);
    return profiles;
  }

  list(): AccountMeta[] {
    const profiles = this.saveCurrent();
    return profiles.map((p) => ({
      name: p.name,
      updatedAt: p.updatedAt,
      maps: countMaps(p.payload.encounteredPets),
      fireMaps: countMaps(p.payload.encounteredPets2),
    }));
  }

  create(name: string): void {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('账号名称不能为空');
    const profiles = readProfiles();
    if (profiles.some((p) => p.name === clean)) throw new Error(`账号「${clean}」已存在`);
    this.saveCurrent();
    const current = this.collect();
    const empty: AccountPayload = {
      encounteredPets: {},
      encounteredPets2: {},
      thresholds: current.thresholds,
      appSettings: current.appSettings,
    };
    profiles.push({ name: clean, payload: empty, updatedAt: new Date().toISOString() });
    writeProfiles(profiles);
  }

  switchTo(name: string): void {
    const profiles = readProfiles();
    const target = profiles.find((p) => p.name === name);
    if (!target) throw new Error('账号不存在');
    if (name === this.current()) return;
    this.saveCurrent();
    writeCurrent(name);
    this.applyPayload(target.payload);
  }

  rename(oldName: string, newName: string): void {
    const clean = String(newName || '').trim();
    if (!clean) throw new Error('账号名称不能为空');
    if (clean === oldName) return;
    const profiles = readProfiles();
    if (!profiles.some((p) => p.name === oldName)) throw new Error('账号不存在');
    if (profiles.some((p) => p.name === clean)) throw new Error('账号名已存在');
    const item = profiles.find((p) => p.name === oldName);
    if (item) item.name = clean;
    writeProfiles(profiles);
    if (this.current() === oldName) writeCurrent(clean);
  }

  remove(name: string): string {
    let profiles = readProfiles();
    if (profiles.length <= 1) throw new Error('至少保留一个账号');
    if (!profiles.some((p) => p.name === name)) throw new Error('账号不存在');
    const wasActive = this.current() === name;
    if (wasActive) this.saveCurrent(name);
    profiles = profiles.filter((p) => p.name !== name);
    writeProfiles(profiles);

    if (!wasActive) return this.current();
    const fallback = profiles[0].name;
    writeCurrent(fallback);
    this.applyPayload(profiles[0].payload);
    return fallback;
  }

  exportSingle(): string {
    this.saveCurrent();
    return JSON.stringify(this.collect(), null, 2);
  }

  importSingle(text: string): boolean {
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;

    let next: AccountPayload;
    if (parsed.encounteredPets || parsed.encounteredPets2 || parsed.thresholds || parsed.appSettings) {
      next = normalizePayload(parsed);
    } else {
      next = { encounteredPets: parsed, encounteredPets2: {}, thresholds: {}, appSettings: {} };
    }
    this.applyPayload(next);
    this.saveCurrent();
    return true;
  }

  exportAll(): string {
    this.saveCurrent();
    const archive = {
      app: MULTI_APP,
      version: 1,
      current: this.current(),
      exportedAt: new Date().toISOString(),
      accounts: readProfiles(),
    };
    return JSON.stringify(archive, null, 2);
  }

  importAll(text: string): { count: number; current: string } {
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('无法读取该文件');
    }
    if (!parsed || parsed.app !== MULTI_APP || !Array.isArray(parsed.accounts)) {
      throw new Error('不是有效的多账号存档');
    }
    this.saveCurrent();
    const merged = new Map<string, AccountProfile>(readProfiles().map((p) => [p.name, p]));
    let count = 0;
    parsed.accounts.forEach((a: any) => {
      if (!a || !a.name || !a.payload) return;
      merged.set(a.name, {
        name: a.name,
        payload: normalizePayload(a.payload),
        updatedAt: a.updatedAt || new Date().toISOString(),
      });
      count += 1;
    });
    const list = Array.from(merged.values());
    writeProfiles(list);

    let target = this.current();
    if (parsed.current && list.some((p) => p.name === parsed.current)) target = parsed.current;
    writeCurrent(target);
    const t = list.find((p) => p.name === target);
    if (t) this.applyPayload(t.payload);
    return { count, current: target };
  }
}

export const webAccounts = new WebAccounts();
