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
import { ScannerMapGalleryModal } from './components/ScannerMapGalleryModal';

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
  // Current active detected map (1, 2, 3)
  const [detectedMapNum, setDetectedMapNum] = useState<number>(1);

  // Storage and records
  const [records, setRecords] = useState<Record<string, EncounterRecord>>(() => storage.getAll());
  const [mapsPets, setMapsPets] = useState<Record<string, { count: number; items: PetItem[] }>>(FALLBACK_MAPS_DATA);

  // Recognition process status
  const [isRecognizingNow, setIsRecognizingNow] = useState<boolean>(false);
  const [lastScanTime, setLastScanTime] = useState<string>('刚刚');

  // Backend connection & collapsed state
  const [, setIsRealBackendConnected] = useState<boolean>(false);
  const [isCollapsedContent, setIsCollapsedContent] = useState<boolean>(false);

  // Detected pets list (0 to 3 pets)
  const [detectedPets, setDetectedPets] = useState<DetectedPetSlot[]>([]);

  // Gallery Modal state (for browsing other maps and full gallery)
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);

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
      // executeSingleRecognition();
    });

    return () => {
      unsub();
    };
  }, []);

  // Fast map reference lookup
  const currentDetectedMap: MapConfig = useMemo(() => {
    const found = MAP_CONFIGS.find((m) => m.num === detectedMapNum);
    if (found) return found;
    return MAP_CONFIGS[0] || {
      id: `map${detectedMapNum}`,
      num: detectedMapNum,
      name: `地图 ${detectedMapNum}`,
      description: '王国区域',
      themeColor: '#7ABCF4',
      bgGradient: 'from-blue-500/20 to-sky-500/20',
      badgeBg: 'bg-blue-500/15 text-blue-800 border-blue-400',
      iconName: 'Compass',
    };
  }, [detectedMapNum]);

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
    const formatted = formatPetName(petName);
    const mapKey = `map${detectedMapNum}`;
    const directKey = `${mapKey}_${petName}`;
    const directFormattedKey = `${mapKey}_${formatted}`;

    if (records[directKey]?.encountered || records[directFormattedKey]?.encountered) {
      return true;
    }

    return (Object.values(records) as EncounterRecord[]).some((rec) => {
      if (!rec || !rec.encountered) return false;
      const recFormatted = formatPetName(rec.filename);
      return (
          rec.mapId === mapKey && (recFormatted === formatted || rec.filename === petName)
      );
    });
  };

  // Find rich pet metadata
  const findPetMetadata = (name: string): PetItem | undefined => {
    const formatted = formatPetName(name);
    const activePetsMap = mapsPets || FALLBACK_MAPS_DATA;
    for (const key of Object.keys(activePetsMap)) {
      const items = activePetsMap[key]?.items || [];
      const found = items.find((p) => {
        const pFormatted = formatPetName(p.name);
        return (
            pFormatted === formatted ||
            p.name === name
        );
      });
      if (found) return found;
    }
    return undefined;
  };

  // Map progress calculation
  const mapCollectionStats = useMemo(() => {
    const mapKey = `map${detectedMapNum}`;
    const activePetsMap = mapsPets || FALLBACK_MAPS_DATA;
    const petsOnMap: PetItem[] = activePetsMap[mapKey]?.items || FALLBACK_MAPS_DATA[mapKey]?.items || [];
    const total = petsOnMap.length;
    if (total === 0) {
      return { total: 0, encountered: 0, percent: 0, remaining: 0 };
    }

    const encounteredCount = petsOnMap.filter((p) => {
      const formatted = formatPetName(p.name);
      const directKey = `${mapKey}_${p.name}`;
      const directFormattedKey = `${mapKey}_${formatted}`;
      if (records[directKey]?.encountered || records[directFormattedKey]?.encountered) {
        return true;
      }
      return (Object.values(records) as EncounterRecord[]).some((rec) => {
        if (!rec || !rec.encountered) return false;
        const recFormatted = formatPetName(rec.filename);
        return rec.mapId === mapKey && (recFormatted === formatted || rec.filename === p.name);
      });
    }).length;

    const percent = (encounteredCount / total) * 100;
    const remaining = total - encounteredCount;
    return { total, encountered: encounteredCount, percent, remaining };
  }, [detectedMapNum, records, mapsPets]);

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
    const formatted = formatPetName(petName);
    sound.playEncounter();
    const mapKey = `map${detectedMapNum}`;
    storage.toggleEncountered(mapKey, petName);
  };

  // Process response into state
  const applyApiResults = (data: FollowRecognizeApiResponse) => {
    if (data.map_num !== undefined && data.map_num !== null) {
      setDetectedMapNum(data.map_num);
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

  const executeSingleRecognition = async () => {
    if (isRecognizingNow) return;
    setIsRecognizingNow(true);
    sound.playClick();

    try {
      // 第一步：调用 pywebview API 进行本地截图
      const pyApi = (window as any).pywebview?.api;
      if (!pyApi) {
        console.error("未找到 Python API 桥接");
        setIsRecognizingNow(false);
        return;
      }

      const capRes = await pyApi.capture_and_recognize("洛克王国：世界"); // 这里的标题要和游戏窗口一致
      console.log(capRes)
      if (capRes) {
        // 第二步：将截图结果发送给 Flask 后端接口
        // 假设你的 api.ts 里定义了 followRecognize 方法
        const res = await api.followRecognize(capRes);
        // setIsRealBackendConnected(!res.isOfflineMock);
        if (res.data) {
          // 第三步：将识别结果渲染到界面
          applyApiResults(res.data);
        }
      } else {
        alert("截图失败: " + capRes.message);
      }
    } catch (err) {
      console.warn('捕获并识别流程出错:', err);
    } finally {
      setIsRecognizingNow(false);
    }
  };

  const handleCloseWindow = async () => {
    sound.playClick();
    console.log('=====')
    const pyApi = (window as any).pywebview?.api?.close_current_window;
    if (pyApi) {
      console.log("进入pywebview关闭逻辑");
      await pyApi();
      console.log("api返回，执行return，阻止跳转");
      return;
    } else if (window.opener) {
      window.close();
    } else {
      console.log("浏览器环境，跳转主页");
      window.location.href = '/';
    }
  };

  return (
      <div className="w-screen h-screen bg-[#F0F6FC] text-slate-800 flex flex-col justify-between select-none overflow-hidden font-sans border-0 m-0 p-0">
        {/* ------------------------------------------------------------- */}
        {/* 1. Main App Match Titlebar: Roco Sky Blue (#7ABCF4) */}
        {/* ------------------------------------------------------------- */}
        <div className="h-10 px-3 bg-[#7ABCF4] border-b-2 border-[#5DA8E8] flex items-center justify-between gap-2 pywebview-drag-region cursor-move shrink-0 shadow-xs text-white">
          <div className="flex items-center gap-2 min-w-0 pointer-events-none">
            <div className="w-5 h-5 bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
              <MapPin className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-black text-white truncate tracking-tight">
              {currentDetectedMap.name}
            </span>
              <span className="text-[10px] font-black px-1.5 py-0.2 bg-white/25 text-[#424242] border border-white/30 shrink-0">
              地图 {detectedMapNum}
            </span>
            </div>
          </div>

          {/* Right side status & action buttons */}
          <div className="flex items-center gap-1 shrink-0 pywebview-no-drag">
            {/*<button*/}
            {/*    type="button"*/}
            {/*    onClick={() => setIsCollapsedContent(!isCollapsedContent)}*/}
            {/*    className="w-7 h-7 hover:bg-white/20 text-white/90 hover:text-white flex items-center justify-center transition-colors cursor-pointer"*/}
            {/*    title={isCollapsedContent ? '展开详细面板' : '收起详细面板'}*/}
            {/*>*/}
            {/*  {isCollapsedContent ? <ChevronDown className="w-4 h-4 stroke-[2.5]" /> : <ChevronUp className="w-4 h-4 stroke-[2.5]" />}*/}
            {/*</button>*/}
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setIsGalleryOpen(true);
                }}
                className="px-2 py-1 bg-white/20 hover:bg-white/30 text-white flex items-center gap-1 text-[11px] font-black transition-colors cursor-pointer border border-white/30 shadow-2xs mr-0.5"
                title="查看全部地图图鉴与全图名册"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>查图鉴</span>
            </button>
            <button
                type="button"
                id="scanner-standalone-close-btn"
                onClick={handleCloseWindow}
                className="w-7 h-7 hover:bg-rose-500 text-white flex items-center justify-center transition-colors cursor-pointer"
                title="关闭窗口"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 2. Main Content Area: Roco Light Clean Aesthetics (Zero-Gap) */}
        {/* ------------------------------------------------------------- */}
        <div className="flex-1 flex flex-col justify-between overflow-y-auto bg-[#F0F6FC] p-2.5 gap-2">
          {!isCollapsedContent ? (
              <div className="space-y-2">
                {/* 2.1 Collection Progress Card */}
                <div className="p-2.5 bg-white border-2 border-[#DCE8F5] shadow-xs">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-700 font-black flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-[#7ABCF4]" />
                  当前地图图鉴收集
                </span>
                    <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-black text-[#689F38]">
                    {mapCollectionStats.encountered}/{mapCollectionStats.total}
                  </span>
                      {mapCollectionStats.remaining > 0 ? (
                          <span className="text-[10px] font-black px-1.5 py-0.2 bg-amber-100 text-amber-800 border border-amber-300">
                      余 {mapCollectionStats.remaining} 未遇
                    </span>
                      ) : (
                          <span className="text-[10px] font-black px-1.5 py-0.2 bg-emerald-100 text-emerald-800 border border-emerald-300">
                      全收录 🎉
                    </span>
                      )}
                    </div>
                  </div>

                  {/* High Contrast Progress Bar */}
                  <div className="w-full h-2 bg-[#E9F2FA] overflow-hidden border border-[#D5E3F0]">
                    <div
                        className="h-full bg-gradient-to-r from-[#95D151] to-[#76B032] transition-all duration-300"
                        style={{ width: `${mapCollectionStats.percent}%` }}
                    />
                  </div>
                </div>

                {/* 2.2 Detected Pets List */}
                {detectedPets.length === 0 ? (
                    <div className="p-4 bg-white border-2 border-[#DCE8F5] text-center space-y-1.5 shadow-xs">
                      <div className="w-8 h-8 bg-[#E9F2FA] text-[#7ABCF4] flex items-center justify-center mx-auto border border-[#D5E3F0]">
                        <Eye className="w-4 h-4" />
                      </div>
                      <p className="text-xs font-black text-slate-700">当前视野未检测到精灵</p>
                      <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                        在游戏内移动画面，或点击下方「立即识别」捕获
                      </p>
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
                                className="border-2 border-dashed border-[#BCD7F2] bg-[#F4F9FF] p-3 text-center shadow-xs flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-9 h-9 bg-white border border-[#D5E3F0] flex items-center justify-center text-amber-500 font-bold text-sm shrink-0">
                                  {cleanName.includes('魔力之源') ? '✨' : '🎒'}
                                </div>
                                <div className="text-left min-w-0">
                                  <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-black text-slate-700 truncate">
                                    【特殊点位】{cleanName}
                                  </span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">
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
                              className={`border-2 p-2.5 transition-all shadow-xs ${
                                  isEncountered
                                      ? 'bg-[#F8FBFE] border-[#D5E3F0] text-slate-600'
                                      : 'bg-white border-[#7ABCF4] text-slate-800'
                              }`}
                          >
                            {/* Header: Avatar, Name, Status, Action */}
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {/* Pet Image */}
                                <div className="relative w-10 h-10 bg-white border-2 border-[#D5E3F0] p-0.5 flex items-center justify-center shrink-0 overflow-hidden">
                                  <img
                                      src={`${api.getApiBase()}/icons/map${detectedMapNum}/${displayName}.png`}
                                      alt={displayName}
                                      className="w-full h-full object-contain"
                                      onError={(e) => {
                                        if (slot.matchedPet?.url) {
                                          (e.target as HTMLImageElement).src = slot.matchedPet.url;
                                        }
                                      }}
                                  />
                                  {isEncountered && (
                                      <div className="absolute inset-0 bg-emerald-900/30 flex items-center justify-center">
                                        <Check className="w-4 h-4 text-emerald-600 stroke-[3]" />
                                      </div>
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black text-slate-800 truncate" title={displayName}>
                              {displayName}
                            </span>
                                    <span className="text-[10px] font-mono font-black text-emerald-700 bg-emerald-100 px-1 py-0.2 border border-emerald-300">
                              {topScorePercent}%
                            </span>
                                  </div>

                                  <div className="flex items-center gap-1 mt-1">
                                    {isEncountered ? (
                                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 border border-slate-200 flex items-center gap-1">
                                <Check className="w-2.5 h-2.5 text-emerald-600" />
                                已在图鉴
                              </span>
                                    ) : (
                                        <span className="text-[10px] font-black text-amber-800 bg-amber-100 px-1.5 py-0.2 border border-amber-300 flex items-center gap-1">
                                <Sparkle className="w-2.5 h-2.5 text-amber-600" />
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
                                  className={`px-2.5 py-1 text-xs font-black flex items-center gap-1 transition-all cursor-pointer shrink-0 border-2 ${
                                      isEncountered
                                          ? 'bg-[#E9F2FA] hover:bg-[#D5E3F0] text-slate-600 border-[#C7DBEB]'
                                          : 'bg-[#95D151] hover:bg-[#84C242] text-white border-[#689F38] shadow-xs'
                                  }`}
                                  title={isEncountered ? '已在图鉴（点击取消）' : '点击点亮图鉴'}
                              >
                                {isEncountered ? (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                      <span>已遇见</span>
                                    </>
                                ) : (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>点亮图鉴</span>
                                    </>
                                )}
                              </button>
                            </div>

                            {/* Candidate Switcher */}
                            {slot.candidates && slot.candidates.length > 1 && (
                                <div className="pt-1.5 border-t border-[#E9F2FA]">
                                  <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                                    <span className="font-bold">候选置信度排行:</span>
                                    <span className="font-mono font-bold">选定: #{slot.selectedCandidateIndex + 1}
                                    </span>
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
                                              className={`p-1.5 text-left transition-all cursor-pointer border ${
                                                  isSelected
                                                      ? 'bg-[#EBF5FE] border-[#7ABCF4] text-[#1E5B99] font-black'
                                                      : 'bg-[#F8FBFE] border-[#D5E3F0] text-slate-600 hover:bg-[#E9F2FA]'
                                              }`}
                                          >
                                          <div className="flex items-center justify-between text-[9px] font-mono">
                                            <span className="text-slate-400 font-bold">
                                              {checkEncountered(candName) ? (
                                                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 border border-slate-200 flex items-center gap-1">
                                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                                    #{cIdx + 1}
                                                </span>
                                              ) : (
                                                  <span className="text-[10px] font-black text-amber-800 bg-amber-100 px-1.5 py-0.2 border border-amber-300 flex items-center gap-1">
                                                  <Sparkle className="w-2.5 h-2.5 text-amber-600" />
                                                    #{cIdx + 1}
                                                </span>
                                              )}
                                            </span>
                                            <span className={isSelected ? 'text-[#1E5B99] font-black' : 'text-slate-500'}>
                                              {candPercent}%
                                            </span>
                                          </div>

                                          <div className={`text-[11px] font-bold truncate mt-0.5 `} title={candName}>
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
              <div className="p-2.5 bg-white border-2 border-[#DCE8F5] flex items-center justify-between shadow-xs">
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
          <div className="pt-1.5 border-t border-[#D5E3F0] space-y-1.5 shrink-0">
            <div className="grid grid-cols-1 gap-2">
              <button
                  type="button"
                  id="scanner-single-recognize-btn"
                  onClick={() => executeSingleRecognition()}
                  disabled={isRecognizingNow}
                  className="py-2 px-3 bg-[#7ABCF4] hover:bg-[#68AEEB] text-white border-2 border-[#5DA8E8] font-black text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRecognizingNow ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>捕获中...</span>
                    </>
                ) : (
                    <>
                      <Camera className="w-3.5 h-3.5" />
                      <span>立即识别</span>
                    </>
                )}
              </button>


            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 3. Micro Status Bar */}
        {/* ------------------------------------------------------------- */}
        <div className="h-6 px-3 bg-[#E9F2FA] border-t border-[#D5E3F0] text-[10px] font-mono text-slate-500 flex items-center justify-between shrink-0 font-bold">
          <span>上次: {lastScanTime}</span>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 4. Scanner Map & All Pet Gallery Modal */}
        {/* ------------------------------------------------------------- */}
        <ScannerMapGalleryModal
            isOpen={isGalleryOpen}
            onClose={() => setIsGalleryOpen(false)}
            initialMapNum={detectedMapNum}
            mapsPets={mapsPets}
            records={records}
        />
      </div>
  );
};
