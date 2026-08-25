export interface PetItem {
  name: string; // 精灵名称 (后端返回的精灵名字)
  displayName?: string;
  url: string;  // 图标地址
  element?: 'grass' | 'fire' | 'water' | 'electric' | 'normal' | 'ghost' | 'dragon' | 'light' | 'stone'; // 旧字段（英文枚举，用于兜底头像颜色）
  elements?: string[]; // 属性列表（中文），第一个为主属性，如 ['光'] / ['光','火']
  id?: number;
  seq?: number; // 形态序号（同 id 多形态时使用，单形态无）
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
}

export interface MapData {
  count: number;
  items: PetItem[];
}

export interface IconsApiResponse {
  status: 'success' | 'error';
  data: {
    map1: MapData;
    map2: MapData;
    map3: MapData;
    [key: string]: MapData;
  };
  message?: string;
}

export interface PredictCandidateItem {
  filename: string;
  score: number;
  view_url: string;
  match_path?: string;
  matchedPet?: PetItem;
}

export interface PredictResult {
  filename: string;
  score: number;
  view_url: string;
  match_path?: string;
  matchedPet?: PetItem;
  candidates?: PredictCandidateItem[];
  selectedCandidateIndex?: number;
  mapNum: number;
  timestamp: string;
}

export interface PredictApiRawItem {
  filename: string;
  score: number;
  view_url: string;
  match_path?: string;
}

export interface PredictApiResponse {
  status: 'success' | 'error';
  count?: number;
  data: PredictApiRawItem | PredictApiRawItem[];
  message?: string;
}

export interface BatchInitCandidateItem {
  filename: string;
  score: number;
  view_url: string;
  match_path?: string;
  matchedPet?: PetItem;
}

export interface BatchInitApiRawItem {
  index: number;
  status: 'matched' | 'unmatched';
  candidates?: BatchInitCandidateItem[];
  filename?: string;
  score?: number;
  view_url?: string;
  match_path?: string;
  reason?: string;
}

export interface BatchInitApiResponse {
  status: 'success' | 'error';
  total_detected: number;
  results: BatchInitApiRawItem[];
  message?: string;
}

export interface BatchInitReviewItem {
  index: number;
  status: 'matched' | 'unmatched';
  candidates?: BatchInitCandidateItem[];
  selectedCandidateIndex?: number;
  filename?: string;
  score?: number;
  view_url?: string;
  match_path?: string;
  reason?: string;
  matchedPet?: PetItem;
  isChecked: boolean; // 是否勾选为“对的”并准备批量遇见
  isManuallyEdited?: boolean; // 是否经过用户手动纠错
  isAlreadyEncountered?: boolean; // 之前是否已经遇见并在图鉴中
}

export interface EncounterRecord {
  key: string; // `${mapId}_${filename}`
  mapId: string;
  filename: string;
  encountered: boolean;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  note?: string;
}

export interface Trial {
  key: string; // 'grass' | 'fire'
  title: string;
  element: string;
  collection_key: string;
  dev_only: boolean;
  map_list?: string[];
  scene_features?: unknown[];
  supports_recognition?: boolean;
  pets_source?: string;
  maps?: TrialMap[];
}

export interface TrialMap {
  id: string;
  num: number;
  name: string;
  description: string;
  themeColor: string;
  bgGradient: string;
  badgeBg: string;
  iconName: string;
}

export interface TrialsApiResponse {
  status: 'success' | 'error';
  data: {
    trials: Trial[];
  };
  message?: string;
}

export interface FirePokedexEntry {
  id: number;
  name: string;
  url?: string;
  seq?: number; // 形态序号
  elements?: string[]; // 属性列表（中文），第一个为主属性
}

export interface FirePokedexApiResponse {
  status: 'success' | 'error';
  data: {
    pets: FirePokedexEntry[];
    count: number;
  };
  message?: string;
}

export interface MapConfig {
  id: string; // 'map1', 'map2', 'map3'
  num: number; // 1, 2, 3
  name: string;
  description: string;
  themeColor: string;
  bgGradient: string;
  badgeBg: string;
  iconName: string;
}

export interface FollowGameStatusResponse {
  status: 'success' | 'error';
  is_running: boolean;
  window_found: boolean;
  window_title?: string;
  window_rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  message?: string;
}

export interface FollowRecognizeApiRawItem {
  index: number;
  status: 'matched' | 'unmatched';
  filename?: string;
  score?: number;
  view_url?: string;
  match_path?: string;
  reason?: string;
  candidates?: BatchInitCandidateItem[];
}

export interface FollowRecognizeApiResponse {
  status: 'success' | 'error';
  map_num: number;
  map_name?: string;
  total_detected: number;
  is_game_running: boolean;
  screenshot_url?: string;
  timestamp?: string;
  results: FollowRecognizeApiRawItem[];
  message?: string;
}

export type EffectLevel = 0 | 1 | 2 | 3;
export type FloatingButtonsMode = 'normal' | 'compact' | 'hidden';
export type CaptureMode = 'hwnd' | 'grab';

export interface AppSettings {
  isSoundMuted?: boolean;
  isFABCollapsed?: boolean; // 右下角快捷按钮栏是否收起
  isFilterSwitchCollapsed?: boolean; // 左下角筛选悬浮按钮栏是否收起
  activeMapNum?: number; // 当前选中的地图编号（用于主页面与ScannerApp识别时自动联动）
  scannerPinnedMapNum?: number | null; // ScannerApp 钉住的地图编号（非 null 时识别后视图不跳回）
  showRecognitionSamples?: boolean; // 首页识别示例截图提示（test1~5）是否显示
  effectLevel?: EffectLevel; // 0: 关闭, 1: 轻微 (默认), 2: 标准, 3: 丰富
  floatingButtonsMode?: FloatingButtonsMode; // 'normal' 正常完整 | 'compact' 紧凑缩小 | 'hidden' 彻底隐藏
  updateMode?: 'auto' | 'full'; // 'auto' 自动增量更新（默认）| 'full' 强制整包更新
  autoCheckUpdate?: boolean; // 启动时是否自动检测更新（默认开启）
  hideUpdateDot?: boolean; // 是否隐藏更新提示红点（默认不隐藏）
  showHints?: boolean; // 启动/退出提示窗口是否显示（默认显示）
  [key: string]: unknown;
}

export interface CheckUpdateResponse {
  has_update: boolean;
  latest_version?: string;
  current_version?: string;
  update_log?: string;
  mirrors?: Record<string, string>;
  auto_update?: {
    base_url?: string;
    files?: Array<{
      name: string;
      md5: string;
      size?: number;
    }>;
  };
  delta?: {
    base_version?: string;
    url?: string;
    md5?: string;
    size?: number;
  };
  deltas?: Array<{
    base_version?: string;
    url?: string;
    md5?: string;
    size?: number;
  }>;
}

export interface DataUpdateFileInfo {
  name: string;
  md5?: string;
  url?: string;
  size?: number;
  status?: 'missing' | 'changed' | 'pending' | 'downloading' | 'done' | 'error';
  progress?: number;
  error?: string | null;
}

export interface DataUpdateCheckData {
  has_update: boolean;
  updates: DataUpdateFileInfo[];
  message?: string;
}

export interface DataUpdateStatusData {
  state: 'idle' | 'running' | 'done' | 'error';
  files: DataUpdateFileInfo[];
  message?: string;
}

export type DownloadStatus =
    | 'idle'
    | 'downloading'
    | 'paused'
    | 'stopped'
    | 'merging'
    | 'ready'
    | 'error'
    | 'install'
    | string;

export interface StartDownloadResponse {
  status: 'downloading' | 'started' | 'error' | string;
  message?: string;
}

export interface StopDownloadResponse {
  status: 'stopped' | 'error' | string;
  message?: string;
}

export interface DeleteDownloadResponse {
  status: 'deleted' | 'idle' | 'error' | string;
  message?: string;
}

export interface InstallUpdateResponse {
  status: 'install' | 'success' | 'error' | string;
  message?: string;
}

export interface DownloadProgressResponse {
  progress: number; // 已下载字节数 (bytes) 或 进度值
  total_bytes?: number; // 总字节数 (bytes)
  speed_bps?: number; // 下载速度 (字节/秒 bytes/sec)
  status: DownloadStatus;
  error?: string;
}

export interface SubmitFeedbackPayload {
  type: string;
  content: string;
  contact?: string;
}

export interface SubmitFeedbackResponse {
  status?: string;
  message?: string;
  success?: boolean;
}
