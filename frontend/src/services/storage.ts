import axios from 'axios';
import { EncounterRecord, AppSettings, PetItem } from '../types';
import { api } from './api';
import { sound } from './sound';
import { IS_STATIC, PLATFORM } from './staticMode';
import {
  isPetEncounteredInRecords,
  findMatchingRecordKeys,
  formatPetName,
  getBasePetName,
  isSamePetName,
} from '../utils/petHelper';

const LOCAL_STORAGE_KEY = 'roco_encountered_pets_v1';
const THRESHOLDS_STORAGE_KEY = 'roco_thresholds_v1';
const SETTINGS_STORAGE_KEY = 'roco_settings_v1';

export interface StoragePayload {
  encounteredPets?: Record<string, EncounterRecord>;
  thresholds?: Record<string, number>;
  appSettings?: AppSettings;
  version?: number;
  platform?: 'app' | 'web';
}

type StorageListener = (records: Record<string, EncounterRecord>) => void;
type SettingsListener = (settings: AppSettings) => void;

export class StorageService {
  private records: Record<string, EncounterRecord> = {};
  private thresholds: Record<string, number> = {};
  private appSettings: AppSettings = {};
  private listeners: Set<StorageListener> = new Set();
  private settingsListeners: Set<SettingsListener> = new Set();
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;

  private localVersion = 0;
  // 轮询定时器
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  // 标记是否本地有未同步到后端的最新更改，避免轮询覆盖当前未落盘的点击
  private hasPendingLocalChanges = false;

  constructor() {
    this.loadFromLocalStorage();
    // 纯前端静态版：无后端存储，仅用 localStorage；不做轮询/上报。
    if (!IS_STATIC) {
      this.startPoll(); // 启动轮询替代websocket
      this.flushOnUnload(); // 窗口关闭前把未落盘的改动刷到后端
      this.fetchRemote().catch(() => {
        // 降级使用localStorage
      });
    }
  }

  /**
   * 窗口/页面关闭时，把尚未落盘的改动通过 sendBeacon 提交到后端，
   * 避免用户改完立刻关窗导致最后一步数据丢失。
   */
  private flushOnUnload() {
    if (typeof window === 'undefined') return;
    if (IS_STATIC) return;
    const flush = () => {
      if (!this.hasPendingLocalChanges && !this.saveTimeout) return;
      try {
        const blob = new Blob([JSON.stringify(this.getPayload())], {
          type: 'application/json',
        });
        navigator.sendBeacon(`${api.getApiBase()}/api/storage`, blob);
      } catch (e) {
        console.warn('flush on unload failed', e);
      }
    };
    // pagehide 在 Chromium/WebView2 下比 beforeunload 更可靠，两者都挂，重复发送同一份数据无副作用
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
  }

  public getPayload(): StoragePayload {
    return {
      encounteredPets: { ...this.records },
      thresholds: { ...this.thresholds },
      appSettings: { ...this.appSettings },
      version: this.localVersion,
      platform: PLATFORM,
    };
  }

  /**
   * 轮询，替代socket "storage_updated"广播
   */
  private startPoll() {
    const poll = async () => {
      try {
        // 如果本地有正在等待保存或正在落盘的操作，暂缓本轮拉取，避免竞态覆盖
        if (!this.hasPendingLocalChanges && !this.saveTimeout) {
          const apiBase = api.getApiBase();
          const res = await axios.get<StoragePayload | { status: string }>(`${apiBase}/api/storage/${this.localVersion}`, { timeout: 4000 });
          const remote = res.data;
          // 版本一致时返回 {"status": "ok"}，无需更新
          if (remote && 'status' in remote && remote.status === 'ok') {
            return;
          }
          // 版本不一致时返回完整数据，直接应用
          if (remote && 'version' in remote && remote.version && remote.version > this.localVersion) {
            this.applyRemoteData(remote as StoragePayload);
          }
        }
      } catch (e) {
        // 后端未启动或离线，静默忽略
      } finally {
        this.pollTimer = setTimeout(poll, 300);
      }
    };
    poll();
  }

  private loadFromLocalStorage() {
    try {
      const recordsData = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (recordsData) {
        this.records = JSON.parse(recordsData);
      } else {
        this.records = {};
      }

      const thresholdsData = localStorage.getItem(THRESHOLDS_STORAGE_KEY);
      if (thresholdsData) {
        this.thresholds = JSON.parse(thresholdsData);
      }

      const settingsData = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (settingsData) {
        this.appSettings = JSON.parse(settingsData);
        if (typeof this.appSettings.isSoundMuted === 'boolean') {
          sound.setMuted(this.appSettings.isSoundMuted);
        }
      }
    } catch (e) {
      console.error('Failed to load storage from localStorage:', e);
      this.records = {};
    }
  }

  private saveToLocalStorage() {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.records));
      localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(this.thresholds));
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.appSettings));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  private notifyListeners() {
    const copy = { ...this.records };
    this.listeners.forEach((listener) => {
      try {
        listener(copy);
      } catch (err) {
        console.error('Error notifying storage listener:', err);
      }
    });
  }

  private notifySettingsListeners() {
    const copy = { ...this.appSettings };
    this.settingsListeners.forEach((listener) => {
      try {
        listener(copy);
      } catch (err) {
        console.error('Error notifying settings listener:', err);
      }
    });
  }

  private applyRemoteData(remote: StoragePayload) {
    let hasRecordsChanges = false;
    let hasSettingsChanges = false;

    if (remote.encounteredPets) {
      this.records = remote.encounteredPets;
      hasRecordsChanges = true;
    }
    if (remote.thresholds) {
      this.thresholds = remote.thresholds;
    }
    if (remote.appSettings) {
      this.appSettings = remote.appSettings;
      if (typeof this.appSettings.isSoundMuted === 'boolean') {
        sound.setMuted(this.appSettings.isSoundMuted);
      }
      hasSettingsChanges = true;
    }
    if (remote.version) {
      this.localVersion = remote.version;
    }

    this.saveToLocalStorage();
    if (hasRecordsChanges) this.notifyListeners();
    if (hasSettingsChanges) this.notifySettingsListeners();
  }

  public async fetchRemote(): Promise<StoragePayload | null> {
    const apiBase = api.getApiBase();
    this.isSyncing = true;
    try {
      const response = await axios.get<StoragePayload | { status: string }>(`${apiBase}/api/storage/0`, {
        timeout: 4000,
      });

      const remote = response.data;
      if (!remote || ('status' in remote && remote.status === 'ok')) return null;
      if (!('version' in remote)) return null;

      this.applyRemoteData(remote as StoragePayload);
      return remote as StoragePayload;
    } catch (err) {
      console.warn('fetchRemote fail, fallback localStorage');
    } finally {
      this.isSyncing = false;
    }
    return null;
  }

  /**
   * 全部使用http post，移除socket逻辑
   */
  public async saveToRemote(): Promise<boolean> {
    if (IS_STATIC) {
      this.hasPendingLocalChanges = false;
      return true;
    }
    const payload = this.getPayload();
    const apiBase = api.getApiBase();
    try {
      const res = await axios.post<{ version?: number }>(`${apiBase}/api/storage`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      if (res.status === 200) {
        if (res.data?.version) {
          this.localVersion = res.data.version;
        }
        this.hasPendingLocalChanges = false;
        return true;
      }
      return false;
    } catch (err) {
      console.warn('save remote http fail', err);
      return false;
    }
  }

  private triggerSave() {
    this.hasPendingLocalChanges = true;
    this.saveToLocalStorage();
    this.notifyListeners();

    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveToRemote();
    }, 150);
  }

  private triggerSettingsSave() {
    this.hasPendingLocalChanges = true;
    this.saveToLocalStorage();
    this.notifySettingsListeners();

    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveToRemote();
    }, 150);
  }

  public subscribe(listener: StorageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public subscribeSettings(listener: SettingsListener): () => void {
    this.settingsListeners.add(listener);
    return () => {
      this.settingsListeners.delete(listener);
    };
  }

  public getSettings(): AppSettings {
    return { ...this.appSettings };
  }

  public getSetting<T>(key: keyof AppSettings, defaultValue: T): T {
    return (this.appSettings[key] !== undefined ? this.appSettings[key] : defaultValue) as T;
  }

  public setSetting(key: keyof AppSettings, value: unknown): void {
    this.appSettings[key] = value;
    if (key === 'isSoundMuted' && typeof value === 'boolean') {
      sound.setMuted(value);
    }
    this.triggerSettingsSave();
  }

  public updateSettings(partialSettings: Partial<AppSettings>): void {
    this.appSettings = { ...this.appSettings, ...partialSettings };
    if (typeof partialSettings.isSoundMuted === 'boolean') {
      sound.setMuted(partialSettings.isSoundMuted);
    }
    this.triggerSettingsSave();
  }

  public getAll(): Record<string, EncounterRecord> {
    return { ...this.records };
  }

  public getKey(mapId: string, filename: string): string {
    return `${mapId}_${filename}`;
  }

  public isEncountered(mapId: string, filename: string): boolean {
    return isPetEncounteredInRecords(this.records, mapId, filename);
  }

  public getRecord(mapId: string, filename: string): EncounterRecord | undefined {
    const key = this.getKey(mapId, filename);
    if (this.records[key]) return this.records[key];
    const matchingKeys = findMatchingRecordKeys(this.records, mapId, filename);
    if (matchingKeys.length > 0) {
      return this.records[matchingKeys[0]];
    }
    return undefined;
  }

  public markEncountered(mapId: string, filename: string, note?: string): EncounterRecord {
    const key = this.getKey(mapId, filename);
    const existing = this.records[key];
    const now = new Date().toISOString();
    const record: EncounterRecord = {
      key,
      mapId,
      filename,
      encountered: true,
      count: (existing?.count || 0) + 1,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      note: note ?? existing?.note,
    };
    this.records[key] = record;

    // Synchronize all other matching keys for this pet on this map
    const matchingKeys = findMatchingRecordKeys(this.records, mapId, filename);
    matchingKeys.forEach((mKey) => {
      if (mKey !== key && this.records[mKey]) {
        this.records[mKey] = {
          ...this.records[mKey],
          encountered: true,
          lastSeenAt: now,
        };
      }
    });

    this.triggerSave();
    return record;
  }

  public batchMarkEncountered(
      items: Array<{ mapId: string; filename: string; note?: string }>
  ): number {
    const now = new Date().toISOString();
    let updatedCount = 0;
    items.forEach(({ mapId, filename, note }) => {
      const key = this.getKey(mapId, filename);
      const existing = this.records[key];
      this.records[key] = {
        key,
        mapId,
        filename,
        encountered: true,
        count: (existing?.count || 0) + 1,
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
        note: note ?? existing?.note ?? '批量初始化识别导入',
      };

      // Also ensure existing variant keys for this pet match
      const matchingKeys = findMatchingRecordKeys(this.records, mapId, filename);
      matchingKeys.forEach((mKey) => {
        if (mKey !== key && this.records[mKey]) {
          this.records[mKey] = {
            ...this.records[mKey],
            encountered: true,
            lastSeenAt: now,
          };
        }
      });

      updatedCount++;
    });
    this.triggerSave();
    return updatedCount;
  }

  public toggleEncountered(mapId: string, filename: string): boolean {
    const key = this.getKey(mapId, filename);
    const now = new Date().toISOString();
    const isCurrentlyEnc = this.isEncountered(mapId, filename);

    // Find all matching keys in records (e.g. map1_板板壳.png, map1_板板壳, map1_板板壳_蜕皮.png)
    const matchingKeys = new Set(findMatchingRecordKeys(this.records, mapId, filename));
    matchingKeys.add(key);

    if (isCurrentlyEnc) {
      // Toggle to FALSE: uncheck ALL matching keys so no phantom record keeps it encountered
      matchingKeys.forEach((mKey) => {
        if (this.records[mKey]) {
          this.records[mKey] = {
            ...this.records[mKey],
            encountered: false,
            lastSeenAt: now,
          };
        }
      });
      // Also ensure primary key has record explicitly false
      if (!this.records[key]) {
        this.records[key] = {
          key,
          mapId,
          filename,
          encountered: false,
          count: 0,
          firstSeenAt: now,
          lastSeenAt: now,
        };
      }
      this.triggerSave();
      return false;
    } else {
      // Toggle to TRUE: mark primary key as true, and sync any existing matched records
      const existing = this.records[key];
      this.records[key] = {
        key,
        mapId,
        filename,
        encountered: true,
        count: (existing?.count || 0) + 1,
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
      };

      matchingKeys.forEach((mKey) => {
        if (mKey !== key && this.records[mKey]) {
          this.records[mKey] = {
            ...this.records[mKey],
            encountered: true,
            lastSeenAt: now,
          };
        }
      });

      this.triggerSave();
      return true;
    }
  }

  public resetMap(mapId: string): void {
    const now = new Date().toISOString();
    Object.keys(this.records).forEach((key) => {
      if (this.records[key]?.mapId === mapId || key.startsWith(`${mapId}_`)) {
        this.records[key] = {
          ...this.records[key],
          encountered: false,
          lastSeenAt: now,
        };
      }
    });
    this.triggerSave();
  }

  public clearAll(): void {
    this.records = {};
    this.thresholds = {};
    this.appSettings = {};
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem(THRESHOLDS_STORAGE_KEY);
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    this.notifyListeners();
    this.saveToRemote();
  }

  public getTotalEncounteredCount(allMapsPets?: Record<string, { items: PetItem[] }>): number {
    if (allMapsPets) {
      let count = 0;
      Object.keys(allMapsPets).forEach((mapId) => {
        const items = allMapsPets[mapId]?.items || [];
        count += items.filter((p) => isPetEncounteredInRecords(this.records, mapId, p.name)).length;
      });
      return count;
    }

    // Fallback: count unique base pet names per map to avoid double-counting multi-key records
    const uniqueMapPets = new Set<string>();
    Object.values(this.records).forEach((r) => {
      if (r && r.encountered) {
        const base = getBasePetName(r.filename || r.key);
        uniqueMapPets.add(`${r.mapId}_${base}`);
      }
    });
    return uniqueMapPets.size;
  }

  public getMapStats(
      mapId: string,
      totalItems: number,
      petsList?: PetItem[]
  ): { encounteredCount: number; percentage: number } {
    let count = 0;
    if (petsList && petsList.length > 0) {
      count = petsList.filter((p) => isPetEncounteredInRecords(this.records, mapId, p.name)).length;
    } else {
      // Deduplicate by base name to avoid multiple keys inflating count
      const uniqueBase = new Set<string>();
      Object.values(this.records).forEach((r) => {
        if (r && r.encountered && (r.mapId === mapId || r.key?.startsWith(`${mapId}_`))) {
          uniqueBase.add(getBasePetName(r.filename || r.key));
        }
      });
      count = uniqueBase.size;
    }
    const percentage = totalItems > 0 ? Math.round((count / totalItems) * 100) : 0;
    return { encounteredCount: count, percentage };
  }

  public getThreshold(key: string, defaultValue = 0.25): number {
    return typeof this.thresholds[key] === 'number' ? this.thresholds[key] : defaultValue;
  }

  public setThreshold(key: string, value: number): void {
    this.thresholds[key] = value;
    this.triggerSave();
  }

  public getTopK(defaultValue = 3): number {
    const val = this.thresholds['predict_top_k'];
    return typeof val === 'number' && val >= 1 && val <= 6 ? val : defaultValue;
  }

  public setTopK(value: number): void {
    const clamped = Math.max(1, Math.min(6, Math.round(value)));
    this.thresholds['predict_top_k'] = clamped;
    this.triggerSave();
  }

  public exportData(): string {
    return JSON.stringify(
        {
          encounteredPets: this.records,
          thresholds: this.thresholds,
          appSettings: this.appSettings,
        },
        null,
        2
    );
  }

  public importData(jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      if (typeof parsed === 'object' && parsed !== null) {
        if (parsed.encounteredPets) {
          this.records = parsed.encounteredPets;
          this.thresholds = parsed.thresholds || {};
          this.appSettings = parsed.appSettings || {};
        } else {
          this.records = parsed;
        }
        if (typeof this.appSettings.isSoundMuted === 'boolean') {
          sound.setMuted(this.appSettings.isSoundMuted);
        }
        this.triggerSave();
        this.notifySettingsListeners();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public getIsSyncing(): boolean {
    return this.isSyncing;
  }

  public destroy() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }
}

export const storage = new StorageService();
