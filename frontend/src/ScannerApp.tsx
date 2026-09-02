// noinspection JSRemoveUnnecessaryParentheses

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  ChevronLeft,
  ChevronRight,
  MapPin,
  Sparkle,
  Radio,
  Eye,
  ExternalLink,
  BookOpen,
  Pin,
  PinOff,
  History,
  Sun,
  Moon,
} from 'lucide-react';
import { PetItem, EncounterRecord, MapConfig, FollowRecognizeApiResponse, FirePokedexEntry, ThemeMode } from './types';
import { MAP_CONFIGS, FALLBACK_MAPS_DATA, createSvgPetAvatar } from './data/mockPets';
import { FIRE_MAP_CONFIGS } from './data/trials';
import { sound } from './services/sound';
import { api } from './services/api';
import { storage } from './services/storage';
import { themeService } from './services/theme';
import { fireStorage } from './services/fireStorage';
import { getFireTrialPetsCached } from './services/fireTrialData';
import { collectAtlasObservation, fetchTrialAtlas, syncTrialAtlas, petKeyOf, TrialAtlas, wilsonLower } from './services/atlasCollector';
import { PLATFORM } from './services/staticMode';
import { fireEncounterConfetti, fireUnencounterEffect } from './services/effect';
import { EffectLevel } from './types';
import { ScannerMapGalleryModal } from './components/ScannerMapGalleryModal';
import { EncounterHistoryModal } from './components/EncounterHistoryModal';
import { ImageZoom } from './components/ImageZoom';
import { ElementBadges } from './components/ElementBadges';
import { PetSpecialTag } from './components/PetSpecialTag';
import {
  formatPetName,
  isSamePetName,
  isPetEncounteredInRecords,
  getBasePetName,
} from './utils/petHelper';
import { ELEMENT_EN_TO_CN } from './utils/elements';

interface DetectedPetSlot {
  id: string;
  name: string;
  score: number;
  view_url?: string;
  candidates: { filename: string; score: number; elements?: string[] }[];
  selectedCandidateIndex: number;
  selectedPetName: string;
  matchedPet?: PetItem;
  sourceMapNum?: number;
}

/** 火系全图鉴 -> 与首页「全图鉴自选」一致的 mapsPets 结构（每张地图均为全量）。 */
const buildFireMapsPets = (pets: FirePokedexEntry[]): Record<string, { count: number; items: PetItem[] }> => {
  const items: PetItem[] = pets
      .filter((pet): pet is FirePokedexEntry => !!pet && typeof pet === 'object')
      .map((pet) => ({
        name: `${pet.name}.png`,
        id: pet.id,
        seq: pet.seq,
        elements: pet.elements ?? [],
        rarity: 'common',
        url: pet.url || createSvgPetAvatar(pet.name, '火', (pet.id * 47) % 360, '#ef4444', '🔥'),
      }));
  const base = { count: items.length, items };
  return { map1: base, map2: base, map3: base };
};

// 候选置信度排行分页导航组件（保持原版大尺寸卡片，每页3项，左右翻页，无滑动条）
const CandidateCarousel: React.FC<{
  candidates: { filename: string; score: number; elements?: string[] }[];
  selectedCandidateIndex: number;
  slotId: string;
  sourceMapNum?: number;
  onSelect: (slotId: string, index: number) => void;
  checkEncountered: (name: string, sourceMapNum?: number) => boolean;
  /** 共创图鉴：取候选的社区数据（赞同率），火系且未隐藏投票时传入。 */
  getCommunityInfo?: (candFilename: string, sourceMapNum?: number) => { agree_ratio?: number } | undefined;
}> = ({ candidates, selectedCandidateIndex, slotId, sourceMapNum, onSelect, checkEncountered, getCommunityInfo }) => {
  const pageSize = 3;
  const totalPages = Math.ceil(candidates.length / pageSize);
  const [currentPage, setCurrentPage] = React.useState(() => Math.floor(selectedCandidateIndex / pageSize));

  // If selected candidate changes externally, ensure current page contains it
  React.useEffect(() => {
    const pageOfSelected = Math.floor(selectedCandidateIndex / pageSize);
    if (pageOfSelected >= 0 && pageOfSelected < totalPages) {
      setCurrentPage(pageOfSelected);
    }
  }, [selectedCandidateIndex, totalPages]);

  const displayedCandidates = candidates.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  return (
      <div className="pt-2 border-t-2 border-[#F1F5F9] dark:border-slate-800">
        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1.5 font-bold">
          <div className="flex items-center gap-1.5">
            <span>候选置信度排行:</span>
            {totalPages > 1 && (
                <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
              第 {currentPage + 1}/{totalPages} 页 (共 {candidates.length} 项)
            </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[#1E5B99] dark:text-sky-300">选定: #{selectedCandidateIndex + 1}</span>
            {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                      type="button"
                      onClick={handlePrevPage}
                      disabled={currentPage === 0}
                      className="w-5 h-5 rounded-md bg-white dark:bg-slate-800 border border-[#BCD7F2] dark:border-slate-700 text-[#1E5B99] dark:text-sky-300 flex items-center justify-center hover:bg-[#EBF5FE] dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all active:scale-95 shadow-2xs"
                      title="上一页候选 (#1-#3)"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                      type="button"
                      onClick={handleNextPage}
                      disabled={currentPage >= totalPages - 1}
                      className="w-5 h-5 rounded-md bg-white dark:bg-slate-800 border border-[#BCD7F2] dark:border-slate-700 text-[#1E5B99] dark:text-sky-300 flex items-center justify-center hover:bg-[#EBF5FE] dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all active:scale-95 shadow-2xs"
                      title="下一页候选 (#4-#6)"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
            )}
          </div>
        </div>

        {/* 原版大尺寸 3 列网格，无滑动条，保持饱满清爽 */}
        <div className="grid grid-cols-3 gap-1.5">
          {displayedCandidates.map((cand, idxInPage) => {
            const cIdx = currentPage * pageSize + idxInPage;
            const isSelected = cIdx === selectedCandidateIndex;
            const candName = formatPetName(cand.filename);
            const candPercent = (cand.score * 100).toFixed(1);
            // 候选图：后端返回的 filename 直接拼 /icons 路径
            const candViewUrl = `${api.getApiBase()}/icons/${cand.filename}`;
            const communityInfo = getCommunityInfo?.(cand.filename, sourceMapNum);

            return (
                <button
                    key={cand.filename + cIdx}
                    type="button"
                    onClick={() => onSelect(slotId, cIdx)}
                    className={`p-1.5 rounded-xl text-left transition-all cursor-pointer border-2 ${
                        isSelected
                            ? 'bg-[#EBF5FE] dark:bg-sky-950/70 border-[#7ABCF4] dark:border-sky-500 text-[#1E5B99] dark:text-sky-300 font-black shadow-xs ring-1 ring-[#7ABCF4]'
                            : 'bg-[#F8FBFE] dark:bg-slate-800 border-[#E2E8F0] dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#BCD7F2] dark:hover:border-slate-600 hover:bg-[#E9F2FA] dark:hover:bg-slate-700'
                    }`}
                >
                  {/* 一行布局：左图 + 右文本（紧凑，避免撑成两行） */}
                  <div className="flex items-center gap-1.5">
                    {/* 候选精灵预览图（悬停/点击放大） */}
                    <div className="relative w-9 h-9 shrink-0 rounded-lg bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-700 p-0.5 flex items-center justify-center overflow-hidden">
                      <ImageZoom
                          src={candViewUrl}
                          alt={candName}
                          className="w-full h-full"
                          imgClassName="w-full h-full object-contain"
                          zoomWidth={280}
                          zoomHeight={280}
                          maxWidth={60}
                          maxHeight={60}
                      />
                      <ElementBadges
                          elements={cand.elements}
                          className="absolute top-0 left-0 z-10"
                          size="xs"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-[9px] font-mono">
                        <span className="text-slate-400 dark:text-slate-500 font-bold">
                          {checkEncountered(candName, sourceMapNum) ? (
                              <span className="inline-flex items-center gap-0.5 text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-1 py-0.2 rounded-full border border-[#95D151]/40">
                                <Check className="w-2 h-2 text-emerald-600 stroke-[3]" />
                                #{cIdx + 1}
                              </span>
                          ) : (
                              <span className="inline-flex items-center gap-0.5 text-amber-800 dark:text-amber-300 bg-[#FEF9E6] dark:bg-amber-950/60 px-1 py-0.2 rounded-full border border-[#E5C43B]/60">
                                <Sparkle className="w-2 h-2 text-amber-600" />
                                #{cIdx + 1}
                              </span>
                          )}
                        </span>
                        <span className={isSelected ? 'text-[#1E5B99] dark:text-sky-300 font-black' : 'text-slate-500 dark:text-slate-400'}>
                          {candPercent}%
                        </span>
                      </div>
                      <div className="text-[10px] font-bold text-slate-800 dark:text-slate-100 truncate" title={candName}>
                        {candName}
                      </div>
                      <PetSpecialTag
                          filename={cand.filename}
                          className="mt-0.5"
                      />
                      {communityInfo && (
                          <div className="mt-0.5">
                            <span
                                className={`text-[8px] font-mono font-black px-1 py-0.2 rounded border ${
                                    (communityInfo.agree_ratio ?? 0) >= 0.7
                                        ? 'text-green-700 dark:text-emerald-300 bg-green-50 dark:bg-emerald-950/60 border-green-300 dark:border-emerald-800'
                                        : (communityInfo.agree_ratio ?? 0) >= 0.3
                                            ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800'
                                            : 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-800'
                                }`}
                                title="社区共创图鉴赞同率"
                            >
                              {Math.round((communityInfo.agree_ratio ?? 0) * 100)}% 赞同
                            </span>
                          </div>
                      )}
                    </div>
                  </div>
                </button>
            );
          })}
        </div>
      </div>
  );
};


export const ScannerApp: React.FC = () => {
  // 跟随识别窗口“可见”标记：关闭=隐藏时文档变 hidden，据此停/开存储轮询
  useEffect(() => {
    const setFlag = () => {
      try {
        if (document.visibilityState === 'visible') {
          localStorage.setItem('roco_follow_active', '1');
        } else {
          localStorage.removeItem('roco_follow_active');
        }
      } catch { /* ignore */ }
    };
    setFlag();
    document.addEventListener('visibilitychange', setFlag);
    window.addEventListener('pagehide', () => { try { localStorage.removeItem('roco_follow_active'); } catch { /* ignore */ } });
    return () => {
      document.removeEventListener('visibilitychange', setFlag);
      try { localStorage.removeItem('roco_follow_active'); } catch { /* ignore */ }
    };
  }, []);

  // Map num confirmed from last backend recognition (null on initial load, or 1, 2, 3)
  const [detectedMapNum, setDetectedMapNum] = useState<number | null>(null);
  // Map num currently selected by user in UI (can be switched freely before re-recognizing)
  const [selectedMapNum, setSelectedMapNum] = useState<number | null>(() => {
    // 上次钉住过地图时，打开窗口直接恢复钉住的地图视图
    const savedPin = storage.getSetting<number | null>('scannerPinnedStageNum', null);
    return savedPin !== null ? savedPin : null;
  });
  // 钉住地图：非 null 时锁定该地图，识别完成后视图不再跳回识别结果对应的地图
  const [pinnedMapNum, setPinnedMapNum] = useState<number | null>(() =>
      storage.getSetting<number | null>('scannerPinnedStageNum', null)
  );

  // Storage and records（按初始试炼选择存储：草系=storage，火系=fireStorage）
  const [records, setRecords] = useState<Record<string, EncounterRecord>>(() => {
    try {
      if (localStorage.getItem('roco_active_trial') === 'fire') return fireStorage.getAll();
    } catch { /* ignore */ }
    return storage.getAll();
  });
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
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [topmost, setTopmost] = useState<boolean>(true);

  // 当前试炼：初始取自 localStorage（来源页面打开窗口前写入），之后可在窗口内自行切换
  const [trialKey, setTrialKey] = useState<'grass' | 'fire'>(() => {
    try {
      return localStorage.getItem('roco_active_trial') === 'fire' ? 'fire' : 'grass';
    } catch {
      return 'grass';
    }
  });
  const isFire = trialKey === 'fire';
  const activeMapsConfig = isFire ? FIRE_MAP_CONFIGS : MAP_CONFIGS;
  const [isTrialSwitcherOpen, setIsTrialSwitcherOpen] = useState<boolean>(false);
  // 可切换试炼列表：以服务端 /api/trials 为准（打包环境会按 dev_only 过滤掉火系）
  const [trialOptions, setTrialOptions] = useState<{ key: string; title: string }[]>([
    { key: 'grass', title: '草系徽章试炼' },
  ]);

  useEffect(() => {
    api.getTrials()
        .then((res) => {
          const options = (res.trials || []).map((t) => ({ key: t.key, title: t.title }));
          if (options.length) setTrialOptions(options);
        })
        .catch(() => { /* 失败保持默认草系 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 火系共创图鉴：社区聚合数据 + 本地投票 + 隐藏投票开关（均与首页共用 localStorage，跨窗口一致）
  const [serverAtlas, setServerAtlas] = useState<TrialAtlas | null>(null);
  const [showAtlasVote, setShowAtlasVote] = useState<boolean>(() => {
    return storage.getSetting<{ showVote?: boolean }>('fireSettings', {}).showVote ?? true;
  });

  // Active viewing map number (selectedMapNum takes precedence, otherwise detectedMapNum)
  const activeStageNum = selectedMapNum !== null ? selectedMapNum : detectedMapNum;

  // Whether user manually switched to a different map from what was previously detected
  const hasPendingMapChange = detectedMapNum !== null && selectedMapNum !== null && selectedMapNum !== detectedMapNum;

  // Subscribe to storage changes & load icons
  useEffect(() => {
    document.body.classList.add('scanner-transparent-mode');
    return () => {
      document.body.classList.remove('scanner-transparent-mode');
    };
  }, []);

  // 数据加载：按当前试炼选择存储与图鉴数据源
  // 草系=本地 storage + /icons 图鉴；火系=fireStorage + 全图鉴（识别依据用全图鉴）
  useEffect(() => {
    if (isFire) {
      setRecords(fireStorage.getAll());
      const unsub = fireStorage.subscribe((newRecords) => {
        setRecords(newRecords);
      });
      let cancelled = false;
      getFireTrialPetsCached().then((pets) => {
        if (!cancelled && pets.length > 0) {
          setMapsPets(buildFireMapsPets(pets));
        }
      });
      return () => {
        cancelled = true;
        unsub();
      };
    }
    setRecords(storage.getAll());
    const unsub = storage.subscribe((newRecords) => {
      setRecords(newRecords);
    });
    api.getIcons().then((res) => {
      if (res.data) {
        setMapsPets(res.data);
      }
    });
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFire]);

  // Check game status on initial load（与试炼无关，仅启动时检测一次）
  useEffect(() => {
    api.checkGameStatus().then((statusRes) => {
      setIsRealBackendConnected(!statusRes.isOfflineMock);
    });
  }, []);

  // 共创图鉴快照（上传用）：当前已点亮 pet_key 集合（算法与首页 FireBadgeTrial 一致）
  const buildFireMapsSnapshot = (): Record<string, string[]> => {
    const m: Record<string, string[]> = {};
    Object.entries(mapsPets).forEach(([mapId, mapData]) => {
      ((mapData as { count: number; items: PetItem[] })?.items || []).forEach((pet) => {
        if (isPetEncounteredInRecords(fireStorage.getAll(), mapId, pet.name)) {
          const pk = petKeyOf(pet.name, pet.id, pet.seq);
          if (pk) (m[mapId] ??= []).push(pk);
        }
      });
    });
    return m;
  };

  // 火系手动投票并入 encounteredPets2：从 fireStorage 记录里的 vote 派生，避免单独一套存储。
  const fireVotes = useMemo<Record<string, Record<string, 'agree' | 'disagree'>>>(() => {
    const votes: Record<string, Record<string, 'agree' | 'disagree'>> = {};
    (Object.entries(records) as Array<[string, EncounterRecord]>).forEach(([, rec]) => {
      if (!rec?.vote || !rec.mapId) return;
      const pet = (mapsPets[rec.mapId]?.items || []).find((p) => p.name === rec.filename);
      const pk = pet ? petKeyOf(pet.name, pet.id, pet.seq) : petKeyOf(rec.filename || '');
      if (pk) (votes[rec.mapId] ??= {})[pk] = rec.vote;
    });
    return votes;
  }, [records, mapsPets]);

  // 保存最新同步载荷，30s 静默同步/切出兜底用
  const latestSyncRef = useRef<{ maps: Record<string, string[]>; votes: Record<string, Record<string, 'agree' | 'disagree'>> }>({ maps: {}, votes: {} });
  latestSyncRef.current = { maps: isFire ? buildFireMapsSnapshot() : {}, votes: fireVotes };

  // 火系共创图鉴：进入火系时拉取社区数据 + 上传本地快照；30s 静默同步；切走/卸载时兜底同步
  useEffect(() => {
    if (!isFire) return;
    let mounted = true;
    void fetchTrialAtlas('fire').then((a) => { if (mounted && a) setServerAtlas(a); });
    void syncTrialAtlas('fire', latestSyncRef.current.maps, latestSyncRef.current.votes);
    const t = setInterval(() => {
      void syncTrialAtlas('fire', latestSyncRef.current.maps, latestSyncRef.current.votes);
    }, 30000);
    return () => {
      mounted = false;
      clearInterval(t);
      void syncTrialAtlas('fire', latestSyncRef.current.maps, latestSyncRef.current.votes);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFire]);

  // 初始化：把火系所有“已点亮”精灵默认为赞同（无手动投票时），与首页逻辑一致
  useEffect(() => {
    if (!isFire) return;
    let changed = false;
    (Object.values(fireStorage.getAll()) as EncounterRecord[]).forEach((rec) => {
      if (rec?.encountered && !rec.vote) {
        fireStorage.updateVote(rec.mapId, rec.filename, 'agree');
        changed = true;
      }
    });
    if (changed) setRecords(fireStorage.getAll());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFire, mapsPets]);

  // 多端/跨窗口同步：fire 设置（显示投票）变化时刷新本窗口；vote 由 fireStorage.subscribe 的 records 驱动
  useEffect(() => {
    const unsub = storage.subscribeSettings((s) => {
      setShowAtlasVote((s.fireSettings || {}).showVote ?? true);
    });
    return unsub;
  }, []);

  // 社区图鉴：合并本地投票 + 服务端权重后的展示态（算法与首页一致，本设备权重 app×1 / web×0.5）
  const communityAtlas = useMemo(() => {
    const map: Record<string, {
      confirmed_by: number;
      confidence: number;
      agree_ratio?: number;
      vote_ratio?: number;
      total_users?: number;
      voter_count?: number;
      my_vote?: 'agree' | 'disagree' | 'none';
    }> = {};
    const w = PLATFORM === 'web' ? 0.5 : 1;
    if (serverAtlas?.maps) {
      Object.entries(serverAtlas.maps).forEach(([mapId, entries]) => {
        Object.entries(entries).forEach(([, e]) => {
          const pk = e.pet_key || (e.id != null ? String(e.id) : '');
          if (!pk) return;
          const key = `${mapId}:${pk}`;
          const localVote = fireVotes?.[mapId]?.[pk];
          const serverVote = e.my_vote ?? 'none';
          const pet = (mapsPets[mapId]?.items || []).find((p) => petKeyOf(p.name, p.id, p.seq) === pk);
          const encName = pet?.name || '';
          const localRecord = encName ? records[`${mapId}_${encName}`] : undefined;
          let localRatio = e.agree_ratio ?? 0;
          let myVote = e.my_vote ?? 'none';
          let confidence = e.confidence ?? 0;
          if (localRecord) {
            let na = e.agree_weight ?? 0;
            let nt = e.total_weight ?? 0;
            if (serverVote === 'agree') { na -= w; nt -= w; }
            else if (serverVote === 'disagree') { nt -= w; }
            if (localVote === 'agree') { na += w; nt += w; }
            else if (localVote === 'disagree') { nt += w; }
            localRatio = nt > 0 ? na / nt : 0;
            myVote = localVote ?? 'none';
            confidence = wilsonLower(na, nt);
          }
          const voterCount = e.voter_count ?? 0;
          const totalUsers = e.total_users ?? 0;
          map[key] = {
            confirmed_by: e.confirmed_by,
            confidence,
            agree_ratio: localRatio,
            vote_ratio: totalUsers > 0 ? voterCount / totalUsers : 0,
            total_users: totalUsers,
            voter_count: voterCount,
            my_vote: myVote,
          };
        });
      });
    }
    // 无服务端数据但有本地投票：按本设备权重合成展示态（agree → 100%/1票，disagree → 0%/1票），
    // 否则无共创数据的卡投票后无条目，按钮不激活、进度条不出现（“点了没反应”）
    Object.entries(fireVotes || {}).forEach(([mapId, votes]) => {
      Object.entries(votes).forEach(([pk, v]) => {
        const key = `${mapId}:${pk}`;
        if (map[key]) return;
        const agreeCount = v === 'agree' ? 1 : 0;
        map[key] = {
          confirmed_by: 0,
          confidence: wilsonLower(agreeCount, 1),
          agree_ratio: v === 'agree' ? 1 : 0,
          vote_ratio: 0,
          total_users: 0,
          voter_count: 1,
          my_vote: v,
        };
      });
    });
    return map;
  }, [serverAtlas, fireVotes, records, mapsPets]);

  // 上次同步给 Python 的窗口高度，避免重复 resize 造成抖动
  const lastWindowHeightRef = useRef<number | null>(null);
  // 节流：resize 首边立即生效（无卡顿），但限制频率，避免高频跨线程操作
  const lastResizeAtRef = useRef<number>(0);
  const resizeTrailingTimerRef = useRef<number | null>(null);

  // 依据前端内容自然高度，动态调整 pywebview 子窗口高度（宽度保持当前值）
  const syncScannerWindowHeight = useCallback(() => {
    const pyApi = (window as any).pywebview?.api;
    if (!pyApi || typeof pyApi.resize_scanner_window !== 'function') return;

    const contentEl = document.getElementById('scanner-scroll-content');
    const titlebarEl = document.getElementById('scanner-titlebar');
    const statusbarEl = document.getElementById('scanner-statusbar');
    if (!contentEl) return;

    const titlebarH = titlebarEl?.getBoundingClientRect().height ?? 44;
    const statusbarH = statusbarEl?.getBoundingClientRect().height ?? 28;

    // 中间滚动区内容自然高度 = 各直接子元素高度之和 + 间距(gap-2.5=10px) + 上下内边距(p-3=12px)
    const children = Array.from(contentEl.children) as HTMLElement[];
    const gap = 10;
    let contentH = 0;
    children.forEach((child, i) => {
      contentH += child.getBoundingClientRect().height;
      if (i > 0) contentH += gap;
    });
    if (children.length === 0) {
      contentH = contentEl.scrollHeight;
    }
    const contentStyle = getComputedStyle(contentEl);
    contentH += (parseFloat(contentStyle.paddingTop) || 12) + (parseFloat(contentStyle.paddingBottom) || 12);

    // 前端最低高度：内容再少窗口也不低于这个值（与 create_window 默认高度保持一致）
    const MIN_WINDOW_HEIGHT = 614;
    const targetHeight = Math.max(MIN_WINDOW_HEIGHT, Math.ceil(titlebarH + contentH + statusbarH));
    const prevHeight = lastWindowHeightRef.current;
    if (prevHeight !== null && Math.abs(prevHeight - targetHeight) <= 4) return;
    lastWindowHeightRef.current = targetHeight;
    // 宽度保持窗口当前宽度（即 create_window 里的固定值，如 420），只按内容动态调整高度
    pyApi.resize_scanner_window(window.innerWidth, targetHeight);
  }, []);

  // 节流包装（leading + trailing）：内容一变化立即调一次，间隔内的高频变化合并到间隔后一次
  const throttledResize = useCallback(() => {
    const INTERVAL = 120;
    const now = Date.now();
    const remaining = INTERVAL - (now - lastResizeAtRef.current);
    if (remaining <= 0) {
      lastResizeAtRef.current = now;
      syncScannerWindowHeight();
    } else if (resizeTrailingTimerRef.current === null) {
      resizeTrailingTimerRef.current = window.setTimeout(() => {
        resizeTrailingTimerRef.current = null;
        throttledResize();
      }, remaining);
    }
  }, [syncScannerWindowHeight]);

  // 首次加载：等 pywebview 就绪 + 内容布局稳定后再同步一次，
  // 避免在窗口刚创建/WebView2 未完全就绪时反复调整尺寸触发原生断点。
  useEffect(() => {
    let timer: number | null = null;
    const onReady = () => {
      throttledResize();
      // 布局稳定后兜底再同步一次（字体/图片可能晚加载）
      timer = window.setTimeout(throttledResize, 300);
    };

    // pywebview 注入完成会派发 pywebviewready 事件；若 api 已就绪则直接同步
    if ((window as any).pywebview?.api) {
      onReady();
    } else {
      window.addEventListener('pywebviewready', onReady);
    }

    return () => {
      window.removeEventListener('pywebviewready', onReady);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      if (resizeTrailingTimerRef.current !== null) {
        window.clearTimeout(resizeTrailingTimerRef.current);
        resizeTrailingTimerRef.current = null;
      }
      lastResizeAtRef.current = 0;
    };
  }, [throttledResize]);

  // 读取跟随识别窗口当前的置顶状态，并定时轮询，使右上角按钮与系统设置保持同步
  useEffect(() => {
    const syncTopmost = () => {
      try {
        const pyApi = (window as any).pywebview?.api;
        if (pyApi?.get_scanner_topmost) {
          pyApi.get_scanner_topmost().then((r: any) => {
            if (r?.on_top !== undefined) setTopmost(!!r.on_top);
          });
        }
      } catch {
        /* ignore */
      }
    };
    const onReady = () => {
      syncTopmost();
    };
    if ((window as any).pywebview?.api) {
      onReady();
    } else {
      window.addEventListener('pywebviewready', onReady);
    }
    const timer = window.setInterval(syncTopmost, 1500);
    return () => {
      window.removeEventListener('pywebviewready', onReady);
      window.clearInterval(timer);
    };
  }, []);

  // 内容变化（识别结果、收起/展开、地图切换、钉住等）后同步窗口高度
  useEffect(() => {
    throttledResize();
  });

  // Calculate statistics across all maps
  const allMapsStats = useMemo(() => {
    const activePetsMap = mapsPets || FALLBACK_MAPS_DATA;
    let grandTotal = 0;
    let grandEncountered = 0;

    const mapList = activeMapsConfig.map((m) => {
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
  }, [records, mapsPets, activeMapsConfig]);

  // Fast map reference lookup
  const currentDetectedMap: MapConfig = useMemo(() => {
    if (activeStageNum === null) {
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
    const found = activeMapsConfig.find((m) => m.num === activeStageNum);
    if (found) return found;
    return {
      id: `map${activeStageNum}`,
      num: activeStageNum,
      name: `地图 ${activeStageNum}`,
      description: '王国区域',
      themeColor: '#7ABCF4',
      bgGradient: 'from-blue-500/20 to-sky-500/20',
      badgeBg: 'bg-blue-500/15 text-blue-800 border-blue-400',
      iconName: 'Compass',
    };
  }, [activeStageNum, activeMapsConfig]);

  // Get readable map name
  const getMapDisplayName = (mapNum: number | null | undefined): string => {
    if (mapNum === null || mapNum === undefined) return '全图总览';
    const found = activeMapsConfig.find((m) => m.num === mapNum);
    return found ? found.name : `地图${mapNum}`;
  };

  // Check if a pet is encountered in records (prioritizes pet's original source map)
  const checkEncountered = (petName: string, sourceMapNum?: number): boolean => {
    const targetMapNum = sourceMapNum ?? detectedMapNum ?? activeStageNum ?? 1;
    const mapKey = `map${targetMapNum}`;
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
    const mapKey = `map${activeStageNum || 1}`;
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
  }, [activeStageNum, records, mapsPets]);

  // Handle manual map selection (does NOT trigger recognition, only changes view/pending target)
  const handleSelectMap = (mapNum: number | null) => {
    sound.playClick();
    setSelectedMapNum(mapNum);
    // 钉住模式下切换地图 = 钉随当前选择移动；切回“全图”则取消钉住
    if (mapNum !== null) {
      setPinnedMapNum(mapNum);
      storage.setSetting('scannerPinnedStageNum', mapNum);
    } else {
      setPinnedMapNum(null);
      storage.setSetting('scannerPinnedStageNum', null);
    }
  };

  // 钉住/取消钉住当前试炼关卡：钉住后识别完成不再跳回识别结果对应的关卡
  const handleTogglePin = () => {
    sound.playClick();
    if (pinnedMapNum !== null) {
      setPinnedMapNum(null);
      storage.setSetting('scannerPinnedStageNum', null);
    } else if (activeStageNum !== null) {
      setPinnedMapNum(activeStageNum);
      storage.setSetting('scannerPinnedStageNum', activeStageNum);
      setSelectedMapNum(activeStageNum);
    }
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

  // Mark/unmark single pet (routes to sourceMapNum to avoid corrupting switched map book)
  const handleTogglePetEncounter = (petName: string, sourceMapNum?: number) => {
    const targetMapNum = sourceMapNum ?? detectedMapNum ?? activeStageNum ?? 1;
    const mapKey = `map${targetMapNum}`;
    const level = storage.getSetting<EffectLevel>('effectLevel', 0);

    if (isFire) {
      // 火系：fireStorage + 点亮=赞同（与首页一致；取消点亮保留赞同票）
      const wasLit = fireStorage.isEncountered(mapKey, petName);
      fireStorage.toggleEncountered(mapKey, petName);
      setRecords(fireStorage.getAll());
      if (!wasLit) {
        sound.playEncounter();
        fireEncounterConfetti(level);
      } else {
        sound.playToggleOff();
        fireUnencounterEffect(level);
      }
      // 点亮 = 默认赞同（写入 vote）；取消点亮保留 vote
      if (!wasLit) fireStorage.updateVote(mapKey, petName, 'agree');
      return;
    }

    const wasEncountered = storage.isEncountered(mapKey, petName);
    storage.toggleEncountered(mapKey, petName);

    if (!wasEncountered) {
      sound.playEncounter();
      fireEncounterConfetti(level);
    } else {
      sound.playToggleOff();
      fireUnencounterEffect(level);
    }
  };

  // 窗口内切换试炼：重置识别态，写入 localStorage 供桥接/采集/其他窗口使用
  const switchTrial = (next: string) => {
    setIsTrialSwitcherOpen(false);
    if (next === trialKey) return;
    sound.playClick();
    setTrialKey(next);
    try { localStorage.setItem('roco_active_trial', next); } catch { /* ignore */ }
    setDetectedPets([]);
    setDetectedMapNum(null);
    setSelectedMapNum(null);
    setPinnedMapNum(null);
    storage.setSetting('scannerPinnedStageNum', null);
    setLastScanTime('未识别');
  };

  // 共创图鉴投票：11 态状态机，与首页 FireBadgeTrial.handleAtlasVote 一致（点亮 ↔ 赞同联动）
  const handleAtlasVote = (mapId: string, petKey: string, petName: string, type: 'agree' | 'disagree') => {
    sound.playClick();
    const pet = (mapsPets[mapId]?.items || []).find((p) => petKeyOf(p.name, p.id, p.seq) === petKey);
    const encName = pet?.name || petName;
    const isLit = isPetEncounteredInRecords(fireStorage.getAll(), mapId, encName);
    const cur = fireVotes[mapId]?.[petKey];
    const isAgree = cur === 'agree';
    const isDisagree = cur === 'disagree';
    let newLit = isLit;
    let newVote: 'agree' | 'disagree' | 'none' = 'none';
    if (type === 'agree') {
      if (isLit && isAgree) { newLit = false; newVote = 'none'; }        // 1
      else if (isLit) { newVote = 'agree'; }                             // 2
      else if (isAgree) { newVote = 'none'; }                            // 7
      else if (isDisagree) { newVote = 'agree'; }                        // 8
      else { newVote = 'agree'; }                                        // 6: 未点亮点赞同 -> 仅激活赞同，不点亮卡片
    } else {
      if (isLit) { newLit = false; newVote = 'disagree'; }               // 3,4
      else if (isDisagree) { newVote = 'none'; }                         // 10
      else if (isAgree) { newVote = 'disagree'; }                        // 9
      else { newVote = 'disagree'; }                                     // 5
    }
    if (newLit !== isLit) {
      fireStorage.toggleEncountered(mapId, encName);
    }
    fireStorage.updateVote(mapId, encName, newVote === 'none' ? undefined : newVote);
    setRecords(fireStorage.getAll());
  };

  // 识别候选的社区数据（赞同率徽章用）：候选文件名 -> pet_key -> communityAtlas
  const getFireCommunityInfo = (candFilename: string, sourceMapNum?: number): { agree_ratio?: number } | undefined => {
    if (!isFire || !showAtlasVote) return undefined;
    const mapId = `map${sourceMapNum ?? detectedMapNum ?? activeStageNum ?? 1}`;
    const pet = (mapsPets[mapId]?.items || []).find((p) => isSamePetName(p.name, candFilename));
    const pk = pet ? petKeyOf(pet.name, pet.id, pet.seq) : petKeyOf(candFilename);
    if (!pk) return undefined;
    return communityAtlas[`${mapId}:${pk}`];
  };

  // Process response into state
  // 更新“上次捕获”时间
  const markScanTime = () => {
    const now = new Date();
    setLastScanTime(
        `${now.getHours().toString().padStart(2, '0')}:${now
            .getMinutes()
            .toString()
            .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    );
  };

  // 识别不可用（游戏未打开 / 无 Python 桥接 / 识别失败）时，保持“当前未检测到精灵”空态
  const showNoPets = () => {
    setDetectedPets([]);
    markScanTime();
  };

  // 统一处理 followRecognize 结果：生产环境忽略本地模拟，避免伪造精灵结果
  const applyFollowResults = (res: { data?: FollowRecognizeApiResponse; isOfflineMock?: boolean }) => {
    if (!res?.data) return;
    if (res.isOfflineMock && import.meta.env.PROD) {
      console.warn('生产环境忽略离线模拟结果，保持“当前未检测到精灵”');
      showNoPets();
      return;
    }
    applyApiResults(res.data);
  };

  const applyApiResults = (data: FollowRecognizeApiResponse) => {
    // Always use the real stage_num returned by the backend recognition
    const targetMap = (data.stage_num !== undefined && data.stage_num !== null) ? Number(data.stage_num) : 1;
    setDetectedMapNum(targetMap);
    if (pinnedMapNum !== null) {
      // 钉住地图：只更新识别数据，视图保持在钉住的地图，不跳回识别结果地图
      setSelectedMapNum(pinnedMapNum);
    } else {
      setSelectedMapNum(targetMap); // 原逻辑：Reset manual selection so activeStageNum follows the recognized map
    }

    // 同步给左侧主界面（通过 storage settings 以及跨窗口消息；钉住时同步钉住的地图）
    const syncMapNum = pinnedMapNum !== null ? pinnedMapNum : targetMap;
    storage.setSetting('activeStageNum', syncMapNum);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('roco_active_stage_num', String(syncMapNum));
        if ('BroadcastChannel' in window) {
          const bc = new BroadcastChannel('roco_channel');
          bc.postMessage({ type: 'SWITCH_MAP', mapNum: syncMapNum });
          bc.close();
        }
        if (window.opener) {
          window.opener.postMessage({ type: 'SWITCH_MAP', mapNum: syncMapNum }, '*');
        }
      }
    } catch (e) {
      console.warn('Sync map message error:', e);
    }

    const rawList = data.results || [];

    const formattedSlots: DetectedPetSlot[] = rawList.map((item, idx) => {
      const topCand = item.candidates?.[0];
      const initialName = item.filename || topCand?.filename || '未知精灵';
      const initialScore = item.score ?? topCand?.score ?? 0.95;
      const matched = findPetMetadata(initialName);

      const candidateList = item.candidates && item.candidates.length > 0
          ? item.candidates
          : [{ filename: initialName, score: initialScore }];

      return {
        id: `slot-${idx}-${Date.now()}`,
        name: initialName,
        score: initialScore,
        view_url: item.view_url,
        candidates: candidateList.map((c) => ({
          filename: c.filename || '未知精灵',
          score: typeof c.score === 'number' ? c.score : 0.85,
          elements: findPetMetadata(c.filename || '')?.elements,
        })),
        selectedCandidateIndex: 0,
        selectedPetName: initialName,
        matchedPet: matched,
        sourceMapNum: targetMap,
      };
    });

    // 优化识别：3 个候选区全部为 10.0%以下（无有效候选）时，说明画面里根本没有精灵，
    // 直接清空结果走“当前未检测到精灵”空态，而不是显示 3 张 10.0%以下 的未知精灵卡片
    const isEmptySlot = (slot: DetectedPetSlot) =>
        slot.score <= 0 || slot.candidates.every((c) => c.score <= 0.1);
    const allSlotsEmpty = formattedSlots.length > 0 && formattedSlots.every(isEmptySlot);
    setDetectedPets(allSlotsEmpty ? [] : formattedSlots);

    // 共创采集：无完整图鉴的试炼（如火系），把跟随识别到的 (图, 精灵id, 置信度) 上报用于聚合
    formattedSlots.forEach((slot) => {
      if (slot.matchedPet?.id != null && slot.score > 0.1) {
        collectAtlasObservation(trialKey, {
          map_id: `map${targetMap}`,
          pet_id: slot.matchedPet.id,
          filename: slot.name,
          confidence: slot.score,
        });
      }
    });

    markScanTime();
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
      // 钉住地图时始终以钉住的地图作为识别目标，避免再次点击识别后跳回游戏实际识别出的地图
      const isPinnedRecognition = pinnedMapNum !== null && selectedMapNum !== null;
      const isReRecognize = (hasPendingMapChange || isPinnedRecognition) && selectedMapNum !== null;
      const targetMap = isReRecognize ? selectedMapNum : (targetMapNum !== undefined ? targetMapNum : undefined);

      const pyApi = (window as any).pywebview?.api;
      let capRes: any = null;

      if (pyApi) {
        if (isReRecognize && targetMap) {
          // 重新识别：指定试炼关卡（图1-3）识别
          console.log(`[PyWebView] 调用 capture_and_recognize_by_map(${targetMap}, "${trialKey}")`);
          if (typeof pyApi.capture_and_recognize_by_map === 'function') {
            capRes = await pyApi.capture_and_recognize_by_map(targetMap, trialKey);
          } else {
            // 兼容降级
            capRes = await pyApi.capture_and_recognize("洛克王国：世界", targetMap, trialKey);
          }
        } else {
          // 立即识别：全自动识别游戏画面
          console.log(`[PyWebView] 调用 capture_and_recognize("洛克王国：世界", null, "${trialKey}")`);
          capRes = await pyApi.capture_and_recognize("洛克王国：世界", null, trialKey);
        }

        console.log("识别结果:", capRes);
        if (!capRes) {
          console.warn("截图识别返回为空（游戏未打开？）");
          showNoPets();
        } else if (capRes.status === 'error' || capRes.status === 'fail') {
          // 游戏未打开 / 截图失败：不伪造数据，直接显示“当前未检测到精灵”
          console.warn("识别失败（游戏未打开或画面不可用）:", capRes.message || capRes);
          showNoPets();
        } else {
          // 将结果交由 applyApiResults 或 followRecognize 进行结构规整
          const res = await api.followRecognize(capRes);
          applyFollowResults(res);
        }
      } else {
        if (import.meta.env.PROD) {
          // 生产环境没有 Python 桥接（游戏未打开/非桌面端）：不做模拟识别，保持空态
          console.warn("未找到 Python API 桥接（生产环境），保持“当前未检测到精灵”");
          showNoPets();
        } else {
          // 未检测到 Python API 时的 Web 端开发/测试降级调用
          console.warn("未找到 Python API 桥接，使用 HTTP 降级");
          const res = await api.followRecognize(targetMap);
          applyFollowResults(res);
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

  const handleToggleTopmost = async () => {
    sound.playClick();
    const next = !topmost;
    setTopmost(next);
    try {
      const pyApi = (window as any).pywebview?.api;
      if (pyApi?.set_scanner_topmost) {
        const res = await pyApi.set_scanner_topmost(next);
        if (res?.on_top !== undefined) setTopmost(!!res.on_top);
      }
    } catch {
      /* ignore */
    }
  };

  return (
      <div className="w-screen h-screen bg-[#FDF9F3] dark:bg-slate-900 text-slate-800 dark:text-slate-100 flex flex-col justify-between select-none overflow-hidden font-sans border-0 m-0 p-0 relative rounded-none">
        {/* Subtle Scan Shimmer Radar Effect */}
        {showRadarAnimation && <div className="scanner-radar-active" />}

        {/* ------------------------------------------------------------- */}
        {/* 1. Main App Match Titlebar: Roco Sky Blue (#7ABCF4) */}
        {/* ------------------------------------------------------------- */}
        <div
            id="scanner-titlebar"
            className="h-11 px-3 bg-[#7ABCF4] dark:bg-slate-800 border-b border-[#5DA8E8] dark:border-slate-700 flex items-center justify-between gap-2 pywebview-drag-region cursor-move shrink-0 text-white rounded-none"
        >
          <div className="flex items-center gap-2 min-w-0 pointer-events-none">
            {/* 系别 logo 按钮：展示当前试炼，点击切换试炼（火/草） */}
            <div className="relative shrink-0 pointer-events-auto pywebview-no-drag">
              <button
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setIsTrialSwitcherOpen((v) => !v);
                  }}
                  className="w-7 h-7 rounded-xl bg-white/20 border-2 border-white/40 hover:bg-white/30 active:opacity-80 flex items-center justify-center transition-all cursor-pointer"
                  title={`当前试炼：${isFire ? '火系徽章试炼' : '草系徽章试炼'}（点击切换试炼）`}
              >
                <ElementBadges elements={[ELEMENT_EN_TO_CN[trialKey] || '草']} size="md" />
              </button>
              {isTrialSwitcherOpen && (
                  <>
                    {/* 外罩：点击任意处关闭 */}
                    <div className="fixed inset-0 z-40 cursor-default" onClick={() => setIsTrialSwitcherOpen(false)} />
                    <div className="absolute left-0 top-9 z-50 w-44 bg-white dark:bg-slate-800 rounded-xl border-2 border-[#D5E3F0] dark:border-slate-700 shadow-xl overflow-hidden">
                      {trialOptions.map((t) => (
                          <button
                              key={t.key}
                              type="button"
                              onClick={() => switchTrial(t.key)}
                              className={`w-full px-3 py-2 flex items-center gap-2 text-xs font-black transition-colors cursor-pointer ${
                                  t.key === trialKey
                                      ? 'bg-[#EBF5FE] dark:bg-sky-950/70 text-[#1E5B99] dark:text-sky-300'
                                      : 'text-slate-700 dark:text-slate-200 hover:bg-[#F8FBFE] dark:hover:bg-slate-700'
                              }`}
                          >
                            <ElementBadges elements={[ELEMENT_EN_TO_CN[t.key] || '草']} size="sm" />
                            <span>{t.title}</span>
                            {t.key === trialKey && <Check className="w-3.5 h-3.5 ml-auto text-[#1E5B99] dark:text-sky-300 stroke-[3]" />}
                          </button>
                      ))}
                    </div>
                  </>
              )}
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs sm:text-sm font-black text-white truncate tracking-tight">
                {activeStageNum === null ? '跟随识别' : currentDetectedMap.name}
              </span>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FEE061] text-[#854D0E] border-2 border-[#E5C43B] shrink-0 font-mono">
                {activeStageNum === null
                    ? `全图 ${allMapsStats.grandEncountered}/${allMapsStats.grandTotal}`
                    : `地图 ${activeStageNum}`}
              </span>
            </div>
          </div>

          {/* Right side status & action buttons */}
          <div className="flex items-center gap-1.5 shrink-0 pywebview-no-drag">
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  themeService.toggleTheme();
                }}
                className="w-7 h-7 rounded-xl bg-white/20 hover:bg-white/30 active:opacity-80 text-white flex items-center justify-center transition-all cursor-pointer border-2 border-white/40"
                title={themeService.isDark() ? '切换为明亮模式' : '切换为暗黑模式'}
            >
              {themeService.isDark() ? (
                <Sun className="w-3.5 h-3.5 text-[#FEE061]" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-white" />
              )}
            </button>
            <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  setIsHistoryOpen(true);
                }}
                className="px-2.5 py-1 rounded-xl bg-white/20 hover:bg-white/30 active:opacity-80 text-white flex items-center gap-1 text-xs font-black transition-all cursor-pointer border-2 border-white/40"
                title="查看遇见历史与防止误点撤销"
            >
              <History className="w-3.5 h-3.5 text-[#FEE061]" />
              <span>历史</span>
            </button>
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
                id="scanner-topmost-btn"
                onClick={handleToggleTopmost}
                title={topmost ? '取消置顶' : '置顶到所有窗口前面'}
                className={`w-7 h-7 rounded-xl border-2 flex items-center justify-center transition-all cursor-pointer active:opacity-80 ${
                    topmost
                        ? 'bg-white dark:bg-slate-700 text-[#2B78C4] dark:text-sky-300 border-white/80 dark:border-slate-600 shadow-xs'
                        : 'bg-white/20 text-white border-white/40 hover:bg-white/30'
                }`}
            >
              {topmost ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
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
        {/* 2. Main Content Area: Roco Light / Dark Clean Aesthetics (Zero-Gap) */}
        {/* ------------------------------------------------------------- */}
        <div
            id="scanner-scroll-content"
            className="flex-1 flex flex-col justify-between overflow-y-auto bg-[#FDF9F3] dark:bg-slate-900 p-3 gap-2.5 transition-colors"
        >
          {!isCollapsedContent ? (
              <div className="space-y-2.5">
                {/* 2.1 Collection Progress Card */}
                {activeStageNum === null ? (
                    /* Initial State: Show all maps overview */
                    <div className="p-3 bg-white dark:bg-slate-800 roco-card border-2 border-[#E6EEF8] dark:border-slate-700 rounded-2xl space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-800 dark:text-slate-100 font-black flex items-center gap-1.5">
                          <Layers className="w-4 h-4 text-[#7ABCF4]" />
                          王国各区域图鉴总览
                        </span>
                        <span className="text-xs font-mono font-black text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-[#95D151]/50 dark:border-emerald-700/50">
                          {allMapsStats.grandEncountered}/{allMapsStats.grandTotal} ({allMapsStats.grandPercent.toFixed(0)}%)
                        </span>
                      </div>

                      {/* Total progress bar */}
                      <div className="w-full h-2.5 bg-[#E9F2FA] dark:bg-slate-700/80 rounded-full overflow-hidden border-2 border-[#D5E3F0] dark:border-slate-600 p-0.5">
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
                                className="p-2 rounded-xl bg-[#F8FBFE] dark:bg-slate-800/90 hover:bg-[#EBF5FE] dark:hover:bg-slate-700 border-2 border-[#D5E3F0] dark:border-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500 text-left transition-all cursor-pointer group"
                                title={`点击切换查看 ${m.config.name}`}
                            >
                              <div className="text-[11px] font-black text-slate-800 dark:text-slate-200 truncate group-hover:text-[#1E5B99] dark:group-hover:text-sky-300">
                                {m.config.name}
                              </div>
                              <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                                <span className="font-bold text-[#2D6613] dark:text-emerald-400">{m.encountered}/{m.total}</span>
                                <span className="text-slate-400 dark:text-slate-400 font-sans">{m.percent.toFixed(0)}%</span>
                              </div>
                            </button>
                        ))}
                      </div>
                    </div>
                ) : (
                    /* Active Selected/Detected Map Progress Card */
                    <div className="p-3 bg-white dark:bg-slate-800 roco-card border-2 border-[#E6EEF8] dark:border-slate-700 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-800 dark:text-slate-100 font-black flex items-center gap-1.5">
                          <Layers className="w-4 h-4 text-[#7ABCF4]" />
                          {currentDetectedMap.name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {/* 钉住地图：识别后视图不再跳回 */}
                          <button
                              type="button"
                              onClick={handleTogglePin}
                              className={`px-2 py-1 rounded-lg text-[10px] font-black border flex items-center gap-1 transition-all cursor-pointer active:scale-95 ${
                                  pinnedMapNum !== null
                                      ? 'bg-[#FEE061] text-[#854D0E] border-[#E5C43B] shadow-xs'
                                      : 'bg-[#F8FBFE] dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-[#D5E3F0] dark:border-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500 hover:bg-[#EBF5FE] dark:hover:bg-slate-700'
                              }`}
                              title={
                                pinnedMapNum !== null
                                    ? `已钉住【${currentDetectedMap.name}】：再次识别后视图不再跳回`
                                    : '钉住当前关卡：再次识别后视图不再跳回识别出的关卡'
                              }
                          >
                            <MapPin className={`w-3 h-3 ${pinnedMapNum !== null ? 'fill-[#E5C43B]' : ''}`} />
                            {pinnedMapNum !== null ? '已钉住' : '钉住'}
                          </button>
                          <span className="text-xs font-mono font-black text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-[#95D151]/50 dark:border-emerald-700/50">
                            {mapCollectionStats.encountered}/{mapCollectionStats.total}
                          </span>
                          {mapCollectionStats.remaining > 0 ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                                余 {mapCollectionStats.remaining}
                              </span>
                          ) : (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                全收录 🎉
                              </span>
                          )}
                        </div>
                      </div>

                      {/* High Contrast Progress Bar */}
                      <div className="w-full h-2.5 bg-[#E9F2FA] dark:bg-slate-700/80 rounded-full overflow-hidden border-2 border-[#D5E3F0] dark:border-slate-600 p-0.5">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-[#95D151] to-[#76B032] transition-all duration-300"
                            style={{ width: `${mapCollectionStats.percent}%` }}
                        />
                      </div>

                      {/* Pending re-recognition banner if user manually switched map */}
                      {hasPendingMapChange && (
                          <div className="text-[11px] font-bold text-[#854D0E] dark:text-amber-200 bg-[#FEF9E6] dark:bg-amber-950/60 border border-[#E5C43B] dark:border-amber-700 rounded-xl px-2.5 py-1.5 flex items-center justify-between">
                            <span>已指定为【{currentDetectedMap.name}】</span>
                            <span className="text-[10px] bg-[#FEE061] text-[#854D0E] font-black px-2 py-0.5 rounded-full border border-[#E5C43B]">
                              待重新识别
                            </span>
                          </div>
                      )}

                      {/* Map Switcher Bar */}
                      <div className="pt-1.5 border-t border-[#EDF2F7] dark:border-slate-700/80 flex items-center justify-between gap-1.5">
                        <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 shrink-0">
                          切换地图:
                        </span>
                        <div className="grid grid-cols-4 gap-1 flex-1">
                          <button
                              type="button"
                              onClick={() => handleSelectMap(null)}
                              className={`py-1 px-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer truncate ${
                                  activeStageNum === null
                                      ? 'bg-[#7ABCF4] dark:bg-sky-600 text-white border-[#5DA8E8] dark:border-sky-500'
                                      : 'bg-[#F8FBFE] dark:bg-slate-800 hover:bg-[#EBF5FE] dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-[#D5E3F0] dark:border-slate-700'
                              }`}
                              title="查看王国各区域总览"
                          >
                            全图
                          </button>
                          {activeMapsConfig.map((m) => {
                            const isSelected = activeStageNum === m.num;
                            const mapShort = isFire
                                ? `图${m.num}`
                                : m.num === 1 ? '图1 索米亚' : m.num === 2 ? '图2 巨石阵' : m.num === 3 ? '图3 普拉塔' : `图${m.num}`;
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => handleSelectMap(m.num)}
                                    className={`py-1 px-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer truncate ${
                                        isSelected
                                            ? 'bg-[#7ABCF4] dark:bg-sky-600 text-white border-[#5DA8E8] dark:border-sky-500 shadow-xs'
                                            : 'bg-[#F8FBFE] dark:bg-slate-800 hover:bg-[#EBF5FE] dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-[#D5E3F0] dark:border-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500'
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
                {/* Notice banner when user switched viewing map but has not re-recognized yet */}
                {detectedPets.length > 0 && detectedMapNum !== null && activeStageNum !== detectedMapNum && (
                    <div className="p-2.5 rounded-2xl bg-[#FEF9E6] dark:bg-amber-950/60 border-2 border-[#E5C43B] dark:border-amber-700 text-[#854D0E] dark:text-amber-200 flex items-center justify-between gap-2 shadow-2xs">
                      <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-[#FEE061] text-[#854D0E] flex items-center justify-center font-black text-xs shrink-0 border border-[#E5C43B]">
                        !
                      </span>
                        <div className="text-[11px] leading-tight min-w-0">
                          <span className="font-black">已切换至【{getMapDisplayName(activeStageNum)}】</span>
                          <p className="text-[10px] text-[#A16207] dark:text-amber-300/80 truncate font-medium mt-0.5">
                            【{getMapDisplayName(detectedMapNum)}】识别结果，点亮仍计入原地图
                          </p>
                        </div>
                      </div>
                      <button
                          type="button"
                          onClick={() => executeSingleRecognition(activeStageNum || undefined)}
                          disabled={isRecognizingNow}
                          className="shrink-0 text-[10px] font-black bg-[#E5C43B] hover:bg-[#D4B32A] text-slate-900 px-2.5 py-1 rounded-xl border border-[#CA9B1B] cursor-pointer transition-all active:scale-95 flex items-center gap-1"
                          title="立即对当前切换的地图进行识别"
                      >
                        <RefreshCw className={`w-3 h-3 ${isRecognizingNow ? 'animate-spin' : ''}`} />
                        <span>立即重识</span>
                      </button>
                    </div>
                )}

                {detectedPets.length === 0 ? (
                    <div className="p-5 bg-white dark:bg-slate-800 roco-card border-2 border-[#E6EEF8] dark:border-slate-700 rounded-2xl text-center space-y-2">
                      <div className="w-10 h-10 rounded-2xl bg-[#EBF5FE] dark:bg-slate-700 text-[#7ABCF4] dark:text-sky-400 flex items-center justify-center mx-auto border-2 border-[#D5E3F0] dark:border-slate-600">
                        <Eye className="w-5 h-5" />
                      </div>
                      <p className="text-xs font-black text-slate-800 dark:text-slate-100">当前未检测到精灵</p>
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
                                className="rounded-2xl border-2 border-dashed border-[#BCD7F2] dark:border-sky-900/60 bg-[#F4F9FF] dark:bg-slate-800/90 p-3 text-center flex items-center justify-between gap-2.5"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-10 h-10 rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D5E3F0] dark:border-slate-700 flex items-center justify-center text-amber-500 font-bold text-base shrink-0">
                                  {cleanName.includes('魔力之源') ? '❤️' : '🎒'}
                                </div>
                                <div className="text-left min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                                      【特殊点位】{cleanName}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate font-medium">
                                    场景特殊交互点，无需点亮图鉴
                                  </p>
                                </div>
                              </div>
                            </div>
                        );
                      }

                      const slotSourceMap = slot.sourceMapNum ?? detectedMapNum ?? 1;
                      const isSlotFromDifferentMap = activeStageNum !== slotSourceMap;
                      const isEncountered = checkEncountered(slot.selectedPetName, slotSourceMap);
                      const topScorePercent = (slot.score * 100).toFixed(1);

                      return (
                          <div
                              key={slot.id}
                              className={`roco-card rounded-2xl border-2 p-3 transition-all ${
                                  isEncountered
                                      ? 'bg-[#F8FBFE] dark:bg-slate-800/90 border-[#D5E3F0] dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                      : 'bg-white dark:bg-slate-800 border-[#7ABCF4] dark:border-sky-500 text-slate-800 dark:text-slate-100'
                              }`}
                          >

                            {/* Header: Avatar, Name, Status, Action */}
                            <div className="flex items-center justify-between gap-2.5 mb-2.5">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {/* Pet Image（悬停/点击放大预览） */}
                                <div className="relative shrink-0">
                                  <ImageZoom
                                      src={slot.matchedPet?.url || `${api.getApiBase()}/icons/${displayName}.png`}
                                      alt={displayName}
                                      className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D5E3F0] dark:border-slate-700 p-1 flex items-center justify-center overflow-hidden"
                                      imgClassName="w-full h-full object-contain"
                                      zoomWidth={360}
                                      zoomHeight={360}
                                      maxWidth={80}
                                      maxHeight={80}
                                  />
                                  <ElementBadges
                                      elements={slot.matchedPet?.elements}
                                      className="absolute top-0.5 left-0.5 z-10"
                                  />
                                </div>

                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 truncate" title={displayName}>
                                      {displayName}
                                    </span>
                                    <PetSpecialTag
                                        pet={slot.matchedPet}
                                        filename={slot.selectedPetName || slot.name}
                                    />
                                    <span className="text-[10px] font-mono font-black text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
                                      {topScorePercent}%
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1 mt-1">
                                    {isEncountered ? (
                                        <span className="text-[10px] font-bold text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-[#95D151]/50 dark:border-emerald-700/50 flex items-center gap-1">
                                          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 stroke-[3]" />
                                          已在图鉴
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-black text-amber-800 dark:text-amber-300 bg-[#FEF9E6] dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-[#E5C43B] dark:border-amber-700/60 flex items-center gap-1">
                                          <Sparkle className="w-3 h-3 text-amber-600 dark:text-amber-400 fill-amber-500" />
                                          未遇新宠 (可点亮)
                                        </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Toggle Encounter Button */}
                              <button
                                  type="button"
                                  onClick={() => handleTogglePetEncounter(slot.selectedPetName, slotSourceMap)}
                                  className={`px-3 py-1.5 text-xs font-black rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border-2 ${
                                      isEncountered
                                          ? 'roco-btn-secondary bg-[#E1F7DB]/80 dark:bg-emerald-950/60 hover:bg-[#D3F3CA] dark:hover:bg-emerald-900/60 text-[#2D6613] dark:text-emerald-300 border-[#86EFAC] dark:border-emerald-700'
                                          : 'roco-btn-success text-white'
                                  }`}
                                  title={
                                    isEncountered
                                        ? `已在【${getMapDisplayName(slotSourceMap)}】图鉴中（点击取消）`
                                        : `点亮【${getMapDisplayName(slotSourceMap)}】图鉴${isSlotFromDifferentMap ? `（注意：当前切换至${getMapDisplayName(activeStageNum)}但未重新识别）` : ''}`
                                  }
                              >
                                {isEncountered ? (
                                    <>
                                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
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

                            {/* Candidate Switcher with Horizontal Navigation */}
                            {slot.candidates && slot.candidates.length > 1 && (
                                <CandidateCarousel
                                    candidates={slot.candidates}
                                    selectedCandidateIndex={slot.selectedCandidateIndex}
                                    slotId={slot.id}
                                    sourceMapNum={slotSourceMap}
                                    onSelect={handleSelectCandidate}
                                    checkEncountered={checkEncountered}
                                    getCommunityInfo={isFire ? getFireCommunityInfo : undefined}
                                />
                            )}
                          </div>
                      );
                    })
                )}
              </div>
          ) : (
              <div className="p-3 bg-white dark:bg-slate-800 roco-card border-2 border-[#DCE8F5] dark:border-slate-700 rounded-2xl flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">识别信息已收起</span>
                <button
                    type="button"
                    onClick={() => setIsCollapsedContent(false)}
                    className="text-xs font-black text-[#1E5B99] dark:text-sky-400 hover:underline"
                >
                  展开完整视图
                </button>
              </div>
          )}

          {/* 2.3 Bottom Action Buttons (Main app matched buttons) */}
          <div className="pt-2 border-t-2 border-[#D5E3F0] dark:border-slate-700 space-y-2 shrink-0">
            <div className="grid grid-cols-1 gap-2">
              <button
                  type="button"
                  id="scanner-single-recognize-btn"
                  onClick={() => executeSingleRecognition(activeStageNum || undefined)}
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
                      <span>重新识别 (指定地图{activeStageNum})</span>
                    </>
                ) : pinnedMapNum !== null ? (
                    <>
                      <MapPin className="w-4 h-4" />
                      <span>识别 (已钉住地图{pinnedMapNum})</span>
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
        <div
            id="scanner-statusbar"
            className="h-7 px-3 bg-[#E9F2FA] dark:bg-slate-800 border-t-2 border-[#D5E3F0] dark:border-slate-700 text-[11px] font-mono text-slate-600 dark:text-slate-300 flex items-center justify-between shrink-0 font-bold rounded-none"
        >
          <span>上次捕获: {lastScanTime}</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-sans">洛克王国徽章试炼助手</span>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 4. Scanner Map & All Pet Gallery Modal */}
        {/* ------------------------------------------------------------- */}
        <ScannerMapGalleryModal
            isOpen={isGalleryOpen}
            onClose={() => setIsGalleryOpen(false)}
            initialMapNum={activeStageNum || 1}
            mapsPets={mapsPets}
            records={records}
            mapsConfig={activeMapsConfig}
            onToggleEncounter={isFire
                ? (mapId, filename) => handleTogglePetEncounter(filename, parseInt(mapId.replace(/^map/, ''), 10) || undefined)
                : undefined}
            communityAtlas={isFire && showAtlasVote ? communityAtlas : undefined}
            onAtlasVote={isFire && showAtlasVote ? handleAtlasVote : undefined}
            communityCard={isFire}
            onOpenHistory={() => setIsHistoryOpen(true)}
            trialKey={trialKey}
        />

        {/* 5. Encounter History Modal */}
        <EncounterHistoryModal
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
            records={records}
            allMapsPets={mapsPets}
            onToggleEncounter={(mapId, filename) => {
              if (isFire) {
                handleTogglePetEncounter(filename, parseInt(mapId.replace(/^map/, ''), 10) || undefined);
                return;
              }
              const wasEnc = storage.isEncountered(mapId, filename);
              storage.toggleEncountered(mapId, filename);
              const level = storage.getSetting<EffectLevel>('effectLevel', 0);
              if (!wasEnc) {
                sound.playEncounter();
                fireEncounterConfetti(level);
              } else {
                sound.playToggleOff();
                fireUnencounterEffect(level);
              }
            }}
        />
      </div>
  );
};
