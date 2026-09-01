import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bird,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  FastForward,
  Flame,
  FlaskConical,
  Flower2,
  Footprints,
  History,
  Layers,
  MapPin,
  Navigation,
  Palette,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  Shield,
  Sliders,
  Sparkles,
  Square,
  Star,
  Trash2,
  Volume2,
  Wand2,
  ZoomIn,
} from 'lucide-react';
import { MapConfig } from '../../types';
import { getElementColor } from '../../utils/elements';
import { sound } from '../../services/sound';
import { api } from '../../services/api';
import { Header } from '../Header';
import { AuthBadge } from '../AuthBadge';
import { UserManualModal } from '../UserManualModal';
import { AIRWALL_POLYGON_L13, drawSmoothClosedPolygon, isPointInPolygon } from '../../data/mapAirwall';

interface MapAwarenessProps {
  maps: MapConfig[];
  onBack: () => void;
  isSoundMuted?: boolean;
  onToggleSound?: () => void;
  onOpenFeedback?: () => void;
  onOpenUpdate?: () => void;
  onOpenSettings?: () => void;
}

interface Vec2 {
  x: number;
  y: number;
}

interface PathNode {
  x: number;
  y: number;
  heading: number;
  timestamp: number;
}

interface WildPet {
  id: number;
  name: string;
  element: string;
  x: number;
  y: number;
  shiny: boolean;
  pollution: boolean;
  sound: boolean;
  collected: boolean;
}

type PoiType =
  | 'source'
  | 'cauldron'
  | 'guard'
  | 'nest_guard'
  | 'owl_star_blue'
  | 'owl_star_yellow';

interface Poi {
  id: string;
  name: string;
  type: PoiType;
  x: number;
  y: number;
  defaultOn: boolean;
  collected: boolean;
}

interface LayerState {
  poi: boolean;
  rarePoi: boolean;
  wild: boolean;
  seeds: boolean;
  collect: boolean;
  fogOfWar: boolean; // 未涉足区域蒙版
  showPath: boolean; // 轨迹图
}

export interface FogStyle {
  color: string; // 迷雾颜色 HEX, e.g. '#334155'
  opacity: number; // 迷雾不透明度 0.1 ~ 0.95
  clearRadius: number; // 自定义视野与去迷雾光圈半径 (180 ~ 800)
}

export type PathLineStyle = 'dashed' | 'solid' | 'dotted';

export type MapTheme = 'classic' | 'real_hd';

export type PlayerIconType =
  | 'crystal_blue' // 洛克能量水晶 (蓝金)
  | 'crystal_gold' // 曜日烈阳 (纯金)
  | 'crystal_ruby' // 赤焰红宝石 (红白)
  | 'crystal_emerald' // 翡翠精灵 (绿白)
  | 'crystal_purple' // 暗夜紫曜 (紫白)
  | 'target_ring' // 准星雷达环
  | 'star_badge'; // 王国星辉徽章

export interface PathStyle {
  color: string; // 路径颜色 HEX, e.g. '#38BDF8'
  lineStyle: PathLineStyle; // 虚线 / 实线 / 点线
  lineWidth: number; // 线条粗细 1 ~ 8
  glow: boolean; // 是否开启发光光晕
}

// 统一逻辑世界坐标：8192 x 8192（与 Level 13 32x32 瓦片 256px 对齐）
const WORLD_W = 8192;
const WORLD_H = 8192;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 5.0;
const MAP_LAYERS_KEY = 'roco_map_layers_v2';
const MAP_FOG_REVEALED_KEY = 'roco_map_revealed_v1';
const MAP_PATH_KEY = 'roco_map_path_history_v1';
const MAP_FOG_STYLE_KEY = 'roco_map_fog_style_v1';
const MAP_PATH_STYLE_KEY = 'roco_map_path_style_v1';
const MAP_THEME_KEY = 'roco_map_theme_v1';
const MAP_PLAYER_ICON_KEY = 'roco_map_player_icon_v1';
const OVERLAY_URL = './mapdata/over.png';
const DEFAULT_CLEAR_RADIUS = 360; // 默认解锁迷雾半径
const MAX_TELEPORT_DISTANCE = 600; // 传送/大跨度位移判定阈值（单位像素，超过则断开连线不绘制直线）

const DEFAULT_FOG_STYLE: FogStyle = {
  color: '#334155',
  opacity: 0.45,
  clearRadius: DEFAULT_CLEAR_RADIUS,
};

const DEFAULT_PATH_STYLE: PathStyle = {
  color: '#38BDF8',
  lineStyle: 'solid',
  lineWidth: 4,
  glow: true,
};

const PLAYER_ICON_PRESETS: { id: PlayerIconType; label: string; color: string; desc: string }[] = [
  { id: 'crystal_blue', label: '能量晶核', color: '#2563EB', desc: '洛克经典天蓝与金芒' },
  { id: 'crystal_gold', label: '曜日烈阳', color: '#EAB308', desc: '耀眼纯金星曜辉光' },
  { id: 'crystal_ruby', label: '赤炎红宝', color: '#EF4444', desc: '醒目烈焰绯红能量' },
  { id: 'crystal_emerald', label: '翡翠灵风', color: '#10B981', desc: '清新荧绿自然光环' },
  { id: 'crystal_purple', label: '暗夜紫曜', color: '#8B5CF6', desc: '神秘幻魅紫晶信标' },
  { id: 'target_ring', label: '战术准星', color: '#06B6D4', desc: '科技感全景准星环' },
  { id: 'star_badge', label: '王国星徽', color: '#F59E0B', desc: '洛克专属五星微标' },
];

const FOG_COLOR_PRESETS = [
  { label: '暗蓝灰', value: '#334155' },
  { label: '玄夜黑', value: '#0f172a' },
  { label: '晨雾白', value: '#94a3b8' },
  { label: '深海蓝', value: '#1e3a8a' },
  { label: '神秘紫', value: '#4c1d95' },
];

const PATH_COLOR_PRESETS = [
  { label: '天蓝色', value: '#38BDF8' },
  { label: '曜金黄', value: '#FACC15' },
  { label: '荧光绿', value: '#4ADE80' },
  { label: '烈焰红', value: '#F87171' },
  { label: '幻魅紫', value: '#C084FC' },
  { label: '纯雪白', value: '#F8FAFC' },
];

// 分级 LOD 配置：
// Level 11: 8x8 (1016..1023), count = 8, step in world = 1024px
// Level 12: 16x16 (2032..2047), count = 16, step in world = 512px
// Level 13: 32x32 (4064..4095), count = 32, step in world = 256px
const LOD_LEVELS = [
  { level: 11, minX: 1016, minY: 1016, count: 8, tileWorldSize: 1024, minZoom: 0, maxZoom: 0.45 },
  { level: 12, minX: 2032, minY: 2032, count: 16, tileWorldSize: 512, minZoom: 0.45, maxZoom: 1.0 },
  { level: 13, minX: 4064, minY: 4064, count: 32, tileWorldSize: 256, minZoom: 1.0, maxZoom: 99 },
];

function getLodForZoom(zoom: number) {
  for (let i = LOD_LEVELS.length - 1; i >= 0; i--) {
    if (zoom >= LOD_LEVELS[i].minZoom) {
      return LOD_LEVELS[i];
    }
  }
  return LOD_LEVELS[0];
}

const DEFAULT_LAYERS: LayerState = {
  poi: true,
  rarePoi: false,
  wild: true,
  seeds: false,
  collect: false,
  fogOfWar: false,
  showPath: true,
};

const POI_META: Record<
  PoiType,
  { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  source: { label: '魔力之源', color: '#3B82F6', Icon: Sparkles },
  cauldron: { label: '炼金釜', color: '#A855F7', Icon: FlaskConical },
  guard: { label: '守护地', color: '#E4A11B', Icon: Shield },
  nest_guard: { label: '眠枭庇护所', color: '#7E5BD8', Icon: Compass },
  owl_star_blue: { label: '蓝眠枭之星', color: '#38BDF8', Icon: Star },
  owl_star_yellow: { label: '黄眠枭之星', color: '#FACC15', Icon: Star },
};

const INITIAL_POIS: Poi[] = [
  { id: 'source1', name: '魔力之源', type: 'source', x: 2320, y: 1860, defaultOn: true, collected: false },
  { id: 'source2', name: '魔力之源', type: 'source', x: 6160, y: 5180, defaultOn: true, collected: false },
  { id: 'cauldron1', name: '炼金釜', type: 'cauldron', x: 5260, y: 2340, defaultOn: true, collected: false },
  { id: 'cauldron2', name: '炼金釜', type: 'cauldron', x: 2460, y: 5040, defaultOn: true, collected: false },
  { id: 'guard1', name: '守护地', type: 'guard', x: 4980, y: 4900, defaultOn: false, collected: false },
  { id: 'nestguard1', name: '眠枭庇护所', type: 'nest_guard', x: 3720, y: 3620, defaultOn: false, collected: false },
  { id: 'nestguard2', name: '眠枭庇护所', type: 'nest_guard', x: 5380, y: 3760, defaultOn: false, collected: false },
  { id: 'owlblue1', name: '蓝眠枭之星', type: 'owl_star_blue', x: 2560, y: 6300, defaultOn: false, collected: true },
  { id: 'owlyellow1', name: '黄眠枭之星', type: 'owl_star_yellow', x: 6720, y: 2300, defaultOn: false, collected: false },
  { id: 'owlyellow2', name: '黄眠枭之星', type: 'owl_star_yellow', x: 4820, y: 6400, defaultOn: false, collected: true },
];

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function clampView(view: { cx: number; cy: number; zoom: number }, size: Vec2) {
  const halfW = Math.min(WORLD_W / 2, size.x / (2 * view.zoom));
  const halfH = Math.min(WORLD_H / 2, size.y / (2 * view.zoom));
  return {
    ...view,
    cx: clamp(view.cx, halfW, WORLD_W - halfW),
    cy: clamp(view.cy, halfH, WORLD_H - halfH),
  };
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hexToRgba(hex: string, alpha: number) {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map((char) => char + char).join('');
  }
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const MapAwareness: React.FC<MapAwarenessProps> = ({
  maps,
  onBack,
  isSoundMuted = false,
  onToggleSound,
  onOpenFeedback,
  onOpenUpdate,
  onOpenSettings,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerSize, setContainerSize] = useState<Vec2>({ x: 960, y: 560 });
  const [view, setView] = useState<{ cx: number; cy: number; zoom: number }>({
    cx: WORLD_W / 2,
    cy: WORLD_H / 2,
    zoom: 0.18,
  });
  const viewRef = useRef(view);
  viewRef.current = view;

  // 玩家实时位置与朝向
  const [player, setPlayer] = useState<{ pos: Vec2; heading: number }>({
    pos: { x: 4096, y: 4096 },
    heading: 0,
  });
  const playerRef = useRef(player);
  playerRef.current = player;

  // 后端实时定位状态提示消息
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusMsgDismissed, setStatusMsgDismissed] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);

  // 移动轨迹历史（路径图）
  const [pathHistory, setPathHistory] = useState<PathNode[]>(() => {
    try {
      const raw = localStorage.getItem(MAP_PATH_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });
  const pathHistoryRef = useRef(pathHistory);
  pathHistoryRef.current = pathHistory;

  // 已探索解锁区域的点位列表（用于在蒙版中擦除打孔）
  const [revealedCircles, setRevealedCircles] = useState<Vec2[]>(() => {
    try {
      const raw = localStorage.getItem(MAP_FOG_REVEALED_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [{ x: 4096, y: 4096 }];
  });
  const revealedCirclesRef = useRef(revealedCircles);
  revealedCirclesRef.current = revealedCircles;

  const [pets] = useState<WildPet[]>([]);
  const [layers, setLayers] = useState<LayerState>(() => {
    try {
      const raw = localStorage.getItem(MAP_LAYERS_KEY);
      if (raw) return { ...DEFAULT_LAYERS, ...JSON.parse(raw) };
    } catch {
      // 忽略读取失败
    }
    return DEFAULT_LAYERS;
  });
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // 自定义迷雾与路径样式
  const [fogStyle, setFogStyle] = useState<FogStyle>(() => {
    try {
      const raw = localStorage.getItem(MAP_FOG_STYLE_KEY);
      if (raw) return { ...DEFAULT_FOG_STYLE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_FOG_STYLE;
  });
  const fogStyleRef = useRef(fogStyle);
  fogStyleRef.current = fogStyle;

  const [pathStyle, setPathStyle] = useState<PathStyle>(() => {
    try {
      const raw = localStorage.getItem(MAP_PATH_STYLE_KEY);
      if (raw) return { ...DEFAULT_PATH_STYLE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_PATH_STYLE;
  });
  const pathStyleRef = useRef(pathStyle);
  pathStyleRef.current = pathStyle;

  // 地图底图风格主题：'classic'（经典多级LOD原画） | 'real_hd'（超清写实新地图 1024瓦片）
  const [mapTheme, setMapTheme] = useState<MapTheme>(() => {
    try {
      const raw = localStorage.getItem(MAP_THEME_KEY);
      if (raw === 'real_hd' || raw === 'classic') return raw;
    } catch {}
    return 'classic';
  });
  const mapThemeRef = useRef(mapTheme);
  mapThemeRef.current = mapTheme;

  // 人物图标样式
  const [playerIcon, setPlayerIcon] = useState<PlayerIconType>(() => {
    try {
      const raw = localStorage.getItem(MAP_PLAYER_ICON_KEY);
      if (raw && PLAYER_ICON_PRESETS.some((p) => p.id === raw)) {
        return raw as PlayerIconType;
      }
    } catch {}
    return 'crystal_blue';
  });
  const playerIconRef = useRef(playerIcon);
  playerIconRef.current = playerIcon;

  // 样式功能面板（默认展开）
  const [styleMenuOpen, setStyleMenuOpen] = useState(true);

  // ---- 历史回放控制器状态 ----
  const [playbackActive, setPlaybackActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 2x, 5x, 10x
  const playbackIndexRef = useRef(playbackIndex);
  playbackIndexRef.current = playbackIndex;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const playbackActiveRef = useRef(playbackActive);
  playbackActiveRef.current = playbackActive;

  const [hoveredPet] = useState<WildPet | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);

  // 瓦片与背景缓存
  const tileCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const overImageRef = useRef<HTMLImageElement | null>(null);
  const patternRef = useRef<CanvasPattern | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const renderCanvasRef = useRef<() => void>(() => {});

  const requestRender = useCallback(() => {
    if (animFrameRef.current !== null) return;
    animFrameRef.current = requestAnimationFrame(() => {
      animFrameRef.current = null;
      renderCanvasRef.current();
    });
  }, []);

  // 获取并缓存切片图片（支持经典 LOD 与 超清写实新地图 1024 瓦片）
  const getTileImage = useCallback((level: number, row: number, col: number, theme: MapTheme = mapThemeRef.current) => {
    const tileKey = `${theme}_${level}_${row}_${col}`;
    let img = tileCacheRef.current.get(tileKey);
    if (!img) {
      img = new Image();
      if (theme === 'real_hd') {
        // 超清写实新地图：32x32 对应 row 4064..4095, col 4064..4095
        img.src = `./mapdata_real/aligned_tiles_256/${row}_${col}.png`;
        // 容错回退
        img.onerror = () => {
          if (img && !img.src.includes('/mapdata/13/')) {
            img.src = `./mapdata/13/${row}_${col}.png`;
          }
        };
      } else {
        // 经典 LOD 瓦片
        img.src = `./mapdata/${level}/${row}_${col}.png`;
      }
      tileCacheRef.current.set(tileKey, img);
      img.onload = () => {
        requestRender();
      };
    }
    return img;
  }, [requestRender]);

  // 初始化预加载基础底图（L11：共 64 块切片）和 over.png
  useEffect(() => {
    const overImg = new Image();
    overImg.src = OVERLAY_URL;
    overImg.onload = () => {
      overImageRef.current = overImg;
      requestRender();
    };

    const baseLod = LOD_LEVELS[0];
    for (let r = 0; r < baseLod.count; r++) {
      for (let c = 0; c < baseLod.count; c++) {
        getTileImage(baseLod.level, baseLod.minY + r, baseLod.minX + c, 'classic');
      }
    }
  }, [getTileImage, requestRender]);

  // 历史持久化
  useEffect(() => {
    try {
      localStorage.setItem(MAP_LAYERS_KEY, JSON.stringify(layers));
    } catch {}
  }, [layers]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_FOG_REVEALED_KEY, JSON.stringify(revealedCircles));
    } catch {}
  }, [revealedCircles]);

  // 初始化从本地存储及后端 roco_user_mapdata.json 同步足迹历史与样式配置
  useEffect(() => {
    let mounted = true;
    const fetchRemoteFootprints = async () => {
      try {
        const res = await api.getMapStorageRemote();
        if (mounted && res) {
          // 1. 同步足迹历史
          if (res.mapFootprints) {
            const { pathHistory: remotePath, revealedCircles: remoteRevealed } = res.mapFootprints;
            if (Array.isArray(remotePath) && remotePath.length > 0) {
              setPathHistory((prev) => {
                if (prev.length === 0 || remotePath.length >= prev.length) {
                  return remotePath;
                }
                return prev;
              });
            }
            if (Array.isArray(remoteRevealed) && remoteRevealed.length > 0) {
              setRevealedCircles((prev) => {
                if (prev.length <= 1 || remoteRevealed.length >= prev.length) {
                  return remoteRevealed;
                }
                return prev;
              });
            }
          }

          // 2. 同步样式配置（迷雾样式、路径样式、图层开关、底图主题、人物信标）
          if (res.mapDesignStyles) {
            const { fogStyle: remoteFog, pathStyle: remotePathStyle, layers: remoteLayers, mapTheme: remoteTheme, playerIcon: remotePlayerIcon } = res.mapDesignStyles;
            if (remoteFog && typeof remoteFog === 'object') {
              setFogStyle((prev) => ({ ...prev, ...remoteFog }));
            }
            if (remotePathStyle && typeof remotePathStyle === 'object') {
              setPathStyle((prev) => ({ ...prev, ...remotePathStyle }));
            }
            if (remoteLayers && typeof remoteLayers === 'object') {
              setLayers((prev) => ({ ...prev, ...remoteLayers }));
            }
            if (remoteTheme === 'real_hd' || remoteTheme === 'classic') {
              setMapTheme(remoteTheme);
            }
            if (remotePlayerIcon && PLAYER_ICON_PRESETS.some((p) => p.id === remotePlayerIcon)) {
              setPlayerIcon(remotePlayerIcon as PlayerIconType);
            }
          }
        }
      } catch (err) {
        console.warn('同步远程地图足迹与样式配置失败，保留本地缓存:', err);
      }
    };
    fetchRemoteFootprints();
    return () => {
      mounted = false;
    };
  }, []);

  // 防抖自动保存到本地 roco_user_mapdata.json (后端 /api/map_storage) 与 页面退出/关闭保底存盘
  const saveToBackendTimerRef = useRef<number | null>(null);
  const syncToRemoteDisk = useCallback(() => {
    try {
      const payload = {
        mapFootprints: {
          pathHistory: pathHistoryRef.current,
          revealedCircles: revealedCirclesRef.current,
          updatedAt: Date.now(),
        },
        mapDesignStyles: {
          fogStyle: fogStyleRef.current,
          pathStyle: pathStyleRef.current,
          layers: layersRef.current,
          mapTheme: mapThemeRef.current,
          playerIcon: playerIconRef.current,
          updatedAt: Date.now(),
        },
      };
      api.saveMapStorageRemote(payload).catch(() => {});
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_PLAYER_ICON_KEY, playerIcon);
    } catch {}
    playerIconRef.current = playerIcon;
    requestRender();
  }, [playerIcon, requestRender]);

  useEffect(() => {
    // 每次足迹或样式更新后，防抖 10 秒合并写入一次后端磁盘，避免频繁 IO 卡顿
    if (saveToBackendTimerRef.current !== null) {
      clearTimeout(saveToBackendTimerRef.current);
    }
    saveToBackendTimerRef.current = window.setTimeout(() => {
      syncToRemoteDisk();
      saveToBackendTimerRef.current = null;
    }, 10000);

    return () => {
      if (saveToBackendTimerRef.current !== null) {
        clearTimeout(saveToBackendTimerRef.current);
      }
    };
  }, [pathHistory, revealedCircles, fogStyle, pathStyle, layers, mapTheme, playerIcon, syncToRemoteDisk]);

  // 页面关闭 / 切换时利用 beforeunload / pagehide 立即落盘
  useEffect(() => {
    const handleUnload = () => {
      try {
        const payload = {
          mapFootprints: {
            pathHistory: pathHistoryRef.current,
            revealedCircles: revealedCirclesRef.current,
            updatedAt: Date.now(),
          },
          mapDesignStyles: {
            fogStyle: fogStyleRef.current,
            pathStyle: pathStyleRef.current,
            layers: layersRef.current,
            mapTheme: mapThemeRef.current,
            playerIcon: playerIconRef.current,
            updatedAt: Date.now(),
          },
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(`${api.getApiBase()}/api/map_storage`, blob);
        }
      } catch {}
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      // 组件卸载时保存
      syncToRemoteDisk();
    };
  }, [syncToRemoteDisk]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_FOG_STYLE_KEY, JSON.stringify(fogStyle));
    } catch {}
    fogStyleRef.current = fogStyle;
    requestRender();
  }, [fogStyle, requestRender]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_PATH_STYLE_KEY, JSON.stringify(pathStyle));
    } catch {}
    pathStyleRef.current = pathStyle;
    requestRender();
  }, [pathStyle, requestRender]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_THEME_KEY, mapTheme);
    } catch {}
    mapThemeRef.current = mapTheme;
    requestRender();
  }, [mapTheme, requestRender]);

  // 容器大小测量
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const nextSize = { x: Math.max(rect.width, 320), y: Math.max(rect.height, 320) };
      setContainerSize(nextSize);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 更新玩家位置与解锁迷雾打孔
  const updatePlayerPosition = useCallback((pos: Vec2, heading: number, timestamp = Date.now()) => {
    // 空气墙与合法边界校验：如果超出地图有效岛屿轮廓多边形范围，则视为后端识别错误直接丢弃
    if (!isPointInPolygon(pos)) {
      return;
    }

    setPlayer({ pos, heading });

    // 记录路径点（仅当位移 > 30px 时记录新点，避免密集冗余）
    const lastNode = pathHistoryRef.current[pathHistoryRef.current.length - 1];
    if (!lastNode || distance(lastNode, pos) > 30) {
      setPathHistory((prev) => [...prev.slice(-1000), { x: pos.x, y: pos.y, heading, timestamp }]);
    }

    // 迷雾打孔记录（仅当位移 > 120px 时记录新打孔圆）
    const lastReveal = revealedCirclesRef.current[revealedCirclesRef.current.length - 1];
    if (!lastReveal || distance(lastReveal, pos) > 120) {
      setRevealedCircles((prev) => [...prev, { x: pos.x, y: pos.y }]);
    }
    requestRender();
  }, [requestRender]);

  // 后端轮询监听游戏画面
  useEffect(() => {
    if (!isMonitoring) return;
    let timer: number | null = null;
    let active = true;

    const poll = async () => {
      try {
        const obs = await api.observeMap();
        if (active && obs) {
          if (obs.status_message) {
            setStatusMsg(obs.status_message);
            setStatusMsgDismissed(false);
          }
          if (obs.position) {
            // 优先使用后端观测时刻的真实捕获时间戳（避免网络传输和前端渲染延迟影响历史时序）
            const captureTime = obs.position.captured_at || obs.timestamp || Date.now();
            updatePlayerPosition(
              { x: obs.position.x, y: obs.position.y },
              typeof obs.heading === 'number' ? obs.heading : playerRef.current.heading,
              captureTime
            );
          }
        }
      } catch {}
      if (active) {
        timer = window.setTimeout(poll, 1500);
      }
    };

    poll();
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      // 前端停止轮询时也停掉后端后台线程，避免它继续抓图/拉起窗口。
      api.stopMapMonitor().catch(() => {});
    };
  }, [isMonitoring, updatePlayerPosition]);

  // ---- 历史回放时钟循环 ----
  useEffect(() => {
    if (!playbackActive || !isPlaying || pathHistory.length === 0) return;

    const intervalMs = Math.max(50, Math.round(500 / playbackSpeed));
    const timer = setInterval(() => {
      setPlaybackIndex((prev) => {
        if (prev >= pathHistoryRef.current.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
      requestRender();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [playbackActive, isPlaying, playbackSpeed, pathHistory.length, requestRender]);

  // ---- Canvas 渲染引擎 ----
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    const currentView = viewRef.current;
    const { cx, cy, zoom } = currentView;
    const currentLayers = layersRef.current;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 1. 绘制外部 over.png 纹理背景
    if (overImageRef.current && overImageRef.current.complete && overImageRef.current.naturalWidth > 0) {
      if (!patternRef.current) {
        patternRef.current = ctx.createPattern(overImageRef.current, 'repeat');
      }
      if (patternRef.current) {
        ctx.fillStyle = patternRef.current;
        ctx.fillRect(0, 0, width, height);
      }
    } else {
      ctx.fillStyle = '#0a1d30';
      ctx.fillRect(0, 0, width, height);
    }

    // 视口在世界坐标系下的可视范围
    const halfW = width / (2 * zoom);
    const halfH = height / (2 * zoom);
    const minWorldX = cx - halfW;
    const maxWorldX = cx + halfW;
    const minWorldY = cy - halfH;
    const maxWorldY = cy + halfH;

    // 屏幕坐标转换基准
    const screenOffsetX = width / 2 - cx * zoom;
    const screenOffsetY = height / 2 - cy * zoom;

    // 开启平滑插值
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    const currentTheme = mapThemeRef.current;

    if (currentTheme === 'real_hd') {
      // 2. 超清写实新地图渲染（32x32 共 1024 块 256px 瓦片，对应 L13 范围 4064..4095）
      const realLod = LOD_LEVELS[2]; // level 13: count=32, tileWorldSize=256
      const minCol = Math.max(0, Math.floor(minWorldX / realLod.tileWorldSize));
      const maxCol = Math.min(realLod.count - 1, Math.floor(maxWorldX / realLod.tileWorldSize));
      const minRow = Math.max(0, Math.floor(minWorldY / realLod.tileWorldSize));
      const maxRow = Math.min(realLod.count - 1, Math.floor(maxWorldY / realLod.tileWorldSize));

      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          const worldX = c * realLod.tileWorldSize;
          const worldY = r * realLod.tileWorldSize;
          const dx = Math.floor(screenOffsetX + worldX * zoom);
          const dy = Math.floor(screenOffsetY + worldY * zoom);
          const dw = Math.ceil(screenOffsetX + (worldX + realLod.tileWorldSize) * zoom) - dx;
          const dh = Math.ceil(screenOffsetY + (worldY + realLod.tileWorldSize) * zoom) - dy;

          const img = getTileImage(realLod.level, realLod.minY + r, realLod.minX + c, 'real_hd');
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, dx, dy, dw, dh);
          }
        }
      }
    } else {
      // 2. 经典 LOD 原画底图：先绘制 L11 恒定垫底
      const baseLod = LOD_LEVELS[0];
      const minBaseCol = Math.max(0, Math.floor(minWorldX / baseLod.tileWorldSize));
      const maxBaseCol = Math.min(baseLod.count - 1, Math.floor(maxWorldX / baseLod.tileWorldSize));
      const minBaseRow = Math.max(0, Math.floor(minWorldY / baseLod.tileWorldSize));
      const maxBaseRow = Math.min(baseLod.count - 1, Math.floor(maxWorldY / baseLod.tileWorldSize));

      for (let r = minBaseRow; r <= maxBaseRow; r++) {
        for (let c = minBaseCol; c <= maxBaseCol; c++) {
          const worldX = c * baseLod.tileWorldSize;
          const worldY = r * baseLod.tileWorldSize;
          const dx = Math.floor(screenOffsetX + worldX * zoom);
          const dy = Math.floor(screenOffsetY + worldY * zoom);
          const dw = Math.ceil(screenOffsetX + (worldX + baseLod.tileWorldSize) * zoom) - dx;
          const dh = Math.ceil(screenOffsetY + (worldY + baseLod.tileWorldSize) * zoom) - dy;

          const img = getTileImage(baseLod.level, baseLod.minY + r, baseLod.minX + c, 'classic');
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, dx, dy, dw, dh);
          }
        }
      }

      // 3. 当前 LOD 等级瓦片覆盖绘制（仅绘制一次，保证 60fps）
      const currentLod = getLodForZoom(zoom);
      if (currentLod.level !== baseLod.level) {
        const minCol = Math.max(0, Math.floor(minWorldX / currentLod.tileWorldSize));
        const maxCol = Math.min(currentLod.count - 1, Math.floor(maxWorldX / currentLod.tileWorldSize));
        const minRow = Math.max(0, Math.floor(minWorldY / currentLod.tileWorldSize));
        const maxRow = Math.min(currentLod.count - 1, Math.floor(maxWorldY / currentLod.tileWorldSize));

        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const worldX = c * currentLod.tileWorldSize;
            const worldY = r * currentLod.tileWorldSize;
            const dx = Math.floor(screenOffsetX + worldX * zoom);
            const dy = Math.floor(screenOffsetY + worldY * zoom);
            const dw = Math.ceil(screenOffsetX + (worldX + currentLod.tileWorldSize) * zoom) - dx;
            const dh = Math.ceil(screenOffsetY + (worldY + currentLod.tileWorldSize) * zoom) - dy;

            const img = getTileImage(currentLod.level, currentLod.minY + r, currentLod.minX + c, 'classic');
            if (img.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, dx, dy, dw, dh);
            }
          }
        }
      }
    }

    // 4. 高性能迷雾蒙版（未涉足区域以浅灰半透明覆盖，走过区域显现原本鲜艳高清地图）
    if (currentLayers.fogOfWar) {
      // 获取/初始化离屏 Canvas
      if (!fogCanvasRef.current) {
        fogCanvasRef.current = document.createElement('canvas');
      }
      const fogCanvas = fogCanvasRef.current;
      if (fogCanvas.width !== width || fogCanvas.height !== height) {
        fogCanvas.width = width;
        fogCanvas.height = height;
      }

      const fogCtx = fogCanvas.getContext('2d');
      if (fogCtx) {
        // 清空离屏 Canvas
        fogCtx.clearRect(0, 0, width, height);

        // 绘制只局限于岛屿空气墙轮廓内的半透明灰雾（使用贝塞尔样条平滑过渡，避免生硬直线折角）
        const currentFogStyle = fogStyleRef.current;
        fogCtx.fillStyle = hexToRgba(currentFogStyle.color, currentFogStyle.opacity);
        drawSmoothClosedPolygon(
          fogCtx,
          AIRWALL_POLYGON_L13,
          screenOffsetX,
          screenOffsetY,
          zoom
        );
        fogCtx.fill();

        // 设置混合模式为擦除（destination-out）
        fogCtx.globalCompositeOperation = 'destination-out';

        const reveals = revealedCirclesRef.current;
        const radiusVal = currentFogStyle.clearRadius || DEFAULT_CLEAR_RADIUS;
        const sr = radiusVal * zoom;

        // 擦除所有已探索的点位圆
        fogCtx.beginPath();
        for (let i = 0; i < reveals.length; i++) {
          const pt = reveals[i];
          const sx = screenOffsetX + pt.x * zoom;
          const sy = screenOffsetY + pt.y * zoom;

          if (sx < -sr * 2 || sx > width + sr * 2 || sy < -sr * 2 || sy > height + sr * 2) continue;

          fogCtx.moveTo(sx + sr, sy);
          fogCtx.arc(sx, sy, sr, 0, Math.PI * 2);
        }
        fogCtx.fill();

        // 擦除当前玩家所在位置的探索视野圆
        const curP = playerRef.current.pos;
        const curSx = screenOffsetX + curP.x * zoom;
        const curSy = screenOffsetY + curP.y * zoom;
        const curSr = (radiusVal + 40) * zoom;
        fogCtx.beginPath();
        fogCtx.arc(curSx, curSy, curSr, 0, Math.PI * 2);
        fogCtx.fill();

        // 恢复离屏 Canvas 的混合模式
        fogCtx.globalCompositeOperation = 'source-over';

        // 将渲染好的迷雾层绘制回主 Canvas
        ctx.drawImage(fogCanvas, 0, 0);
      }
    }

    // 5. 绘制历史移动路径线（双层高对比度高亮描边 + 荧光霓虹发光）
    if (currentLayers.showPath && pathHistoryRef.current.length > 1) {
      const history = pathHistoryRef.current;
      const currentPathStyle = pathStyleRef.current;
      const baseWidth = Math.max(currentPathStyle.lineWidth, (currentPathStyle.lineWidth + 2) * zoom);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1) 先绘制深色/半透明高对比度底层外描边（确保在任何地貌上都极度清晰显眼）
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.lineWidth = baseWidth + 3.5;
      if (currentPathStyle.lineStyle === 'dashed') {
        ctx.setLineDash([10, 7]);
      } else if (currentPathStyle.lineStyle === 'dotted') {
        ctx.setLineDash([4, 6]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const pt = history[i];
        const sx = screenOffsetX + pt.x * zoom;
        const sy = screenOffsetY + pt.y * zoom;
        if (i === 0) {
          ctx.moveTo(sx, sy);
        } else {
          const prevPt = history[i - 1];
          if (distance(prevPt, pt) > MAX_TELEPORT_DISTANCE) {
            ctx.moveTo(sx, sy);
          } else {
            ctx.lineTo(sx, sy);
          }
        }
      }
      ctx.stroke();

      // 2) 绘制上层高亮本体色彩 + 发光霓虹光晕
      ctx.strokeStyle = currentPathStyle.color;
      ctx.lineWidth = baseWidth;
      if (currentPathStyle.glow) {
        ctx.shadowColor = hexToRgba(currentPathStyle.color, 0.9);
        ctx.shadowBlur = 12;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const pt = history[i];
        const sx = screenOffsetX + pt.x * zoom;
        const sy = screenOffsetY + pt.y * zoom;
        if (i === 0) {
          ctx.moveTo(sx, sy);
        } else {
          const prevPt = history[i - 1];
          if (distance(prevPt, pt) > MAX_TELEPORT_DISTANCE) {
            ctx.moveTo(sx, sy);
          } else {
            ctx.lineTo(sx, sy);
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // 6. 绘制高显眼度无方向人物信标光标（根据用户自选图标样式绘制）
    const p = playerRef.current;
    const px = screenOffsetX + p.pos.x * zoom;
    const py = screenOffsetY + p.pos.y * zoom;
    const currentIcon = playerIconRef.current || 'crystal_blue';

    ctx.save();
    ctx.translate(px, py);

    if (currentIcon === 'target_ring') {
      // 战术准星雷达环
      ctx.beginPath();
      ctx.arc(0, 0, 36, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#06B6D4';
      ctx.shadowColor = '#06B6D4';
      ctx.shadowBlur = 10;
      ctx.stroke();

      // 四向刻度十字线
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(0, -26); ctx.lineTo(0, -12);
      ctx.moveTo(0, 12);  ctx.lineTo(0, 26);
      ctx.moveTo(-26, 0); ctx.lineTo(-12, 0);
      ctx.moveTo(12, 0);  ctx.lineTo(26, 0);
      ctx.stroke();

      // 中心红心点
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#EF4444';
      ctx.fill();
    } else if (currentIcon === 'star_badge') {
      // 王国星徽
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.18)';
      ctx.fill();

      // 白色实心底盘
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 8;
      ctx.fill();

      // 金色圆环
      ctx.beginPath();
      ctx.arc(0, 0, 13.5, 0, Math.PI * 2);
      ctx.fillStyle = '#F59E0B';
      ctx.fill();

      // 绘制五角星
      ctx.save();
      ctx.beginPath();
      const spikes = 5;
      const outerR = 9;
      const innerR = 4.2;
      let rot = (Math.PI / 2) * 3;
      const step = Math.PI / spikes;
      ctx.moveTo(0, -outerR);
      for (let i = 0; i < spikes; i++) {
        let sx = Math.cos(rot) * outerR;
        let sy = Math.sin(rot) * outerR;
        ctx.lineTo(sx, sy);
        rot += step;
        sx = Math.cos(rot) * innerR;
        sy = Math.sin(rot) * innerR;
        ctx.lineTo(sx, sy);
        rot += step;
      }
      ctx.lineTo(0, -outerR);
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#FEF08A';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.restore();
    } else {
      // 各种色系的能量水晶球（crystal_blue, crystal_gold, crystal_ruby, crystal_emerald, crystal_purple）
      const colorMap: Record<string, { aura: string; ring: string; coreStart: string; coreMid: string; coreEnd: string; dot: string }> = {
        crystal_blue: {
          aura: 'rgba(56, 189, 248, 0.18)',
          ring: 'rgba(56, 189, 248, 0.9)',
          coreStart: '#60A5FA',
          coreMid: '#2563EB',
          coreEnd: '#1D4ED8',
          dot: '#FACC15',
        },
        crystal_gold: {
          aura: 'rgba(250, 204, 21, 0.22)',
          ring: 'rgba(234, 179, 8, 0.95)',
          coreStart: '#FEF08A',
          coreMid: '#EAB308',
          coreEnd: '#CA8A04',
          dot: '#FFFFFF',
        },
        crystal_ruby: {
          aura: 'rgba(239, 68, 68, 0.2)',
          ring: 'rgba(239, 68, 68, 0.9)',
          coreStart: '#FCA5A5',
          coreMid: '#EF4444',
          coreEnd: '#B91C1C',
          dot: '#FFFFFF',
        },
        crystal_emerald: {
          aura: 'rgba(16, 185, 129, 0.2)',
          ring: 'rgba(16, 185, 129, 0.9)',
          coreStart: '#6EE7B7',
          coreMid: '#10B981',
          coreEnd: '#047857',
          dot: '#FEF08A',
        },
        crystal_purple: {
          aura: 'rgba(139, 92, 246, 0.2)',
          ring: 'rgba(139, 92, 246, 0.9)',
          coreStart: '#C4B5FD',
          coreMid: '#8B5CF6',
          coreEnd: '#6D28D9',
          dot: '#FFFFFF',
        },
      };

      const pal = colorMap[currentIcon] || colorMap.crystal_blue;

      // 1) 最外层大范围感知柔和光晕
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, Math.PI * 2);
      ctx.fillStyle = pal.aura;
      ctx.fill();

      // 2) 脉冲扩散雷达外环
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fillStyle = pal.aura;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.shadowColor = pal.ring;
      ctx.shadowBlur = 12;
      ctx.stroke();

      // 3) 高对比度白色实心衬底圈
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 8;
      ctx.fill();

      // 4) 渐变晶核
      ctx.beginPath();
      ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
      const coreGrad = ctx.createRadialGradient(0, -2, 1, 0, 0, 9.5);
      coreGrad.addColorStop(0, pal.coreStart);
      coreGrad.addColorStop(0.6, pal.coreMid);
      coreGrad.addColorStop(1, pal.coreEnd);
      ctx.fillStyle = coreGrad;
      ctx.fill();

      // 5) 核心定位星芒与高光点
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = pal.dot;
      ctx.shadowColor = pal.dot;
      ctx.shadowBlur = 6;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(-2, -2, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }

    ctx.restore();

    // 7. 绘制历史回放游标（醒目橙金能量信标）
    if (playbackActiveRef.current && pathHistoryRef.current.length > 0) {
      const idx = Math.min(playbackIndexRef.current, pathHistoryRef.current.length - 1);
      const replayNode = pathHistoryRef.current[idx];
      if (replayNode) {
        const rx = screenOffsetX + replayNode.x * zoom;
        const ry = screenOffsetY + replayNode.y * zoom;

        ctx.save();
        ctx.translate(rx, ry);

        // 回放外层虚线脉冲圈
        ctx.beginPath();
        ctx.arc(0, 0, 36, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(249, 115, 22, 0.2)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.85)';
        ctx.setLineDash([4, 4]);
        ctx.stroke();

        // 白色对比衬底
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(234, 88, 12, 0.9)';
        ctx.shadowBlur = 10;
        ctx.setLineDash([]);
        ctx.fill();

        // 橙红渐变晶核
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        const replayGrad = ctx.createRadialGradient(0, -2, 1, 0, 0, 10);
        replayGrad.addColorStop(0, '#FDBA74');
        replayGrad.addColorStop(0.6, '#EA580C');
        replayGrad.addColorStop(1, '#9A3412');
        ctx.fillStyle = replayGrad;
        ctx.fill();

        // 核心白曜亮点
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = 6;
        ctx.fill();

        ctx.restore();
      }
    }
  }, [getTileImage]);

  renderCanvasRef.current = renderCanvas;

  // 当尺寸或 view 改变时触发重绘
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = containerSize.x;
      canvas.height = containerSize.y;
    }
    requestRender();
  }, [containerSize, requestRender]);

  // ---- 交互处理：拖动与滚轮缩放 ----
  const dragRef = useRef<{ startX: number; startY: number; cx: number; cy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const updateView = useCallback((next: { cx: number; cy: number; zoom: number }) => {
    const bounded = clampView(next, containerSize);
    viewRef.current = bounded;
    setView(bounded);
    requestRender();
  }, [containerSize, requestRender]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      cx: viewRef.current.cx,
      cy: viewRef.current.cy,
    };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const current = viewRef.current;
    updateView({
      ...current,
      cx: drag.cx - dx / current.zoom,
      cy: drag.cy - dy / current.zoom,
    });
  };

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [endDrag]);

  // 滚轮朝光标缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nextZoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = v.cx + (mx - containerSize.x / 2) / v.zoom;
      const wy = v.cy + (my - containerSize.y / 2) / v.zoom;
      updateView({
        cx: wx - (mx - containerSize.x / 2) / nextZoom,
        cy: wy - (my - containerSize.y / 2) / nextZoom,
        zoom: nextZoom,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerSize, updateView]);

  const resetView = () => {
    updateView({ cx: WORLD_W / 2, cy: WORLD_H / 2, zoom: 0.18 });
    sound.playClick();
  };

  const centerOnPlayer = () => {
    updateView({ ...viewRef.current, cx: playerRef.current.pos.x, cy: playerRef.current.pos.y });
    sound.playClick();
  };

  const toggleLayer = (key: keyof LayerState) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      layersRef.current = next;
      return next;
    });
    sound.playClick();
    requestRender();
  };

  const clearFogAndPath = () => {
    setRevealedCircles([{ x: player.pos.x, y: player.pos.y }]);
    setPathHistory([{ x: player.pos.x, y: player.pos.y, heading: player.heading, timestamp: Date.now() }]);
    sound.playToggleOff();
    requestRender();
  };

  const activeLod = getLodForZoom(view.zoom);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col selection:bg-sky-200 selection:text-sky-900 bg-[#EAF4FB]">
      <Header
        activeStageNum={maps[0]?.num ?? 1}
        onSelectMap={() => undefined}
        mapsStats={[]}
        totalEncountered={0}
        totalPetsCount={0}
        isSoundMuted={isSoundMuted}
        onToggleSound={onToggleSound || (() => undefined)}
        onOpenManual={() => setIsManualOpen(true)}
        onOpenFeedback={onOpenFeedback}
        onOpenUpdate={onOpenUpdate}
        onOpenSettings={onOpenSettings}
        onOpenHub={onBack}
        mapsConfig={maps}
        showMapNav={false}
        devBadge
        rightStatus={<AuthBadge />}
      />

      <UserManualModal
        isOpen={isManualOpen}
        onClose={() => setIsManualOpen(false)}
      />

      <main className="relative flex-1 min-h-0 w-full bg-[#EAF4FB] overflow-hidden">
        <div className="relative w-full h-full">
          {/* ---- 地图画布区域 ---- */}
          <div
            className={`absolute inset-y-0 right-0 bg-[#0a1d30] overflow-hidden flex flex-col transition-all duration-200 ${
              toolbarCollapsed ? 'left-0' : 'left-0 min-[700px]:left-[324px]'
            }`}
          >
            <div
              ref={containerRef}
              className="relative w-full h-full overflow-hidden touch-none select-none"
              style={{ cursor: dragging ? 'grabbing' : 'grab' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full block"
              />

              {/* 悬停提示 */}
              {hoveredPet && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-slate-900/85 text-white text-xs font-bold px-3 py-1.5 rounded-lg pointer-events-none shadow">
                  {hoveredPet.name}
                  <span className="ml-1.5 text-slate-300">
                    {hoveredPet.shiny ? '异色/炫彩 ' : ''}
                    {hoveredPet.pollution ? '污染 ' : ''}
                    {hoveredPet.sound ? '声音异常' : ''}
                  </span>
                </div>
              )}

              {/* 实时定位状态提示（顶部） */}
              {isMonitoring && statusMsg && !statusMsgDismissed && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-xl pointer-events-auto select-none border border-white/10 flex items-center gap-2 max-w-[90%]"
                     onPointerDown={(e) => e.stopPropagation()}>
                  <Radio className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                  <span className="truncate">{statusMsg}</span>
                  <button
                    type="button"
                    onClick={() => setStatusMsgDismissed(true)}
                    className="ml-1 shrink-0 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    aria-label="关闭提示"
                  >
                    <span className="text-xs font-black">✕</span>
                  </button>
                </div>
              )}
            </div>

            {/* 历史足迹回放浮动控制器（独立于可拖拽 Canvas 容器，防止事件冒泡拖动地图） */}
            {playbackActive && pathHistory.length > 0 && (
              <div
                className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border-2 border-[#E6EEF8] px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 min-w-[320px] sm:min-w-[440px] max-w-[92vw] pointer-events-auto select-none"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying((v) => !v);
                    sound.playClick();
                  }}
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center cursor-pointer transition-all shadow-xs shrink-0 ${
                    isPlaying
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-[#5DA8E8] text-white hover:bg-[#4A97D8]'
                  }`}
                  title={isPlaying ? '暂停回放' : '开始播放足迹历史'}
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white" /> : <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white ml-0.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPlaybackIndex(0);
                    setIsPlaying(false);
                    sound.playClick();
                    requestRender();
                  }}
                  className="p-1 sm:p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
                  title="跳至起点"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                {/* 进度条 */}
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-black text-slate-500">
                    <span className="flex items-center gap-1 text-amber-600 font-bold truncate">
                      <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
                      {new Date(pathHistory[playbackIndex]?.timestamp || Date.now()).toLocaleTimeString()}
                    </span>
                    <span className="shrink-0 ml-1">
                      {playbackIndex + 1}/{pathHistory.length}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(0, pathHistory.length - 1)}
                    value={playbackIndex}
                    onChange={(e) => {
                      setPlaybackIndex(parseInt(e.target.value, 10));
                      requestRender();
                    }}
                    className="w-full accent-amber-500 h-1.5 sm:h-2 bg-slate-200 rounded-lg cursor-pointer"
                  />
                </div>

                {/* 倍速切换 */}
                <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-100 p-0.5 sm:p-1 rounded-xl shrink-0">
                  {[1, 2, 5, 10].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => {
                        setPlaybackSpeed(spd);
                        sound.playClick();
                      }}
                      className={`px-1 sm:px-1.5 py-0.5 text-[9px] sm:text-[10px] font-black rounded-lg transition-all cursor-pointer ${
                        playbackSpeed === spd
                          ? 'bg-amber-500 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setPlaybackActive(false);
                    setIsPlaying(false);
                    sound.playClick();
                    requestRender();
                  }}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0 text-sm font-bold cursor-pointer"
                  title="退出回放模式"
                >
                  ✕
                </button>
              </div>
            )}

            {/* 右下角缩放等级与 DEV 调试浮标 */}
            <div className="absolute bottom-4 sm:bottom-6 right-4 sm:right-6 z-40 flex flex-col items-end gap-2 pointer-events-auto">
              <button
                type="button"
                onClick={centerOnPlayer}
                className="roco-card px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-black text-[#2B78C4] hover:border-[#7ABCF4] shadow-md flex items-center gap-1.5 bg-white/95 backdrop-blur-md cursor-pointer transition-all active:scale-95"
                title="聚焦到当前玩家人物坐标"
              >
                <Navigation className="w-3.5 h-3.5 text-[#7ABCF4]" />
                <span>定位人物</span>
              </button>

              <div className="roco-card px-2.5 sm:px-3 py-1 sm:py-1.5 text-center shadow-lg border-2 border-[#E6EEF8] bg-white/95 backdrop-blur-md">
                <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-black text-slate-700">
                  <ZoomIn className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#7ABCF4]" />
                  <span>{(view.zoom * 100).toFixed(0)}%</span>
                </div>
                <div className="text-[8px] sm:text-[9px] font-black text-sky-600 mt-0.5">
                  LOD: L{activeLod.level} ({activeLod.count}×{activeLod.count})
                </div>
              </div>
            </div>
          </div>

          {/* ---- 侧栏：>=700px 侧边停靠，<700px 悬浮在地图上方 ---- */}
          <div className="absolute top-0 left-0 bottom-0 z-30 pointer-events-none">
            <div
              className={`absolute top-0 left-0 bottom-0 w-[300px] sm:w-[324px] p-3 sm:p-4 flex flex-col gap-3 transition-transform duration-200 pointer-events-auto overflow-visible max-h-full ${
                toolbarCollapsed ? '-translate-x-full' : 'translate-x-0'
              }`}
            >
              {/* 探索与迷雾控制面板 */}
              <div className="w-full roco-card shadow-2xl p-3.5 sm:p-4 backdrop-blur-md space-y-3 overflow-y-auto max-h-full scrollbar-none">
                {/* 实时定位按钮（位于工具栏顶部） */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !isMonitoring;
                    setIsMonitoring(next);
                    setStatusMsgDismissed(false);
                    // 同步启停后端后台监测线程：关闭时真正停止，避免它继续抓图/拉起游戏窗口。
                    if (next) {
                      api.startMapMonitor().catch(() => {});
                    } else {
                      api.stopMapMonitor().catch(() => {});
                    }
                    sound.playClick();
                  }}
                  className={`w-full inline-flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs font-black shadow-2xs transition-all active:scale-[0.98] ${
                    isMonitoring
                      ? 'border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-200'
                      : 'border-[#A9D6FA] bg-[#5DA8E8] text-white hover:bg-[#4A97D8]'
                  }`}
                  title={isMonitoring ? '停止游戏画面位置监听' : '开始监听游戏画面并实时定位'}
                  aria-pressed={isMonitoring}
                >
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4" />
                    <span>画面实时定位</span>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${
                    isMonitoring ? 'bg-white text-emerald-600' : 'bg-white/20 text-white'
                  }`}>
                    {isMonitoring ? '监测中' : '点击开启'}
                  </span>
                </button>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2 text-sm font-black text-slate-700">
                    <Footprints className="w-4 h-4 text-[#7ABCF4]" />
                    地图探索与路径
                  </div>
                  {/* 收起工具栏按钮（保留经典 ‹ 风格） */}
                  <button
                    type="button"
                    onClick={() => {
                      setToolbarCollapsed(true);
                      sound.playClick();
                    }}
                    className="h-7 w-7 rounded-xl border border-[#E6EEF8] bg-white text-slate-600 shadow-2xs hover:border-[#7ABCF4] hover:text-[#2B78C4] transition-all cursor-pointer flex items-center justify-center font-bold text-sm"
                    title="收起工具栏"
                    aria-label="收起工具栏"
                  >
                    ‹
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <LayerToggle
                    label="未涉足区域蒙版 (迷雾探索)"
                    icon={<Layers className="w-4 h-4" />}
                    on={layers.fogOfWar}
                    onToggle={() => toggleLayer('fogOfWar')}
                  />
                  <LayerToggle
                    label="实时移动路径轨迹"
                    icon={<Navigation className="w-4 h-4" />}
                    on={layers.showPath}
                    onToggle={() => toggleLayer('showPath')}
                  />
                </div>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400 font-bold">
                    已记录 {pathHistory.length} 个点
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPlaybackActive((prev) => {
                          const next = !prev;
                          if (!next) setIsPlaying(false);
                          return next;
                        });
                        sound.playClick();
                      }}
                      className={`text-[10px] font-black px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors border ${
                        playbackActive
                          ? 'bg-amber-500 text-white border-amber-600 shadow-2xs'
                          : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                      }`}
                      title="开启历史足迹时光回放"
                    >
                      <History className="w-2.5 h-2.5" />
                      <span>{playbackActive ? '回放中' : '回放'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStyleMenuOpen((v) => !v);
                        sound.playClick();
                      }}
                      className={`text-[10px] font-black px-2 py-0.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors border ${
                        styleMenuOpen
                          ? 'bg-sky-50 text-sky-600 border-sky-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:text-sky-600'
                      }`}
                      title="自定义迷雾与路径样式"
                    >
                      <Sliders className="w-2.5 h-2.5" />
                      <span>样式</span>
                      {styleMenuOpen ? (
                        <ChevronUp className="w-2.5 h-2.5" />
                      ) : (
                        <ChevronDown className="w-2.5 h-2.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={clearFogAndPath}
                      className="text-[10px] font-black text-rose-500 hover:text-rose-600 flex items-center gap-1 cursor-pointer transition-colors"
                      title="重置迷雾与路径"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>重置</span>
                    </button>
                  </div>
                </div>

                {/* 折叠的迷雾与路径视觉样式菜单 */}
                {styleMenuOpen && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-3">
                    {/* 地图底图画风选择 */}
                    <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-200/80 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-slate-700 flex items-center gap-1">
                          <Layers className="w-3 h-3 text-sky-500" />
                          地图底图画风
                        </span>
                        <span className="text-[9px] font-black text-sky-600">
                          {mapTheme === 'real_hd' ? 'UP实拍' : '经典原画'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setMapTheme('classic');
                            sound.playClick();
                          }}
                          className={`p-1.5 rounded-xl border text-left flex flex-col gap-0.5 cursor-pointer transition-all ${
                            mapTheme === 'classic'
                              ? 'bg-sky-500 text-white border-sky-600 shadow-2xs font-black'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-sky-300'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-black">
                            <span>经典原画地图</span>
                            {mapTheme === 'classic' && <span className="text-[8px] bg-white text-sky-600 px-1 rounded">当前</span>}
                          </div>
                          <div className={`text-[8px] ${mapTheme === 'classic' ? 'text-white/80' : 'text-slate-400'}`}>
                            分级 LOD · 原版地貌
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setMapTheme('real_hd');
                            sound.playClick();
                          }}
                          className={`p-1.5 rounded-xl border text-left flex flex-col gap-0.5 cursor-pointer transition-all ${
                            mapTheme === 'real_hd'
                              ? 'bg-sky-500 text-white border-sky-600 shadow-2xs font-black'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-sky-300'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-black">
                            <span>UP实拍地图</span>
                            {mapTheme === 'real_hd' && <span className="text-[8px] bg-white text-sky-600 px-1 rounded">当前</span>}
                          </div>
                          <div className={`text-[8px] ${mapTheme === 'real_hd' ? 'text-white/80' : 'text-slate-400'}`}>
                            1024瓦片 · 实景拼接
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* 迷雾样式设置 */}
                    <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-200/80 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-slate-700 flex items-center gap-1">
                          <Palette className="w-3 h-3 text-sky-500" />
                          迷雾浓度与色调
                        </span>
                        <span className="text-[10px] font-bold text-sky-600">
                          {Math.round(fogStyle.opacity * 100)}%
                        </span>
                      </div>

                      {/* 迷雾不透明度滑块 */}
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400 font-bold">浅</span>
                        <input
                          type="range"
                          min="0.15"
                          max="0.85"
                          step="0.05"
                          value={fogStyle.opacity}
                          onChange={(e) =>
                            setFogStyle((prev) => ({ ...prev, opacity: parseFloat(e.target.value) }))
                          }
                          className="w-full accent-sky-500 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
                        />
                        <span className="text-[9px] text-slate-400 font-bold">深</span>
                      </div>

                      {/* 迷雾开路光圈半径自定义 */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                        <span className="text-[10px] font-bold text-slate-600">去迷雾光圈半径</span>
                        <span className="text-[10px] font-mono font-bold text-sky-600">
                          {fogStyle.clearRadius || DEFAULT_CLEAR_RADIUS}px
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400 font-bold">小</span>
                        <input
                          type="range"
                          min="180"
                          max="800"
                          step="20"
                          value={fogStyle.clearRadius || DEFAULT_CLEAR_RADIUS}
                          onChange={(e) =>
                            setFogStyle((prev) => ({ ...prev, clearRadius: parseInt(e.target.value, 10) }))
                          }
                          className="w-full accent-sky-500 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
                        />
                        <span className="text-[9px] text-slate-400 font-bold">大</span>
                      </div>

                      {/* 迷雾颜色预设 & 自定义取色 */}
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        {FOG_COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            onClick={() => {
                              setFogStyle((prev) => ({ ...prev, color: preset.value }));
                              sound.playClick();
                            }}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                              fogStyle.color.toLowerCase() === preset.value.toLowerCase()
                                ? 'bg-sky-500 text-white border-sky-600 shadow-2xs'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
                            }`}
                          >
                            <span
                              className="w-2 h-2 rounded-full border border-black/10 inline-block"
                              style={{ backgroundColor: preset.value }}
                            />
                            {preset.label}
                          </button>
                        ))}
                        <label
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-white border-slate-200 hover:border-sky-300 text-slate-600 cursor-pointer flex items-center gap-1"
                          title="自定义迷雾颜色"
                        >
                          <input
                            type="color"
                            value={fogStyle.color}
                            onChange={(e) =>
                              setFogStyle((prev) => ({ ...prev, color: e.target.value }))
                            }
                            className="w-0 h-0 opacity-0 absolute"
                          />
                          <span
                            className="w-2 h-2 rounded-full border border-black/10 inline-block"
                            style={{ backgroundColor: fogStyle.color }}
                          />
                          自定义
                        </label>
                      </div>
                    </div>

                    {/* 自选人物光标图标 */}
                    <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-200/80 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-slate-700 flex items-center gap-1">
                          <Compass className="w-3 h-3 text-sky-500" />
                          人物光标图标
                        </span>
                        <span className="text-[9px] font-bold text-sky-600">
                          {PLAYER_ICON_PRESETS.find((p) => p.id === playerIcon)?.label || '能量晶核'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {PLAYER_ICON_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              setPlayerIcon(preset.id);
                              sound.playClick();
                            }}
                            className={`p-1.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                              playerIcon === preset.id
                                ? 'bg-sky-500 text-white border-sky-600 shadow-2xs font-black'
                                : 'bg-white text-slate-700 border-slate-200 hover:border-sky-300'
                            }`}
                          >
                            <span
                              className="w-3.5 h-3.5 rounded-full border border-white/60 shrink-0 shadow-2xs"
                              style={{ backgroundColor: preset.color }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-black truncate">{preset.label}</div>
                              <div className={`text-[8px] truncate ${playerIcon === preset.id ? 'text-white/80' : 'text-slate-400'}`}>
                                {preset.desc}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 移动路径样式设置 */}
                    <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-200/80 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-slate-700 flex items-center gap-1">
                          <Navigation className="w-3 h-3 text-sky-500" />
                          轨迹线风格与粗细
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPathStyle((prev) => ({ ...prev, glow: !prev.glow }));
                            sound.playClick();
                          }}
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                            pathStyle.glow
                              ? 'bg-sky-100 text-sky-700 border-sky-300'
                              : 'bg-slate-100 text-slate-400 border-slate-200'
                          }`}
                          title="开启/关闭路径荧光光晕"
                        >
                          {pathStyle.glow ? '✨ 光晕开启' : '光晕关闭'}
                        </button>
                      </div>

                      {/* 线条风格选择：虚线 / 实线 / 点线 */}
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            { id: 'dashed', label: '虚线', pattern: '╌╌╌' },
                            { id: 'solid', label: '实线', pattern: '───' },
                            { id: 'dotted', label: '点线', pattern: '····' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setPathStyle((prev) => ({ ...prev, lineStyle: opt.id }));
                              sound.playClick();
                            }}
                            className={`py-1 px-1 rounded-lg text-[10px] font-black border text-center transition-all cursor-pointer ${
                              pathStyle.lineStyle === opt.id
                                ? 'bg-[#5DA8E8] text-white border-[#4A97D8] shadow-2xs'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
                            }`}
                          >
                            <div>{opt.label}</div>
                            <div className="text-[8px] opacity-75 font-mono">{opt.pattern}</div>
                          </button>
                        ))}
                      </div>

                      {/* 路径粗细滑块 */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] text-slate-400 font-bold">细</span>
                        <input
                          type="range"
                          min="1"
                          max="7"
                          step="1"
                          value={pathStyle.lineWidth}
                          onChange={(e) =>
                            setPathStyle((prev) => ({ ...prev, lineWidth: parseInt(e.target.value, 10) }))
                          }
                          className="w-full accent-sky-500 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
                        />
                        <span className="text-[9px] text-slate-400 font-bold">粗</span>
                        <span className="text-[10px] font-mono font-bold text-sky-600 w-4 text-right">
                          {pathStyle.lineWidth}px
                        </span>
                      </div>

                      {/* 路径颜色预设 & 自定义取色 */}
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        {PATH_COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            type="button"
                            onClick={() => {
                              setPathStyle((prev) => ({ ...prev, color: preset.value }));
                              sound.playClick();
                            }}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                              pathStyle.color.toLowerCase() === preset.value.toLowerCase()
                                ? 'bg-sky-500 text-white border-sky-600 shadow-2xs'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'
                            }`}
                          >
                            <span
                              className="w-2 h-2 rounded-full border border-black/10 inline-block"
                              style={{ backgroundColor: preset.value }}
                            />
                            {preset.label}
                          </button>
                        ))}
                        <label
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-white border-slate-200 hover:border-sky-300 text-slate-600 cursor-pointer flex items-center gap-1"
                          title="自定义轨迹颜色"
                        >
                          <input
                            type="color"
                            value={pathStyle.color}
                            onChange={(e) =>
                              setPathStyle((prev) => ({ ...prev, color: e.target.value }))
                            }
                            className="w-0 h-0 opacity-0 absolute"
                          />
                          <span
                            className="w-2 h-2 rounded-full border border-black/10 inline-block"
                            style={{ backgroundColor: pathStyle.color }}
                          />
                          自定义
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 收起状态下：左侧边缘优雅的悬浮拉出按键 */}
            {toolbarCollapsed && (
              <button
                type="button"
                onClick={() => {
                  setToolbarCollapsed(false);
                  sound.playClick();
                }}
                className="pointer-events-auto absolute top-4 left-3 sm:left-4 z-40 roco-card px-3 py-2 text-xs font-black text-[#2B78C4] hover:border-[#7ABCF4] shadow-lg flex items-center gap-1.5 bg-white/95 backdrop-blur-md cursor-pointer transition-all active:scale-95 animate-in fade-in zoom-in-95 duration-150"
                title="展开地图探索与路径设置面板"
                aria-label="展开工具栏"
              >
                <Sliders className="w-3.5 h-3.5 text-[#7ABCF4]" />
                <span>地图设置</span>
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

// ---- 辅助小组件 ----

interface LayerToggleProps {
  label: string;
  icon: React.ReactNode;
  on: boolean;
  onToggle: () => void;
}

const LayerToggle: React.FC<LayerToggleProps> = ({ label, icon, on, onToggle }) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 text-left transition-all cursor-pointer ${
        on
          ? 'border-[#7ABCF4] bg-[#7ABCF4]/10 text-[#2B78C4]'
          : 'border-[#E6EEF8] bg-white text-slate-400 hover:bg-slate-50'
      }`}
    >
      <span className={on ? 'text-[#7ABCF4]' : 'text-slate-300'}>{icon}</span>
      <span className="flex-1 text-xs font-black">{label}</span>
      {on ? <Eye className="w-4 h-4 text-[#7ABCF4]" /> : <EyeOff className="w-4 h-4 text-slate-300" />}
    </button>
  );
};

interface TagProps {
  color: string;
  icon: React.ReactNode;
  label: string;
}

const Tag: React.FC<TagProps> = ({ color, icon, label }) => {
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold ${color}`}>
      {icon}
      {label}
    </span>
  );
};

const PET_EMOJI: Record<string, string> = {
  迪莫: '⭐',
  水蓝蓝: '💧',
  火花: '🔥',
  喵喵: '🐱',
  音速犬: '🐺',
  雪绒鸟: '🐦',
  闪电鸟: '⚡',
  音符: '🎵',
};
