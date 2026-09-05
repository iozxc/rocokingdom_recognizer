import React, { useEffect } from 'react';
import { X, Check, RotateCcw, Sparkles, Crown, Layers, Calendar, FileText, Info } from 'lucide-react';
import confetti from 'canvas-confetti';
import { MapConfig, PetItem, EncounterRecord } from '../types';
import { sound } from '../services/sound';
import { IS_STATIC } from '../services/staticMode';
import { ElementBadges } from './ElementBadges';
import { PetSprite } from './PetSprite';
import { PetSkillPanel } from './PetSkillPanel';
import { formatPetName, getPetSpecialType } from '../utils/petHelper';
import { createSvgPetAvatar } from '../data/mockPets';
import { getElementColor } from '../utils/elements';

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
  // 监听 ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !pet) return null;

  const isEncountered = !!record?.encountered;
  const displayName = formatPetName(pet.displayName || pet.name);
  const specialType = getPetSpecialType(pet);
  const primaryElement = pet.elements?.[0] || '草';
  const elementStyle = getElementColor(primaryElement);

  // 图片加载失败时兜底的通用头像
  const fallbackAvatar = createSvgPetAvatar(
    displayName,
    primaryElement.slice(0, 1),
    (Number(pet.id) || 1) * 47 % 360,
    elementStyle.bg,
    '⭐'
  );

  const formatTime = (iso?: string): string => {
    if (!iso) return '未知';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleToggle = () => {
    sound.playClick();
    if (!isEncountered) {
      sound.playEncounter();
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });
    } else {
      sound.playToggleOff();
    }
    onToggleEncounter(currentMap.id, pet.name);
  };

  return (
    <div
      id="pet-detail-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-950/65 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        id="pet-detail-modal-container"
        className="relative w-full max-w-3xl bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[92vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部/右上角关闭按钮 */}
        <button
          id="pet-detail-close-btn"
          type="button"
          onClick={() => {
            sound.playClick();
            onClose();
          }}
          className="absolute top-3.5 right-3.5 z-20 p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-white/80 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-xs cursor-pointer"
          title="关闭 (Esc)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 左栏：精灵立绘卡片与图鉴遇见标记 (约 280px 宽度) */}
        <div className="w-full md:w-[290px] shrink-0 p-5 md:p-6 flex flex-col items-center border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-800 bg-gradient-to-b from-slate-50/80 via-white to-sky-50/30 dark:from-slate-800/40 dark:via-slate-900 dark:to-slate-900 overflow-y-auto">
          {/* 精灵立绘框 */}
          <div className="relative w-36 h-36 md:w-44 md:h-44 rounded-3xl p-3 flex items-center justify-center group/sprite">
            {/* 系别环境柔和光晕底纹 */}
            <div
              className="absolute inset-2 rounded-3xl opacity-20 blur-xl transition-all duration-300 group-hover/sprite:opacity-35"
              style={{ backgroundColor: elementStyle.bg }}
            />
            <div className="relative z-10 w-full h-full rounded-2xl bg-white/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/60 p-3 shadow-sm flex items-center justify-center overflow-hidden">
              {IS_STATIC && pet.sprite ? (
                <PetSprite
                  pet={pet}
                  alt={displayName}
                  className="w-full h-full object-contain transition-transform duration-300 group-hover/sprite:scale-110 select-none"
                />
              ) : (
                <img
                  src={pet.url || fallbackAvatar}
                  alt={displayName}
                  className="w-full h-full object-contain transition-transform duration-300 group-hover/sprite:scale-110 select-none"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    if (!el.src.endsWith('svg+xml')) {
                      el.src = fallbackAvatar;
                    }
                  }}
                />
              )}

              {/* 已遇见专属绿色浮标 */}
              {isEncountered && (
                <div
                  id="pet-detail-encountered-badge"
                  className="absolute bottom-2 left-2 flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white shadow-md ring-2 ring-white dark:ring-slate-800"
                  title="已在图鉴中点亮遇见"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
              )}
            </div>
          </div>

          {/* 名称与编号 */}
          <div className="mt-3 text-center w-full">
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
                {displayName}
              </h2>
              {specialType && (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] font-black px-2 py-0.5 rounded-full border ${
                    specialType === 'boss'
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                      : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30'
                  }`}
                >
                  {specialType === 'boss' ? <Crown className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
                  {specialType === 'boss' ? '首领化' : '多形态'}
                </span>
              )}
            </div>

            {pet.id != null && (
              <p className="text-xs font-bold text-sky-600 dark:text-sky-400 mt-1">
                洛克图鉴编号 #{String(pet.id).padStart(3, '0')}
              </p>
            )}

            {/* 属性展示 */}
            {pet.elements && pet.elements.length > 0 && (
              <div className="mt-2.5 flex justify-center">
                <ElementBadges elements={pet.elements} size="md" horizontal />
              </div>
            )}
          </div>

          {/* 遇见记录详情（如果已记录） */}
          {isEncountered && record && (
            <div className="mt-4 w-full rounded-2xl bg-sky-50/60 dark:bg-slate-800/60 border border-sky-100 dark:border-slate-700/60 p-3 space-y-1.5 text-left text-xs">
              <div className="flex items-center justify-between gap-1 text-slate-500 dark:text-slate-400 font-semibold">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-sky-500" />
                  遇见时间
                </span>
                <span className="font-mono text-slate-700 dark:text-slate-200 font-bold">
                  {formatTime(record.lastSeenAt)}
                </span>
              </div>
              {record.note && (
                <div className="flex items-start justify-between gap-1 pt-1 border-t border-sky-100 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 font-semibold">
                  <span className="flex items-center gap-1 shrink-0">
                    <FileText className="w-3.5 h-3.5 text-sky-500" />
                    标记备注
                  </span>
                  <span className="text-right text-slate-700 dark:text-slate-200 font-medium truncate max-w-[140px]">
                    {record.note}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 遇见状态快捷切换按钮 */}
          <div className="mt-auto pt-4 w-full">
            <button
              id="pet-detail-toggle-encounter-btn"
              type="button"
              onClick={handleToggle}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98 ${
                isEncountered
                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-emerald-500/25'
              }`}
            >
              {isEncountered ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>取消【已遇见】标记</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-emerald-100" />
                  <span>点亮图鉴 · 标记已遇见</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 右栏：战斗技能与固有特性专属面板 (自适应伸展) */}
        <div className="flex-1 min-w-0 p-4 md:p-5 flex flex-col overflow-hidden bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-5 rounded-full bg-sky-500 shrink-0" />
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 tracking-tight">
              精灵专属特性与技能全览
            </h3>
          </div>

          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <PetSkillPanel
              pet={pet}
              compact={false}
              showHeader={false}
              className="border-0 shadow-none bg-transparent dark:bg-transparent flex-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
