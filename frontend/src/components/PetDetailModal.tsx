import React from 'react';
import { X, Check, RotateCcw, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import { MapConfig, PetItem, EncounterRecord } from '../types';
import { sound } from '../services/sound';

interface PetDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  pet: PetItem | null;
  currentMap: MapConfig;
  record: EncounterRecord | undefined;
  onToggleEncounter: (mapId: string, filename: string) => void;
  onUpdateNote?: (mapId: string, filename: string, note: string) => void;
}

export const PetDetailModal: React.FC<PetDetailModalProps> = ({
  isOpen,
  onClose,
  pet,
  currentMap,
  record,
  onToggleEncounter,
}) => {
  if (!isOpen || !pet) return null;

  const isEncountered = !!record?.encountered;

  const handleToggle = () => {
    sound.playClick();
    if (!isEncountered) {
      sound.playEncounter();
      confetti({ particleCount: 50, spread: 50 });
    } else {
      sound.playToggleOff();
    }
    onToggleEncounter(currentMap.id, pet.name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div
        className="relative w-full max-w-sm bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl p-6 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={() => {
            sound.playClick();
            onClose();
          }}
          className="absolute top-4 right-4 p-2 rounded-2xl text-slate-400 hover:text-slate-700 hover:bg-[#F5F9FF] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Pet Visual Display */}
        <div className="flex flex-col items-center text-center mt-2">
          <div className="relative w-36 h-36 rounded-3xl bg-[#F5F9FF] border-3 border-[#E6EEF8] p-4 shadow-inner flex items-center justify-center">
            <img
              src={pet.url}
              alt={pet.displayName || pet.name}
              className="w-full h-full object-contain"
            />
            {/* Green Checkmark Badge at Bottom Left */}
            {isEncountered && (
              <div className="encountered-badge-check scale-120">
                <Check className="w-4 h-4 text-white stroke-[3.5]" />
              </div>
            )}
          </div>

          <div className="mt-4 text-center">
            <h3 className="text-xl font-black text-slate-800">
              {pet.displayName || pet.name}
            </h3>
            <p className="text-xs font-bold text-[#7ABCF4] mt-1">
              分布于：{currentMap.name} (Map {currentMap.num})
            </p>
          </div>
        </div>

        {/* Action Toggle Button */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={handleToggle}
            className={`w-full py-3 px-4 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 ${
              isEncountered
                ? 'roco-btn-secondary text-rose-600 hover:bg-rose-50'
                : 'roco-btn-success'
            }`}
          >
            {isEncountered ? (
              <>
                <RotateCcw className="w-4 h-4" />
                <span>取消【已遇见】标记</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>点亮图鉴 · 标记为【已遇见】</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
