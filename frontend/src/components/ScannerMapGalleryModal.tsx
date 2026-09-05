import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    X,
    Layers,
    Sparkles,
    Check,
    Search,
    BookOpen,
    Filter,
    ArrowRight,
    Slash,
    Sun,
    Moon,
    History,
} from 'lucide-react';
import { PetItem, EncounterRecord, AdvancedFilterState, MapConfig } from '../types';
import { MAP_CONFIGS, FALLBACK_MAPS_DATA } from '../data/mockPets';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { themeService } from '../services/theme';
import { formatPetName, isPetEncounteredInRecords, getBasePetName, getPetSpecialType } from '../utils/petHelper';
import { ElementBadges } from './ElementBadges';
import { AdvancedFilterPopover } from './AdvancedFilterPopover';
import { PetSprite } from './PetSprite';
import { PetSpecialTag } from './PetSpecialTag';
import { MiniPetSkillTip } from './MiniPetSkillTip';
import { petKeyOf } from '../services/atlasCollector';

interface ScannerMapGalleryModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMapNum: number;
    mapsPets: Record<string, { count: number; items: PetItem[] }>;
    records: Record<string, EncounterRecord>;
    onToggleEncounter?: (mapId: string, filename: string) => void;
    /** 试炼地图配置（默认草系 MAP_CONFIGS；火系传 FIRE_MAP_CONFIGS）。 */
    mapsConfig?: MapConfig[];
    /** 共创图鉴：社区数据（含赞同率 / 我是否已投），传入后卡片展示投票 UI。 */
    communityAtlas?: Record<string, {
        confirmed_by: number;
        confidence: number;
        agree_ratio?: number;
        vote_ratio?: number;
        total_users?: number;
        voter_count?: number;
        my_vote?: 'agree' | 'disagree' | 'none';
    }>;
    /** 对社区图鉴条目投票（agree / disagree）。 */
    onAtlasVote?: (mapId: string, petKey: string, petName: string, type: 'agree' | 'disagree') => void;
    /** 共创图鉴卡片布局（火系专用）：头部行（系别图标+#编号）+ 进度条/投票区；默认 false 保持草系经典叠加布局。 */
    communityCard?: boolean;
    /** 打开「遇见历史」弹窗（跟随识别主窗的 EncounterHistoryModal）。 */
    onOpenHistory?: () => void;
    /** 当前试炼 key（'grass' | 'fire'），用于顶部与主窗一致的试炼 logo。 */
    trialKey?: string;
}

export const ScannerMapGalleryModal: React.FC<ScannerMapGalleryModalProps> = ({
                                                                                  isOpen,
                                                                                  onClose,
                                                                                  initialMapNum,
                                                                                  mapsPets,
                                                                                  records,
                                                                                  onToggleEncounter,
                                                                                  mapsConfig,
                                                                                  communityAtlas,
                                                                                  onAtlasVote,
                                                                                  communityCard = false,
                                                                                  onOpenHistory,
                                                                                  trialKey = 'grass',
                                                                              }) => {
    // 'all' for full gallery, or 1, 2, 3...
    const [selectedTab, setSelectedTab] = useState<'all' | number>(initialMapNum);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterMode, setFilterMode] = useState<'all' | 'unencountered' | 'encountered'>('all');
    const [, setThemeTick] = useState(0);
    const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>({
        elements: [],
        specialTypes: [],
    });
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [tipInfo, setTipInfo] = useState<{ pet: PetItem; x: number; y: number; left: boolean } | null>(null);
    const [showSkillHover, setShowSkillHover] = useState<boolean>(() => storage.getSetting<boolean>('showPetSkillHover', true));

    // 监听主题变更，强制重渲染以刷新切换按钮的 icon/提示
    useEffect(() => {
      const unsub = themeService.subscribe(() => setThemeTick((t) => t + 1));
      return () => unsub();
    }, []);

    // 同步「悬浮展示精灵技能」开关（与首页图鉴/设置面板共用同一份设置）
    useEffect(() => {
      const unsub = storage.subscribeSettings((settings) => {
        if (typeof settings.showPetSkillHover === 'boolean') {
          setShowSkillHover(settings.showPetSkillHover);
        }
      });
      return unsub;
    }, []);

    // 试炼地图配置：默认草系；火系等试炼由调用方传入
    const galleryMaps = mapsConfig && mapsConfig.length > 0 ? mapsConfig : MAP_CONFIGS;

    const activeAdvancedCount = advancedFilters.elements.length + advancedFilters.specialTypes.length;

    const showTip = (pet: PetItem, e: React.MouseEvent<HTMLElement>) => {
        if (!showSkillHover) return;
        if (tipTimer.current) clearTimeout(tipTimer.current);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        tipTimer.current = setTimeout(() => {
            const left = rect.right > window.innerWidth - 240;
            setTipInfo({ pet, x: rect.right, y: rect.top + rect.height / 2, left });
        }, 400);
    };

    const hideTip = () => {
        if (tipTimer.current) clearTimeout(tipTimer.current);
        setTipInfo(null);
    };

    const handleToggleSkillHover = () => {
        sound.playClick();
        const next = !showSkillHover;
        setShowSkillHover(next);
        storage.setSetting('showPetSkillHover', next);
    };

    const isEncountered = (mapId: string, filename: string): boolean => {
        return isPetEncounteredInRecords(records, mapId, filename);
    };

    const handleToggle = (mapId: string, filename: string) => {
        sound.playClick();
        if (onToggleEncounter) {
            onToggleEncounter(mapId, filename);
        } else {
            storage.toggleEncountered(mapId, filename);
        }
    };

    // Calculate stats for all maps
    const allMapsStats = galleryMaps.map((map) => {
        const activePets = mapsPets[map.id]?.items || FALLBACK_MAPS_DATA[map.id]?.items || [];
        const total = activePets.length;
        const encounteredCount = activePets.filter((p) => isEncountered(map.id, p.name)).length;
        const percent = total > 0 ? Math.round((encounteredCount / total) * 100) : 0;
        return {
            map,
            total,
            encounteredCount,
            percent,
            pets: activePets,
        };
    });

    const grandTotal = allMapsStats.reduce((sum, item) => sum + item.total, 0);
    const grandEncountered = allMapsStats.reduce((sum, item) => sum + item.encounteredCount, 0);
    const grandPercent = grandTotal > 0 ? Math.round((grandEncountered / grandTotal) * 100) : 0;

    // Compile the display list of pets
    const displayItems = useMemo(() => {
        if (!isOpen) return [];

        let list: Array<{ pet: PetItem; mapId: string; mapName: string; mapNum: number; themeColor: string }> = [];

        if (selectedTab === 'all') {
            galleryMaps.forEach((map) => {
                const pets = mapsPets[map.id]?.items || FALLBACK_MAPS_DATA[map.id]?.items || [];
                pets.forEach((pet) => {
                    list.push({
                        pet,
                        mapId: map.id,
                        mapName: map.name,
                        mapNum: map.num,
                        themeColor: map.themeColor,
                    });
                });
            });
        } else {
            const map = galleryMaps.find((m) => m.num === selectedTab) || galleryMaps[0];
            const pets = mapsPets[map.id]?.items || FALLBACK_MAPS_DATA[map.id]?.items || [];
            pets.forEach((pet) => {
                list.push({
                    pet,
                    mapId: map.id,
                    mapName: map.name,
                    mapNum: map.num,
                    themeColor: map.themeColor,
                });
            });
        }

        // Filter by search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            list = list.filter(
                (item) =>
                    formatPetName(item.pet.name).toLowerCase().includes(q) ||
                    item.pet.name.toLowerCase().includes(q) ||
                    item.mapName.toLowerCase().includes(q) ||
                    String(item.pet.id ?? '').includes(q)
            );
        }

        // Filter by encounter mode
        if (filterMode === 'encountered') {
            list = list.filter((item) => isEncountered(item.mapId, item.pet.name));
        } else if (filterMode === 'unencountered') {
            list = list.filter((item) => !isEncountered(item.mapId, item.pet.name));
        }

        // Advanced filters
        if (advancedFilters.elements.length > 0) {
            list = list.filter(
                (item) =>
                    item.pet.elements &&
                    item.pet.elements.some((el) => advancedFilters.elements.includes(el))
            );
        }

        if (advancedFilters.specialTypes.length > 0) {
            list = list.filter((item) => {
                const specialType = getPetSpecialType(item.pet);
                return (
                    (advancedFilters.specialTypes.includes('boss') && specialType === 'boss') ||
                    (advancedFilters.specialTypes.includes('multiform') && specialType === 'multiform')
                );
            });
        }

        return list;
    }, [isOpen, selectedTab, searchQuery, filterMode, mapsPets, records, advancedFilters]);

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-50 w-full h-full bg-[#FDF9F3] dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col justify-between select-none overflow-hidden font-sans animate-in fade-in duration-150 rounded-none">
            {/* 1. Modal Top Bar（与跟随识别主窗完全一致：同高度/同配色/同布局，仅少「查图鉴」并有返回关闭） */}
            <div className="pywebview-drag-region cursor-move h-11 px-3 bg-[#7ABCF4] dark:bg-slate-800 border-b border-[#5DA8E8] dark:border-slate-700 flex items-center justify-between gap-2 shrink-0 text-white rounded-none">
                <div className="flex items-center gap-2 min-w-0 cursor-default">
                    {/* 试炼 logo（静态展示当前试炼，点击返回主界面） */}
                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            onClose();
                        }}
                        className="w-7 h-7 rounded-xl bg-white/20 border-2 border-white/40 hover:bg-white/30 active:opacity-80 flex items-center justify-center transition-all cursor-pointer shrink-0"
                        title={`当前试炼：${trialKey === 'fire' ? '火系徽章试炼' : '草系徽章试炼'}（点击返回）`}
                    >
                        <ElementBadges elements={[trialKey === 'fire' ? '火' : '草']} size="md" />
                    </button>
                    <span className="text-xs sm:text-sm font-black text-white truncate tracking-tight">
                        精灵图鉴
                    </span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FEE061] text-[#854D0E] border-2 border-[#E5C43B] shrink-0 font-mono">
                        {grandEncountered}/{grandTotal} ({grandPercent}%)
                    </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 pywebview-no-drag">
                    <button
                        type="button"
                        id="gallery-skill-hover-switch-btn"
                        onClick={handleToggleSkillHover}
                        className="w-7 h-7 rounded-xl bg-white/20 hover:bg-white/30 active:opacity-80 text-white flex items-center justify-center transition-all cursor-pointer border-2 border-white/40 shrink-0"
                        title={showSkillHover ? '关闭悬浮展示精灵技能' : '开启悬浮展示精灵技能'}
                    >
                        <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
                            <Sparkles className={`w-3.5 h-3.5 transition-colors duration-200 ${showSkillHover ? 'text-[#FEE061]' : 'text-white/50'}`} />
                            {!showSkillHover && <Slash className="absolute w-3.5 h-3.5 text-white/90 stroke-[3]" />}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            themeService.toggleTheme();
                            setThemeTick((t) => t + 1);
                        }}
                        className="w-7 h-7 rounded-xl bg-white/20 hover:bg-white/30 active:opacity-80 text-white flex items-center justify-center transition-all cursor-pointer border-2 border-white/40"
                        title={themeService.isDark() ? '切换为明亮模式' : '切换为暗黑模式'}
                    >
                        {themeService.isDark() ? <Sun className="w-3.5 h-3.5 text-[#FEE061]" /> : <Moon className="w-3.5 h-3.5 text-white" />}
                    </button>
                    {onOpenHistory && (
                        <button
                            type="button"
                            onClick={() => {
                                sound.playClick();
                                onOpenHistory();
                            }}
                            className="px-2.5 py-1 rounded-xl bg-white/20 hover:bg-white/30 active:opacity-80 text-white flex items-center gap-1 text-xs font-black transition-all cursor-pointer border-2 border-white/40"
                            title="查看遇见历史"
                        >
                            <History className="w-3.5 h-3.5 text-[#FEE061]" />
                            <span>历史</span>
                        </button>
                    )}
                    <button
                        type="button"
                        className="w-7 h-7 rounded-xl bg-white/20 hover:bg-rose-500 text-white border-2 border-white/40 hover:border-rose-600 flex items-center justify-center transition-all cursor-pointer shrink-0 active:opacity-80"
                        onClick={() => {
                            sound.playClick();
                            onClose();
                        }}
                        title="返回识别主界面"
                    >
                        <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                    </button>
                </div>
            </div>

            {/* 2. Map Switcher Tabs & Filter Bar (Optimized for 420px fixed width) */}
            <div className="p-2 bg-white dark:bg-slate-900 border-b-2 border-[#E6EEF8] dark:border-slate-800 space-y-1.5 shrink-0">
                {/* Compact Map Selector Tabs */}
                <div className="grid grid-cols-4 gap-1">
                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            setSelectedTab('all');
                        }}
                        title="查看全部地图精灵"
                        className={`py-1 px-1 text-xs font-black rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer border-2 ${
                            selectedTab === 'all'
                                ? 'bg-[#7ABCF4] text-white border-[#5DA8E8]'
                                : 'bg-[#F4F9FF] dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-[#DCE8F5] dark:border-slate-700 hover:bg-[#E9F2FA] dark:hover:bg-slate-700'
                        }`}
                    >
                        <Layers className="w-3 h-3 shrink-0" />
                        <span>全图</span>
                        <span className={`text-[9px] px-1 py-0.2 rounded-full font-mono font-black shrink-0 ${selectedTab === 'all' ? 'bg-white/30 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
              {grandEncountered}/{grandTotal}
            </span>
                    </button>

                    {allMapsStats.map((item) => {
                        const isSel = selectedTab === item.map.num;
                        return (
                            <button
                                key={item.map.id}
                                type="button"
                                onClick={() => {
                                    sound.playClick();
                                    setSelectedTab(item.map.num);
                                }}
                                title={`${item.map.name} (图${item.map.num})`}
                                className={`py-1 px-1 text-xs font-black rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer border-2 ${
                                    isSel
                                        ? 'text-white'
                                        : 'bg-[#F4F9FF] dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-[#DCE8F5] dark:border-slate-700 hover:bg-[#E9F2FA] dark:hover:bg-slate-700'
                                }`}
                                style={{
                                    backgroundColor: isSel ? item.map.themeColor : undefined,
                                    borderColor: isSel ? item.map.themeColor : undefined,
                                }}
                            >
                                <span>图{item.map.num}</span>
                                <span className={`text-[9px] px-1 py-0.2 rounded-full font-mono font-black shrink-0 ${isSel ? 'bg-white/30 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                  {item.encounteredCount}/{item.total}
                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search Input and Status Switch */}
                <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-[#F0F6FC] dark:border-slate-800">
                    <div className="relative flex-1 min-w-0">
                        <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder="搜索精灵名、图鉴id..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-6 pr-5 py-1 bg-[#F8FBFE] dark:bg-slate-800 border-2 border-[#D5E3F0] dark:border-slate-700 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-[#7ABCF4] dark:focus:border-sky-500 focus:bg-white dark:focus:bg-slate-800 transition-all"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>

                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                sound.playClick();
                                setIsAdvancedOpen(!isAdvancedOpen);
                            }}
                            className={`p-1 rounded-lg border-2 transition-all flex items-center justify-center cursor-pointer active:scale-95 hover:border-[#7ABCF4] dark:hover:border-sky-500 ${
                                activeAdvancedCount > 0
                                    ? 'bg-[#F0F7FF] dark:bg-sky-950/60 border-[#7ABCF4] dark:border-sky-500 text-[#2B78C4] dark:text-sky-300'
                                    : 'bg-white dark:bg-slate-800 border-[#D5E3F0] dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-[#2B78C4] dark:hover:text-sky-300'
                            }`}
                            title="高级筛选"
                        >
                            <Filter className="w-3.5 h-3.5" />
                            {activeAdvancedCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center border border-white">
                                    {activeAdvancedCount}
                                </span>
                            )}
                        </button>

                        <AdvancedFilterPopover
                            isOpen={isAdvancedOpen}
                            onClose={() => setIsAdvancedOpen(false)}
                            filters={advancedFilters}
                            onChange={setAdvancedFilters}
                        />
                    </div>

                    <div className="flex items-center gap-0.5 bg-[#F4F9FF] dark:bg-slate-800 p-0.5 rounded-lg border border-[#DCE8F5] dark:border-slate-700 shrink-0">
                        <button
                            type="button"
                            onClick={() => setFilterMode('all')}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'all' ? 'bg-[#7ABCF4] text-white' : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            全部
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterMode('unencountered')}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'unencountered' ? 'bg-amber-500 text-white' : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            未遇
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterMode('encountered')}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'encountered' ? 'bg-[#95D151] text-white' : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                        >
                            已遇
                        </button>
                    </div>
                </div>
            </div>

            {/* 3. Pet Grid Container */}
            <div className="flex-1 overflow-y-auto p-2.5 bg-[#FDF9F3] dark:bg-slate-950">
                {displayItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-8 bg-white dark:bg-slate-900 roco-card rounded-2xl border-2 border-[#E6EEF8] dark:border-slate-800 p-6">
                        <Sparkles className="w-8 h-8 text-[#7ABCF4] mb-2" />
                        <p className="text-xs font-black text-slate-700 dark:text-slate-200">未找到符合条件的精灵</p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-medium">请修改搜索关键字或筛选模式</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {displayItems.map(({ pet, mapId, mapNum, themeColor }) => {
                            const isEnc = isEncountered(mapId, pet.name);
                            const displayName = formatPetName(pet.name);

                            return (
                                <div
                                    key={`${mapId}_${pet.name}`}
                                    onClick={() => handleToggle(mapId, pet.name)}
                                    onMouseEnter={(e) => showTip(pet, e)}
                                    onMouseLeave={hideTip}
                                    className={`group relative p-2 rounded-2xl flex flex-col items-center cursor-pointer transition-all border-2 select-none roco-card-interactive ${
                                        isEnc
                                            ? 'bg-[#F2FBF0] dark:bg-emerald-950/40 border-[#95D151] dark:border-emerald-600'
                                            : 'bg-white dark:bg-slate-900 border-[#E6EEF8] dark:border-slate-800 hover:border-[#7ABCF4] dark:hover:border-sky-500'
                                    }`}
                                >
                                    {/* Map badge on multi-map mode（草系：叠加卡片左上角；火系：吃进立绘容器头部行） */}
                                    {!communityCard && selectedTab === 'all' && (
                                        <span
                                            className="absolute top-1 left-1 text-[8px] font-black px-1.5 py-0.2 rounded-md text-white z-10 opacity-90"
                                            style={{ backgroundColor: themeColor }}
                                        >
                      图{mapNum}
                    </span>
                                    )}
                                    {/* Pet Avatar Container */}
                                    {communityCard ? (
                                        /* 共创图鉴（火系）：头部行吃进立绘容器顶部（aspect-square 不变，卡片高度与草系一致） */
                                        <div className="relative w-full aspect-square rounded-xl bg-[#F8FBFE] dark:bg-slate-800 p-1 flex flex-col border-2 border-[#E9F2FA] dark:border-slate-700 overflow-hidden">
                                            {/* 头部行：左图N徽章+系别图标、右图鉴编号（轻量小元素） */}
                                            <div className="flex items-start justify-between w-full shrink-0">
                                                <div className="flex items-center gap-1">
                                                    {selectedTab === 'all' && (
                                                        <span
                                                            className="text-[8px] font-black px-1.5 py-0.2 rounded-md text-white opacity-90"
                                                            style={{ backgroundColor: themeColor }}
                                                        >
                                                            图{mapNum}
                                                        </span>
                                                    )}
                                                    <ElementBadges
                                                        elements={pet.elements}
                                                        size="sm"
                                                    />
                                                </div>
                                                {pet.id != null && (
                                                    <span className="text-[9px] font-mono font-black text-slate-400 leading-none">
                                                        #{pet.id}
                                                    </span>
                                                )}
                                            </div>
                                            {/* 置信度（与首页同款）：悬浮在精灵图标顶部居中 */}
                                            {communityAtlas && onAtlasVote && (() => {
                                                const pk = petKeyOf(pet.name, pet.id, pet.seq);
                                                const info = pk ? communityAtlas[`${mapId}:${pk}`] : undefined;
                                                if (!info) return null;
                                                const conf = info.confidence ?? 0;
                                                const tcls = conf >= 0.7 ? 'text-green-700 bg-green-50 border-green-300 dark:bg-green-950/60 dark:text-green-300 dark:border-green-800'
                                                    : conf >= 0.3 ? 'text-amber-700 bg-amber-50 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                                                        : 'text-rose-700 bg-rose-50 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800';
                                                return (
                                                    <div className="absolute -top-0 left-0 right-0 z-[2] flex justify-center">
                                                        <span className={`text-[8px] font-mono font-black px-1 py-0.5 rounded-full border bg-white/90 dark:bg-slate-900/90 ${tcls}`}>置信度：{Math.round(conf * 100)}%</span>
                                                    </div>
                                                );
                                            })()}
                                            {/* 立绘：核心视觉区，占据剩余全部空间 */}
                                            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
                                                <PetSprite
                                                    pet={pet}
                                                    alt={displayName}
                                                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-150"
                                                />
                                            </div>
                                            {/* 票数/总人数进度条（与首页同款）：叠在立绘下方，仅已有社区数据时显示 */}
                                            {communityAtlas && onAtlasVote && (() => {
                                                const pk = petKeyOf(pet.name, pet.id, pet.seq);
                                                const info = pk ? communityAtlas[`${mapId}:${pk}`] : undefined;
                                                if (!info) return null;
                                                const vc = info.voter_count ?? 0;
                                                const tc = info.total_users ?? 0;
                                                const vr = info.vote_ratio ?? 0;
                                                const barCls = vr >= 0.5 ? 'bg-green-500' : vr >= 0.25 ? 'bg-amber-400' : 'bg-rose-400';
                                                return (
                                                    <div className="flex items-center gap-1 w-full shrink-0 pt-0.5">
                                                        <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full ${barCls}`}
                                                                style={{ width: `${Math.min(100, Math.round(vr * 100))}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-[9px] font-mono font-black leading-none shrink-0 text-slate-600 dark:text-slate-300">
                                                            {vc}{tc > 0 ? `/${tc}` : ''}
                                                        </span>
                                                    </div>
                                                );
                                            })()}
                                        {/* 多形态/首领化（火系共创图鉴）：右侧竖排，z 与 #id 同级 */}
                                        <div className="absolute right-0.5 top-1/2 -translate-y-1/2 z-[1] pointer-events-none">
                                            <PetSpecialTag pet={pet} vertical />
                                        </div>
                                        </div>
                                    ) : (
                                        /* 草系经典：编号/系别图标叠加在立绘上 */
                                        <div className="relative w-full aspect-square rounded-xl bg-[#F8FBFE] dark:bg-slate-900 p-1 flex items-center justify-center border-2 border-[#E9F2FA] dark:border-slate-700 overflow-hidden">
                                            <PetSprite
                                                pet={pet}
                                                alt={displayName}
                                                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-150"
                                            />
                                            {pet.id != null && (
                                                <span className="absolute top-0.5 right-0.5 z-[1] text-[9px] font-mono font-black leading-none px-1.5 py-0.5 rounded bg-slate-800/70 text-white/90">
                                                  #{pet.id}
                                                </span>
                                            )}
                                            <ElementBadges
                                                elements={pet.elements}
                                                className="absolute top-0.5 left-0.5 z-10 drop-shadow-xs"
                                                size="sm"
                                            />
                                            {/* Check icon if encountered */}
                                            {isEnc && (
                                                <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-[#95D151] flex items-center justify-center text-white z-10 border border-white">
                                                    <Check className="w-2.5 h-2.5 stroke-[3.5]" />
                                                </div>
                                            )}
                                            {/* 多形态/首领化：叠在立绘底部，z 与 #id 同级 */}
                                            <div className="absolute bottom-1 left-0 right-0 z-[1] flex justify-center pointer-events-none">
                                                <PetSpecialTag pet={pet} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Pet Name */}
                                    <div className="mt-1.5 w-full text-center">
                                        <p
                                            className={`text-[11px] font-black truncate ${
                                                isEnc ? 'text-[#2D6613] dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'
                                            }`}
                                            title={displayName}
                                        >
                                            {displayName}
                                        </p>
                                    </div>

                                    {/* Status Tag / 共创图鉴投票区：✓左 状态文本 ✕右（进度条已叠入立绘容器底部） */}
                                    {communityAtlas && onAtlasVote ? (() => {
                                        const pk = petKeyOf(pet.name, pet.id, pet.seq);
                                        const info = pk ? communityAtlas[`${mapId}:${pk}`] : undefined;
                                        const myVote = info?.my_vote ?? 'none';
                                        const renderBtn = (type: 'agree' | 'disagree', label: string) => {
                                            const active = type === 'agree' ? myVote === 'agree' : myVote === 'disagree';
                                            return (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (pk) onAtlasVote(mapId, pk, pet.name, type);
                                                    }}
                                                    className={`text-[10px] font-black w-5 h-5 rounded-md border flex items-center justify-center transition-colors select-none cursor-pointer ${
                                                        active
                                                            ? type === 'agree' ? 'bg-green-500 border-green-500 text-white' : 'bg-rose-500 border-rose-500 text-white'
                                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-500 dark:hover:text-slate-300'
                                                    }`}
                                                    title={type === 'agree' ? '赞同（上报社区图鉴）' : '不赞同（上报社区图鉴）'}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        };
                                        return (
                                            <div className="mt-1 w-full flex items-center justify-between">
                                                {renderBtn('agree', '✓')}
                                                <span className={`text-[10px] font-black leading-none truncate ${
                                                    isEnc ? 'text-[#2D6613] dark:text-emerald-400' : 'text-slate-400'
                                                }`}>
                                                    {isEnc ? '已遇见' : '未探索'}
                                                </span>
                                                {renderBtn('disagree', '✕')}
                                            </div>
                                        );
                                    })() : (
                                        <div className="mt-1 w-full text-center">
                                            <span
                                                className={`text-[9px] font-black px-2 py-0.5 rounded-full block truncate ${
                                                    isEnc
                                                        ? 'bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border border-[#95D151]/40 dark:border-emerald-700/60'
                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 group-hover:bg-[#EBF5FE] dark:group-hover:bg-sky-950/50 group-hover:text-[#1E5B99] dark:group-hover:text-sky-300 group-hover:border-[#7ABCF4] dark:group-hover:border-sky-600'
                                                }`}
                                            >
                                                {isEnc ? '已遇见' : '未探索'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 4. Bottom Action Bar */}
            <div className="h-9 px-3 bg-white dark:bg-slate-900 border-t-2 border-[#E6EEF8] dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-bold shrink-0 rounded-none">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">点击卡片点亮或取消</span>
                <button
                    type="button"
                    onClick={() => {
                        sound.playClick();
                        onClose();
                    }}
                    className="roco-btn-primary px-3 py-1 text-xs font-black rounded-xl transition-all cursor-pointer text-white"
                >
                    返回识别
                </button>
            </div>

            {showSkillHover && tipInfo && (tipInfo.pet.trait?.name || (tipInfo.pet.skills && tipInfo.pet.skills.length)) && (
                <div
                    className="fixed z-[100] pointer-events-none"
                    style={{
                        top: Math.min(Math.max(tipInfo.y - 140, 8), Math.max(8, window.innerHeight - 320)),
                        left: tipInfo.left ? undefined : tipInfo.x + 10,
                        right: tipInfo.left ? Math.max(10, window.innerWidth - tipInfo.x + 10) : undefined,
                    }}
                >
                    <MiniPetSkillTip pet={tipInfo.pet} />
                </div>
            )}
        </div>
    );
};
