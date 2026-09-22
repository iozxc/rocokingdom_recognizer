export interface PetItem {
  name: string; // 精灵名称 (后端返回的精灵名字)
  displayName?: string;
  url: string;  // 图标地址
  sprite?: string; // 雪碧图文件名（web 纯前端使用），如 'sprite-1.png'
  col?: number;    // 在雪碧图中的列
  row?: number;    // 在雪碧图中的行
  element?: 'grass' | 'fire' | 'water' | 'electric' | 'normal' | 'ghost' | 'dragon' | 'light' | 'stone'; // 旧字段（英文枚举，用于兜底头像颜色）
  elements?: string[]; // 属性列表（中文），第一个为主属性，如 ['光'] / ['光','火']
  id?: number;
  seq?: number; // 形态序号（同 id 多形态时使用，单形态无）
  rarity?: 'common' | 'rare' | 'epic' | 'legendary';
  trait?: PetTraitInfo | null;
  skills?: PetSkillInfo[];
}

export interface PetTraitInfo {
  id?: string;
  name: string;
  desc?: string;
  glossary?: string[]; // 命中的术语 id（对应 glossary.json）
  icon_url?: string;
}

export interface PetSkillInfo {
  sid: string;
  name: string;
  desc?: string;
  skill_type?: '攻击' | '状态' | '防御' | '其他';
  element?: string;
  damage_kind?: '物理' | '魔法' | '真实' | null;
  energy_cost?: number | null;
  power?: number | null;
  glossary?: string[]; // 命中的术语 id（对应 glossary.json）
  icon_url?: string;
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
  stageNum: number;
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
  /** 纯前端版：候选来源（图像特征 / OCR 文字 / 两者都命中）。 */
  source?: 'feature' | 'ocr' | 'both';
  /** 纯前端版：该候选不在当前地图白名单（仅提示，仍可手动点选）。 */
  out_of_map?: boolean;
}

export interface BatchInitApiRawItem {
  index: number;
  status: 'matched' | 'unmatched';
  candidates?: BatchInitCandidateItem[];
  filename?: string;
  score?: number;
  view_url?: string;
  match_path?: string;
  /** 后端从整图中实际裁剪出的该槽位小图（data URI），用于与图鉴候选并排核对 */
  crop_image?: string;
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
  /** 后端从整图中实际裁剪出的该槽位小图（data URI），用于与图鉴候选并排核对 */
  crop_image?: string;
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
  vote?: 'agree' | 'disagree';
}

export interface Trial {
  key: string; // 'grass' | 'fire' | 'map'
  title: string;
  element: string;
  collection_key: string;
  dev_only: boolean;
  map_list?: string[];
  scene_features?: unknown[];
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
  stage_num: number;
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
export type ThemeMode = 'light' | 'dark';
export type SearchFilterPosition = 'position1' | 'position2';
/** 地图信息栏布局：merged=信息并入 PetGrid 标题区（默认）| separate=顶部独立 StatsBanner 经典版 */
export type StatsLayoutMode = 'merged' | 'separate';

export interface FireSettings {
  agreeRatio?: number; // 火系赞同率阈值 0~1（默认 0）
  showVote?: boolean; // 隐藏投票/赞同率（默认显示）
  atlasMode?: 'community' | 'pokedex'; // 首页图鉴数据源：共创图鉴 / 全图鉴自选
}

export interface AppSettings {
  theme?: ThemeMode; // 'light' 明亮模式 | 'dark' 暗黑模式
  isSoundMuted?: boolean;
  isFABCollapsed?: boolean; // 右下角快捷按钮栏是否收起
  isFilterSwitchCollapsed?: boolean; // 左下角筛选悬浮按钮栏是否收起
  activeStageNum?: number; // 当前选中的试炼关卡编号（图1-3，用于主页面与ScannerApp识别时自动联动）
  scannerPinnedStageNum?: number | null; // ScannerApp 钉住的试炼关卡编号（非 null 时识别后视图不跳回）
  showRecognitionSamples?: boolean; // 首页识别示例截图提示（test1~5）是否显示
  showDuplicatePetHint?: boolean; // 首页批量识别发现疑似重复精灵时是否弹出小提醒（默认开启）
  autoReturnView?: boolean; // 首页批量识别「视角自动归位」：识别完成自动下滚到结果区、确认点亮后回到识别区（默认开启；关闭后识别全程不自动滚动）
  effectLevel?: EffectLevel; // 0: 关闭, 1: 轻微 (默认), 2: 标准, 3: 丰富
  floatingButtonsMode?: FloatingButtonsMode; // 'normal' 正常完整 | 'compact' 紧凑缩小 | 'hidden' 彻底隐藏
  isSimplifiedFABs?: boolean; // 快捷面板是否开启精简模式（隐藏数据管理等次要入口）
  updateMode?: 'auto' | 'full'; // 'auto' 自动增量更新（默认）| 'full' 强制整包更新
  autoCheckUpdate?: boolean; // 启动时是否自动检测更新（默认开启）
  hideUpdateDot?: boolean; // 是否隐藏更新提示红点（默认不隐藏）
  showHints?: boolean; // 启动/退出提示窗口是否显示（默认关闭，首次启动强制显示一次）
  followTopMost?: boolean; // 跟随识别窗口是否默认置顶（默认开启）
  followScannerHotkey?: string; // 全局显示/隐藏跟随识别窗口的快捷键（规范串，如 "Ctrl+Alt+R"）；空串=禁用；仅桌面版生效
  autoWatchScan?: boolean; // 自动模式子开关：自动识别选择界面（默认开启）
  autoWatchMark?: boolean; // 自动模式子开关：自动点亮对战精灵（默认开启）
  autoWatchTickSeconds?: number; // 自动模式后台扫描间隔（秒，默认 0.25，范围 0.2~5）
  gpuAcceleration?: boolean; // 推理是否使用 GPU 加速（默认开启；关闭后强制 CPU，功能一致）
  debugImageCap?: number; // debug 截图保留上限（张），0 = 关闭不保存（默认 0）
  fireSettings?: FireSettings; // 火系徽章试炼专属设置
  showPetSkillHover?: boolean; // petgrid 卡片 hover 时是否展示精灵技能面板（默认开启）
  showHomeScrollbar?: boolean; // 首页自定义滚动条是否显示（默认关闭）
  homeScrollbarWidth?: number; // 首页自定义滚动条宽度 px（默认 10）
  searchFilterPosition?: SearchFilterPosition; // 搜索/筛选位置：position1=统计栏，position2=PetGrid 右上角（默认）
  statsLayoutMode?: StatsLayoutMode; // 地图信息栏布局：merged=并入 PetGrid（默认）| separate=顶部独立统计栏经典版
  [key: string]: unknown;
}

// 极简结构化更新日志（时间线），由远程 version.json 的 changelog 字段提供
export interface UpdateLogItem {
  k?: string; // 分类：新功能 / 重要 / 优化 / 修复 / 网页 / 注意
  t: string; // 一句话说明
}
export interface UpdateLogEntry {
  version: string;
  date?: string;
  tag?: string; // 角标，如 重大 / 推荐
  items: UpdateLogItem[];
}

export interface CheckUpdateResponse {
  has_update: boolean;
  latest_version?: string;
  current_version?: string;
  update_log?: string;
  changelog?: UpdateLogEntry[];
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
  platform?: 'app' | 'web';
}

export interface SubmitFeedbackResponse {
  status?: string;
  message?: string;
  success?: boolean;
}

export interface AdvancedFilterState {
  elements: string[]; // e.g. ['草', '水']
  specialTypes: string[]; // e.g. ['boss', 'multiform']
}

// ---------- 设备授权 ----------
export type AuthStatus = 'pending' | 'waiting' | 'banned' | 'expired' | 'authorized' | 'error' | 'offline';

export interface AuthState {
  status: AuthStatus;
  machine_code: string;
  auth_code: string;
  expire_time: string;
  qq_id: string;
  msg: string;
  error: string;
  is_authorized: boolean;
  offline_badge: boolean;
}
