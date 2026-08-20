import React, { useState, useMemo } from 'react';
import { Sparkles, Check, Sparkle, Filter } from 'lucide-react';
import { MapConfig, PetItem, EncounterRecord } from '../types';
import { sound } from '../services/sound';
import { formatPetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';

interface PetGridProps {
  currentMap: MapConfig;
  pets: PetItem[];
  records: Record<string, EncounterRecord>;
  onToggleEncounter: (mapId: string, filename: string) => void;
  filterMode: 'all' | 'encountered' | 'unencountered';
  onFilterChange?: (mode: 'all' | 'encountered' | 'unencountered') => void;
  searchQuery: string;
}

export const PetGrid: React.FC<PetGridProps> = ({
                                                  currentMap,
                                                  pets,
                                                  records,
                                                  onToggleEncounter,
                                                  filterMode,
                                                  onFilterChange,
                                                  searchQuery,
                                                }) => {
  // Track keys of pets that were just toggled to encountered / unencountered
  const [animatingKeys, setAnimatingKeys] = useState<Record<string, boolean>>({});
  const [unanimatingKeys, setUnanimatingKeys] = useState<Record<string, boolean>>({});
  const totalCount = pets.length;
  const encounteredCount = useMemo(() => {
    return pets.filter((p) => isPetEncounteredInRecords(records, currentMap.id, p.name)).length;
  }, [pets, records, currentMap.id]);
  const unencounteredCount = Math.max(0, totalCount - encounteredCount);

  const handleCardClick = (petName: string, currentlyEncountered: boolean) => {
    const key = `${currentMap.id}_${petName}`;

    if (!currentlyEncountered) {
      // 未遇见 -> 遇见
      setAnimatingKeys((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setAnimatingKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 700);
    } else {
      // 遇见 -> 未遇见 (静谧平滑重置)
      setUnanimatingKeys((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setUnanimatingKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 500);
    }

    onToggleEncounter(currentMap.id, petName);
  };


  // Filter pets by mode and query
  const filteredPets = pets.filter((pet) => {
    const isEnc = isPetEncounteredInRecords(records, currentMap.id, pet.name);

    if (filterMode === 'encountered' && !isEnc) return false;
    if (filterMode === 'unencountered' && isEnc) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const cleanName = formatPetName(pet.name).toLowerCase();
      const baseName = getBasePetName(pet.name).toLowerCase();
      const rawName = pet.name.toLowerCase();
      return cleanName.includes(q) || rawName.includes(q) || baseName.includes(q);
    }

    return true;
  });

  return (
      <div className="bg-white roco-card p-5 sm:p-6">
        {/* Section Header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b-2 border-[#F1F5F9] mb-5">
          <div className="flex items-center gap-2.5">
            <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-sm font-black text-sm shrink-0"
                style={{ backgroundColor: currentMap.themeColor }}
            >
              {currentMap.num}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight flex items-center gap-2 flex-wrap">
                <span>{currentMap.name}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F5F9FF] text-[#2B78C4] font-mono font-black border border-[#E6EEF8] shadow-2xs flex items-center gap-1">
                <span>已遇见 <strong className="text-[#2D6613] font-black">{encounteredCount}</strong> / {totalCount}</span>
                  {filterMode !== 'all' && (
                      <span className="text-[10px] text-slate-400 font-normal">
                    (当前显示 {filteredPets.length})
                  </span>
                  )}
              </span>
              </h3>
              <p className="text-xs text-slate-500">
                点击卡片即可直接切换【已遇见 / 未遇见】状态
              </p>
            </div>
          </div>
        </div>

        {/* Empty State */}
        {filteredPets.length === 0 ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center">
              <Sparkles className="w-10 h-10 text-slate-300 mb-2" />
              <p className="text-sm font-black text-slate-600">未找到符合条件的精灵</p>
              <p className="text-xs text-slate-400 mt-1">请尝试调整搜索关键词或切换筛选条件</p>
            </div>
        ) : (
            /* Uniform Grid of Scaled Pet Icons */
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 sm:gap-4">
              {filteredPets.map((pet) => {
                const key = `${currentMap.id}_${pet.name}`;
                const isEnc = isPetEncounteredInRecords(records, currentMap.id, pet.name);
                const isJustEncountered = !!animatingKeys[key];

                return (
                    <div
                        key={pet.name}
                        id={`pet-card-${currentMap.id}-${pet.name.replace('.', '-')}`}
                        onClick={() => handleCardClick(pet.name, isEnc)}
                        className={`group relative rounded-2xl p-2.5 flex flex-col items-center cursor-pointer transition-all duration-300 select-none ${
                            isJustEncountered
                                ? 'encounter-pop-active bg-[#F2FBF0] border-2 border-[#95D151] ring-4 ring-[#95D151]/40 shadow-md'
                                : isEnc
                                    ? 'bg-[#F2FBF0] border-2 border-[#95D151] shadow-xs hover:border-[#76B032] hover:-translate-y-1 hover:shadow-md'
                                    : 'bg-[#F5F9FF] border-2 border-[#E6EEF8] hover:border-[#7ABCF4] hover:bg-white hover:-translate-y-1 hover:shadow-md'
                        }`}
                    >
                      {/* Floating sparkle badge during encounter activation */}
                      {isJustEncountered && (
                          <div className="absolute -top-3.5 z-20 encounter-sparkle-active bg-gradient-to-r from-[#95D151] to-[#76B032] text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-md border border-white flex items-center gap-1 pointer-events-none">
                            <Sparkle className="w-2.5 h-2.5 fill-white text-white" />
                            <span>点亮图鉴</span>
                          </div>
                      )}

                      {/* Fixed Uniform Image Container - 1:1 Aspect Ratio with object-contain */}
                      <div className="relative w-full aspect-square rounded-xl bg-white p-1.5 flex items-center justify-center shadow-inner overflow-hidden border border-[#E6EEF8]">
                        <img
                            src={pet.url}
                            alt={pet.name}
                            className={`w-full h-full object-contain transition-transform duration-300 ${
                                isJustEncountered
                                    ? 'scale-110'
                                    : 'group-hover:scale-105'
                            }`}
                            loading="lazy"
                        />
                      </div>

                      {/* Pet Name Label */}
                      <div className="mt-2 w-full text-center">
                        <p
                            className={`text-xs font-black truncate transition-colors duration-200 ${
                                isEnc ? 'text-[#2D6613]' : 'text-slate-700'
                            }`}
                            title={formatPetName(pet.name)}
                        >
                          {formatPetName(pet.name)}
                        </p>
                      </div>

                      {/* Status indicator pill */}
                      <div className="mt-2 flex items-center justify-center w-full">
                        {isEnc ? (
                            <span className="text-[11px] font-black text-[#2D6613] bg-[#E1F7DB] px-2.5 py-0.5 rounded-md w-full text-center shadow-2xs">
                      已遇见
                    </span>
                        ) : (
                            <span className="text-[11px] font-medium text-slate-400 bg-white/60 px-2 py-0.5 rounded-md w-full text-center border border-slate-200/60 group-hover:border-[#BCD7F2] group-hover:text-slate-600 transition-colors">
                      未探索
                    </span>
                        )}
                      </div>
                    </div>
                );
              })}
            </div>
        )}
      </div>
  );
};
