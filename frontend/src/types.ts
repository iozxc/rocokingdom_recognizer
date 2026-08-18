export interface PetItem {
  name: string; // 精灵名称 (后端返回的精灵名字)
  url: string;  // 图标地址
  element?: 'grass' | 'fire' | 'water' | 'electric' | 'normal' | 'ghost' | 'dragon' | 'light' | 'stone';
  id?: number;
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

export interface AppSettings {
  isSoundMuted?: boolean;
  isFABCollapsed?: boolean; // 右下角快捷按钮栏是否收起
  isFilterSwitchCollapsed?: boolean; // 左下角筛选悬浮按钮栏是否收起
  [key: string]: unknown;
}

export interface CheckUpdateResponse {
  has_update: boolean;
  latest_version?: string;
  update_log?: string;
  mirrors?: Record<string, string>;
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