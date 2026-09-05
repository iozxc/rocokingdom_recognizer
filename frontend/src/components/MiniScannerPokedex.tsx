import React, { useMemo, useState } from 'react';
import { X, Layers } from 'lucide-react';
import { PetItem, EncounterRecord, MapConfig } from '../types';
import { MAP_CONFIGS } from '../data/mockPets';
import { formatPetName, isPetEncounteredInRecords, getPetSpecialType } from '../utils/petHelper';
import { PetSprite } from './PetSprite';
import { PetSpecialTag } from './PetSpecialTag';

interface MiniScannerPokedexProps {
  isOpen: boolean;
  onClose: () => void;
  initialMapNum: number;
  mapsPets: Record<string, { count: number; items: PetItem[] }>;
  records: Record<string, EncounterRecord>;
  onToggleEncounter?: (mapId: string, filename: string) => void;
  mapsConfig?: MapConfig[];
}

export const MiniScannerPokedex: React.FC<MiniScannerPokedexProps> = ({
  isOpen,
  onClose,
  initialMapNum,
  mapsPets,
  records,
  onToggleEncounter,
  mapsConfig,
}) => {
  const [mapNum, setMapNum] = useState<number>(initialMapNum || 1);
  const configs = mapsConfig && mapsConfig.length > 0 ? mapsConfig : MAP_CONFIGS;
  const map = configs.find((m) => m.num === mapNum) || configs[0];

  const pets = useMemo(
      () => (mapsPets[map?.id]?.items || []).filter((p) => p.name),
      [mapsPets, map?.id]
  );
  const encountered = pets.filter((p) => isPetEncounteredInRecords(records, map?.id, p.name)).length;

  if (!isOpen) return null;

  const toggle = (mapId: string, name: string) => {
    if (onToggleEncounter) {
      onToggleEncounter(mapId, name);
    } else {
      // 无回调时保持只读展示；实际调用方总会传入切换。
    }
  };

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-slate-900/60 backdrop-blur-sm">
        <div className="w-full max-w-[420px] max-h-[86vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <Layers className="w-4 h-4 text-sky-500 shrink-0" />
              <span className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                迷你图鉴 · {map.name}
              </span>
              <span className="text-[10px] font-bold text-slate-400 shrink-0">{encountered}/{pets.length}</span>
            </div>
            <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0"
                title="关闭图鉴"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
            {configs.map((m) => (
                <button
                    key={m.id}
                    type="button"
                    onClick={() => setMapNum(m.num)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                        m.num === mapNum
                            ? 'bg-sky-500 text-white'
                            : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                    }`}
                >
                  图{m.num}
                </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2 grid grid-cols-5 gap-1.5 content-start">
            {pets.map((pet) => {
              const isEnc = isPetEncounteredInRecords(records, map?.id, pet.name);
              const type = getPetSpecialType(pet);
              return (
                  <button
                      key={pet.name}
                      type="button"
                      onClick={() => toggle(map?.id, pet.name)}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                          isEnc
                              ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
                              : 'border-transparent bg-slate-100 dark:bg-slate-800 hover:border-sky-400'
                      } ${type ? 'ring-1 ring-amber-300/60' : ''}`}
                      title={`${formatPetName(pet.name)}${isEnc ? ' · 已遇见' : ''}`}
                  >
                    {pet.url ? (
                        <img
                            src={pet.url}
                            alt={pet.name}
                            loading="lazy"
                            className="w-full h-full object-contain pointer-events-none"
                        />
                    ) : (
                        <PetSprite
                            pet={pet}
                            alt={pet.name}
                            className="w-full h-full object-contain pointer-events-none"
                        />
                    )}
                    {type && (
                        <span className="absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 scale-75">
                          <PetSpecialTag pet={pet} iconOnly />
                        </span>
                    )}
                    {isEnc && (
                        <span className="absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white dark:border-slate-900" />
                    )}
                  </button>
              );
            })}
            {pets.length === 0 && (
                <div className="col-span-5 text-center py-8 text-xs text-slate-400">暂无精灵数据</div>
            )}
          </div>
        </div>
      </div>
  );
};
