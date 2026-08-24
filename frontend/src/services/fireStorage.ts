import axios from 'axios';
import { EncounterRecord } from '../types';
import { api } from './api';
import { isPetEncounteredInRecords } from '../utils/petHelper';

const LOCAL_STORAGE_KEY = 'roco_encountered_pets_fire_v1';

type Listener = (records: Record<string, EncounterRecord>) => void;

interface FireStoragePayload {
  encounteredPets2?: Record<string, EncounterRecord>;
  version?: number;
}

/**
 * 火系徽章试炼的独立存储服务。
 *
 * 与草系共用同一个 /api/storage 接口和 roco_user_data.json，
 * 数据落在 encounteredPets2 集合；记录 key 与草系一致（map1_火花.png），
 * 只是与草系分属不同集合，互不影响。
 */
export class FireStorageService {
  private records: Record<string, EncounterRecord> = {};
  private listeners: Set<Listener> = new Set();
  private localVersion = 0;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private hasPendingLocalChanges = false;

  constructor() {
    this.loadFromLocalStorage();
    this.startPoll();
    this.flushOnUnload();
    this.fetchRemote().catch(() => {
      // 离线时继续使用 localStorage
    });
  }

  private flushOnUnload() {
    if (typeof window === 'undefined') return;
    const flush = () => {
      if (!this.hasPendingLocalChanges && !this.saveTimeout) return;
      try {
        const blob = new Blob([JSON.stringify(this.getPayload())], {
          type: 'application/json',
        });
        navigator.sendBeacon(`${api.getApiBase()}/api/storage`, blob);
      } catch (e) {
        console.warn('fire flush on unload failed', e);
      }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
  }

  private loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      this.records = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('Failed to load fire storage from localStorage:', e);
      this.records = {};
    }
  }

  private saveToLocalStorage() {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.records));
    } catch (e) {
      console.error('Failed to save fire storage to localStorage:', e);
    }
  }

  private getPayload(): FireStoragePayload {
    return {
      encounteredPets2: { ...this.records },
      version: this.localVersion,
    };
  }

  private notifyListeners() {
    const copy = { ...this.records };
    this.listeners.forEach((listener) => {
      try {
        listener(copy);
      } catch (err) {
        console.error('Error notifying fire storage listener:', err);
      }
    });
  }

  private applyRemoteData(remote: FireStoragePayload & { version?: number }) {
    if (remote.encounteredPets2) {
      this.records = remote.encounteredPets2;
    }
    if (typeof remote.version === 'number') {
      this.localVersion = remote.version;
    }
    this.saveToLocalStorage();
    this.notifyListeners();
  }

  private startPoll() {
    const poll = async () => {
      try {
        if (!this.hasPendingLocalChanges && !this.saveTimeout) {
          const res = await axios.get<FireStoragePayload | { status: string }>(
              `${api.getApiBase()}/api/storage/${this.localVersion}`,
              { timeout: 4000 }
          );
          const remote = res.data;
          if (remote && 'status' in remote && remote.status === 'ok') {
            return;
          }
          if (remote && 'encounteredPets2' in remote) {
            this.applyRemoteData(remote as FireStoragePayload & { version?: number });
          }
        }
      } catch (e) {
        // 后端离线时静默忽略
      } finally {
        this.pollTimer = setTimeout(poll, 350);
      }
    };
    poll();
  }

  public async fetchRemote(): Promise<void> {
    const res = await axios.get<FireStoragePayload | { status: string }>(
        `${api.getApiBase()}/api/storage/0`,
        { timeout: 4000 }
    );
    const remote = res.data;
    if (remote && 'status' in remote && remote.status === 'ok') return;
    if (remote && 'encounteredPets2' in remote) {
      this.applyRemoteData(remote as FireStoragePayload & { version?: number });
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

  private async saveToRemote() {
    try {
      const res = await axios.post<{ version?: number }>(
          `${api.getApiBase()}/api/storage`,
          this.getPayload(),
          { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
      );
      if (typeof res.data?.version === 'number') {
        this.localVersion = res.data.version;
      }
      this.hasPendingLocalChanges = false;
    } catch (e) {
      console.warn('fire save remote http fail', e);
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getAll(): Record<string, EncounterRecord> {
    return { ...this.records };
  }

  public isEncountered(mapId: string, filename: string): boolean {
    return isPetEncounteredInRecords(this.records, mapId, filename);
  }

  public markEncountered(mapId: string, filename: string, note?: string): EncounterRecord {
    const key = `${mapId}_${filename}`;
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
    this.triggerSave();
    return record;
  }

  public toggleEncountered(mapId: string, filename: string): boolean {
    const key = `${mapId}_${filename}`;
    const now = new Date().toISOString();
    const wasEncountered = this.isEncountered(mapId, filename);
    if (wasEncountered) {
      this.records[key] = {
        key,
        mapId,
        filename,
        encountered: false,
        count: this.records[key]?.count || 0,
        firstSeenAt: this.records[key]?.firstSeenAt || now,
        lastSeenAt: now,
      };
    } else {
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
    }
    this.triggerSave();
    return !wasEncountered;
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

  public resetAll(): void {
    this.records = {};
    this.triggerSave();
  }

  public destroy() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }
}

export const fireStorage = new FireStorageService();

