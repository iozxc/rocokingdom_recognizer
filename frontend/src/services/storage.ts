import axios from 'axios';
import { EncounterRecord, AppSettings } from '../types';
import { api } from './api';
import { sound } from './sound';

const LOCAL_STORAGE_KEY = 'roco_encountered_pets_v1';
const THRESHOLDS_STORAGE_KEY = 'roco_thresholds_v1';
const SETTINGS_STORAGE_KEY = 'roco_settings_v1';

export interface StoragePayload {
  encounteredPets?: Record<string, EncounterRecord>;
  thresholds?: Record<string, number>;
  appSettings?: AppSettings;
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

  constructor() {
    this.loadFromLocalStorage();
    this.startPoll(); // 启动轮询替代websocket
    this.fetchRemote().catch(() => {
      // 降级使用localStorage
    });
  }

  /**
   * 轮询，替代socket "storage_updated"广播
   */
  private startPoll() {
    const poll = async () => {
      try {
        const apiBase = api.getApiBase();
        const res = await axios.get<StoragePayload & { version?: number }>(`${apiBase}/api/storage`, { timeout:4000 });
        const remote = res.data;
        if (remote.version && remote.version > this.localVersion) {
          await this.fetchRemote();
        }
      } catch (e) {
        // 后端未启动，静默失败
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

  public async fetchRemote(): Promise<(StoragePayload & {version?:number}) | null> {
    const apiBase = api.getApiBase();
    this.isSyncing = true;
    try {
      const response = await axios.get<StoragePayload & {version?:number}>(`${apiBase}/api/storage`, {
        timeout: 4000,
      });

      const remote = response.data;
      if (!remote) return null;
      if (remote.version && remote.version <= this.localVersion) {
        return remote;
      }

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
      if (remote.version) this.localVersion = remote.version;

      this.saveToLocalStorage();
      if (hasRecordsChanges) this.notifyListeners();
      if (hasSettingsChanges) this.notifySettingsListeners();

      return remote;
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
    const payload: StoragePayload = {
      encounteredPets: this.records,
      thresholds: this.thresholds,
      appSettings: this.appSettings,
    };
    const apiBase = api.getApiBase();
    try {
      const res = await axios.post(`${apiBase}/api/storage`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      return res.status === 200;
    } catch (err) {
      console.warn('save remote http fail', err);
      return false;
    }
  }

  private triggerSave() {
    this.saveToLocalStorage();
    this.notifyListeners();

    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveToRemote();
    }, 300);
  }

  private triggerSettingsSave() {
    this.saveToLocalStorage();
    this.notifySettingsListeners();

    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveToRemote();
    }, 300);
  }

  public subscribe(listener: StorageListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  public subscribeSettings(listener: SettingsListener): () => void {
    this.settingsListeners.add(listener);
    return () => { this.settingsListeners.delete(listener); };
  }

  public getSettings(): AppSettings { return { ...this.appSettings }; }
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

  public getAll(): Record<string, EncounterRecord> { return { ...this.records }; }
  public getKey(mapId: string, filename: string): string { return `${mapId}_${filename}`; }
  public isEncountered(mapId: string, filename: string): boolean {
    const key = this.getKey(mapId, filename);
    return !!this.records[key]?.encountered;
  }
  public getRecord(mapId: string, filename: string): EncounterRecord | undefined {
    const key = this.getKey(mapId, filename);
    return this.records[key];
  }

  public markEncountered(mapId: string, filename: string, note?: string): EncounterRecord {
    const key = this.getKey(mapId, filename);
    const existing = this.records[key];
    const now = new Date().toISOString();
    const record: EncounterRecord = {
      key, mapId, filename, encountered: true,
      count: (existing?.count || 0) + 1,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      note: note ?? existing?.note,
    };
    this.records[key] = record;
    this.triggerSave();
    return record;
  }

  public batchMarkEncountered(items: Array<{ mapId: string; filename: string; note?: string }>): number {
    const now = new Date().toISOString();
    let updatedCount = 0;
    items.forEach(({ mapId, filename, note }) => {
      const key = this.getKey(mapId, filename);
      const existing = this.records[key];
      this.records[key] = {
        key, mapId, filename, encountered: true,
        count: (existing?.count || 0) + 1,
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
        note: note ?? existing?.note ?? '批量初始化识别导入',
      };
      updatedCount++;
    });
    this.triggerSave();
    return updatedCount;
  }

  public toggleEncountered(mapId: string, filename: string): boolean {
    const key = this.getKey(mapId, filename);
    const existing = this.records[key];
    const now = new Date().toISOString();
    if (existing && existing.encountered) {
      this.records[key] = { ...existing, encountered: false };
      this.triggerSave();
      return false;
    } else {
      this.records[key] = {
        key, mapId, filename, encountered: true,
        count: (existing?.count || 0) + 1,
        firstSeenAt: existing?.firstSeenAt || now,
        lastSeenAt: now,
      };
      this.triggerSave();
      return true;
    }
  }

  public resetMap(mapId: string): void {
    Object.keys(this.records).forEach((key) => {
      if (this.records[key].mapId === mapId) {
        this.records[key].encountered = false;
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

  public getTotalEncounteredCount(): number {
    return Object.values(this.records).filter((r) => r.encountered).length;
  }

  public getMapStats(mapId: string, totalItems: number): { encounteredCount: number; percentage: number } {
    const count = Object.values(this.records).filter(r => r.mapId === mapId && r.encountered).length;
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
    return JSON.stringify({
      encounteredPets: this.records,
      thresholds: this.thresholds,
      appSettings: this.appSettings,
    }, null, 2);
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
        this.triggerSave();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public getIsSyncing(): boolean { return this.isSyncing; }

  public destroy() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }
}

export const storage = new StorageService();