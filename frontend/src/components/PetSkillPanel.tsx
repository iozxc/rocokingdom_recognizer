import React, { useState, useMemo } from 'react';
import {
  Swords,
  Shield,
  Sparkles,
  Crown,
  Layers,
} from 'lucide-react';
import { PetItem, PetSkillInfo } from '../types';
import { getPetSpecialType, formatPetName } from '../utils/petHelper';
import { ElementBadges, ElementBadge } from './ElementBadges';
import { getElementColor } from '../utils/elements';
import { resolvePetSkillsAndTrait } from '../data/petSkillMock';

interface PetSkillPanelProps {
  pet: PetItem;
  className?: string;
  /** 用于 hover 弹出的小面板，隐藏复杂筛选，保留轻量核心信息。 */
  compact?: boolean;
  /** 是否展示精灵名称标题栏（在已包含精灵标题的 Modal 中可关闭）。 */
  showHeader?: boolean;
}

export const PetSkillPanel: React.FC<PetSkillPanelProps> = ({
  pet,
  className = '',
  compact = false,
  showHeader = true,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'trait' | 'attack' | 'support'>('all');
  const specialType = getPetSpecialType(pet);
  const displayName = formatPetName(pet.name);
  const defaultElement = pet.elements?.[0] || '普通';

  // 智能补齐特性与技能数据（优先自带，缺失时根据系别自适应解析）
  const { trait, skills } = useMemo(() => resolvePetSkillsAndTrait(pet), [pet]);

  // 技能分类过滤
  const filteredSkills = useMemo(() => {
    if (activeTab === 'attack') {
      return skills.filter((s) => s.skill_type === '攻击');
    }
    if (activeTab === 'support') {
      return skills.filter((s) => s.skill_type === '防御' || s.skill_type === '状态' || s.skill_type === '其他');
    }
    if (activeTab === 'trait') {
      return [];
    }
    return skills;
  }, [skills, activeTab]);

  const attackCount = useMemo(() => skills.filter((s) => s.skill_type === '攻击').length, [skills]);
  const supportCount = useMemo(() => skills.filter((s) => s.skill_type !== '攻击').length, [skills]);

  return (
    <div
      id={`pet-skill-panel-${pet.id || pet.name}`}
      className={`overflow-hidden flex flex-col transition-all text-slate-800 dark:text-slate-100 ${
        showHeader
          ? 'bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xl'
          : ''
      } ${className}`}
    >
      {/* 顶部标题栏 */}
      {showHeader && (
        <div className={`border-b border-slate-100 dark:border-slate-800/80 bg-gradient-to-r from-sky-50/70 via-blue-50/40 to-transparent dark:from-slate-800/60 dark:to-slate-900/40 flex items-center justify-between gap-2 ${
          compact ? 'px-3 py-1.5' : 'px-3.5 py-2'
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            {pet.elements && pet.elements.length > 0 ? (
              <ElementBadges elements={pet.elements} size="sm" horizontal />
            ) : (
              <div className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center text-[10px] font-bold">
                宠
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                <span>{displayName}</span>
                {specialType && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.2 rounded-full border ${
                      specialType === 'boss'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                        : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30'
                    }`}
                  >
                    {specialType === 'boss' ? <Crown className="w-2.5 h-2.5" /> : <Layers className="w-2.5 h-2.5" />}
                    {specialType === 'boss' ? '首领' : '多形态'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 选项卡切换（仅在非 compact 模式下完整呈现） */}
      {!compact && (
        <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 text-[11px] overflow-x-auto select-none no-scrollbar">
          <button
            id="skill-tab-all"
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 cursor-pointer ${
              activeTab === 'all'
                ? 'bg-sky-500 text-white shadow-xs shadow-sky-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            全部 ({skills.length + (trait?.name ? 1 : 0)})
          </button>
          {trait?.name && (
            <button
              id="skill-tab-trait"
              type="button"
              onClick={() => setActiveTab('trait')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 cursor-pointer ${
                activeTab === 'trait'
                  ? 'bg-amber-500 text-white shadow-xs shadow-amber-500/30'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Sparkles className="w-3 h-3 text-amber-300" />
              特性
            </button>
          )}
          <button
            id="skill-tab-attack"
            type="button"
            onClick={() => setActiveTab('attack')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'attack'
                ? 'bg-rose-500 text-white shadow-xs shadow-rose-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Swords className="w-3 h-3" />
            攻击 ({attackCount})
          </button>
          <button
            id="skill-tab-support"
            type="button"
            onClick={() => setActiveTab('support')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'support'
                ? 'bg-emerald-500 text-white shadow-xs shadow-emerald-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Shield className="w-3 h-3" />
            辅助/防御 ({supportCount})
          </button>
        </div>
      )}

      {/* 技能与特性区域：紧凑排版，无多余大边框，严格阻止横向溢出 */}
      <div
        className={`${compact ? 'p-2.5 space-y-2' : 'p-3.5 space-y-2.5 max-h-[480px] overflow-y-auto'} overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700`}
      >
        {/* 固有特性卡片 */}
        {(activeTab === 'all' || activeTab === 'trait') && trait?.name && (
          <div
            id={`trait-card-${trait.id || trait.name}`}
            className={`group/trait relative overflow-hidden rounded-xl border border-amber-400/30 dark:border-amber-500/25 bg-gradient-to-br from-amber-50/80 via-orange-50/40 to-transparent dark:from-amber-950/30 dark:via-slate-900/60 dark:to-slate-900 transition-all hover:border-amber-400/60 flex items-start gap-2 ${
              compact ? 'p-1.5' : 'p-2'
            }`}
          >
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg overflow-hidden shrink-0 border border-amber-500/20 bg-white dark:bg-slate-900 flex items-center justify-center">
              {trait.icon_url ? (
                <img
                  src={trait.icon_url}
                  alt={trait.name}
                  loading="lazy"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <Sparkles className="w-4 h-4 text-amber-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-black text-amber-800 dark:text-amber-200 truncate">
                  {trait.name}
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20 shrink-0">
                  特性
                </span>
              </div>
              <p className={`text-slate-600 dark:text-slate-300 font-normal leading-snug ${
                compact ? 'mt-0.5 text-[10.5px]' : 'mt-1 text-xs leading-relaxed'
              }`}>
                {trait.desc || '入场即生效的专属常驻被动能力。'}
              </p>
            </div>
          </div>
        )}

        {/* 技能列表：采用参考图虚线分隔设计 */}
        <div className="divide-y divide-dashed divide-slate-200/90 dark:divide-slate-800/90">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.sid + skill.name}
              skill={skill}
              defaultElement={defaultElement}
              compact={compact}
            />
          ))}
        </div>

        {filteredSkills.length === 0 && activeTab !== 'trait' && (
          <div className="text-center py-4 text-xs text-slate-400 dark:text-slate-500">
            暂无该分类技能
          </div>
        )}
      </div>
    </div>
  );
};

interface SkillCardProps {
  skill: PetSkillInfo;
  defaultElement: string;
  compact?: boolean;
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, defaultElement, compact }) => {
  const skillElement = skill.element || defaultElement;
  const elementStyle = getElementColor(skillElement);

  return (
    <div
      id={`skill-row-${skill.sid || skill.name}`}
      className={`group/skill relative transition-colors flex items-start gap-2 ${
        compact ? 'py-1.5 first:pt-0.5 last:pb-0' : 'py-2 first:pt-1 last:pb-0'
      }`}
    >
      {/* 技能图标列：纵向跨过名称/规格与描述两行 */}
      <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-lg overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 flex items-center justify-center">
        {skill.icon_url ? (
          <img
            src={skill.icon_url}
            alt={skill.name}
            loading="lazy"
            className="w-full h-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ElementBadge element={skill.element || defaultElement} size="xs" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5 min-w-0 flex-nowrap">
          {/* 技能名称与伤害类型 */}
          <div className="flex items-center gap-1.5 min-w-0 flex-nowrap overflow-hidden">
            <span
              className={`font-black text-slate-800 dark:text-slate-100 tracking-tight truncate ${
                compact ? 'text-xs' : 'text-sm'
              }`}
            >
              {skill.name}
            </span>
            {skill.damage_kind && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0 leading-none">
                {skill.damage_kind}
              </span>
            )}
          </div>

          {/* 右侧：★能耗 + 系别/威力 */}
          <div
            className="inline-flex items-center h-5 rounded-md overflow-hidden border border-slate-200/90 dark:border-slate-700/80 shadow-2xs shrink-0 select-none whitespace-nowrap"
            title={`能量消耗: ${skill.energy_cost ?? 1} | ${skillElement}系技能，威力: ${
              skill.power != null && skill.power > 0 ? skill.power : '无/变化'
            }`}
          >
            <div className="h-full px-1.5 flex items-center gap-0.5 bg-slate-800 dark:bg-slate-850 text-white font-mono font-bold text-[10px] border-r border-slate-700/70 shrink-0">
              <span className="text-amber-300 text-[9px] leading-none select-none">★</span>
              <span className="leading-none">{skill.energy_cost ?? 1}</span>
            </div>

            <div
              className="h-full px-1.5 flex items-center gap-1 font-mono font-bold text-[10px] shrink-0"
              style={{
                backgroundColor: elementStyle.bg,
                color: elementStyle.fg || '#ffffff',
              }}
            >
              <div className="shrink-0 flex items-center justify-center">
                <ElementBadge element={skillElement} size="xs" />
              </div>
              <span className="leading-none tracking-tight drop-shadow-2xs">
                {skill.power != null && skill.power > 0 ? skill.power : '—'}
              </span>
            </div>
          </div>
        </div>

        <p
          className={`text-slate-600 dark:text-slate-300 font-normal leading-snug ${
            compact ? 'mt-0.5 text-[10px]' : 'mt-1 text-xs leading-relaxed'
          }`}
        >
          {skill.desc || '对敌方精灵造成属性伤害与对战效果。'}
        </p>
      </div>
    </div>
  );
};
