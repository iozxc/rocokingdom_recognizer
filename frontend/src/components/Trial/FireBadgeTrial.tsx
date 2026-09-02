import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapConfig, PetItem, EncounterRecord, FirePokedexEntry, FloatingButtonsMode, AdvancedFilterState, FireSettings } from '../../types';
import { fireStorage } from '../../services/fireStorage';
import { getCachedFirePets, getFireTrialPetsCached, getFireMapPets } from '../../services/fireTrialData';
import { storage } from '../../services/storage';
import { sound } from '../../services/sound';
import { FIRE_MAP_CONFIGS } from '../../data/trials';
import { Header } from '../Header';
import { AuthBadge } from '../AuthBadge';
import { StatsBanner } from '../StatsBanner';
import { PetGrid } from '../PetGrid';
import { BootstrapAtlasModal } from '../BootstrapAtlasModal';
import { PetDetailModal } from '../PetDetailModal';
import { FloatingFilterSwitch } from '../FloatingFilterSwitch';
import { GlobalFloatingSearch } from '../GlobalFloatingSearch';
import { SubHeaderToolbar } from '../SubHeaderToolbar';
import { FeedbackContactModal } from '../FeedbackContactModal';
import { UserManualModal } from '../UserManualModal';
import { UpdateModal } from '../UpdateModal';
import { AppSettingsModal } from '../AppSettingsModal';
import { BatchRecognizerCard } from '../BatchRecognizerCard';
import { createSvgPetAvatar } from '../../data/mockPets';
import { fetchTrialAtlas, syncTrialAtlas, syncTrialAtlasKeepalive, petKeyOf, TrialAtlas, AtlasEntry, wilsonLower } from '../../services/atlasCollector';
import { isPetEncounteredInRecords } from '../../utils/petHelper';
import { PLATFORM, IS_STATIC } from '../../services/staticMode';
import { updateStore } from '../../services/updateStore';

interface FireBadgeTrialProps {
  maps: MapConfig[];
  onBack: () => void;
}

export const FireBadgeTrial: React.FC<FireBadgeTrialProps> = ({ maps, onBack }) => {
  // 兜底：即使后端未下发地图配置，也使用本地火系地图，避免空数组导致渲染崩溃
  const safeMaps = maps && maps.length > 0 ? maps : FIRE_MAP_CONFIGS;
  const initialPets = getCachedFirePets();
  const [activeStageNum, setActiveStageNum] = useState<number>(1);
  const [pokedex, setPokedex] = useState<FirePokedexEntry[]>(initialPets ?? []);
  const [fireMapPets, setFireMapPets] = useState<Record<string, Record<string, { id?: number; name?: string; seq?: number | null }>>>({});
  const [records, setRecords] = useState<Record<string, EncounterRecord>>(() => fireStorage.getAll());
  const [filterMode, setFilterMode] = useState<'all' | 'encountered' | 'unencountered'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loaded, setLoaded] = useState<boolean>(initialPets !== null);
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isSoundMuted', sound.getMuted());
  });
  const [isManualOpen, setIsManualOpen] = useState<boolean>(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState<boolean>(false);
  const [detailPet, setDetailPet] = useState<PetItem | null>(null);
  const [feedbackInitialType, setFeedbackInitialType] = useState<string>('');
  const [isUpdateOpen, setIsUpdateOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isAtlasOpen, setIsAtlasOpen] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'ok' | 'err'>('idle');
  // 火系专属设置存 appSettings.fireSettings，跨会话/换设备保持一致
  const [fireSettings, setFireSettings] = useState<FireSettings>(() =>
      storage.getSetting<FireSettings>('fireSettings', {})
  );
  const saveFireSettings = (patch: Partial<FireSettings>) => {
    const current = storage.getSetting<FireSettings>('fireSettings', {}) || {};
    const next = { ...current, ...patch };
    setFireSettings(next);
    storage.setSetting('fireSettings', next);
    // 立即同步到后端，避免“改完立刻关窗”时 150ms 防抖未触发导致丢失。
    void storage.saveToRemote();
  };
  // 赞同率阈值：默认 0%（开荒期不做过滤）
  const [minAgreeRatio, setMinAgreeRatio] = useState<number>(() => fireSettings.agreeRatio ?? 0);
  // 隐藏投票/赞同率（默认显示）
  const [showAtlasVote, setShowAtlasVote] = useState<boolean>(() => fireSettings.showVote ?? true);
  // 首页图鉴数据源：community=共创图鉴（按 map_pets2 分组）| pokedex=全图鉴自选（每图全量）
  const [atlasMode, setAtlasMode] = useState<'community' | 'pokedex'>(() => fireSettings.atlasMode ?? 'community');
  const [serverAtlas, setServerAtlas] = useState<TrialAtlas | null>(null);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState<boolean>(false);
  const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
    return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
  });
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>({
    elements: [],
    specialTypes: [],
  });

  useEffect(() => {
    const unsubscribe = fireStorage.subscribe((newRecords) => setRecords(newRecords));
    getFireTrialPetsCached().then((pets) => {
      setPokedex(pets);
      setLoaded(true);
    }).catch(() => {
      setPokedex([]);
      setLoaded(true);
    });
    getFireMapPets().then((mp) => setFireMapPets(mp)).catch(() => {});
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = storage.subscribeSettings((newSettings) => {
      if (typeof newSettings.isSoundMuted === 'boolean') {
        setIsSoundMuted(newSettings.isSoundMuted);
      }
      if (newSettings.floatingButtonsMode) {
        setFloatingMode(newSettings.floatingButtonsMode);
      }
      // 多端同步：远端 user_data.json 拉到最新 fire 专属设置时刷新本地展示态
      const fs = newSettings.fireSettings || {};
      setMinAgreeRatio(fs.agreeRatio ?? 0);
      setShowAtlasVote(fs.showVote ?? true);
      setAtlasMode(fs.atlasMode ?? 'community');
    });
    return unsubscribe;
  }, []);

  // 按 map_pets2.json（社区共创图鉴）分组：每张地图只含该图精灵，PetItem.name 用完整数据集文件名，
  // 与识别结果返回的 filename 一致，避免识别/点亮对不上；name=filename => 记录 key 也统一。
  const fireMapsPets: Record<string, { count: number; items: PetItem[] }> = useMemo(() => {
    const buildFullItems = (): PetItem[] =>
        pokedex
            .filter((pet): pet is FirePokedexEntry => !!pet && typeof pet === 'object')
            .map((pet) => ({
              name: `${pet.name}.png`,
              id: pet.id,
              seq: pet.seq,
              elements: pet.elements ?? [],
              rarity: 'common',
              url: pet.url || createSvgPetAvatar(pet.name, '火', (pet.id * 47) % 360, '#ef4444', '🔥'),
            }));

    // 全图鉴自选模式：每张地图都展示全量 pokedex（与旧版一致）
    if (atlasMode === 'pokedex') {
      const items = buildFullItems();
      const base = { count: items.length, items };
      return { map1: base, map2: base, map3: base };
    }

    const byIdSeq = new Map<string, FirePokedexEntry>();
    pokedex.forEach((p) => {
      if (p && typeof p === 'object') byIdSeq.set(`${p.id}_${p.seq ?? 0}`, p);
    });

    const filenameOf = (pet: FirePokedexEntry | undefined, pid: number, seq?: number): string => {
      const base = pet?.name || String(pid);
      return seq != null
          ? `${String(pid).padStart(3, '0')}_${String(seq).padStart(2, '0')}_${base}.png`
          : `${String(pid).padStart(3, '0')}_${base}.png`;
    };
    const seqOf = (pet_key: string): number | undefined => {
      const m = (pet_key || '').match(/_(\d{1,3})$/);
      return m ? parseInt(m[1], 10) : undefined;
    };

    // 社区共创图鉴：以远端服务器实时聚合的 atlas（与共创图鉴弹窗同一份）为准，自动反映最新
    const buildAtlasItems = (entries: Record<string, AtlasEntry>): PetItem[] =>
        Object.entries(entries || {}).map(([pet_key, entry]) => {
          const pid = entry.id ?? parseInt(String(pet_key).split('_')[0], 10);
          const seq = seqOf(pet_key);
          const pet = byIdSeq.get(`${pid}_${seq ?? 0}`);
          return {
            name: filenameOf(pet, pid, seq),
            id: pid,
            seq,
            elements: pet?.elements ?? [],
            rarity: 'common',
            url: pet?.url || createSvgPetAvatar(pet?.name || String(pid), '火', (pid * 47) % 360, '#ef4444', '🔥'),
          };
        });

    const buildItems = (entries: Record<string, { id?: number; name?: string; seq?: number | null }>): PetItem[] =>
        Object.entries(entries || {}).map(([filename, meta]) => {
          const pet = byIdSeq.get(`${meta.id}_${meta.seq ?? 0}`);
          return {
            name: filename, // 完整数据集文件名，如 "258_02_乌达_极夜.png"
            id: meta.id ?? 0,
            seq: meta.seq ?? undefined,
            elements: pet?.elements ?? [],
            rarity: 'common',
            url: pet?.url || createSvgPetAvatar(meta.name || String(meta.id ?? ''), '火', ((meta.id ?? 0) * 47) % 360, '#ef4444', '🔥'),
          };
        });

    const out: Record<string, { count: number; items: PetItem[] }> = {};
    // 1) 本地 map_pets2.json 已存在（data_manifest 更新 / 官方图鉴）：优先用本地
    if (Object.keys(fireMapPets).length > 0) {
      Object.entries(fireMapPets).forEach(([mapId, entries]) => {
        const items = buildItems((entries || {}) as Record<string, { id?: number; name?: string; seq?: number | null }>);
        out[mapId] = { count: items.length, items };
      });
    }
    // 2) 本地无 map_pets2.json：走远端服务器 atlas（共创图鉴，自动最新）
    else if (serverAtlas?.maps && Object.keys(serverAtlas.maps).length > 0) {
      Object.entries(serverAtlas.maps).forEach(([mapId, entries]) => {
        const items = buildAtlasItems((entries || {}) as Record<string, AtlasEntry>);
        out[mapId] = { count: items.length, items };
      });
    }
    // 3) 仍为空则兜底全量（避免空页）
    if (Object.keys(out).length === 0) {
      const items = buildFullItems();
      const base = { count: items.length, items };
      return { map1: base, map2: base, map3: base };
    }

    return out;
  }, [atlasMode, fireMapPets, pokedex, serverAtlas]);

  // 手动投票并入 encounteredPets2：从 fireStorage 记录里的 vote 派生，避免单独一套存储。
  const manualVotes = useMemo<Record<string, Record<string, 'agree' | 'disagree'>>>(() => {
    const votes: Record<string, Record<string, 'agree' | 'disagree'>> = {};
    (Object.entries(records) as Array<[string, EncounterRecord]>).forEach(([, rec]) => {
      if (!rec?.vote || !rec.mapId) return;
      const pet = (fireMapsPets[rec.mapId]?.items || []).find((p) => p.name === rec.filename);
      const pk = pet ? petKeyOf(pet.name, pet.id, pet.seq) : petKeyOf(rec.filename || '');
      if (pk) (votes[rec.mapId] ??= {})[pk] = rec.vote;
    });
    return votes;
  }, [records, fireMapsPets]);

  const currentMap: MapConfig = useMemo(() => {
    return safeMaps.find((m) => m.num === activeStageNum) || safeMaps[0];
  }, [activeStageNum, safeMaps]);

  const currentMapPets: PetItem[] = useMemo(() => {
    return fireMapsPets[`map${activeStageNum}`]?.items || [];
  }, [activeStageNum, fireMapsPets]);

  const allMapsStats = useMemo(() => {
    return safeMaps.map((map) => {
      const list = fireMapsPets[map.id]?.items || [];
      const encountered = list.filter((p) =>
          isPetEncounteredInRecords(records, map.id, p.name)
      ).length;
      return {
        num: map.num,
        id: map.id,
        name: map.name,
        encountered,
        total: list.length,
      };
    });
  }, [fireMapsPets, records, safeMaps]);

  const totalPetsCount = useMemo(() => {
    return safeMaps.reduce((sum, map) => {
      return sum + (fireMapsPets[map.id]?.items.length || 0);
    }, 0);
  }, [fireMapsPets, safeMaps]);

  const totalEncounteredCount = useMemo(() => {
    return allMapsStats.reduce((sum, s) => sum + s.encountered, 0);
  }, [allMapsStats]);

  const currentMapStats = useMemo(() => {
    const encountered = currentMapPets.filter((p) =>
        isPetEncounteredInRecords(records, currentMap.id, p.name)
    ).length;
    const total = currentMapPets.length;
    return {
      encounteredCount: encountered,
      totalMapPets: total,
      percentage: total > 0 ? Math.round((encountered / total) * 100) : 0,
    };
  }, [currentMapPets, records, currentMap.id]);

  const handleToggleEncounter = (mapId: string, filename: string) => {
    const wasLit = fireStorage.isEncountered(mapId, filename);
    fireStorage.toggleEncountered(mapId, filename);
    // 点亮 = 默认赞同（写入 vote）；取消点亮保留 vote（toggleEncountered 已保留）
    if (!wasLit) fireStorage.updateVote(mapId, filename, 'agree');
    setRecords(fireStorage.getAll());
    if (wasLit) sound.playToggleOff(); else sound.playEncounter();
  };

  // 构建“当前已点亮 pet_id 集合”（快照上传用，只传 map->id）
  const buildMaps = (): Record<string, string[]> => {
    const m: Record<string, string[]> = {};
    Object.entries(fireMapsPets).forEach(([mapId, { items }]) => {
      (items || []).forEach((pet) => {
        if (isPetEncounteredInRecords(fireStorage.getAll(), mapId, pet.name)) {
          const pk = petKeyOf(pet.name, pet.id, pet.seq);
          if (pk) (m[mapId] ??= []).push(pk);
        }
      });
    });
    return m;
  };

  // 保存最新同步载荷，手动上传/卸载兜底用
  const latestSyncRef = useRef<{ maps: Record<string, string[]>; votes: Record<string, Record<string, 'agree' | 'disagree'>> }>({ maps: {}, votes: {} });
  latestSyncRef.current = { maps: buildMaps(), votes: manualVotes };
  const doSync = () => {
    setUploadStatus('uploading');
    void syncTrialAtlas('fire', latestSyncRef.current.maps, latestSyncRef.current.votes)
        .then((ok) => {
          setUploadStatus(ok ? 'ok' : 'err');
          setTimeout(() => setUploadStatus('idle'), 2200);
        });
  };

  // 刷新：从服务器拉取最新社区图鉴/赞同率
  const handleRefreshAtlas = () => {
    setUploadStatus('uploading');
    void fetchTrialAtlas('fire').then((a) => {
      if (a) setServerAtlas(a);
      setUploadStatus(a ? 'ok' : 'err');
      setTimeout(() => setUploadStatus('idle'), 2200);
    });
  };

  // 30s 自动同步（静默，不弹 toast）；关闭/卸载在卸载 effect 里再刷一次
  const silentSync = () => { void syncTrialAtlas('fire', latestSyncRef.current.maps, latestSyncRef.current.votes); };
  useEffect(() => {
    const t = setInterval(silentSync, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打开时：拉取社区图鉴 + 上传自己已点亮集合
  useEffect(() => {
    let mounted = true;
    fetchTrialAtlas('fire').then((a) => { if (mounted) setServerAtlas(a); });
    doSync();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始化：把所有“已点亮”精灵默认为赞同（无手动投票时）
  useEffect(() => {
    let changed = false;
    Object.values(fireStorage.getAll()).forEach((rec) => {
      if (rec?.encountered && !rec.vote) {
        fireStorage.updateVote(rec.mapId, rec.filename, 'agree');
        changed = true;
      }
    });
    if (changed) setRecords(fireStorage.getAll());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 社区图鉴：合并本地手动投票 + 自动赞同(点=亮) 后的展示态
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
    const w = PLATFORM === 'web' ? 0.5 : 1; // 本设备权重（web×0.5 / 客户端×1）
    if (serverAtlas?.maps) {
      Object.entries(serverAtlas.maps).forEach(([mapId, entries]) => {
        Object.entries(entries).forEach(([, e]) => {
          const pk = e.pet_key || (e.id != null ? String(e.id) : '');
          if (!pk) return;
          const key = `${mapId}:${pk}`;
          const localVote = manualVotes?.[mapId]?.[pk];
          const serverVote = e.my_vote ?? 'none';
          const pet = (fireMapsPets[mapId]?.items || []).find((p) => petKeyOf(p.name, p.id, p.seq) === pk);
          const encName = pet?.name || '';
          // 本地是否已「操作过」该精灵（有点亮/投票记录，即使已取消 vote）：
          // - 有记录：说明本设备投过/取消过，用本地姿态替换服务端贡献；
          // - 无记录：从未操作，直接采用服务端 agree_ratio（权威），避免“服务端 100% 却显示 0%”。
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
    Object.entries(manualVotes || {}).forEach(([mapId, votes]) => {
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
  }, [serverAtlas, manualVotes, records, fireMapsPets]);

  // 卸载/关闭火系时用最新数据刷一次（不做 30s 轮询）
  useEffect(() => {
    const flush = () =>
        syncTrialAtlasKeepalive('fire', latestSyncRef.current.maps, latestSyncRef.current.votes);
    // 窗口/页面关闭：用 keepalive 在销毁后仍把最新快照发到远端，避免“关闭窗口没上传”。
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      void syncTrialAtlas('fire', latestSyncRef.current.maps, latestSyncRef.current.votes);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 跟随识别开启时，轮询本地存储刷新 records（关闭则不轮询，避免无谓冲突）
  useEffect(() => {
    const t = setInterval(() => {
      try {
        if (localStorage.getItem('roco_follow_active') === '1') {
          setRecords(fireStorage.getAll());
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const handleAtlasVote = (mapId: string, petKey: string, petName: string, type: 'agree' | 'disagree') => {
    sound.playClick();
    const pet = (fireMapsPets[mapId]?.items || []).find((p) => petKeyOf(p.name, p.id, p.seq) === petKey);
    const encName = pet?.name || petName;
    const isLit = isPetEncounteredInRecords(fireStorage.getAll(), mapId, encName);
    const cur = manualVotes[mapId]?.[petKey];
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

  // 火系批量识图成功：点亮 + 默认赞同（与「点亮=同意」一致），并保持本地点亮集合
  const handleFireBatchEncounterSuccess = (
      items: Array<{ mapId: string; filename: string; note?: string }>
  ) => {
    for (const { mapId, filename, note } of items) {
      fireStorage.markEncountered(mapId, filename, note);
      fireStorage.updateVote(mapId, filename, 'agree'); // 批量点亮 = 默认赞同
    }
    setRecords(fireStorage.getAll());
  };

  // dev：生成随机“模拟设备”写入点亮/赞同/不赞同，模拟社区环境
  const handleMockCommunity = async () => {
    sound.playClick();
    setUploadStatus('uploading');
    // 生成足够多的模拟设备（>=100），让赞同投票人数能覆盖 0~100 的区间
    const DEVICES = 120;
    // 收集全图宠key，随机取 ~250 只作为模拟池（不铺满全图鉴）
    const pool: Array<{ mapId: string; petKey: string }> = [];
    Object.entries(fireMapsPets).forEach(([mapId, { items }]) => {
      (items || []).forEach((pet) => {
        const pk = petKeyOf(pet.name, pet.id, pet.seq);
        if (pk) pool.push({ mapId, petKey: pk });
      });
    });
    const target = pool.sort(() => Math.random() - 0.5).slice(0, 250);

    // 每台模拟设备的快照（maps: 点亮; votes: 手动 agree/disagree）
    const deviceMaps: Array<Record<string, string[]>> = Array.from({ length: DEVICES }, () => ({}));
    const deviceVotes: Array<Record<string, Record<string, 'agree' | 'disagree'>>> =
        Array.from({ length: DEVICES }, () => ({}));

    // 对每只精灵生成 0~100 的投票人数（偏热门：少数高票、多数低票），并随机分散到设备上
    target.forEach(({ mapId, petKey }) => {
      const voteCount = Math.round(Math.pow(Math.random(), 2) * 100);
      if (voteCount <= 0) return; // 留一部分“无人投票/未确认”
      const agreeCount = Math.round(voteCount * (0.5 + Math.random() * 0.5));
      const chosen = Array.from({ length: DEVICES }, (_, i) => i)
          .sort(() => Math.random() - 0.5)
          .slice(0, voteCount);
      chosen.forEach((di, idx) => {
        (deviceMaps[di][mapId] ??= []).push(petKey);
        (deviceVotes[di][mapId] ??= {})[petKey] = idx < agreeCount ? 'agree' : 'disagree';
      });
    });

    // 限并发上报（避免瞬时打到 gunicorn 单 worker / sqlite 写锁）
    const CONCURRENCY = 8;
    let cursor = 0;
    const runner = async () => {
      while (cursor < deviceMaps.length) {
        const j = cursor++;
        await syncTrialAtlas('fire', deviceMaps[j], deviceVotes[j], `mock-device-${j + 1}`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, runner));

    const a = await fetchTrialAtlas('fire').catch(() => null);
    if (a) setServerAtlas(a);
    setUploadStatus('ok');
    setTimeout(() => setUploadStatus('idle'), 2200);
  };

  const handleToggleSound = () => {
    const muted = sound.toggleMute();
    setIsSoundMuted(muted);
    storage.setSetting('isSoundMuted', muted);
  };

  const handleResetCurrentMap = () => {
    fireStorage.resetMap(currentMap.id);
    sound.playToggleOff();
  };

  const handleNavigateToPet = (mapNum: number, petName: string) => {
    setActiveStageNum(mapNum);
    setTimeout(() => {
      const targetMap = safeMaps.find((m) => m.num === mapNum);
      if (!targetMap) return;
      const elementId = `pet-card-${targetMap.id}-${petName.replace('.', '-')}`;
      const el = document.getElementById(elementId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-pet-target');
        setTimeout(() => {
          el.classList.remove('highlight-pet-target');
        }, 2500);
      }
    }, 150);
  };

  // 全图鉴加载完成后再渲染整页（含 header 的地图计数），
  // 避免地图切换区先显示 0/0、加载后突然变成真实计数导致缩放跳动。
  if (!loaded) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center selection:bg-orange-200 selection:text-orange-900 bg-gradient-to-b from-[#7ABCF4]/10 to-white dark:from-slate-900 dark:to-slate-950">
          <div className="text-center text-slate-500 dark:text-slate-400 text-sm font-medium">正在加载火系全图鉴...</div>
        </div>
    );
  }

  return (
      <div className="min-h-screen flex flex-col selection:bg-orange-200 selection:text-orange-900 pb-12 relative">
        {/* 顶部：复用草系一致的 Header（三张火系地图切换 + 声音开关） */}
        <Header
            activeStageNum={activeStageNum}
            onSelectMap={(num) => setActiveStageNum(num)}
            mapsStats={allMapsStats}
            totalEncountered={totalEncounteredCount}
            totalPetsCount={totalPetsCount}
            isSoundMuted={isSoundMuted}
            onToggleSound={handleToggleSound}
            onOpenManual={() => setIsManualOpen(true)}
            onOpenFeedback={() => setIsFeedbackOpen(true)}
            onOpenUpdate={() => {
              updateStore.clearDot();
              setIsUpdateOpen(true);
            }}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenHub={onBack}
            mapsConfig={safeMaps}
            devBadge
            rightStatus={<AuthBadge />}
        />

        {/* 右上角：dev/调试按钮（仅前端开发模式显示，生产构建隐藏） */}
        {import.meta.env.DEV && (
            <div className="fixed z-40 right-6 top-32 flex flex-col items-end gap-2">
              <button onClick={doSync} className="px-4 py-2 rounded-2xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-black shadow-lg select-none" title="手动同步本地点亮/投票到服务器">手动上传</button>
              <button onClick={handleMockCommunity} className="px-4 py-2 rounded-2xl bg-purple-500 hover:bg-purple-600 text-white text-sm font-black shadow-lg select-none" title="生成模拟社区假数据">生成社区假数据</button>
            </div>
        )}

        {/* 上传反馈 toast */}
        {uploadStatus !== 'idle' && (
            <div className="fixed z-50 right-6 top-20 px-3 py-1.5 rounded-lg text-xs font-black shadow-lg text-white bg-blue-600/90">
              {uploadStatus === 'uploading' ? '上传中…' : uploadStatus === 'ok' ? '✓ 已上传' : '✕ 上传失败'}
            </div>
        )}

        {/* 移至顶栏：显示与草系一致的顶栏工具栏（筛选 + 全域搜索） */}
        {floatingMode === 'hidden' && (
            <SubHeaderToolbar
                filterMode={filterMode}
                onFilterChange={(mode) => setFilterMode(mode)}
                encounteredCount={currentMapStats.encounteredCount}
                totalCount={currentMapPets.length}
                showFollow={false}
                onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
            />
        )}

        <main className="flex-1 w-full mx-auto px-8 sm:px-16 pt-6">
          <StatsBanner
              currentMap={currentMap}
              encounteredCount={currentMapStats.encounteredCount}
              totalMapPets={currentMapStats.totalMapPets}
              percentage={currentMapStats.percentage}
              filterMode={filterMode}
              onFilterChange={(mode) => setFilterMode(mode)}
              searchQuery={searchQuery}
              onSearchChange={(q) => setSearchQuery(q)}
              onResetEncounters={handleResetCurrentMap}
              advancedFilters={advancedFilters}
              onAdvancedFilterChange={(filters) => setAdvancedFilters(filters)}
          />

          {/* 游戏画面识别（与草系一致；使用火系图鉴，trialKey=fire） */}
          {!IS_STATIC && (
              <div className="mt-4">
                <BatchRecognizerCard
                    currentMap={currentMap}
                    trialKey="fire"
                    allMapsPets={fireMapsPets}
                    records={records}
                    isEncountered={(mapId, filename) => isPetEncounteredInRecords(fireStorage.getAll(), mapId, filename)}
                    onBatchEncounterSuccess={handleFireBatchEncounterSuccess}
                    onSelectMap={(num) => setActiveStageNum(num)}
                />
              </div>
          )}

          <PetGrid
              currentMap={currentMap}
              pets={currentMapPets}
              records={records}
              onToggleEncounter={handleToggleEncounter}
              filterMode={filterMode}
              onFilterChange={(mode) => setFilterMode(mode)}
              searchQuery={searchQuery}
              advancedFilters={advancedFilters}
              communityAtlas={showAtlasVote ? (communityAtlas ?? undefined) : undefined}
              minAgreeRatio={showAtlasVote ? minAgreeRatio : 0}
              onAtlasVote={showAtlasVote ? handleAtlasVote : undefined}
              communityCard
              onOpenPetDetail={(pet) => setDetailPet(pet)}
              onOpenFeedback={(type) => {
                setFeedbackInitialType(type);
                setIsFeedbackOpen(true);
              }}
          />
        </main>

        <footer className="mt-12 text-center text-xs text-slate-400">
          <p>火系徽章试炼 · 全图鉴自选 · 支持本地离线存储（开发环境专属）</p>
        </footer>

        {/* 左下角：与草系一致的悬浮筛选栏 */}
        <FloatingFilterSwitch
            currentMap={currentMap}
            pets={currentMapPets}
            records={records}
            filterMode={filterMode}
            onFilterChange={(mode) => setFilterMode(mode)}
            onCycleMap={() => {
              setActiveStageNum((prev) => (prev % safeMaps.length) + 1);
            }}
            mapsConfig={safeMaps}
            advancedFilters={advancedFilters}
            onAdvancedFilterChange={(filters) => setAdvancedFilters(filters)}
        />

        {/* 右下角：复用通用全域搜索（仅搜索模式） */}
        <GlobalFloatingSearch
            mapsConfig={safeMaps}
            allMapsPets={fireMapsPets}
            records={records}
            onNavigateToPet={handleNavigateToPet}
            onToggleEncounter={handleToggleEncounter}
            isOpen={isGlobalSearchOpen}
            onOpenChange={setIsGlobalSearchOpen}
            onOpenFireAtlas={() => setIsAtlasOpen(true)}
            atlasMode={atlasMode}
            onToggleAtlasMode={() => {
              const next = atlasMode === 'community' ? 'pokedex' : 'community';
              setAtlasMode(next);
              saveFireSettings({ atlasMode: next });
            }}
            followTrialKey="fire"
        />

        {/* 反馈 / 更新 / 设置弹窗（与草系一致） */}
        <FeedbackContactModal
            isOpen={isFeedbackOpen}
            onClose={() => setIsFeedbackOpen(false)}
            initialType={feedbackInitialType}
        />
        <UserManualModal
            isOpen={isManualOpen}
            onClose={() => setIsManualOpen(false)}
        />
        <UpdateModal
            isOpen={isUpdateOpen}
            onClose={() => setIsUpdateOpen(false)}
        />
        <AppSettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onTestEffect={() => {}}
        />

        {/* 精灵详情弹窗（右键菜单进入） */}
        <PetDetailModal
            isOpen={detailPet !== null}
            onClose={() => setDetailPet(null)}
            pet={detailPet}
            currentMap={currentMap}
            record={detailPet ? records[`${currentMap.id}_${detailPet.name}`] : undefined}
            onToggleEncounter={(mapId, filename) => {
              fireStorage.toggleEncountered(mapId, filename);
            }}
        />

        {/* 共创图鉴弹窗（含刷新图鉴/隐藏投票/赞同率筛选控制） */}
        <BootstrapAtlasModal
            isOpen={isAtlasOpen}
            onClose={() => setIsAtlasOpen(false)}
            trialKey="fire"
            mapsPets={fireMapsPets}
            records={records}
            atlas={serverAtlas}
            communityAtlas={communityAtlas ?? undefined}
            onVote={(mapId, petKey, filename, type) => handleAtlasVote(mapId, petKey, filename, type)}
            onToggleEncounter={handleToggleEncounter}
            manualVotes={manualVotes}
            onRefresh={handleRefreshAtlas}
            minAgreeRatio={minAgreeRatio}
            onMinAgreeRatioChange={(v) => {
              setMinAgreeRatio(v);
              saveFireSettings({ agreeRatio: v });
            }}
            showAtlasVote={showAtlasVote}
            onToggleShowVote={() => {
              const next = !showAtlasVote;
              setShowAtlasVote(next);
              saveFireSettings({ showVote: next });
            }}
        />
      </div>
  );
};
