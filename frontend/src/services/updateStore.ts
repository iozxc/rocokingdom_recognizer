import { api } from './api';
import { storage } from './storage';
import { CheckUpdateResponse, DownloadStatus } from '../types';

export type UpdateModePref = 'auto' | 'full';

export interface UpdateState {
  hasUpdate: boolean;
  updateData: CheckUpdateResponse | null;
  checking: boolean;
  checkError?: string;
  downloadStatus: DownloadStatus;
  progress: number;
  totalBytes?: number;
  speedBps?: number;
  error?: string;
  dotVisible: boolean;
}

const initialState: UpdateState = {
  hasUpdate: false,
  updateData: null,
  checking: false,
  checkError: undefined,
  downloadStatus: 'idle',
  progress: 0,
  totalBytes: undefined,
  speedBps: undefined,
  error: undefined,
  dotVisible: false,
};

class UpdateStore {
  private state: UpdateState = { ...initialState };
  private listeners = new Set<() => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): UpdateState => this.state;

  private setState(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  getUpdateModePref = (): UpdateModePref =>
    storage.getSetting<UpdateModePref>('updateMode', 'auto');

  async checkUpdate(silent = false) {
    this.setState({ checking: true });
    try {
      const res = await api.checkUpdate();
      const hasUpdate = !!res.data.has_update;
      this.setState({
        checking: false,
        checkError: undefined,
        hasUpdate,
        updateData: res.data,
        // 静默检查（启动自检）发现更新时点亮右上角红点
        dotVisible: silent
            ? hasUpdate && !storage.getSetting<boolean>('hideUpdateDot', false)
            : this.state.dotVisible,
      });
    } catch (e) {
      this.setState({
        checking: false,
        checkError: (e as Error).message || '检查更新失败',
      });
    }
  }

  clearDot = () => this.setState({ dotVisible: false });

  markDownloadError = (message?: string) => {
    this.setState({ downloadStatus: 'error', error: message || '更新失败' });
    this.stopPolling();
  };

  private refreshProgress = async () => {
    try {
      const res = await api.getDownloadProgress();
      const { progress, total_bytes, speed_bps, status, error } = res.data;
      const normalizedStatus = (status || 'idle') === 'paused' ? 'stopped' : status || 'idle';
      this.setState({
        progress: typeof progress === 'number' ? Math.max(0, progress) : 0,
        totalBytes: typeof total_bytes === 'number' && total_bytes > 0 ? total_bytes : undefined,
        speedBps: typeof speed_bps === 'number' ? speed_bps : undefined,
        downloadStatus: normalizedStatus,
        error: normalizedStatus === 'error' ? error || '下载更新过程中发生错误' : undefined,
      });
      if (
        normalizedStatus !== 'downloading' &&
        !normalizedStatus.startsWith('verifying') &&
        normalizedStatus !== 'merging'
      ) {
        this.stopPolling();
      }
    } catch {
      // 后端离线时静默忽略
    }
  };

  refreshProgressNow = () => this.refreshProgress();

  private startPolling = () => {
    this.stopPolling();
    this.refreshProgress();
    this.pollTimer = setInterval(this.refreshProgress, 1000);
  };

  private stopPolling = () => {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  };

  async startDownload() {
    const mode = this.getUpdateModePref();
    this.setState({ error: undefined, downloadStatus: 'downloading' });
    try {
      const res = await api.startDownload(mode);
      if (res.data.status === 'error') {
        this.setState({ downloadStatus: 'error', error: res.data.message || '发起更新失败' });
      } else {
        this.startPolling();
      }
    } catch (e) {
      this.setState({ downloadStatus: 'error', error: (e as Error).message || '网络异常，发起更新请求失败' });
    }
  }

  async stopDownload() {
    try {
      await api.stopDownload();
    } catch {
      /* 忽略 */
    }
    this.setState({ downloadStatus: 'stopped', speedBps: 0 });
    this.stopPolling();
  }

  async deleteDownload() {
    try {
      await api.deleteDownload();
    } catch {
      /* 忽略 */
    }
    this.setState({
      downloadStatus: 'idle',
      progress: 0,
      totalBytes: undefined,
      speedBps: undefined,
      error: undefined,
    });
    this.stopPolling();
  }

  async installUpdate() {
    return api.installUpdate();
  }

  getPackageSize = (): { bytes: number; isDelta: boolean } | null => {
    const d = this.state.updateData;
    if (!d?.has_update) return null;
    const deltas = d.deltas && d.deltas.length > 0 ? d.deltas : d.delta ? [d.delta] : [];
    const match = deltas.find(
      (x) => x.base_version === d.current_version && x.url && typeof x.size === 'number' && x.size > 0
    );
    if (match) {
      return { bytes: match.size as number, isDelta: true };
    }
    const files = d.auto_update?.files || [];
    const total = files.reduce((s, f) => s + (f.size || 0), 0);
    if (total > 0) return { bytes: total, isDelta: false };
    return null;
  };

  init() {
    if (storage.getSetting<boolean>('autoCheckUpdate', true)) {
      this.checkUpdate(true);
    }
    this.refreshProgress().then(() => {
      const s = this.state.downloadStatus;
      if (s === 'downloading' || s.startsWith('verifying') || s === 'merging') {
        this.startPolling();
      }
    });
  }
}

export const updateStore = new UpdateStore();
