import React from 'react';
import { X, Check, RotateCcw, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import { MapConfig, PetItem, EncounterRecord } from '../types';
import { sound } from '../services/sound';
import { IS_STATIC } from '../services/staticMode';
import { ElementBadges } from './ElementBadges';
import { PetSprite } from './PetSprite';
import { formatPetName } from '../utils/petHelper';
import { createSvgPetAvatar } from '../data/mockPets';

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
  const displayName = formatPetName(pet.displayName || pet.name);
  // 图片加载失败时兜底的通用头像（避免空白 / 无限重试）
  const fallbackAvatar = createSvgPetAvatar(
      displayName,
      '普',
      (Number(pet.id) || 1) * 47 % 360,
      '#7ABCF4',
      '⭐'
  );

  const formatTime = (iso?: string): string => {
    if (!iso) return '未知';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleString('zh-CN', { hour12: false });
  };

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
    <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        onWheel={(e) => e.stopPropagation()}
    >
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
            {IS_STATIC && pet.sprite ? (
                <PetSprite
                    pet={pet}
                    alt={displayName}
                    className="w-full h-full object-contain"
                />
            ) : (
                <img
                    src={pet.url || fallbackAvatar}
                    alt={displayName}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement;
                      if (!el.src.endsWith('svg+xml')) {
                        (e.target as HTMLImageElement).src = fallbackAvatar;
                      }
                    }}
                />
            )}
            {/* Green Checkmark Badge at Bottom Left */}
            {isEncountered && (
              <div className="encountered-badge-check scale-120">
                <Check className="w-4 h-4 text-white stroke-[3.5]" />
              </div>
            )}
          </div>

          <div className="mt-4 text-center">
            <h3 className="text-xl font-black text-slate-800">
              {displayName}
            </h3>
            {pet.id != null && (
                <p className="text-xs font-bold text-[#7ABCF4] mt-1">
                  图鉴编号 #{pet.id}
                </p>
            )}
            {pet.elements && pet.elements.length > 0 && (
                <div className="mt-2 flex justify-center">
                  <ElementBadges elements={pet.elements} size="md" horizontal />
                </div>
            )}
          </div>

          {/* 遇见信息：时间与置信度/备注（来自用户记录） */}
          {isEncountered && record && (
              <div className="mt-4 w-full rounded-2xl bg-[#F5F9FF] border border-[#E6EEF8] p-3 space-y-2 text-left">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-500 font-bold shrink-0">遇见时间</span>
                  <span className="text-slate-800 font-black font-mono truncate">
                    {formatTime(record.lastSeenAt)}
                  </span>
                </div>
                {record.note && (
                    <div className="flex items-start justify-between gap-2 text-xs">
                      <span className="text-slate-500 font-bold shrink-0">置信度/备注</span>
                      <span className="text-slate-800 font-bold text-right">
                        {record.note}
                      </span>
                    </div>
                )}
              </div>
          )}
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
