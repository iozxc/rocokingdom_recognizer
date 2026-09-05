import React, { useState, useMemo } from 'react';
import {
  Swords,
  Shield,
  Sparkles,
  Crown,
  Layers,
  Activity,
} from 'lucide-react';
import { PetItem, PetSkillInfo } from '../types';
import { getPetSpecialType, formatPetName } from '../utils/petHelper';
import { ElementBadges, ElementBadge } from './ElementBadges';
import { resolvePetSkillsAndTrait } from '../data/petSkillMock';
import { TsIcon } from './TsIcon';
import { TermHighlightText } from './TermHighlightText';

const SKILL_ICON_BASE = `${import.meta.env.BASE_URL}icon/`;
const SKILL_CATEGORY_ICONS = {
  physical: { key: 'physical', src: `${SKILL_ICON_BASE}physical.webp`, label: '物理' },
  magic: { key: 'magic', src: `${SKILL_ICON_BASE}magic.webp`, label: '魔法' },
  status: { key: 'status', src: `${SKILL_ICON_BASE}status.webp`, label: '状态' },
  defense: { key: 'defense', src: `${SKILL_ICON_BASE}defense.webp`, label: '防御' },
};
const ENERGY_ICON_SRC = `${SKILL_ICON_BASE}energy.webp`;
// 参考 roco.world：白色分类图标垫在对应色圆底上才可辨识
const SKILL_CATEGORY_COLORS: Record<string, string> = {
  physical: '#9a4238',
  magic: '#6b579e',
  status: '#6f8655',
  defense: '#4f8492',
};
const ENERGY_ICON_COLOR = '#ffc65f';

function resolveSkillCategory(skill: PetSkillInfo): { key: string; src: string; label: string } {
  if (skill.damage_kind === '物理') return SKILL_CATEGORY_ICONS.physical;
  if (skill.damage_kind === '魔法') return SKILL_CATEGORY_ICONS.magic;
  if (skill.damage_kind === '真实') return { ...SKILL_CATEGORY_ICONS.magic, label: '真实' };
  if (skill.skill_type === '防御') return SKILL_CATEGORY_ICONS.defense;
  return SKILL_CATEGORY_ICONS.status;
}

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
  const [activeTab, setActiveTab] = useState<'all' | 'trait' | 'attack' | 'status' | 'defense'>('all');
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
    if (activeTab === 'status') {
      return skills.filter((s) => s.skill_type === '状态' || s.skill_type === '其他');
    }
    if (activeTab === 'defense') {
      return skills.filter((s) => s.skill_type === '防御');
    }
    if (activeTab === 'trait') {
      return [];
    }
    return skills;
  }, [skills, activeTab]);

  const attackCount = useMemo(() => skills.filter((s) => s.skill_type === '攻击').length, [skills]);
  const statusCount = useMemo(() => skills.filter((s) => s.skill_type === '状态' || s.skill_type === '其他').length, [skills]);
  const defenseCount = useMemo(() => skills.filter((s) => s.skill_type === '防御').length, [skills]);

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
            id="skill-tab-status"
            type="button"
            onClick={() => setActiveTab('status')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'status'
                ? 'bg-emerald-500 text-white shadow-xs shadow-emerald-500/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Activity className="w-3 h-3" />
            状态 ({statusCount})
          </button>
          <button
            id="skill-tab-defense"
            type="button"
            onClick={() => setActiveTab('defense')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all shrink-0 flex items-center gap-1 cursor-pointer ${
              activeTab === 'defense'
                ? 'bg-teal-600 text-white shadow-xs shadow-teal-600/30'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Shield className="w-3 h-3" />
            防御 ({defenseCount})
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
                <TsIcon url={trait.icon_url} alt={trait.name} className="w-full h-full" />
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
                <TermHighlightText text={trait.desc || '入场即生效的专属常驻被动能力。'} ids={trait.glossary} interactive={!compact} />
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
  const category = resolveSkillCategory(skill);
  const powerText = skill.power != null && skill.power > 0 ? String(skill.power) : '--';
  const badgeCls = compact ? 'h-[18px] px-1 text-[9px]' : 'h-5 px-1.5 text-[10px]';
  const iconCls = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <div
      id={`skill-row-${skill.sid || skill.name}`}
      className={`group/skill relative transition-colors flex items-center gap-2 ${
        compact ? 'py-1.5 first:pt-0.5 last:pb-0' : 'py-2 first:pt-1 last:pb-0'
      }`}
    >
      {/* 技能图标列：右下角叠系别图标，对齐参考站排版 */}
      <div className="relative w-9 h-9 sm:w-11 sm:h-11 rounded-lg overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 flex items-center justify-center">
        {skill.icon_url ? (
          <TsIcon url={skill.icon_url} alt={skill.name} className="w-full h-full" />
        ) : (
          <ElementBadge element={skill.element || defaultElement} size="xs" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5 min-w-0 flex-nowrap">
          <span className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
            <span
              className={`font-black text-slate-800 dark:text-slate-100 tracking-tight truncate ${
                compact ? 'text-xs' : 'text-sm'
              }`}
            >
              {skill.name}
            </span>
            <span className="inline-flex items-center shrink-0 leading-none">
              <ElementBadge element={skillElement} size="xs" />
            </span>
          </span>

          {/* 参考站同款双徽章：与技能名同一行 */}
          <span className="flex items-center gap-1 shrink-0">
            <span
              className={`inline-flex items-center gap-1 rounded-full bg-slate-800 dark:bg-slate-800 font-mono font-bold text-slate-100 shrink-0 select-none whitespace-nowrap shadow-xs ${badgeCls}`}
              title={`技能类型 ${category.label}；威力 ${powerText}`}
            >
              <span
                className={`${iconCls} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
                style={{ backgroundColor: SKILL_CATEGORY_COLORS[category.key] || '#8a7d68' }}
              >
                <img src={category.src} alt={category.label} loading="lazy" className="w-full h-full object-contain" />
              </span>
              <span className="leading-none">{powerText}</span>
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full bg-slate-800 dark:bg-slate-800 font-mono font-bold text-amber-300 shrink-0 select-none whitespace-nowrap shadow-xs ${badgeCls}`}
              title={`能量 ${skill.energy_cost ?? 0}`}
            >
              <span
                className={`${iconCls} rounded-full overflow-hidden flex items-center justify-center shrink-0`}
                style={{ backgroundColor: ENERGY_ICON_COLOR }}
              >
                <img src={ENERGY_ICON_SRC} alt="能量" loading="lazy" className="w-full h-full object-contain" />
              </span>
              <span className="leading-none">{skill.energy_cost ?? 0}</span>
            </span>
          </span>
        </div>

        <p
          className={`text-slate-600 dark:text-slate-300 font-normal leading-snug ${
            compact ? 'mt-0.5 text-[10px]' : 'mt-1 text-xs leading-relaxed'
          }`}
        >
          <TermHighlightText text={skill.desc || '对敌方精灵造成属性伤害与对战效果。'} ids={skill.glossary} interactive={!compact} />
        </p>
      </div>
    </div>
  );
};
