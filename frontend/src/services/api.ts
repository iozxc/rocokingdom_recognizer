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
  TrialsApiResponse,
  FirePokedexApiResponse,
  FirePokedexEntry,
  Trial,
  DataUpdateCheckData,
  DataUpdateStatusData,
  MapObservation,
} from '../types';
import { FALLBACK_MAPS_DATA } from '../data/mockPets';
import { formatPetName } from '../utils/petHelper';

const DEFAULT_API_BASE = 'http://127.0.0.1:5000';

export class ApiService {
  private apiBase: string;

  constructor() {
    this.apiBase = localStorage.getItem('roco_api_base') || this.resolveDefaultApiBase();
  }

  /**
   * 生产环境由 Flask 同源托管（动态端口），直接用当前页面 origin；
   * 开发环境（vite dev server）仍指向固定 5000 后端。
   */
  private resolveDefaultApiBase(): string {
    if (import.meta.env.DEV) return DEFAULT_API_BASE;
    return typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : DEFAULT_API_BASE;
  }

  public getApiBase(): string {
    return this.apiBase;
  }

  public setApiBase(url: string) {
    this.apiBase = url.replace(/\/+$/, '');
    localStorage.setItem('roco_api_base', this.apiBase);
  }

  public resetApiBase() {
    this.apiBase = this.resolveDefaultApiBase();
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

  /** 单次真实窗口截图观测；未知位置/朝向保持 null。 */
  public async observeMap(trial = 'grass'): Promise<MapObservation> {
    const response = await axios.get<{ status: string; data?: MapObservation }>(
      `${this.apiBase}/map_observation`, { params: { trial }, timeout: 15000 },
    );
    return response.data?.data || ({
      source: 'window-image', window_found: false, window_title: '', map_name: null,
      map_num: null, ocr_text: '', confidence: null, screenshot: null,
      position: null, heading: null, wild_pets: [], reason: 'empty-response',
    } as MapObservation);
  }

  /**
   * 获取当前环境可见的徽章试炼列表（打包环境不返回火系试炼）。
   */
  public async getTrials(): Promise<{ trials: Trial[]; isOfflineMock: boolean }> {
    try {
      const response = await axios.get<TrialsApiResponse>(`${this.apiBase}/api/trials`, {
        timeout: 4000,
      });
      if (response.data?.status === 'success' && Array.isArray(response.data.data?.trials)) {
        return { trials: response.data.data.trials, isOfflineMock: false };
      }
      throw new Error('试炼列表接口返回数据格式不符合规范');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API getTrials failed, falling back to local trial list:', error.message);
      return {
        trials: [
          {
            key: 'grass',
            title: '草系徽章试炼',
            element: 'grass',
            collection_key: 'encounteredPets',
            dev_only: false,
          },
          {
            key: 'map',
            title: '地图感知',
            element: 'map',
            collection_key: 'mapEncountered',
            dev_only: true,
          },
        ],
        isOfflineMock: true,
      };
    }
  }

  /**
   * 火系试炼：读取全图鉴精灵列表，供用户自选。
   */
  public async getFireTrialPets(): Promise<{ pets: FirePokedexEntry[]; isOfflineMock: boolean }> {
    try {
      const response = await axios.get<FirePokedexApiResponse>(
          `${this.apiBase}/api/trials/fire/pets`,
          { timeout: 6000 }
      );
      if (response.data?.status === 'success' && Array.isArray(response.data.data?.pets)) {
        return { pets: response.data.data.pets, isOfflineMock: false };
      }
      throw new Error('火系全图鉴接口返回数据格式不符合规范');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API getFireTrialPets failed:', error.message);
      return { pets: [], isOfflineMock: true };
    }
  }

  /**
   * 检测图鉴数据是否需要更新（md5 对比）。
   */
  public async checkDataUpdates(): Promise<DataUpdateCheckData> {
    try {
      const response = await axios.get<{ data?: DataUpdateCheckData }>(
          `${this.apiBase}/api/data_updates/check`,
          { timeout: 15000 }
      );
      if (response.data?.data) {
        return response.data.data;
      }
      throw new Error('数据更新检查接口返回格式异常');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn('API checkDataUpdates failed:', error.message);
      return { has_update: false, updates: [], message: '检查失败' };
    }
  }

  /**
   * 开始异步下载图鉴数据更新。
   */
  public async startDataUpdate(): Promise<DataUpdateStatusData> {
    const response = await axios.post<{ data?: DataUpdateStatusData }>(
        `${this.apiBase}/api/data_updates/download`,
        {},
        { timeout: 5000 }
    );
    return response.data?.data || { state: 'idle', files: [] };
  }

  /**
   * 查询图鉴数据下载进度。
   */
  public async getDataUpdateStatus(): Promise<DataUpdateStatusData> {
    const response = await axios.get<{ data?: DataUpdateStatusData }>(
        `${this.apiBase}/api/data_updates/status`,
        { timeout: 5000 }
    );
    return response.data?.data || { state: 'idle', files: [] };
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

            const elements = Array.isArray(item.elements) && item.elements.length
                ? item.elements
                : (fallbackItem?.elements ?? []);
            return {
              name: item.name,
              id: item.id ?? fallbackItem?.id,
              seq: item.seq ?? fallbackItem?.seq,
              url: fullUrl || fallbackItem?.url || '',
              elements,
              element: fallbackItem?.element || 'grass',
              rarity: fallbackItem?.rarity || 'common',
            };
          });

          // 多形态排序兜底：按 (id 升序, seq 升序, name) 稳定排序，
          // 保证同 id 的多个形态（普通在前、首领在后）顺序固定。
          enrichedItems.sort((a, b) => {
            const idA = a.id ?? Number.MAX_SAFE_INTEGER;
            const idB = b.id ?? Number.MAX_SAFE_INTEGER;
            if (idA !== idB) return idA - idB;
            const seqA = a.seq ?? 0;
            const seqB = b.seq ?? 0;
            if (seqA !== seqB) return seqA - seqB;
            return (a.name || '').localeCompare(b.name || '', 'zh');
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
      // 生产环境离线返回空图鉴（首页为空白），开发环境保留内置图鉴兜底
      const isProd = import.meta.env.PROD;
      console.warn('API getIcons failed:', error.message);
      return {
        data: isProd ? {} : FALLBACK_MAPS_DATA,
        isOfflineMock: !isProd,
        errorMsg: isProd
            ? `无法连接 ${this.apiBase}/icons (${error.code || error.message})，图鉴暂为空`
            : `无法连接 ${this.apiBase}/icons (${error.code || error.message})，已切换至内置图鉴`,
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

          // 后端返回的 item.filename 带 id 与形态序号（如 064_04_蹦蹦草_象牙球.png），
          // 这里用剥离序号后的展示名与图鉴列表匹配，避免因序号不同而匹配失败。
          const displayName = formatPetName(item.filename);
          const matchedPet = fallbackList.find((p) => p.name === displayName) || {
            name: displayName,
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
            match_path: `icons/${pet.name}`,
          },
          {
            filename: secondPet.name,
            score: Number(score2.toFixed(3)),
            view_url: secondPet.url,
            match_path: `icons/${secondPet.name}`,
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
   * 2. 跟随识别接口 (HTTP GET /api/recognize/<map_num> 或 /api/recognize)
   * 由 Flask 后端自动捕获当前游戏窗口画面进行定域地图 + 精灵裁剪识别 (0-3个)
   * GET /api/recognize/<map_num> 或 GET /api/recognize
   */
  public async followRecognize(mapNumOrParams?: number | any): Promise<{
    data: FollowRecognizeApiResponse;
    isOfflineMock: boolean;
    errorMsg?: string;
  }> {
    let targetMapNum: number | undefined = undefined;
    if (typeof mapNumOrParams === 'number' && mapNumOrParams > 0) {
      targetMapNum = mapNumOrParams;
    } else if (mapNumOrParams && typeof mapNumOrParams === 'object' && mapNumOrParams.map_num) {
      targetMapNum = Number(mapNumOrParams.map_num);
    }

    const url = targetMapNum
        ? `${this.apiBase}/api/recognize/${targetMapNum}`
        : `${this.apiBase}/api/recognize`;

    try {
      let rawResponseData: any = null;

      // Check if params were directly passed as an existing response object
      if (mapNumOrParams && typeof mapNumOrParams === 'object' && (mapNumOrParams.results || mapNumOrParams.status === 'success')) {
        rawResponseData = mapNumOrParams;
      } else {
        const response = await axios.get<any>(url, {
          timeout: 15000,
        });
        rawResponseData = response.data;
      }

      const body = rawResponseData?.data || rawResponseData;

      if (body && (body.status === 'success' || Array.isArray(body.results) || Array.isArray(body.data))) {
        const rawResults = Array.isArray(body.results)
            ? body.results
            : Array.isArray(body.data)
                ? body.data
                : [];

        const normalizedResults = rawResults.map((raw: any, idx: number) => {
          let candidates = raw.candidates || [];
          if (Array.isArray(candidates) && candidates.length > 0) {
            candidates = candidates.map((c: any) => {
              let cUrl = c.view_url || c.url || '';
              if (cUrl && !cUrl.startsWith('http') && !cUrl.startsWith('data:')) {
                cUrl = `${this.apiBase}/${cUrl.replace(/^\//, '')}`;
              }
              return {
                filename: c.filename || c.name || '',
                score: typeof c.score === 'number' ? c.score : typeof c.confidence === 'number' ? c.confidence : 0.85,
                view_url: cUrl,
                match_path: c.match_path || c.path,
              };
            });
          }

          let viewUrl = raw.view_url || raw.url || '';
          if (viewUrl && !viewUrl.startsWith('http') && !viewUrl.startsWith('data:')) {
            viewUrl = `${this.apiBase}/${viewUrl.replace(/^\//, '')}`;
          }

          const topCand = candidates[0];
          const petName = raw.filename || raw.name || raw.pet_name || topCand?.filename || '';

          return {
            index: typeof raw.index === 'number' ? raw.index : idx,
            status: raw.status || 'matched',
            filename: petName,
            score: typeof raw.score === 'number' ? raw.score : typeof raw.confidence === 'number' ? raw.confidence : (topCand?.score ?? 0.88),
            view_url: viewUrl || (topCand?.view_url ?? ''),
            match_path: raw.match_path || (topCand?.match_path ?? ''),
            candidates: candidates,
            reason: raw.reason,
          };
        });

        const effectiveMapNum =
            body.map_num !== undefined && body.map_num !== null
                ? Number(body.map_num)
                : (targetMapNum || 1);

        return {
          data: {
            status: 'success',
            map_num: effectiveMapNum,
            map_name: body.map_name || `地图 ${effectiveMapNum}`,
            total_detected: normalizedResults.length,
            is_game_running: body.is_game_running ?? true,
            screenshot_url: body.screenshot_url,
            timestamp: body.timestamp || new Date().toLocaleTimeString(),
            results: normalizedResults,
          },
          isOfflineMock: false,
        };
      }

      throw new Error(body?.message || '返回数据格式不符合规范');
    } catch (err: unknown) {
      const error = err as AxiosError;
      console.warn(`API GET ${url} failed, using simulated fallback:`, error.message);

      // Offline simulation fallback
      const mapNum = targetMapNum || 1;
      const mapKey = `map${mapNum}`;
      const pets = FALLBACK_MAPS_DATA[mapKey]?.items || [];
      const sampleCount = Math.floor(Math.random() * 2) + 2; // 2 to 3
      const shuffled = [...pets].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, sampleCount);

      const simResults: any[] = selected.map((p, idx) => {
        const score = Number((0.92 + Math.random() * 0.07).toFixed(3));
        const otherPets = pets.filter((op) => op.name !== p.name);
        const candidates = [
          { filename: p.name, score, view_url: p.url },
          ...otherPets.slice(0, 5).map((op, opIdx) => ({
            filename: op.name,
            score: Number(Math.max(0.1, score - (opIdx + 1) * 0.12 - Math.random() * 0.05).toFixed(3)),
            view_url: op.url,
          })),
        ];

        return {
          index: idx,
          status: 'matched',
          filename: p.name,
          score,
          view_url: p.url,
          candidates,
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
        errorMsg: `无法连接 Flask 后端 (${url})，已启用本地模拟`,
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
          current_version: '0.0.0',
          update_log: '1.0.0正式发布版，洛克王国徽章图鉴：跟随识别、初始化、单个识别、批量识别',
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
                size: 94371840,
              },
              {
                name: 'RocoKingdomRecognizer_part.7z.002',
                md5: '61897e197feaaba1b56606ca0ad767e9',
                size: 94371840,
              },
              {
                name: 'RocoKingdomRecognizer_part.7z.003',
                md5: 'cfac22b59f623d574890e45556a8a6f8',
                size: 26214400,
              },
            ],
          },
          delta: {
            base_version: '0.0.0',
            url: 'https://gitee.com/iozxc/rocokingdom_recognizer/releases/download/v1.0.0/RocoKingdomRecognizer_delta.7z',
            md5: 'c8042c38c1a3781bdf40d63100456e9b',
            size: 1024 * 1024,
          },
          deltas: [
            {
              base_version: '0.0.0',
              url: 'https://gitee.com/iozxc/rocokingdom_recognizer/releases/download/v1.0.0/RocoKingdomRecognizer_delta_0.0.0.7z',
              md5: 'c8042c38c1a3781bdf40d63100456e9b',
              size: 1024 * 1024,
            },
          ],
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
  public async startDownload(mode: 'auto' | 'full' = 'auto'): Promise<{
    data: StartDownloadResponse;
    isOfflineMock: boolean;
  }> {
    try {
      const response = await axios.get<StartDownloadResponse>(
          `${this.apiBase}/api/start_download?mode=${mode}`,
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
      // 模拟：增量约 20MB，整包约 210MB
      this.simDownloadState.total_bytes = mode === 'full' ? 210 * 1024 * 1024 : 20 * 1024 * 1024;
      this.simDownloadState.progress = 0;
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
   * GET /api/apply_update
   */
  public async installUpdate(): Promise<{
    data: InstallUpdateResponse;
    isOfflineMock: boolean;
  }> {
    try {
      // 尝试调用安装接口，若接到返回即代表请求成功开始安装
      const response = await axios.get<InstallUpdateResponse>(
          `${this.apiBase}/api/apply_update`,
          { timeout: 5000 }
      );
      return { data: response.data || { status: 'install' }, isOfflineMock: false };
    } catch (err: unknown) {
      // 安装成功时会强制退出进程，可能收不到返回，视为成功触发安装
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
   * 8.5 实测下载速度（用于预估更新时间）
   * GET /api/speed_test
   */
  public async speedTest(): Promise<{
    data: { status: string; speed_bps?: number; tested_bytes?: number; duration?: number; message?: string };
    isOfflineMock: boolean;
  }> {
    try {
      const response = await axios.get(
          `${this.apiBase}/api/speed_test`,
          { timeout: 20000 }
      );
      return { data: response.data, isOfflineMock: false };
    } catch (err: unknown) {
      // 离线模拟：给一个约 2MB/s 的模拟速度
      return {
        data: { status: 'success', speed_bps: 2 * 1024 * 1024 },
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

  /**
   * 人工修正回流：把「识别到的名字 -> 用户修正后的正确名」上报，
   * 写入 OCR 纠错表，后续同类误识会被自动纠正。
   */
  public async submitOcrCorrection(
      wrong: string, right: string, kind: 'word' | 'char' = 'word'
  ): Promise<{ success: boolean }> {
    if (!wrong || !right || wrong === right) {
      return { success: false };
    }
    try {
      await axios.post(
          `${this.apiBase}/api/ocr_correction`,
          { wrong, right, kind },
          { timeout: 4000 }
      );
      return { success: true };
    } catch (err: unknown) {
      console.warn('API submitOcrCorrection failed:', (err as AxiosError).message);
      return { success: false };
    }
  }

  /** 获取远程存储数据 (roco_user_data.json) */
  public async getStorageRemote(): Promise<Record<string, any> | null> {
    try {
      const res = await axios.get<Record<string, any>>(`${this.apiBase}/api/storage/0`, {
        timeout: 4000,
      });
      return res.data;
    } catch {
      return null;
    }
  }

  /** 保存数据到远程存储 (roco_user_data.json) */
  public async saveStorageRemote(payload: Record<string, any>): Promise<{ success: boolean; version?: number }> {
    try {
      const res = await axios.post<{ version?: number }>(`${this.apiBase}/api/storage`, payload, {
        timeout: 5000,
      });
      return { success: true, version: res.data?.version };
    } catch (err: unknown) {
      console.warn('API saveStorageRemote failed:', (err as AxiosError).message);
      return { success: false };
    }
  }

  /** 获取地图专用存储数据 (roco_user_mapdata.json) */
  public async getMapStorageRemote(): Promise<Record<string, any> | null> {
    try {
      const res = await axios.get<Record<string, any>>(`${this.apiBase}/api/map_storage/0`, {
        timeout: 4000,
      });
      return res.data;
    } catch {
      return null;
    }
  }

  /** 保存地图专用存储数据到远程 (roco_user_mapdata.json) */
  public async saveMapStorageRemote(payload: Record<string, any>): Promise<{ success: boolean; version?: number }> {
    try {
      const res = await axios.post<{ version?: number }>(`${this.apiBase}/api/map_storage`, payload, {
        timeout: 5000,
      });
      return { success: true, version: res.data?.version };
    } catch (err: unknown) {
      console.warn('API saveMapStorageRemote failed:', (err as AxiosError).message);
      return { success: false };
    }
  }

}

export const api = new ApiService();
