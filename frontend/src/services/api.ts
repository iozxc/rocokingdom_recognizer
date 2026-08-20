import axios, { AxiosError } from 'axios';
import {
  IconsApiResponse,
  PredictApiResponse,
  PredictApiRawItem,
  PredictResult,
  PredictCandidateItem,
  PetItem,
  BatchInitApiResponse,
  FollowGameStatusResponse,
  FollowRecognizeApiResponse,
  CheckUpdateResponse,
  StartDownloadResponse,
  StopDownloadResponse,
  DeleteDownloadResponse,
  InstallUpdateResponse,
  DownloadProgressResponse,
  DownloadStatus,
  SubmitFeedbackPayload,
  SubmitFeedbackResponse,
} from '../types';
import { FALLBACK_MAPS_DATA } from '../data/mockPets';

const DEFAULT_API_BASE = 'http://127.0.0.1:5000';

export class ApiService {
  private apiBase: string;

  constructor() {
    this.apiBase = localStorage.getItem('roco_api_base') || DEFAULT_API_BASE;
  }

  public getApiBase(): string {
    return this.apiBase;
  }

  public setApiBase(url: string) {
    this.apiBase = url.replace(/\/+$/, '');
    localStorage.setItem('roco_api_base', this.apiBase);
  }

  public resetApiBase() {
    this.apiBase = DEFAULT_API_BASE;
    localStorage.removeItem('roco_api_base');
  }

  // Health / Connection check
  public async checkHealth(): Promise<{ online: boolean; message: string; data?: unknown }> {
    try {
      const res = await axios.get(`${this.apiBase}/icons`, { timeout: 3000 });
      return { online: res.status === 200, message: '后端服务连接正常', data: res.data };
    } catch (err: unknown) {
      const error = err as AxiosError;
      return {
        online: false,
        message: error.message || '无法连接到后端 (http://127.0.0.1:5000)',
      };
    }
  }

  // Fetch all icons for map1, map2, map3
  public async getIcons(): Promise<{
    data: Record<string, { count: number; items: PetItem[] }>;
    isOfflineMock: boolean;
    errorMsg?: string;
  }> {
    try {
      const response = await axios.get<IconsApiResponse>(`${this.apiBase}/icons`, {
        timeout: 4000,
      });

      if (response.data && response.data.status === 'success' && response.data.data) {
        // Map and enrich pet items with display names if possible
        const remoteData = response.data.data;
        const normalized: Record<string, { count: number; items: PetItem[] }> = {};

        ['map1', 'map2', 'map3'].forEach((mapKey) => {
          const mapInfo = remoteData[mapKey] || { count: 0, items: [] };
          const fallbackMap = FALLBACK_MAPS_DATA[mapKey];

          const enrichedItems: PetItem[] = mapInfo.items.map((item, idx) => {
            const fallbackItem = fallbackMap?.items.find((f) => f.name === item.name) || fallbackMap?.items[idx];
            // Format full URL if relative
            let fullUrl = item.url;
            if (fullUrl && !fullUrl.startsWith('http') && !fullUrl.startsWith('data:')) {
              fullUrl = `${this.apiBase}/${fullUrl.replace(/^\//, '')}`;
            }

            return {
              name: item.name,
              url: fullUrl || fallbackItem?.url || '',
              element: fallbackItem?.element || 'grass',
              rarity: fallbackItem?.rarity || 'common',
            };
          });

          normalized[mapKey] = {
            count: mapInfo.count || enrichedItems.length,
            items: enrichedItems,
          };
        });

        return { data: normalized, isOfflineMock: false };
      }

      throw new Error('API 返回数据格式不符合规范');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API getIcons failed, falling back to built-in Roco pet dex:', error.message);
      return {
        data: FALLBACK_MAPS_DATA,
        isOfflineMock: true,
        errorMsg: `无法连接 ${this.apiBase}/icons (${error.code || error.message})，已切换至内置图鉴`,
      };
    }
  }

  // Predict Pet Image (Supports Top-K selection: 1 to 6 candidates)
  public async predictPet(
      imageFile: File | Blob,
      mapNum: number,
      threshold: number = 0.25,
      topK: number = 3
  ): Promise<{ result: PredictResult; isOfflineMock: boolean }> {
    const clampedK = Math.max(1, Math.min(6, Math.round(topK || 3)));
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('map_num', String(mapNum));
    formData.append('threshold', String(threshold));
    formData.append('top_k', String(clampedK));
    formData.append('k', String(clampedK));
    formData.append('max_results', String(clampedK));

    const mapKey = `map${mapNum}`;
    const fallbackList = FALLBACK_MAPS_DATA[mapKey]?.items || [];

    try {
      const response = await axios.post<PredictApiResponse>(
          `${this.apiBase}/predict`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            timeout: 12000,
          }
      );

      if (response.data && response.data.status === 'success' && response.data.data) {
        const rawData = response.data.data;
        const rawList: PredictApiRawItem[] = Array.isArray(rawData) ? rawData : [rawData];

        if (rawList.length === 0) {
          throw new Error('识别接口返回候选列表为空');
        }

        const candidates: PredictCandidateItem[] = rawList.slice(0, clampedK).map((item) => {
          let viewUrl = item.view_url || '';
          if (viewUrl && !viewUrl.startsWith('http') && !viewUrl.startsWith('data:')) {
            viewUrl = `${this.apiBase}/${viewUrl.replace(/^\//, '')}`;
          }

          const matchedPet = fallbackList.find((p) => p.name === item.filename) || {
            name: item.filename,
            url: viewUrl,
            element: 'grass',
          };

          return {
            filename: item.filename,
            score: typeof item.score === 'number' ? Number(item.score.toFixed(4)) : 0.95,
            view_url: viewUrl || matchedPet.url,
            match_path: item.match_path,
            matchedPet,
          };
        });

        const primary = candidates[0];

        return {
          result: {
            filename: primary.filename,
            score: primary.score,
            view_url: primary.view_url,
            match_path: primary.match_path,
            matchedPet: primary.matchedPet,
            candidates,
            selectedCandidateIndex: 0,
            mapNum,
            timestamp: new Date().toISOString(),
          },
          isOfflineMock: false,
        };
      }
      throw new Error('识别接口返回数据异常');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API predictPet failed, generating simulated smart match for demo:', error.message);

      // Offline simulation helper with top-k candidates
      const pets = fallbackList.length > 0 ? fallbackList : [{ name: '烈火战神', url: '', element: 'fire' as const }];
      const shuffled = [...pets].sort(() => 0.5 - Math.random());
      const selectedCount = Math.min(clampedK, shuffled.length);
      const chosenPets = shuffled.slice(0, selectedCount);

      // Descending confidence scores simulation
      const baseScores = [0.9748, 0.8123, 0.7556, 0.6820, 0.5930, 0.5120];
      const candidates: PredictCandidateItem[] = chosenPets.map((pet, idx) => {
        const score = baseScores[idx] || Math.max(0.45, 0.95 - idx * 0.1);
        return {
          filename: pet.name,
          score,
          view_url: pet.url,
          matchedPet: pet,
        };
      });

      const primary = candidates[0];

      return {
        result: {
          filename: primary.filename,
          score: primary.score,
          view_url: primary.view_url,
          matchedPet: primary.matchedPet,
          candidates,
          selectedCandidateIndex: 0,
          mapNum,
          timestamp: new Date().toISOString(),
        },
        isOfflineMock: true,
      };
    }
  }

  // Batch Initialization: Send one full image, backend returns an array of detected pets with candidates and top_k
  public async initBatch(
      imageFile: File | Blob,
      mapNum: number,
      threshold: number = 0.25,
      topK: number = 3
  ): Promise<{ data: BatchInitApiResponse; isOfflineMock: boolean }> {
    const clampedK = Math.max(1, Math.min(6, Math.round(topK || 3)));
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('map', String(mapNum));
    formData.append('map_num', String(mapNum));
    formData.append('threshold', String(threshold));
    formData.append('top_k', String(clampedK));
    formData.append('topk', String(clampedK));
    formData.append('k', String(clampedK));

    try {
      const response = await axios.post<any>(
          `${this.apiBase}/init_batch`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            timeout: 30000,
          }
      );

      const resBody = response.data;
      if (resBody) {
        let rawResults: any[] = [];
        let totalDetected = 0;

        if (Array.isArray(resBody.results)) {
          rawResults = resBody.results;
          totalDetected = resBody.total_detected || rawResults.length;
        } else if (resBody.data && Array.isArray(resBody.data.results)) {
          rawResults = resBody.data.results;
          totalDetected = resBody.data.total_detected || rawResults.length;
        } else if (Array.isArray(resBody.data)) {
          rawResults = resBody.data;
          totalDetected = rawResults.length;
        } else if (Array.isArray(resBody)) {
          rawResults = resBody;
          totalDetected = rawResults.length;
        }

        if (rawResults.length > 0 || resBody.status === 'success') {
          const normalizedResults = rawResults.map((raw: any, idx: number) => {
            // Process candidates if provided
            let candidates: Array<{ filename: string; score: number; view_url: string; match_path?: string }> = [];
            if (Array.isArray(raw.candidates) && raw.candidates.length > 0) {
              candidates = raw.candidates.map((c: any) => {
                const cName = c.filename || c.name || c.label || '';
                let cUrl = c.view_url || c.url || '';
                if (cUrl && !cUrl.startsWith('http') && !cUrl.startsWith('data:')) {
                  cUrl = `${this.apiBase}/${cUrl.replace(/^\//, '')}`;
                }
                const cScore = typeof c.score === 'number' ? c.score : typeof c.confidence === 'number' ? c.confidence : 0.85;
                return {
                  filename: cName,
                  score: cScore,
                  view_url: cUrl,
                  match_path: c.match_path || c.path,
                };
              });
            }

            const primaryCandidate = candidates[0];
            const petName = primaryCandidate?.filename || raw.filename || raw.name || raw.label || raw.pet_name || '';
            const status: 'matched' | 'unmatched' =
                raw.status === 'unmatched' || (!petName && !raw.matched) ? 'unmatched' : 'matched';

            let viewUrl = primaryCandidate?.view_url || raw.view_url || raw.url || '';
            if (viewUrl && !viewUrl.startsWith('http') && !viewUrl.startsWith('data:')) {
              viewUrl = `${this.apiBase}/${viewUrl.replace(/^\//, '')}`;
            }

            const rawScore = primaryCandidate
                ? primaryCandidate.score
                : typeof raw.score === 'number'
                    ? raw.score
                    : typeof raw.confidence === 'number'
                        ? raw.confidence
                        : 0.88;

            return {
              index: typeof raw.index === 'number' ? raw.index : idx,
              status,
              filename: petName,
              score: rawScore,
              view_url: viewUrl,
              match_path: primaryCandidate?.match_path || raw.match_path,
              candidates: candidates.length > 0 ? candidates : undefined,
              reason: raw.reason || (status === 'unmatched' ? '未找到匹配程度足够高的图标' : undefined),
            };
          });

          return {
            data: {
              status: 'success',
              total_detected: totalDetected || normalizedResults.length,
              results: normalizedResults,
            },
            isOfflineMock: false,
          };
        }
      }
      throw new Error('批量初始化接口返回数据格式不符合规范');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API initBatch failed, generating offline simulated detection:', error.message);

      // Simulated batch detection for testing/offline mode
      const mapKey = `map${mapNum}`;
      const pets = FALLBACK_MAPS_DATA[mapKey]?.items || [];
      const totalDetected = Math.max(pets.length, 6);

      const simulatedResults = pets.slice(0, 10).map((pet, idx) => {
        // Occasionally simulate an unmatched item for realistic demonstration
        if (idx === 2) {
          return {
            index: idx,
            status: 'unmatched' as const,
            reason: '未找到匹配程度足够高的图标 (0.18)',
          };
        }

        const score = Number((0.88 + Math.random() * 0.11).toFixed(3));
        const otherPets = pets.filter((p) => p.name !== pet.name);
        const secondPet = otherPets[idx % otherPets.length] || pet;
        const score2 = Math.max(0.2, score - 0.15);

        const candidates = [
          {
            filename: pet.name,
            score,
            view_url: pet.url,
            match_path: `icons/map${mapNum}/${pet.name}`,
          },
          {
            filename: secondPet.name,
            score: Number(score2.toFixed(3)),
            view_url: secondPet.url,
            match_path: `icons/map${mapNum}/${secondPet.name}`,
          },
        ];

        return {
          index: idx,
          status: 'matched' as const,
          filename: pet.name,
          score,
          view_url: pet.url,
          candidates: candidates.slice(0, clampedK),
        };
      });

      return {
        data: {
          status: 'success',
          total_detected: totalDetected,
          results: simulatedResults,
        },
        isOfflineMock: true,
      };
    }
  }

  /**
   * 1. 检查电脑上是否运行并检测到了“洛克王国”游戏窗口
   * GET /game_status
   */
  public async checkGameStatus(): Promise<{
    isRunning: boolean;
    windowTitle?: string;
    windowRect?: { x: number; y: number; width: number; height: number };
    isOfflineMock: boolean;
    errorMsg?: string;
  }> {
    try {
      const response = await axios.get<FollowGameStatusResponse>(`${this.apiBase}/game_status`, {
        timeout: 4000,
      });

      if (response.data && response.data.status === 'success') {
        return {
          isRunning: !!response.data.is_running,
          windowTitle: response.data.window_title,
          windowRect: response.data.window_rect,
          isOfflineMock: false,
        };
      }

      return {
        isRunning: false,
        isOfflineMock: false,
        errorMsg: response.data?.message || '游戏未运行或未检测到“洛克王国”窗口',
      };
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API checkGameStatus failed, using fallback status:', error.message);
      return {
        isRunning: true, // 降级预览模式允许继续演示
        windowTitle: '洛克王国 (模拟环境)',
        windowRect: { x: 100, y: 100, width: 1920, height: 1080 },
        isOfflineMock: true,
        errorMsg: `无法连接 Flask 后端 (/game_status)，当前处于模拟运行状态`,
      };
    }
  }

  /**
   * 2. 跟随识别接口 (建议接口名: /follow_recognize 或 /recognize_follow)
   * 由 Flask 端自动捕获当前置顶/激活的“洛克王国”游戏窗口画面进行定域地图 + 精灵裁剪识别 (0-3个)
   * POST /follow_recognize
   */
  public async followRecognize(params?: any): Promise<{
    data: FollowRecognizeApiResponse;
    isOfflineMock: boolean;
    errorMsg?: string;
  }> {
    const threshold = 0.25;
    const topK = Math.max(1, 3);

    try {
      const response = {
        data:params
      };

      if (response.data && (response.data.status === 'success' || response.data.results)) {
        const rawResults = response.data.results || [];
        const normalizedResults = rawResults.map((raw, idx) => {
          let candidates = raw.candidates || [];
          if (Array.isArray(candidates) && candidates.length > 0) {
            candidates = candidates.map((c) => {
              let cUrl = c.view_url || '';
              if (cUrl && !cUrl.startsWith('http') && !cUrl.startsWith('data:')) {
                cUrl = `${this.apiBase}/${cUrl.replace(/^\//, '')}`;
              }
              return {
                filename: c.filename || '',
                score: typeof c.score === 'number' ? c.score : 0.85,
                view_url: cUrl,
                match_path: c.match_path,
              };
            });
          }

          let viewUrl = raw.view_url || '';
          if (viewUrl && !viewUrl.startsWith('http') && !viewUrl.startsWith('data:')) {
            viewUrl = `${this.apiBase}/${viewUrl.replace(/^\//, '')}`;
          }

          return {
            index: typeof raw.index === 'number' ? raw.index : idx,
            status: raw.status || 'matched',
            filename: raw.filename || (candidates[0]?.filename ?? ''),
            score: typeof raw.score === 'number' ? raw.score : (candidates[0]?.score ?? 0.88),
            view_url: viewUrl || (candidates[0]?.view_url ?? ''),
            match_path: raw.match_path || (candidates[0]?.match_path ?? ''),
            candidates: candidates.slice(0, 3),
            reason: raw.reason,
          };
        });

        return {
          data: {
            status: 'success',
            map_num: response.data.map_num || 1,
            map_name: response.data.map_name || `地图 ${response.data.map_num || 1}`,
            total_detected: normalizedResults.length,
            is_game_running: response.data.is_game_running ?? true,
            screenshot_url: response.data.screenshot_url,
            timestamp: response.data.timestamp || new Date().toLocaleTimeString(),
            results: normalizedResults.slice(0, 3),
          },
          isOfflineMock: false,
        };
      }

      throw new Error(response.data?.message || '返回数据格式不符合规范');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API followRecognize failed, using simulated fallback:', error.message);

      // Offline simulation
      const mapNum = params?.forceMapNum || 1;
      const mapKey = `map${mapNum}`;
      const pets = FALLBACK_MAPS_DATA[mapKey]?.items || [];
      const sampleCount = Math.floor(Math.random() * 3) + 1; // 1 to 3
      const shuffled = [...pets].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, sampleCount);

      const simResults: any[] = selected.map((p, idx) => {
        const score = Number((0.92 + Math.random() * 0.07).toFixed(3));
        const otherPets = pets.filter((op) => op.name !== p.name);
        const cand2 = otherPets[0] || p;
        const cand3 = otherPets[1] || otherPets[0] || p;

        return {
          index: idx,
          status: 'matched',
          filename: p.name,
          score,
          view_url: p.url,
          candidates: [
            { filename: p.name, score, view_url: p.url },
            { filename: cand2.name, score: Number((score - 0.18).toFixed(3)), view_url: cand2.url },
            { filename: cand3.name, score: Number((score - 0.35).toFixed(3)), view_url: cand3.url },
          ],
        };
      });

      return {
        data: {
          status: 'success',
          map_num: mapNum,
          map_name: `地图 ${mapNum}`,
          total_detected: simResults.length,
          is_game_running: true,
          timestamp: new Date().toLocaleTimeString(),
          results: simResults,
        },
        isOfflineMock: true,
        errorMsg: `无法连接 Flask 后端 (/follow_recognize)，已启用本地模拟`,
      };
    }
  }

  // Simulated local download state for development / preview mode
  private simDownloadState: {
    progress: number;
    total_bytes: number;
    speed_bps: number;
    status: DownloadStatus;
    timer: NodeJS.Timeout | null;
    errorMsg?: string;
  } = {
    progress: 0,
    total_bytes: 73400320, // ~70.0 MB
    speed_bps: 0,
    status: 'idle',
    timer: null,
  };

  /**
   * 3. 检查是否有最新版本
   * GET /api/check_update
   */
  public async checkUpdate(): Promise<{
    data: CheckUpdateResponse;
    isOfflineMock: boolean;
    errorMsg?: string;
  }> {
    try {
      const response = await axios.get<CheckUpdateResponse>(
          `${this.apiBase}/api/check_update`,
          { timeout: 5000 }
      );

      if (response.data) {
        return {
          data: response.data,
          isOfflineMock: false,
        };
      }
      throw new Error('检查更新接口返回为空');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API checkUpdate failed, using simulated response:', error.message);

      // 本地离线/开发环境模拟数据，便于即时测试与演示
      return {
        data: {
          has_update: true,
          latest_version: '1.0.0',
          update_log: '1.0.0正式发布版，洛克王国草系徽章图鉴：跟随识别、初始化、单个识别、批量识别',
          mirrors: {
            'Gitee': 'https://gitee.com/iozxc/rocokingdom_recognizer/releases',
            'GitHub': 'https://github.com/iozxc/rocokingdom_recognizer/releases',
          },
          auto_update: {
            base_url: 'https://gitee.com/iozxc/rocokingdom_recognizer/releases/download/v1.0.0/',
            files: [
              {
                name: 'RocoKingdomRecognizer_part.7z.001',
                md5: 'c8042c38c1a3781bdf40d63100456e9b',
              },
              {
                name: 'RocoKingdomRecognizer_part.7z.002',
                md5: '61897e197feaaba1b56606ca0ad767e9',
              },
              {
                name: 'RocoKingdomRecognizer_part.7z.003',
                md5: 'cfac22b59f623d574890e45556a8a6f8',
              },
            ],
          },
        },
        isOfflineMock: true,
        errorMsg: `无法连接更新接口 (${error.code || error.message})，已展示模拟版本信息`,
      };
    }
  }

  /**
   * 4. 发起手动/自动下载更新
   * GET /api/start_download
   */
  public async startDownload(): Promise<{
    data: StartDownloadResponse;
    isOfflineMock: boolean;
  }> {
    try {
      const response = await axios.get<StartDownloadResponse>(
          `${this.apiBase}/api/start_download`,
          { timeout: 5000 }
      );
      if (response.data) {
        return { data: response.data, isOfflineMock: false };
      }
      return { data: { status: 'downloading' }, isOfflineMock: false };
    } catch (err: unknown) {
      const error = err as AxiosError<{ message?: string; status?: string }>;
      if (error.response?.data?.message) {
        return {
          data: {
            status: 'error',
            message: error.response.data.message,
          },
          isOfflineMock: false,
        };
      }
      // 离线/模拟测试模式：模拟下载步进 (字节单位)
      this.simDownloadState.status = 'downloading';
      this.simDownloadState.speed_bps = 2516582.4; // 2.4 MB/s
      if (this.simDownloadState.progress >= this.simDownloadState.total_bytes) {
        this.simDownloadState.progress = 0;
      }
      if (this.simDownloadState.timer) {
        clearInterval(this.simDownloadState.timer);
      }
      this.simDownloadState.timer = setInterval(() => {
        const curStatus = this.simDownloadState.status;
        if (curStatus === 'stopped' || curStatus === 'idle' || curStatus === 'ready' || curStatus === 'error') {
          if (this.simDownloadState.timer) clearInterval(this.simDownloadState.timer);
          return;
        }
        const total = this.simDownloadState.total_bytes;
        if (this.simDownloadState.progress < total * 0.9) {
          this.simDownloadState.progress += 10485760; // +10MB
          this.simDownloadState.speed_bps = 2400000 + Math.random() * 400000;
        } else if (this.simDownloadState.progress < total) {
          this.simDownloadState.progress = total;
          this.simDownloadState.speed_bps = 0;
          this.simDownloadState.status = 'verifying_1';
        } else if (curStatus === 'verifying_1') {
          this.simDownloadState.status = 'verifying_2';
        } else if (curStatus === 'verifying_2') {
          this.simDownloadState.status = 'merging';
        } else if (curStatus === 'merging') {
          this.simDownloadState.status = 'ready';
          if (this.simDownloadState.timer) clearInterval(this.simDownloadState.timer);
        }
      }, 1200);

      return {
        data: { status: 'downloading' },
        isOfflineMock: true,
      };
    }
  }

  /**
   * 5. 暂停下载更新
   * GET /api/stop_download
   */
  public async stopDownload(): Promise<{
    data: StopDownloadResponse;
    isOfflineMock: boolean;
  }> {
    try {
      const response = await axios.get<StopDownloadResponse>(
          `${this.apiBase}/api/stop_download`,
          { timeout: 5000 }
      );
      return { data: response.data || { status: 'stopped' }, isOfflineMock: false };
    } catch (err: unknown) {
      if (this.simDownloadState.timer) {
        clearInterval(this.simDownloadState.timer);
        this.simDownloadState.timer = null;
      }
      this.simDownloadState.status = 'stopped';
      this.simDownloadState.speed_bps = 0;
      return {
        data: { status: 'stopped' },
        isOfflineMock: true,
      };
    }
  }

  /**
   * 6. 删除已下载文件
   * GET /api/delete_download
   */
  public async deleteDownload(): Promise<{
    data: DeleteDownloadResponse;
    isOfflineMock: boolean;
  }> {
    try {
      const response = await axios.get<DeleteDownloadResponse>(
          `${this.apiBase}/api/delete_download`,
          { timeout: 5000 }
      );
      return { data: response.data || { status: 'deleted' }, isOfflineMock: false };
    } catch (err: unknown) {
      if (this.simDownloadState.timer) {
        clearInterval(this.simDownloadState.timer);
        this.simDownloadState.timer = null;
      }
      this.simDownloadState.status = 'idle';
      this.simDownloadState.progress = 0;
      this.simDownloadState.speed_bps = 0;
      return {
        data: { status: 'deleted' },
        isOfflineMock: true,
      };
    }
  }

  /**
   * 7. 提交确认安装更新
   * GET /api/download_progress 或 /api/install_update
   */
  public async installUpdate(): Promise<{
    data: InstallUpdateResponse;
    isOfflineMock: boolean;
  }> {
    try {
      // 尝试调用安装接口，若接到返回即代表请求成功开始安装
      const response = await axios.get<InstallUpdateResponse>(
          `${this.apiBase}/api/install_update`,
          { timeout: 5000 }
      );
      return { data: response.data || { status: 'install' }, isOfflineMock: false };
    } catch (err: unknown) {
      // 也有可能提前把 Kill app 收不到返回，视为成功触发安装
      return {
        data: { status: 'install' },
        isOfflineMock: true,
      };
    }
  }

  /**
   * 8. 获取下载更新进度
   * GET /api/download_progress
   */
  public async getDownloadProgress(): Promise<{
    data: DownloadProgressResponse;
    isOfflineMock: boolean;
  }> {
    try {
      const response = await axios.get<DownloadProgressResponse>(
          `${this.apiBase}/api/download_progress`,
          { timeout: 4000 }
      );
      if (response.data) {
        return { data: response.data, isOfflineMock: false };
      }
      throw new Error('获取下载进度返回为空');
    } catch (err: unknown) {
      return {
        data: {
          progress: this.simDownloadState.progress,
          total_bytes: this.simDownloadState.total_bytes,
          speed_bps: this.simDownloadState.speed_bps,
          status: this.simDownloadState.status,
          error: this.simDownloadState.errorMsg,
        },
        isOfflineMock: true,
      };
    }
  }

  /**
   * 9. 提交用户反馈
   * POST /api/submit_feedback
   */
  public async submitFeedback(payload: SubmitFeedbackPayload): Promise<{
    success: boolean;
    message?: string;
    isOfflineMock: boolean;
  }> {
    try {
      const response = await axios.post<SubmitFeedbackResponse>(
          `${this.apiBase}/api/submit_feedback`,
          payload,
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 6000,
          }
      );

      return {
        success: true,
        message: response.data?.message || '反馈提交成功，感谢您的支持！',
        isOfflineMock: false,
      };
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API submitFeedback failed, handled in fallback mode:', error.message);

      // 本地降级处理：即使离线也返回成功提示，确保用户体验不被网络报错卡死
      return {
        success: true,
        message: '等待后端连接恢复时！',
        isOfflineMock: true,
      };
    }
  }
}

export const api = new ApiService();
