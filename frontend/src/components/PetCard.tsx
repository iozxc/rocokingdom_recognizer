import React from 'react';
import { Sparkle, Info } from 'lucide-react';
import { PetItem } from '../types';
import { formatPetName } from '../utils/petHelper';
import { ElementBadges } from './ElementBadges';
import { PetSprite } from './PetSprite';
import { PetSpecialTag } from './PetSpecialTag';
import { petKeyOf } from '../services/atlasCollector';

/** 社区图鉴数据（字段来自服务端，允许携带额外字段）。 */
export interface PetCardCommunityInfo {
  confidence?: number;
  agree_ratio?: number;
  my_vote?: 'agree' | 'disagree' | 'none';
  vote_ratio?: number;
  voter_count?: number;
  total_users?: number;
  [key: string]: unknown;
}

interface PetCardProps {
  mapId: string;
  pet: PetItem;
  isEnc: boolean;
  /** 刚刚点亮（播放点亮动效）。 */
  isJustEncountered: boolean;
  /** 共创图鉴卡片布局（火系专用）。 */
  communityCard: boolean;
  communityInfo?: PetCardCommunityInfo | null;
  /** 是否允许社区投票（决定底部行渲染形态）。 */
  canVote: boolean;
  /** 点击卡片：切换【已遇见/未遇见】。 */
  onActivate: (petName: string, currentlyEnc: boolean) => void;
  /** 信息按钮：打开详情。 */
  onOpenDetail: (pet: PetItem) => void;
  /** 社区投票（不传则不渲染投票按钮）。 */
  onVote?: (mapId: string, petKey: string, petName: string, type: 'agree' | 'disagree') => void;
  /** 鼠标进入（智能技能悬浮）。 */
  onEnter: (e: React.MouseEvent<HTMLDivElement>, pet: PetItem) => void;
  onLeave: () => void;
  /** 右键：呼出快捷菜单。 */
  onContext: (e: React.MouseEvent<HTMLDivElement>, pet: PetItem) => void;
}

/**
 * 单张精灵卡片。
 *
 * 性能要点：
 * - React.memo：外层网格（PetGrid）会因 hover/动画/筛选等状态重渲染，未变化的卡片直接跳过重渲染。
 * - 卡片主体外包一层 content-visibility:auto：地图卡片数量很大（数百张）时，视口外的卡片
 *   跳过布局/绘制，切换地图时只真正渲染可见的十几张。
 */
export const PetCard: React.FC<PetCardProps> = React.memo(({
  mapId,
  pet,
  isEnc,
  isJustEncountered,
  communityCard,
  communityInfo,
  canVote,
  onActivate,
  onOpenDetail,
  onVote,
  onEnter,
  onLeave,
  onContext,
}) => {
  const petKey = petKeyOf(pet.name, pet.id, pet.seq);

  return (
    <div
      id={`pet-card-${mapId}-${pet.name.replace('.', '-')}`}
      onClick={() => onActivate(pet.name, isEnc)}
      onContextMenu={(e) => onContext(e, pet)}
      onMouseEnter={(e) => onEnter(e, pet)}
      onMouseLeave={onLeave}
      className={`group relative rounded-2xl p-2 sm:p-3 flex flex-col items-center cursor-pointer transition-all duration-200 select-none ${
        isJustEncountered
          ? 'encounter-pop-active bg-[#F2FBF0] dark:bg-emerald-950/40 border-2 border-[#95D151] ring-2 ring-[#95D151]/40'
          : isEnc
            ? 'bg-gradient-to-b from-[#F2FBF0] to-[#EAF7E8] dark:from-emerald-950/30 dark:to-slate-900/60 border-2 border-[#95D151] dark:border-emerald-600 hover:border-[#76B032] shadow-xs'
            : 'bg-white dark:bg-slate-800/80 border-2 border-slate-200/80 dark:border-slate-700/80 hover:border-sky-400 dark:hover:border-sky-500 hover:shadow-md'
      }`}
    >
      {/* Floating sparkle badge during encounter activation（保留在 content-visibility 容器外，避免被裁剪） */}
      {isJustEncountered && (
        <div className="absolute -top-3.5 z-20 encounter-sparkle-active bg-gradient-to-r from-[#95D151] to-[#76B032] text-white text-[10px] font-black px-2 py-0.5 rounded-full border border-white flex items-center gap-1 pointer-events-none shadow-md">
          <Sparkle className="w-2.5 h-2.5 fill-white text-white" />
          <span>点亮图鉴</span>
        </div>
      )}

      {/* 视口外跳过布局/绘制（content-visibility）；auto 尺寸在首次渲染后自动记忆 */}
      <div className="flex w-full flex-col items-center [content-visibility:auto] [contain-intrinsic-size:auto_150px_190px]">
        {/* Fixed Uniform Image Container - 1:1 Aspect Ratio with object-contain */}
        {communityCard ? (
          /* 共创图鉴（火系）：头部行吃进立绘容器顶部 */
          <div className="relative w-full aspect-square rounded-xl bg-slate-50 dark:bg-slate-900/90 p-1 sm:p-1.5 flex flex-col overflow-hidden border border-slate-100 dark:border-slate-800">
            {/* 头部行：左系别图标、右图鉴编号 */}
            <div className="flex items-start justify-between w-full shrink-0 z-10">
              <ElementBadges elements={pet?.elements} size="sm" />
              {pet.id != null && (
                <span className="text-[9px] font-mono font-bold text-slate-400 dark:text-slate-500 leading-none">
                  #{pet.id}
                </span>
              )}
            </div>

            {/* 置信度 */}
            {(() => {
              const conf = communityInfo?.confidence ?? 0;
              const tcls = conf >= 0.7 ? 'text-emerald-600 dark:text-emerald-400' : conf >= 0.3 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400';
              return (
                <div className="absolute -top-[3px] left-0 right-0 z-[2] text-center pointer-events-none">
                  <span className={`text-[8px] sm:text-[9px] font-mono font-black px-1 py-0.5 rounded-full ${tcls}`}>
                    置信度：{Math.round(conf * 100)}%
                  </span>
                </div>
              );
            })()}

            {/* 立绘 */}
            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
              <PetSprite
                pet={pet}
                alt={pet.name}
                className={`w-full h-full object-contain pointer-events-none transition-transform duration-200 ${
                  isJustEncountered ? 'scale-110' : 'group-hover:scale-108'
                }`}
              />
            </div>

            {/* 进度条 */}
            {communityInfo && onVote && (() => {
              const vr = communityInfo.vote_ratio ?? 0;
              const vc = communityInfo.voter_count ?? 0;
              const tc = communityInfo.total_users ?? 0;
              const barCls = vr >= 0.5 ? 'bg-emerald-500' : vr >= 0.25 ? 'bg-amber-400' : 'bg-rose-400';
              return (
                <div className="flex items-center gap-1 w-full shrink-0 pt-0.5">
                  <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barCls}`}
                      style={{ width: `${Math.min(100, Math.round(vr * 100))}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono font-bold leading-none shrink-0 text-slate-500 dark:text-slate-400">
                    {vc}/{tc}
                  </span>
                </div>
              );
            })()}

            {/* 多形态/首领化 */}
            <div className="absolute right-0.5 top-1/2 -translate-y-1/2 z-[1] pointer-events-none">
              <PetSpecialTag pet={pet} vertical />
            </div>
            <button
              id={`pet-card-info-btn-${pet.name.replace('.', '-')}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(pet);
              }}
              className="opacity-0 group-hover:opacity-100 sm:opacity-0 focus:opacity-100 transition-opacity absolute bottom-1 right-1 z-20 w-5 h-5 rounded-md bg-white/90 dark:bg-slate-800/90 hover:bg-sky-500 hover:text-white text-slate-400 dark:text-slate-300 flex items-center justify-center shadow-xs cursor-pointer border border-slate-200 dark:border-slate-700"
              title="查看精灵详情与全技能"
            >
              <Info className="w-3 h-3" />
            </button>
          </div>
        ) : (
          /* 经典布局：编号/系别图标叠加在立绘上 */
          <div className="relative w-full aspect-square rounded-xl bg-slate-50/70 dark:bg-slate-900/70 p-1 sm:p-1.5 flex items-center justify-center overflow-hidden border border-slate-100 dark:border-slate-800/80">
            {pet.id != null && (
              <span className="absolute top-1 right-1 z-[1] text-[8px] sm:text-[9px] font-mono font-black px-1.5 py-0.5 rounded-md bg-slate-900/60 text-white/90 backdrop-blur-xs">
                #{pet.id}
              </span>
            )}
            <ElementBadges
              elements={pet?.elements}
              className="absolute top-1 left-1 sm:top-1.5 sm:left-1.5 z-10 drop-shadow-xs"
              size="sm"
            />
            <PetSprite
              pet={pet}
              alt={pet.name}
              className={`w-full h-full object-contain pointer-events-none transition-transform duration-200 ${
                isJustEncountered ? 'scale-110' : 'group-hover:scale-108'
              }`}
            />
            {/* 多形态/首领化 */}
            <div className="absolute bottom-1 left-0 right-0 z-[1] flex justify-center pointer-events-none">
              <PetSpecialTag pet={pet} />
            </div>
            <button
              id={`pet-card-info-btn-${pet.name.replace('.', '-')}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(pet);
              }}
              className="opacity-0 group-hover:opacity-100 sm:opacity-0 focus:opacity-100 transition-opacity absolute bottom-1 right-1 z-20 w-5 h-5 rounded-md bg-white/90 dark:bg-slate-800/90 hover:bg-sky-500 hover:text-white text-slate-400 dark:text-slate-300 flex items-center justify-center shadow-xs cursor-pointer border border-slate-200 dark:border-slate-700"
              title="查看精灵详情与全技能"
            >
              <Info className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Pet Name Label */}
        <div className="mt-1.5 w-full text-center">
          <p
            className={`text-[11px] sm:text-xs font-black truncate transition-colors duration-200 ${
              isEnc ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-100'
            }`}
            title={formatPetName(pet.name)}
          >
            {formatPetName(pet.name)}
          </p>
        </div>

        {/* 社区图鉴 / 状态 indicator */}
        {communityCard && canVote && onVote ? (
          <div className="mt-1.5 flex items-center justify-between w-full">
            {(() => {
              const myVote = communityInfo?.my_vote ?? 'none';
              const renderBtn = (type: 'agree' | 'disagree', label: string) => {
                const active = type === 'agree' ? myVote === 'agree' : myVote === 'disagree';
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (petKey) onVote(mapId, petKey, pet.name, type);
                    }}
                    className={`text-[10px] font-black w-5 h-5 sm:w-6 sm:h-6 rounded-md border flex items-center justify-center transition-colors select-none ${
                      active
                        ? type === 'agree' ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-rose-500 border-rose-500 text-white'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-500 dark:hover:text-slate-300'
                    } cursor-pointer`}
                    title={type === 'agree' ? '赞同' : '不赞同'}
                  >
                    {label}
                  </button>
                );
              };
              return (
                <>
                  {renderBtn('agree', '✓')}
                  <span className={`text-[10px] sm:text-[11px] font-black leading-none truncate ${
                    isEnc ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                  }`}>
                    {isEnc ? '已遇见' : '未遇见'}
                  </span>
                  {renderBtn('disagree', '✕')}
                </>
              );
            })()}
          </div>
        ) : (
          /* 遇见状态微药丸 */
          <div className="mt-1.5 flex items-center justify-center w-full">
            {isEnc ? (
              <span className="text-[10px] sm:text-[11px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 dark:bg-emerald-950/60 px-2 py-0.5 rounded-lg w-full text-center border border-emerald-500/30 dark:border-emerald-600/40 truncate">
                已遇见
              </span>
            ) : (
              <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg w-full text-center border border-slate-200 dark:border-slate-700 group-hover:border-sky-300 dark:group-hover:border-sky-600 group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors truncate">
                未遇见
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

PetCard.displayName = 'PetCard';
