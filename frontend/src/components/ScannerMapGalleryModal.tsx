import React, { useState, useMemo } from 'react';
import {
    X,
    Layers,
    Sparkles,
    Check,
    Search,
    BookOpen,
} from 'lucide-react';
import { PetItem, EncounterRecord } from '../types';
import { MAP_CONFIGS, FALLBACK_MAPS_DATA } from '../data/mockPets';
import { sound } from '../services/sound';
import { storage } from '../services/storage';

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

    const formatPetName = (rawName: string): string => {
        if (!rawName) return '未知精灵';
        let clean = rawName.trim();
        if (clean.includes('.')) {
            clean = clean.split('.')[0];
        }
        return clean;
    };

    const isEncountered = (mapId: string, filename: string): boolean => {
        const formatted = formatPetName(filename);
        const directKey = `${mapId}_${filename}`;
        const directFormattedKey = `${mapId}_${formatted}`;
        if (records[directKey]?.encountered || records[directFormattedKey]?.encountered) {
            return true;
        }
        return (Object.values(records) as EncounterRecord[]).some((rec) => {
            if (!rec || !rec.encountered) return false;
            const recFormatted = formatPetName(rec.filename);
            return (
                rec.mapId === mapId &&
                (recFormatted === formatted ||
                    rec.filename === filename ||
                    recFormatted.includes(formatted) ||
                    formatted.includes(recFormatted))
            );
        });
    };

    const handleToggle = (mapId: string, filename: string) => {
        sound.playClick();
        if (onToggleEncounter) {
            onToggleEncounter(mapId, formatPetName(filename));
        } else {
            storage.toggleEncountered(mapId, formatPetName(filename));
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
                    item.mapName.toLowerCase().includes(q)
            );
        }

        // Filter by encounter mode
        if (filterMode === 'encountered') {
            list = list.filter((item) => isEncountered(item.mapId, item.pet.name));
        } else if (filterMode === 'unencountered') {
            list = list.filter((item) => !isEncountered(item.mapId, item.pet.name));
        }

        return list;
    }, [isOpen, selectedTab, searchQuery, filterMode, mapsPets, records]);

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-50 w-full h-full bg-[#F0F6FC] text-slate-800 flex flex-col justify-between select-none overflow-hidden font-sans animate-in fade-in duration-150">
            {/* 1. Modal Top Bar (Matching ScannerApp top bar exactly: #7ABCF4) */}
            <div className="h-10 px-3 bg-[#7ABCF4] border-b-2 border-[#5DA8E8] flex items-center justify-between gap-2 shrink-0 shadow-xs text-white">
                <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-5 h-5 bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
                        <BookOpen className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="text-xs font-black text-white truncate tracking-tight">
            王国精灵图鉴大全
          </span>
                    <span className="text-[10px] font-black px-1.5 py-0.2 bg-white/25 text-[#FEE061] border border-white/30 shrink-0 font-mono">
            全图 {grandEncountered}/{grandTotal} ({grandPercent}%)
          </span>
                </div>

                <button
                    type="button"
                    onClick={() => {
                        sound.playClick();
                        onClose();
                    }}
                    className="w-7 h-7 hover:bg-rose-500 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    title="返回识别主界面"
                >
                    <X className="w-4 h-4 stroke-[2.5]" />
                </button>
            </div>

            {/* 2. Map Switcher Tabs & Filter Bar */}
            <div className="p-2 bg-white border-b border-[#DCE8F5] space-y-1.5 shrink-0 shadow-2xs">
                {/* Horizontal Map Selector Tabs */}
                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
                    <button
                        type="button"
                        onClick={() => {
                            sound.playClick();
                            setSelectedTab('all');
                        }}
                        className={`px-2 py-1 text-[11px] font-black flex items-center gap-1 transition-all cursor-pointer shrink-0 border ${
                            selectedTab === 'all'
                                ? 'bg-[#7ABCF4] text-white border-[#5DA8E8] shadow-xs'
                                : 'bg-[#F4F9FF] text-slate-600 border-[#DCE8F5] hover:bg-[#E9F2FA]'
                        }`}
                    >
                        <Layers className="w-3 h-3" />
                        <span>全图鉴</span>
                        <span className={`text-[9px] px-1 py-0.1 font-mono ${selectedTab === 'all' ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'}`}>
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
                                className={`px-2 py-1 text-[11px] font-black flex items-center gap-1 transition-all cursor-pointer shrink-0 border ${
                                    isSel
                                        ? 'text-white shadow-xs'
                                        : 'bg-[#F4F9FF] text-slate-600 border-[#DCE8F5] hover:bg-[#E9F2FA]'
                                }`}
                                style={{
                                    backgroundColor: isSel ? item.map.themeColor : undefined,
                                    borderColor: isSel ? item.map.themeColor : undefined,
                                }}
                            >
                                <span>图{item.map.num}</span>
                                <span className="truncate max-w-[65px]">{item.map.name}</span>
                                <span className={`text-[9px] px-1 py-0.1 font-mono ${isSel ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'}`}>
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
                            placeholder="搜索精灵..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-6 pr-2 py-1 bg-[#F4F9FF] border border-[#BCD7F2] text-[11px] font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#7ABCF4] focus:bg-white"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-2.5 h-2.5" />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-0.5 bg-[#F4F9FF] p-0.5 border border-[#DCE8F5] shrink-0">
                        <button
                            type="button"
                            onClick={() => setFilterMode('all')}
                            className={`px-1.5 py-0.5 text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'all' ? 'bg-[#7ABCF4] text-white' : 'text-slate-600 hover:text-slate-800'
                            }`}
                        >
                            全部({displayItems.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterMode('unencountered')}
                            className={`px-1.5 py-0.5 text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'unencountered' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:text-slate-800'
                            }`}
                        >
                            未遇
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilterMode('encountered')}
                            className={`px-1.5 py-0.5 text-[10px] font-black transition-all cursor-pointer ${
                                filterMode === 'encountered' ? 'bg-[#95D151] text-white' : 'text-slate-600 hover:text-slate-800'
                            }`}
                        >
                            已遇
                        </button>
                    </div>
                </div>
            </div>

            {/* 3. Pet Grid Container */}
            <div className="flex-1 overflow-y-auto p-2">
                {displayItems.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 py-8">
                        <Sparkles className="w-8 h-8 text-slate-300 mb-1.5" />
                        <p className="text-xs font-black text-slate-600">未找到符合条件的精灵</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">请修改搜索关键字或筛选模式</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                        {displayItems.map(({ pet, mapId, mapNum, themeColor }) => {
                            const isEnc = isEncountered(mapId, pet.name);
                            const displayName = formatPetName(pet.name);

                            return (
                                <div
                                    key={`${mapId}_${pet.name}`}
                                    onClick={() => handleToggle(mapId, pet.name)}
                                    className={`group relative p-1.5 flex flex-col items-center cursor-pointer transition-all border select-none ${
                                        isEnc
                                            ? 'bg-[#F2FBF0] border-[#95D151] hover:border-[#76B032] shadow-2xs'
                                            : 'bg-white border-[#DCE8F5] hover:border-[#7ABCF4]'
                                    }`}
                                >
                                    {/* Map badge on multi-map mode */}
                                    {selectedTab === 'all' && (
                                        <span
                                            className="absolute top-0.5 left-0.5 text-[8px] font-black px-1 text-white z-10 opacity-90"
                                            style={{ backgroundColor: themeColor }}
                                        >
                      图{mapNum}
                    </span>
                                    )}

                                    {/* Check icon if encountered */}
                                    {isEnc && (
                                        <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-[#95D151] flex items-center justify-center text-white z-10">
                                            <Check className="w-2 h-2 stroke-[3]" />
                                        </div>
                                    )}

                                    {/* Pet Avatar Container */}
                                    <div className="w-full aspect-square bg-white p-0.5 flex items-center justify-center border border-[#E9F2FA] overflow-hidden">
                                        <img
                                            src={pet.url}
                                            alt={displayName}
                                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-150"
                                            loading="lazy"
                                        />
                                    </div>

                                    {/* Pet Name */}
                                    <div className="mt-1 w-full text-center">
                                        <p
                                            className={`text-[10px] font-black truncate ${
                                                isEnc ? 'text-[#2D6613]' : 'text-slate-700'
                                            }`}
                                            title={displayName}
                                        >
                                            {displayName}
                                        </p>
                                    </div>

                                    {/* Status Tag */}
                                    <div className="mt-0.5 w-full text-center">
                    <span
                        className={`text-[8px] font-black px-1 py-0.1 block truncate ${
                            isEnc
                                ? 'bg-[#E1F7DB] text-[#2D6613]'
                                : 'bg-slate-100 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600'
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
            <div className="h-8 px-2.5 bg-white border-t border-[#DCE8F5] flex items-center justify-between text-[11px] text-slate-500 font-bold shrink-0">
                <span className="text-[10px]">点击卡片切换状态</span>
                <button
                    type="button"
                    onClick={() => {
                        sound.playClick();
                        onClose();
                    }}
                    className="px-2.5 py-0.5 bg-[#7ABCF4] hover:bg-[#68AEEB] text-white text-[11px] font-black transition-colors cursor-pointer border border-[#5DA8E8]"
                >
                    返回识别
                </button>
            </div>
        </div>
    );
};
