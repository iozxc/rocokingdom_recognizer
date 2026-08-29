import React, { useState, useMemo } from 'react';
import {
    X,
    Layers,
    Sparkles,
    Check,
    Search,
    BookOpen,
    Filter,
    ArrowRight,
} from 'lucide-react';
import { PetItem, EncounterRecord, AdvancedFilterState } from '../types';
import { MAP_CONFIGS, FALLBACK_MAPS_DATA } from '../data/mockPets';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { formatPetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';
import { ElementBadges } from './ElementBadges';
import { AdvancedFilterPopover } from './AdvancedFilterPopover';

interface ScannerMapGalleryModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMapNum: number;
    mapsPets: Record<string, { count: number; items: PetItem[] }>;
    records: Record<string, EncounterRecord>;
    onToggleEncounter?: (mapId: string, filename: string) => void;
}

export const ScannerMapGalleryModal: React.FC<ScannerMapGalleryModalProps> = ({
                                                                                  isOpen,
                                                                                  onClose,
                                                                                  initialMapNum,
                                                                                  mapsPets,
                                                                                  records,
                                                                                  onToggleEncounter,
                                                                              }) => {
    // 'all' for full gallery, or 1, 2, 3...
    const [selectedTab, setSelectedTab] = useState<'all' | number>(initialMapNum);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterMode, setFilterMode] = useState<'all' | 'unencountered' | 'encountered'>('all');
    const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>({
        elements: [],
        specialTypes: [],
    });
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

    const activeAdvancedCount = advancedFilters.elements.length + advancedFilters.specialTypes.length;

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
    const allMapsStats = MAP_CONFIGS.map((map) => {
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
            MAP_CONFIGS.forEach((map) => {
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
            const map = MAP_CONFIGS.find((m) => m.num === selectedTab) || MAP_CONFIGS[0];
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
                const isSeqGreater = item.pet.seq !== undefined && item.pet.seq > 1;
                const cleanName = formatPetName(item.pet.name);
                const hasUnderscore = cleanName.includes('_');

                const isBoss = isSeqGreater && !hasUnderscore;
                const isMultiForm = isSeqGreater && hasUnderscore;

                let matchesSpecial = false;
                if (advancedFilters.specialTypes.includes('boss') && isBoss) {
                    matchesSpecial = true;
                }
                if (advancedFilters.specialTypes.includes('multiform') && isMultiForm) {
                    matchesSpecial = true;
                }
                return matchesSpecial;
            });
        }

        return list;
    }, [isOpen, selectedTab, searchQuery, filterMode, mapsPets, records, advancedFilters]);

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-50 w-full h-full bg-[#FDF9F3] text-slate-800 flex flex-col justify-between select-none overflow-hidden font-sans animate-in fade-in duration-150 rounded-none">
            {/* 1. Modal Top Bar (Matching ScannerApp top bar exactly: #7ABCF4) */}
            <div className="pywebview-drag-region cursor-move h-11 px-3 bg-[#7ABCF4] border-b border-[#5DA8E8] flex items-center justify-between gap-2 shrink-0 text-white rounded-none">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-xl bg-white/20 border-2 border-white/40 flex items-center justify-center shrink-0">
                        <BookOpen className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-xs sm:text-sm font-black text-white truncate tracking-tight">
            精灵图鉴
          </span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FEE061] text-[#854D0E] border-2 border-[#E5C43B] shrink-0 font-mono">
            {grandEncountered}/{grandTotal} ({grandPercent}%)
          </span>
                </div>

                <button
                    type="button"
                    className="pywebview-no-drag w-7 h-7 rounded-xl bg-white/20 hover:bg-rose-500 text-white border-2 border-white/40 hover:border-rose-600 flex items-center justify-center transition-all cursor-pointer shrink-0 active:opacity-80"
                    onClick={() => {
                        sound.playClick();
                        onClose();
                    }}
                    title="返回识别主界面"
                >
                    <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                </button>
            </div>

            {/* 2. Map Switcher Tabs & Filter Bar (Optimized for 420px fixed width) */}
            <div className="p-2 bg-white border-b-2 border-[#E6EEF8] space-y-1.5 shrink-0">
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
                                : 'bg-[#F4F9FF] text-slate-600 border-[#DCE8F5] hover:bg-[#E9F2FA]'
                        }`}
                    >
                        <Layers className="w-3 h-3 shrink-0" />
                        <span>全图</span>
                        <span className={`text-[9px] px-1 py-0.2 rounded-full font-mono font-black shrink-0 ${selectedTab === 'all' ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'}`}>
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
                                        : 'bg-[#F4F9FF] text-slate-600 border-[#DCE8F5] hover:bg-[#E9F2FA]'
                                }`}
                                style={{
                                    backgroundColor: isSel ? item.map.themeColor : undefined,
                                    borderColor: isSel ? item.map.themeColor : undefined,
                                }}
                            >
                                <span>图{item.map.num}</span>
                                <span className={`text-[9px] px-1 py-0.2 rounded-full font-mono font-black shrink-0 ${isSel ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {item.encounteredCount}/{item.total}
                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Search Input and Status Switch */}
                <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-[#F0F6FC]">
                    <div className="relative flex-1 min-w-0">
                        <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder="搜索精灵名、图鉴id..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-6 pr-5 py-1 bg-[#F8FBFE] border-2 border-[#D5E3F0] rounded-lg text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#7ABCF4] focus:bg-white transition-all"
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
                            className={`p-1 rounded-lg border-2 transition-all flex items-center justify-center cursor-pointer active:scale-95 hover:border-[#7ABCF4] ${
                                activeAdvancedCount > 0
                                    ? 'bg-[#F0F7FF] border-[#7ABCF4] text-[#2B78C4]'
                                    : 'bg-white border-[#D5E3F0] text-slate-500 hover:text-[#2B78C4]'
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

                    <div className="flex items-center gap-0.5 bg-[#F4F9FF] p-0.5 rounded-lg border border-[#DCE8F5] shrink-0">
                        <button
                            type="button"
                            onClick={() => setFilterMode('all')}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'all' ? 'bg-[#7ABCF4] text-white' : 'text-slate-600 hover:text-slate-800'
                            }`}
                        >
                            全部
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterMode('unencountered')}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'unencountered' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:text-slate-800'
                            }`}
                        >
                            未遇
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterMode('encountered')}
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'encountered' ? 'bg-[#95D151] text-white' : 'text-slate-600 hover:text-slate-800'
                            }`}
                        >
                            已遇
                        </button>
                    </div>
                </div>
            </div>

            {/* 3. Pet Grid Container */}
            <div className="flex-1 overflow-y-auto p-2.5 bg-[#FDF9F3]">
                {displayItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-8 bg-white roco-card rounded-2xl border-2 border-[#E6EEF8] p-6">
                        <Sparkles className="w-8 h-8 text-[#7ABCF4] mb-2" />
                        <p className="text-xs font-black text-slate-700">未找到符合条件的精灵</p>
                        <p className="text-[11px] text-slate-400 mt-0.5 font-medium">请修改搜索关键字或筛选模式</p>
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
                                    className={`group relative p-2 rounded-2xl flex flex-col items-center cursor-pointer transition-all border-2 select-none roco-card-interactive ${
                                        isEnc
                                            ? 'bg-[#F2FBF0] border-[#95D151]'
                                            : 'bg-white border-[#E6EEF8] hover:border-[#7ABCF4]'
                                    }`}
                                >
                                    {/* Map badge on multi-map mode */}
                                    {selectedTab === 'all' && (
                                        <span
                                            className="absolute top-1 left-1 text-[8px] font-black px-1.5 py-0.2 rounded-md text-white z-10 opacity-90"
                                            style={{ backgroundColor: themeColor }}
                                        >
                      图{mapNum}
                    </span>
                                    )}

                                    {/* Check icon if encountered */}
                                    {isEnc && (
                                        <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#95D151] flex items-center justify-center text-white z-10 border border-white">
                                            <Check className="w-2.5 h-2.5 stroke-[3.5]" />
                                        </div>
                                    )}

                                    {/* Pet Avatar Container */}
                                    <div className="relative w-full aspect-square rounded-xl bg-white p-1 flex items-center justify-center border-2 border-[#E9F2FA] overflow-hidden">
                                        <img
                                            src={pet.url}
                                            alt={displayName}
                                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-150"
                                            loading="lazy"
                                        />
                                        {pet.id != null && (
                                            <span className="absolute top-0.5 right-0.5 z-10 text-[9px] font-mono font-black leading-none px-1.5 py-0.5 rounded bg-slate-800/70 text-white/90">
                                              #{pet.id}
                                            </span>
                                        )}
                                        <ElementBadges
                                            elements={pet.elements}
                                            className="absolute top-0.5 left-0.5 z-10"
                                            size="md"
                                        />
                                    </div>

                                    {/* Pet Name */}
                                    <div className="mt-1.5 w-full text-center">
                                        <p
                                            className={`text-[11px] font-black truncate ${
                                                isEnc ? 'text-[#2D6613]' : 'text-slate-800'
                                            }`}
                                            title={displayName}
                                        >
                                            {displayName}
                                        </p>
                                    </div>

                                    {/* Status Tag */}
                                    <div className="mt-1 w-full text-center">
                    <span
                        className={`text-[9px] font-black px-2 py-0.5 rounded-full block truncate ${
                            isEnc
                                ? 'bg-[#E1F7DB] text-[#2D6613] border border-[#95D151]/40'
                                : 'bg-slate-100 text-slate-500 border border-slate-200 group-hover:bg-[#EBF5FE] group-hover:text-[#1E5B99] group-hover:border-[#7ABCF4]'
                        }`}
                    >
                      {isEnc ? '已遇见' : '未探索'}
                    </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 4. Bottom Action Bar */}
            <div className="h-9 px-3 bg-white border-t-2 border-[#E6EEF8] flex items-center justify-between text-xs text-slate-500 font-bold shrink-0 rounded-none">
                <span className="text-[11px] text-slate-500">点击卡片点亮或取消</span>
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
        </div>
    );
};
