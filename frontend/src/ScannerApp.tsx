// noinspection JSRemoveUnnecessaryParentheses

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Camera,
  Play,
  Square,
  Layers,
  Check,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  MapPin,
  Sparkle,
  Radio,
  Eye,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { PetItem, EncounterRecord, MapConfig, FollowRecognizeApiResponse } from './types';
import { MAP_CONFIGS, FALLBACK_MAPS_DATA } from './data/mockPets';
import { sound } from './services/sound';
import { api } from './services/api';
import { storage } from './services/storage';
import { fireEncounterConfetti, fireUnencounterEffect } from './services/effect';
import { EffectLevel } from './types';
import { ScannerMapGalleryModal } from './components/ScannerMapGalleryModal';
import {
  formatPetName,
  isSamePetName,
  isPetEncounteredInRecords,
  getBasePetName,
} from './utils/petHelper';

interface DetectedPetSlot {
  id: string;
  name: string;
  score: number;
  candidates: { filename: string; score: number }[];
  selectedCandidateIndex: number;
  selectedPetName: string;
  matchedPet?: PetItem;
}

export const ScannerApp: React.FC = () => {
  // Map num confirmed from last backend recognition (null on initial load, or 1, 2, 3)
  const [detectedMapNum, setDetectedMapNum] = useState<number | null>(null);
  // Map num currently selected by user in UI (can be switched freely before re-recognizing)
  const [selectedMapNum, setSelectedMapNum] = useState<number | null>(null);

  // Storage and records
  const [records, setRecords] = useState<Record<string, EncounterRecord>>(() => storage.getAll());
  const [mapsPets, setMapsPets] = useState<Record<string, { count: number; items: PetItem[] }>>(FALLBACK_MAPS_DATA);

  // Recognition process status
  const [isRecognizingNow, setIsRecognizingNow] = useState<boolean>(false);
  const [showRadarAnimation, setShowRadarAnimation] = useState<boolean>(false);
  const [lastScanTime, setLastScanTime] = useState<string>('未识别');

  // Backend connection & collapsed state
  const [, setIsRealBackendConnected] = useState<boolean>(false);
  const [isCollapsedContent, setIsCollapsedContent] = useState<boolean>(false);

  // Detected pets list (0 to 3 pets)
  const [detectedPets, setDetectedPets] = useState<DetectedPetSlot[]>([]);

  // Gallery Modal state (for browsing other maps and full gallery)
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);

  // Active viewing map number (selectedMapNum takes precedence, otherwise detectedMapNum)
  const activeMapNum = selectedMapNum !== null ? selectedMapNum : detectedMapNum;

  // Whether user manually switched to a different map from what was previously detected
  const hasPendingMapChange = detectedMapNum !== null && selectedMapNum !== null && selectedMapNum !== detectedMapNum;

  // Subscribe to storage changes & load icons
  useEffect(() => {
    document.body.classList.add('scanner-transparent-mode');
    return () => {
      document.body.classList.remove('scanner-transparent-mode');
    };
  }, []);

  useEffect(() => {
    const unsub = storage.subscribe((newRecords) => {
      setRecords(newRecords);
    });

    api.getIcons().then((res) => {
      if (res.data) {
        setMapsPets(res.data);
      }
    });

    // Check game status on initial load
    api.checkGameStatus().then((statusRes) => {
      setIsRealBackendConnected(!statusRes.isOfflineMock);
    });

    return () => {
      unsub();
    };
  }, []);

  // Calculate statistics across all maps
  const allMapsStats = useMemo(() => {
    const activePetsMap = mapsPets || FALLBACK_MAPS_DATA;
    let grandTotal = 0;
    let grandEncountered = 0;

    const mapList = MAP_CONFIGS.map((m) => {
      const mapKey = `map${m.num}`;
      const petsOnMap: PetItem[] = activePetsMap[mapKey]?.items || FALLBACK_MAPS_DATA[mapKey]?.items || [];
      const total = petsOnMap.length;
      const encountered = petsOnMap.filter((p) =>
          isPetEncounteredInRecords(records, mapKey, p.name)
      ).length;
      const percent = total > 0 ? (encountered / total) * 100 : 0;
      const remaining = total - encountered;

      grandTotal += total;
      grandEncountered += encountered;

      return {
        config: m,
        mapKey,
        total,
        encountered,
        percent,
        remaining,
      };
    });

    const grandPercent = grandTotal > 0 ? (grandEncountered / grandTotal) * 100 : 0;
    const grandRemaining = grandTotal - grandEncountered;

    return {
      mapList,
      grandTotal,
      grandEncountered,
      grandPercent,
      grandRemaining,
    };
  }, [records, mapsPets]);

  // Fast map reference lookup
  const currentDetectedMap: MapConfig = useMemo(() => {
    if (activeMapNum === null) {
      return {
        id: 'map_all',
        num: 0,
        name: '跟随识别',
        description: '王国全境',
        themeColor: '#7ABCF4',
        bgGradient: 'from-blue-500/20 to-sky-500/20',
        badgeBg: 'bg-blue-500/15 text-blue-800 border-blue-400',
        iconName: 'Compass',
      };
    }
    const found = MAP_CONFIGS.find((m) => m.num === activeMapNum);
    if (found) return found;
    return {
      id: `map${activeMapNum}`,
      num: activeMapNum,
      name: `地图 ${activeMapNum}`,
      description: '王国区域',
      themeColor: '#7ABCF4',
      bgGradient: 'from-blue-500/20 to-sky-500/20',
      badgeBg: 'bg-blue-500/15 text-blue-800 border-blue-400',
      iconName: 'Compass',
    };
  }, [activeMapNum]);

  // Clean filename to standard pet name
  const formatPetName = (rawName: string): string => {
    if (!rawName) return '未知精灵';
    let clean = rawName.trim();
    if (clean.includes('.')) {
      clean = clean.split('.')[0];
    }
    return clean;
  };

  // Check if a pet is encountered in records
  const checkEncountered = (petName: string): boolean => {
    const mapKey = `map${activeMapNum || 1}`;
    return isPetEncounteredInRecords(records, mapKey, petName);
  };

  // Find rich pet metadata
  const findPetMetadata = (name: string): PetItem | undefined => {
    const activePetsMap = mapsPets || FALLBACK_MAPS_DATA;
    for (const key of Object.keys(activePetsMap)) {
      const items = activePetsMap[key]?.items || [];
      const found = items.find((p) => isSamePetName(p.name, name));
      if (found) return found;
    }
    return undefined;
  };

  // Map progress calculation for the active detected map
  const mapCollectionStats = useMemo(() => {
    const mapKey = `map${activeMapNum || 1}`;
    const activePetsMap = mapsPets || FALLBACK_MAPS_DATA;
    const petsOnMap: PetItem[] = activePetsMap[mapKey]?.items || FALLBACK_MAPS_DATA[mapKey]?.items || [];
    const total = petsOnMap.length;
    if (total === 0) {
      return { total: 0, encountered: 0, percent: 0, remaining: 0 };
    }

    const encounteredCount = petsOnMap.filter((p) =>
        isPetEncounteredInRecords(records, mapKey, p.name)
    ).length;

    const percent = (encounteredCount / total) * 100;
    const remaining = total - encounteredCount;
    return { total, encountered: encounteredCount, percent, remaining };
  }, [activeMapNum, records, mapsPets]);

  // Handle manual map selection (does NOT trigger recognition, only changes view/pending target)
  const handleSelectMap = (mapNum: number | null) => {
    sound.playClick();
    setSelectedMapNum(mapNum);
  };

  // Handle single candidate choice switch
  const handleSelectCandidate = (slotId: string, candidateIndex: number) => {
    sound.playClick();
    setDetectedPets((prev) =>
        prev.map((slot) => {
          if (slot.id !== slotId) return slot;
          const targetCand = slot.candidates[candidateIndex];
          if (!targetCand) return slot;
          const newSelectedName = targetCand.filename;
          const matched = findPetMetadata(newSelectedName);
          return {
            ...slot,
            selectedCandidateIndex: candidateIndex,
            selectedPetName: newSelectedName,
            score: targetCand.score,
            matchedPet: matched,
          };
        })
    );
  };

  // Mark/unmark single pet
  const handleTogglePetEncounter = (petName: string) => {
    const mapKey = `map${activeMapNum || 1}`;
    const wasEncountered = storage.isEncountered(mapKey, petName);
    storage.toggleEncountered(mapKey, petName);

    const level = storage.getSetting<EffectLevel>('effectLevel', 0);
    if (!wasEncountered) {
      sound.playEncounter();
      fireEncounterConfetti(level);
    } else {
      sound.playToggleOff();
      fireUnencounterEffect(level);
    }
  };

  // Process response into state
  const applyApiResults = (data: FollowRecognizeApiResponse) => {
    // Always use the real map_num returned by the backend recognition
    const targetMap = (data.map_num !== undefined && data.map_num !== null) ? Number(data.map_num) : 1;
    setDetectedMapNum(targetMap);
    setSelectedMapNum(targetMap); // Reset manual selection so activeMapNum follows the recognized map

    // 同步给左侧主界面（通过 storage settings 以及跨窗口消息）
    storage.setSetting('activeMapNum', targetMap);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('roco_active_map_num', String(targetMap));
        if ('BroadcastChannel' in window) {
          const bc = new BroadcastChannel('roco_channel');
          bc.postMessage({ type: 'SWITCH_MAP', mapNum: targetMap });
          bc.close();
        }
        if (window.opener) {
          window.opener.postMessage({ type: 'SWITCH_MAP', mapNum: targetMap }, '*');
        }
      }
    } catch (e) {
      console.warn('Sync map message error:', e);
    }

    const rawList = data.results || [];
    const cappedList = rawList.slice(0, 3);

    const formattedSlots: DetectedPetSlot[] = cappedList.map((item, idx) => {
      const topCand = item.candidates?.[0];
      const initialName = item.filename || topCand?.filename || '未知精灵';
      const initialScore = item.score ?? topCand?.score ?? 0.95;
      const matched = findPetMetadata(initialName);

      const candidateList = (item.candidates || [{ filename: initialName, score: initialScore }]).slice(0, 3);

      return {
        id: `slot-${idx}-${Date.now()}`,
        name: initialName,
        score: initialScore,
        view_url: item.view_url,
        candidates: candidateList.map((c) => ({
          filename: c.filename || '未知精灵',
          score: typeof c.score === 'number' ? c.score : 0.85,
        })),
        selectedCandidateIndex: 0,
        selectedPetName: initialName,
        matchedPet: matched,
      };
    });

    setDetectedPets(formattedSlots);

    const now = new Date();
    setLastScanTime(
        `${now.getHours().toString().padStart(2, '0')}:${now
            .getMinutes()
            .toString()
            .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    );
  };

  const executeSingleRecognition = async (targetMapNum?: number) => {
    if (isRecognizingNow) return;
    setIsRecognizingNow(true);
    setShowRadarAnimation(true);
    setTimeout(() => setShowRadarAnimation(false), 1300);
    sound.playClick();

    // 通知左侧主页面展示轻量扫描联动特效
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('roco_scan_trigger', String(Date.now()));
        if ('BroadcastChannel' in window) {
          const bc = new BroadcastChannel('roco_channel');
          bc.postMessage({ type: 'SCAN_TRIGGERED', timestamp: Date.now() });
          bc.close();
        }
        if (window.opener) {
          window.opener.postMessage({ type: 'SCAN_TRIGGERED', timestamp: Date.now() }, '*');
        }
      }
    } catch (e) {
      console.warn('Sync scan trigger error:', e);
    }

    try {
      const isReRecognize = hasPendingMapChange && selectedMapNum !== null;
      const targetMap = isReRecognize ? selectedMapNum : (targetMapNum !== undefined ? targetMapNum : undefined);

      const pyApi = (window as any).pywebview?.api;
      let capRes: any = null;

      if (pyApi) {
        if (isReRecognize && targetMap) {
          // 重新识别：指定地图识别
          console.log(`[PyWebView] 调用 capture_and_recognize_by_map(${targetMap})`);
          if (typeof pyApi.capture_and_recognize_by_map === 'function') {
            capRes = await pyApi.capture_and_recognize_by_map(targetMap);
          } else {
            // 兼容降级
            capRes = await pyApi.capture_and_recognize("洛克王国：世界", targetMap);
          }
        } else {
          // 立即识别：全自动识别游戏画面
          console.log('[PyWebView] 调用 capture_and_recognize("洛克王国：世界")');
          capRes = await pyApi.capture_and_recognize("洛克王国：世界");
        }

        console.log("识别结果:", capRes);
        if (capRes) {
          // 将结果交由 applyApiResults 或 followRecognize 进行结构规整
          const res = await api.followRecognize(capRes);
          if (res.data) {
            applyApiResults(res.data);
          }
        } else {
          console.warn("截图识别返回为空");
        }
      } else {
        // 未检测到 Python API 时的 Web 端开发/测试降级调用
        console.warn("未找到 Python API 桥接，使用 HTTP 降级");
        const res = await api.followRecognize(targetMap);
        if (res.data) {
          applyApiResults(res.data);
        }
      }
    } catch (err) {
      console.warn('捕获并识别流程出错:', err);
    } finally {
      setIsRecognizingNow(false);
    }
  };

  const handleCloseWindow = async () => {
    sound.playClick();
    const pyApi = (window as any).pywebview?.api?.close_current_window;
    if (pyApi) {
      console.log("进入pywebview关闭逻辑");
      await pyApi();
      return;
    } else if (window.opener) {
      window.close();
    } else {
      window.location.href = '/';
    }
  };

  return (
      <div className="w-screen h-screen bg-[#FDF9F3] text-slate-800 flex flex-col justify-between select-none overflow-hidden font-sans border-0 m-0 p-0 relative rounded-none">
        {/* Subtle Scan Shimmer Radar Effect */}
        {showRadarAnimation && <div className="scanner-radar-active" />}

        {/* ------------------------------------------------------------- */}
        {/* 1. Main App Match Titlebar: Roco Sky Blue (#7ABCF4) */}
        {/* ------------------------------------------------------------- */}
        <div className="h-11 px-3 bg-[#7ABCF4] border-b-4 border-[#5DA8E8] flex items-center justify-between gap-2 pywebview-drag-region cursor-move shrink-0 text-white rounded-none">
          <div className="flex items-center gap-2 min-w-0 pointer-events-none">
            <div className="w-7 h-7 rounded-xl bg-white/20 border-2 border-white/40 flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs sm:text-sm font-black text-white truncate tracking-tight">
                {activeMapNum === null ? '跟随识别' : currentDetectedMap.name}
              </span>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FEE061] text-[#854D0E] border-2 border-[#E5C43B] shrink-0 font-mono">
                {activeMapNum === null
                    ? `全图 ${allMapsStats.grandEncountered}/${allMapsStats.grandTotal}`
                    : `地图 ${activeMapNum}`}
              </span>
            </div>
          </div>

          {/* Right side status & action buttons */}
          <div className="flex items-center gap-1.5 shrink-0 pywebview-no-drag">
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setIsGalleryOpen(true);
                }}
                className="px-2.5 py-1 rounded-xl bg-[#FEE061] hover:bg-[#F4D349] active:opacity-80 text-[#854D0E] flex items-center gap-1.5 text-xs font-black transition-all cursor-pointer border-2 border-[#E5C43B] mr-0.5"
                title="查看全部地图图鉴与全图名册"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>查图鉴</span>
            </button>
            <button
                type="button"
                id="scanner-standalone-close-btn"
                onClick={handleCloseWindow}
                className="w-7 h-7 rounded-xl bg-white/20 hover:bg-rose-500 text-white border-2 border-white/40 hover:border-rose-600 flex items-center justify-center transition-all cursor-pointer active:opacity-80"
                title="关闭窗口"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 2. Main Content Area: Roco Light Clean Aesthetics (Zero-Gap) */}
        {/* ------------------------------------------------------------- */}
        <div className="flex-1 flex flex-col justify-between overflow-y-auto bg-[#FDF9F3] p-3 gap-2.5">
          {!isCollapsedContent ? (
              <div className="space-y-2.5">
                {/* 2.1 Collection Progress Card */}
                {activeMapNum === null ? (
                    /* Initial State: Show all maps overview */
                    <div className="p-3 bg-white roco-card border-2 border-[#E6EEF8] rounded-2xl space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-800 font-black flex items-center gap-1.5">
                          <Layers className="w-4 h-4 text-[#7ABCF4]" />
                          王国各区域图鉴总览
                        </span>
                        <span className="text-xs font-mono font-black text-[#2D6613] bg-[#E1F7DB] px-2 py-0.5 rounded-full border border-[#95D151]/50">
                          {allMapsStats.grandEncountered}/{allMapsStats.grandTotal} ({allMapsStats.grandPercent.toFixed(0)}%)
                        </span>
                      </div>

                      {/* Total progress bar */}
                      <div className="w-full h-2.5 bg-[#E9F2FA] rounded-full overflow-hidden border-2 border-[#D5E3F0] p-0.5">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-[#7ABCF4] via-[#95D151] to-[#76B032] transition-all duration-300"
                            style={{ width: `${allMapsStats.grandPercent}%` }}
                        />
                      </div>

                      {/* 3 Maps Compact Breakdown */}
                      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                        {allMapsStats.mapList.map((m) => (
                            <button
                                key={m.config.id}
                                type="button"
                                onClick={() => handleSelectMap(m.config.num)}
                                className="p-2 rounded-xl bg-[#F8FBFE] hover:bg-[#EBF5FE] border-2 border-[#D5E3F0] hover:border-[#7ABCF4] text-left transition-all cursor-pointer group"
                                title={`点击切换查看 ${m.config.name}`}
                            >
                              <div className="text-[11px] font-black text-slate-800 truncate group-hover:text-[#1E5B99]">
                                {m.config.name}
                              </div>
                              <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                                <span className="font-bold text-[#2D6613]">{m.encountered}/{m.total}</span>
                                <span className="text-slate-400 font-sans">{m.percent.toFixed(0)}%</span>
                              </div>
                            </button>
                        ))}
                      </div>
                    </div>
                ) : (
                    /* Active Selected/Detected Map Progress Card */
                    <div className="p-3 bg-white roco-card border-2 border-[#E6EEF8] rounded-2xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-800 font-black flex items-center gap-1.5">
                          <Layers className="w-4 h-4 text-[#7ABCF4]" />
                          {currentDetectedMap.name} 收集进度
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-black text-[#2D6613] bg-[#E1F7DB] px-2 py-0.5 rounded-full border border-[#95D151]/50">
                            {mapCollectionStats.encountered}/{mapCollectionStats.total}
                          </span>
                          {mapCollectionStats.remaining > 0 ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                                余 {mapCollectionStats.remaining}
                              </span>
                          ) : (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                                全收录 🎉
                              </span>
                          )}
                        </div>
                      </div>

                      {/* High Contrast Progress Bar */}
                      <div className="w-full h-2.5 bg-[#E9F2FA] rounded-full overflow-hidden border-2 border-[#D5E3F0] p-0.5">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-[#95D151] to-[#76B032] transition-all duration-300"
                            style={{ width: `${mapCollectionStats.percent}%` }}
                        />
                      </div>

                      {/* Pending re-recognition banner if user manually switched map */}
                      {hasPendingMapChange && (
                          <div className="text-[11px] font-bold text-[#854D0E] bg-[#FEF9E6] border border-[#E5C43B] rounded-xl px-2.5 py-1.5 flex items-center justify-between">
                            <span>已指定为【{currentDetectedMap.name}】</span>
                            <span className="text-[10px] bg-[#FEE061] text-[#854D0E] font-black px-2 py-0.5 rounded-full border border-[#E5C43B]">
                              待重新识别
                            </span>
                          </div>
                      )}

                      {/* Map Switcher Bar */}
                      <div className="pt-1.5 border-t border-[#EDF2F7] flex items-center justify-between gap-1.5">
                        <span className="text-[10px] font-black text-slate-500 shrink-0">
                          切换地图:
                        </span>
                        <div className="grid grid-cols-4 gap-1 flex-1">
                          <button
                              type="button"
                              onClick={() => handleSelectMap(null)}
                              className={`py-1 px-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer truncate ${
                                  activeMapNum === null
                                      ? 'bg-[#7ABCF4] text-white border-[#5DA8E8]'
                                      : 'bg-[#F8FBFE] hover:bg-[#EBF5FE] text-slate-700 border-[#D5E3F0]'
                              }`}
                              title="查看王国各区域总览"
                          >
                            全图
                          </button>
                          {MAP_CONFIGS.map((m) => {
                            const isSelected = activeMapNum === m.num;
                            const mapShort = m.num === 1 ? '图1 索米亚' : m.num === 2 ? '图2 巨石阵' : m.num === 3 ? '图3 普拉塔' : `图${m.num}`;
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => handleSelectMap(m.num)}
                                    className={`py-1 px-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer truncate ${
                                        isSelected
                                            ? 'bg-[#7ABCF4] text-white border-[#5DA8E8] shadow-xs'
                                            : 'bg-[#F8FBFE] hover:bg-[#EBF5FE] text-slate-700 border-[#D5E3F0] hover:border-[#7ABCF4]'
                                    }`}
                                    title={`切换为 ${m.name}`}
                                >
                                  {mapShort}
                                </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                )}

                {/* 2.2 Detected Pets List */}
                {detectedPets.length === 0 ? (
                    <div className="p-5 bg-white roco-card border-2 border-[#E6EEF8] rounded-2xl text-center space-y-2">
                      <div className="w-10 h-10 rounded-2xl bg-[#EBF5FE] text-[#7ABCF4] flex items-center justify-center mx-auto border-2 border-[#D5E3F0]">
                        <Eye className="w-5 h-5" />
                      </div>
                      <p className="text-xs font-black text-slate-800">当前未检测到精灵</p>
                    </div>
                ) : (
                    detectedPets.map((slot) => {
                      const displayName = formatPetName(slot.selectedPetName);

                      const rawName = slot.selectedPetName || '';
                      const cleanName = displayName.trim();
                      // 检查是否为占位区间（魔力之源 或 远行商人）
                      const isSpecialPlaceholder =
                          cleanName === '魔力之源' ||
                          rawName.includes('魔力之源') ||
                          cleanName === '远行商人' ||
                          rawName.includes('远行商人');

                      if (isSpecialPlaceholder) {
                        return (
                            <div
                                key={slot.id}
                                className="rounded-2xl border-2 border-dashed border-[#BCD7F2] bg-[#F4F9FF] p-3 text-center flex items-center justify-between gap-2.5"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-10 h-10 rounded-2xl bg-white border-2 border-[#D5E3F0] flex items-center justify-center text-amber-500 font-bold text-base shrink-0">
                                  {cleanName.includes('魔力之源') ? '✨' : '🎒'}
                                </div>
                                <div className="text-left min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-black text-slate-800 truncate">
                                      【特殊点位】{cleanName}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 mt-0.5 truncate font-medium">
                                    场景特殊交互点，无需点亮图鉴
                                  </p>
                                </div>
                              </div>
                            </div>
                        );
                      }

                      const isEncountered = checkEncountered(slot.selectedPetName);
                      const topScorePercent = (slot.score * 100).toFixed(1);

                      return (
                          <div
                              key={slot.id}
                              className={`roco-card rounded-2xl border-2 p-3 transition-all ${
                                  isEncountered
                                      ? 'bg-[#F8FBFE] border-[#D5E3F0] text-slate-600'
                                      : 'bg-white border-[#7ABCF4] text-slate-800'
                              }`}
                          >
                            {/* Header: Avatar, Name, Status, Action */}
                            <div className="flex items-center justify-between gap-2.5 mb-2.5">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {/* Pet Image */}
                                <div className="relative w-12 h-12 rounded-2xl bg-white border-2 border-[#D5E3F0] p-1 flex items-center justify-center shrink-0 overflow-hidden">
                                  <img
                                      src={`${api.getApiBase()}/icons/map${detectedMapNum || 1}/${displayName}.png`}
                                      alt={displayName}
                                      className="w-full h-full object-contain"
                                      onError={(e) => {
                                        if (slot.matchedPet?.url) {
                                          (e.target as HTMLImageElement).src = slot.matchedPet.url;
                                        }
                                      }}
                                  />
                                </div>

                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs sm:text-sm font-black text-slate-800 truncate" title={displayName}>
                                      {displayName}
                                    </span>
                                    <span className="text-[10px] font-mono font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                                      {topScorePercent}%
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1 mt-1">
                                    {isEncountered ? (
                                        <span className="text-[10px] font-bold text-[#2D6613] bg-[#E1F7DB] px-2 py-0.5 rounded-full border border-[#95D151]/50 flex items-center gap-1">
                                          <Check className="w-3 h-3 text-emerald-600 stroke-[3]" />
                                          已在图鉴
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-black text-amber-800 bg-[#FEF9E6] px-2 py-0.5 rounded-full border border-[#E5C43B] flex items-center gap-1">
                                          <Sparkle className="w-3 h-3 text-amber-600 fill-amber-500" />
                                          未遇新宠 (可点亮)
                                        </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Toggle Encounter Button */}
                              <button
                                  type="button"
                                  onClick={() => handleTogglePetEncounter(slot.selectedPetName)}
                                  className={`px-3 py-1.5 text-xs font-black rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border-2 ${
                                      isEncountered
                                          ? 'roco-btn-secondary bg-[#E1F7DB]/80 hover:bg-[#D3F3CA] text-[#2D6613] border-[#86EFAC]'
                                          : 'roco-btn-success text-white'
                                  }`}
                                  title={isEncountered ? '已在图鉴（点击取消）' : '点击点亮图鉴'}
                              >
                                {isEncountered ? (
                                    <>
                                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                      <span>已遇见</span>
                                    </>
                                ) : (
                                    <>
                                      <CheckCircle2 className="w-4 h-4" />
                                      <span>点亮图鉴</span>
                                    </>
                                )}
                              </button>
                            </div>

                            {/* Candidate Switcher */}
                            {slot.candidates && slot.candidates.length > 1 && (
                                <div className="pt-2 border-t-2 border-[#F1F5F9]">
                                  <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5 font-bold">
                                    <span>候选置信度排行:</span>
                                    <span className="font-mono text-[#1E5B99]">选定: #{slot.selectedCandidateIndex + 1}</span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {slot.candidates.slice(0, 3).map((cand, cIdx) => {
                                      const isSelected = cIdx === slot.selectedCandidateIndex;
                                      const candName = formatPetName(cand.filename);
                                      const candPercent = (cand.score * 100).toFixed(1);

                                      return (
                                          <button
                                              key={cand.filename + cIdx}
                                              type="button"
                                              onClick={() => handleSelectCandidate(slot.id, cIdx)}
                                              className={`p-1.5 rounded-xl text-left transition-all cursor-pointer border-2 ${
                                                  isSelected
                                                      ? 'bg-[#EBF5FE] border-[#7ABCF4] text-[#1E5B99] font-black'
                                                      : 'bg-[#F8FBFE] border-[#E2E8F0] text-slate-600 hover:border-[#BCD7F2] hover:bg-[#E9F2FA]'
                                              }`}
                                          >
                                            <div className="flex items-center justify-between text-[9px] font-mono">
                                              <span className="text-slate-400 font-bold">
                                                {checkEncountered(candName) ? (
                                                    <span className="text-[9px] font-bold text-[#2D6613] bg-[#E1F7DB] px-1.5 py-0.2 rounded-full border border-[#95D151]/40 flex items-center gap-0.5">
                                                      <Check className="w-2 h-2 text-emerald-600 stroke-[3]" />
                                                      #{cIdx + 1}
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] font-black text-amber-800 bg-[#FEF9E6] px-1.5 py-0.2 rounded-full border border-[#E5C43B]/60 flex items-center gap-0.5">
                                                      <Sparkle className="w-2 h-2 text-amber-600" />
                                                      #{cIdx + 1}
                                                    </span>
                                                )}
                                              </span>
                                              <span className={isSelected ? 'text-[#1E5B99] font-black' : 'text-slate-500'}>
                                                {candPercent}%
                                              </span>
                                            </div>

                                            <div className="text-[11px] font-bold truncate mt-1" title={candName}>
                                              {candName}
                                            </div>
                                          </button>
                                      );
                                    })}
                                  </div>
                                </div>
                            )}
                          </div>
                      );
                    })
                )}
              </div>
          ) : (
              <div className="p-3 bg-white roco-card border-2 border-[#DCE8F5] rounded-2xl flex items-center justify-between">
                <span className="text-xs text-slate-500 font-bold">识别信息已收起</span>
                <button
                    type="button"
                    onClick={() => setIsCollapsedContent(false)}
                    className="text-xs font-black text-[#1E5B99] hover:underline"
                >
                  展开完整视图
                </button>
              </div>
          )}

          {/* 2.3 Bottom Action Buttons (Main app matched buttons) */}
          <div className="pt-2 border-t-2 border-[#D5E3F0] space-y-2 shrink-0">
            <div className="grid grid-cols-1 gap-2">
              <button
                  type="button"
                  id="scanner-single-recognize-btn"
                  onClick={() => executeSingleRecognition(activeMapNum || undefined)}
                  disabled={isRecognizingNow}
                  className={`py-2.5 px-4 rounded-2xl text-sm font-black flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      hasPendingMapChange
                          ? 'bg-[#FEE061] hover:bg-[#F4D349] text-[#854D0E] border-2 border-[#E5C43B] shadow-sm active:scale-[0.99]'
                          : 'roco-btn-primary'
                  }`}
              >
                {isRecognizingNow ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在智能识别画面...</span>
                    </>
                ) : hasPendingMapChange ? (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>重新识别 (指定地图{activeMapNum})</span>
                    </>
                ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      <span>立即识别当前游戏画面</span>
                    </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 3. Micro Status Bar */}
        {/* ------------------------------------------------------------- */}
        <div className="h-7 px-3 bg-[#E9F2FA] border-t-2 border-[#D5E3F0] text-[11px] font-mono text-slate-600 flex items-center justify-between shrink-0 font-bold rounded-none">
          <span>上次捕获: {lastScanTime}</span>
          <span className="text-[10px] text-slate-400 font-sans">洛克王国草系徽章试炼助手</span>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 4. Scanner Map & All Pet Gallery Modal */}
        {/* ------------------------------------------------------------- */}
        <ScannerMapGalleryModal
            isOpen={isGalleryOpen}
            onClose={() => setIsGalleryOpen(false)}
            initialMapNum={detectedMapNum || 1}
            mapsPets={mapsPets}
            records={records}
        />
      </div>
  );
};
