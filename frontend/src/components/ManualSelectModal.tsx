import React, { useState } from 'react';
import { X, Search, Check, Sparkles, AlertCircle, Filter, CheckCircle2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { MapConfig, PetItem, PredictResult, EncounterRecord } from '../types';
import { sound } from '../services/sound';
import { formatPetName } from '../utils/petHelper';

interface ManualSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMap: MapConfig;
  pets: PetItem[];
  predictResult: PredictResult | null;
  records?: Record<string, EncounterRecord>;
  isEncountered?: (mapId: string, filename: string) => boolean;
  onConfirmSelection: (mapId: string, filename: string, note?: string) => void;
}

export const ManualSelectModal: React.FC<ManualSelectModalProps> = ({
  isOpen,
  onClose,
  currentMap,
  pets,
  predictResult,
  records,
  isEncountered,
  onConfirmSelection,
}) => {
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'unencountered' | 'encountered'>('all');
  const [selectedPet, setSelectedPet] = useState<PetItem | null>(null);

  if (!isOpen) return null;

  // Helper to verify if pet is encountered
  const checkAlreadyEncountered = (petName: string): boolean => {
    if (!petName) return false;
    if (isEncountered) {
      if (isEncountered(currentMap.id, petName) || isEncountered(currentMap.id, formatPetName(petName))) {
        return true;
      }
    }
    if (records) {
      const key1 = `${currentMap.id}_${petName}`;
      const key2 = `${currentMap.id}_${formatPetName(petName)}`;
      if (records[key1]?.encountered || records[key2]?.encountered) return true;
    }
    return false;
  };

  const unencounteredCount = pets.filter((p) => !checkAlreadyEncountered(p.name)).length;
  const encounteredCount = pets.filter((p) => checkAlreadyEncountered(p.name)).length;

  const filteredPets = pets.filter((p) => {
    const isEncounteredPet = checkAlreadyEncountered(p.name);
    if (filterTab === 'unencountered' && isEncounteredPet) return false;
    if (filterTab === 'encountered' && !isEncounteredPet) return false;

    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    const cleanName = formatPetName(p.name).toLowerCase();
    const rawName = p.name.toLowerCase();
    return cleanName.includes(q) || rawName.includes(q);
  });

  const handleConfirm = () => {
    if (!selectedPet) return;

    sound.playEncounter();
    confetti({
      particleCount: 60,
      spread: 60,
      origin: { y: 0.6 },
    });

    onConfirmSelection(
      currentMap.id,
      selectedPet.name,
      `手动纠错选择 (原识别: ${formatPetName(predictResult?.filename) || '未知'})`
    );
    onClose();
  };

  const isSelectedPetAlreadyEncountered = selectedPet ? checkAlreadyEncountered(selectedPet.name) : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/65 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl p-5 sm:p-6 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b-2 border-[#F1F5F9] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#FEE061] text-[#854D0E] flex items-center justify-center font-black shadow-xs border-2 border-white">
              <Sparkles className="w-5 h-5 text-[#854D0E]" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
                手动选择正确的精灵
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#EBF4FE] text-[#2B78C4] border border-[#BCD7F2] font-black">
                  {currentMap.name}
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                挑选真实的遇见精灵进行标记，已标明各精灵的图鉴状态
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Prediction Context Tip & Quick Candidate Chips */}
        {predictResult && (
          <div className="mt-3 p-3 bg-[#FEF9E6] rounded-2xl border-2 border-[#FEE061] text-xs text-[#854D0E] space-y-2 shrink-0">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 text-[#854D0E] shrink-0" />
              <span>
                模型原识别推荐【{formatPetName(predictResult.matchedPet?.name || predictResult.filename)}】(置信度: {(predictResult.score * 100).toFixed(1)}%)。若识别有偏差，可在下方挑选实际遇到的精灵：
              </span>
            </div>

            {predictResult.candidates && predictResult.candidates.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1.5 border-t border-[#E5C43B]/60">
                <span className="text-[11px] font-black text-amber-900">AI Top-{predictResult.candidates.length} 候选快捷选择:</span>
                {predictResult.candidates.map((cand, idx) => {
                  const localMatch = pets.find((p) => p.name === cand.filename) || cand.matchedPet;
                  const isSelected = selectedPet?.name === cand.filename;
                  return (
                    <button
                      key={`${cand.filename}_${idx}`}
                      type="button"
                      onClick={() => {
                        sound.playClick();
                        if (localMatch) {
                          setSelectedPet(localMatch);
                        } else {
                          setSelectedPet({
                            name: cand.filename,
                            url: cand.view_url,
                          });
                        }
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer border ${
                        isSelected
                          ? 'bg-[#7ABCF4] text-white border-[#5DA8E8] shadow-2xs'
                          : 'bg-white text-slate-700 border-amber-300 hover:border-[#7ABCF4] hover:bg-[#F5F9FF]'
                      }`}
                    >
                      <span className="text-[10px] opacity-75">#{idx + 1}</span>
                      <span>{formatPetName(cand.matchedPet?.name || cand.filename)}</span>
                      <span className="font-mono text-[10px] text-amber-700 font-bold">
                        {(cand.score * 100).toFixed(0)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Filter Tabs & Search Bar */}
        <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-[#F5F9FF] rounded-xl border border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => {
                sound.playClick();
                setFilterTab('all');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1 cursor-pointer ${
                filterTab === 'all'
                  ? 'bg-white text-[#2B78C4] shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Filter className="w-3 h-3" />
              全部 ({pets.length})
            </button>
            <button
              type="button"
              onClick={() => {
                sound.playClick();
                setFilterTab('unencountered');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1 cursor-pointer ${
                filterTab === 'unencountered'
                  ? 'bg-[#95D151] text-white shadow-xs'
                  : 'text-[#2D6613] hover:text-slate-800'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              ✨ 未遇见 ({unencounteredCount})
            </button>
            <button
              type="button"
              onClick={() => {
                sound.playClick();
                setFilterTab('encountered');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1 cursor-pointer ${
                filterTab === 'encountered'
                  ? 'bg-slate-600 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Check className="w-3 h-3" />
              已在图鉴 ({encounteredCount})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 sm:w-60">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索精灵名称..."
              className="w-full pl-9 pr-8 py-1.5 text-xs bg-[#F5F9FF] focus:bg-white border-2 border-[#E6EEF8] focus:border-[#7ABCF4] rounded-xl outline-hidden text-slate-800 font-medium transition-all"
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Result status summary */}
        <div className="mt-2.5 px-1 flex items-center justify-between text-xs text-slate-400 font-bold shrink-0">
          <span>共找到 {filteredPets.length} 只精灵</span>
          {selectedPet && (
            <span className="text-[#2D6613] font-black flex items-center gap-1">
              当前已选中：【{formatPetName(selectedPet.name)}】
              {isSelectedPetAlreadyEncountered ? (
                <span className="text-[11px] text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded-md border border-slate-300">
                  (已在图鉴中)
                </span>
              ) : (
                <span className="text-[11px] text-[#2D6613] font-black bg-[#E1F7DB] px-2 py-0.5 rounded-md border border-[#95D151]">
                  (✨ 未遇见新宠)
                </span>
              )}
            </span>
          )}
        </div>

        {/* Pet Options Grid */}
        <div className="mt-2 flex-1 overflow-y-auto pr-1 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5 py-1">
          {filteredPets.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-400">
              <p className="text-xs font-bold">未找到与 &quot;{search}&quot; 匹配的精灵</p>
              <p className="text-[10px] text-slate-400 mt-1">请尝试更换搜索关键字或切换筛选条件</p>
            </div>
          ) : (
            filteredPets.map((pet) => {
              const isChosen = selectedPet?.name === pet.name;
              const isEncounteredPet = checkAlreadyEncountered(pet.name);
              const cleanPetName = formatPetName(pet.name);

              return (
                <button
                  key={pet.name}
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setSelectedPet(pet);
                  }}
                  className={`relative p-2 rounded-2xl border-2 text-center transition-all flex flex-col items-center justify-between select-none cursor-pointer group ${
                    isChosen
                      ? 'border-[#95D151] bg-[#F2FBF0] shadow-md scale-[1.02] ring-2 ring-[#95D151]'
                      : isEncounteredPet
                      ? 'border-slate-300 bg-slate-50/80 hover:bg-white hover:border-[#7ABCF4]'
                      : 'border-[#E6EEF8] bg-[#F5F9FF] hover:bg-white hover:border-[#7ABCF4]'
                  }`}
                >
                  {/* Top status indicator */}
                  <div className="w-full flex items-center justify-between mb-1">
                    {isEncounteredPet ? (
                      <span className="text-[9px] font-black text-slate-600 bg-white px-1.5 py-0.5 rounded border border-slate-200 flex items-center gap-0.5">
                        <Check className="w-2.5 h-2.5 text-[#2D6613]" />
                        已遇见
                      </span>
                    ) : (
                      <span className="text-[9px] font-black text-[#2D6613] bg-[#E1F7DB] px-1.5 py-0.5 rounded border border-[#95D151] flex items-center gap-0.5">
                        <Sparkles className="w-2.5 h-2.5 text-[#2D6613]" />
                        未遇见
                      </span>
                    )}

                    {isChosen && (
                      <div className="w-4 h-4 bg-[#95D151] rounded-full flex items-center justify-center text-white shadow-xs">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </div>

                  {/* Pet Avatar */}
                  <div className="w-14 h-14 rounded-xl bg-white p-1 flex items-center justify-center border border-[#E6EEF8] shadow-inner group-hover:scale-105 transition-transform">
                    <img
                      src={pet.url}
                      alt={cleanPetName}
                      className="w-full h-full object-contain"
                    />
                  </div>

                  {/* Pet Name */}
                  <p className="mt-1.5 text-xs font-black text-slate-800 truncate w-full" title={cleanPetName}>
                    {cleanPetName}
                  </p>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-3.5 pt-3 border-t-2 border-[#F1F5F9] flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 hidden sm:block">
            {selectedPet ? (
              <span>点击下方确认按钮，即可更新图鉴遇见状态</span>
            ) : (
              <span>请点击选中上方任意精灵后确认</span>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={() => {
                sound.playClick();
                onClose();
              }}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-600 text-xs font-black hover:bg-slate-100 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!selectedPet}
              onClick={handleConfirm}
              className="px-6 py-2.5 roco-btn-success text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-md cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isSelectedPetAlreadyEncountered ? '更新为【已遇见】' : '确认标记为【已遇见】'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
