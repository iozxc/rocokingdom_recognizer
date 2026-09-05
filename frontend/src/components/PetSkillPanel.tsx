import React from 'react';
import { Star, Swords, Shield, Sparkles, Atom, Crown, Layers } from 'lucide-react';
import { PetItem, PetSkillInfo } from '../types';
import { getPetSpecialType, formatPetName } from '../utils/petHelper';
import { getElementColor } from '../utils/elements';

interface PetSkillPanelProps {
  pet: PetItem;
  className?: string;
  /** 用于 hover 弹出的小面板，隐藏标题装饰，更紧凑。 */
  compact?: boolean;
}

function skillTypeIcon(type?: string) {
  if (type === '攻击') return <Swords className="w-3 h-3" />;
  if (type === '防御') return <Shield className="w-3 h-3" />;
  if (type === '状态') return <Sparkles className="w-3 h-3" />;
  return <Atom className="w-3 h-3" />;
}

function ElementBadge({ element }: { element?: string }) {
  if (!element) return null;
  const c = getElementColor(element);
  return (
      <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-md text-white text-[10px] font-black shrink-0"
          style={{ backgroundColor: c.bg, color: c.fg || '#fff' }}
          title={element}
      >
        {element.slice(0, 1)}
      </span>
  );
}

function SkillRow({ skill }: { skill: PetSkillInfo }) {
  const isAttack = skill.skill_type === '攻击';
  return (
      <div className="flex items-start gap-2.5 px-2.5 py-2 rounded-xl bg-[#F8FAFC] dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/70">
        <div className="w-9 h-9 rounded-lg bg-slate-900 dark:bg-slate-900 flex items-center justify-center text-white shrink-0 overflow-hidden">
          <ElementBadge element={skill.element} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">{skill.name}</span>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-amber-600 dark:text-amber-400">
              <Star className="w-2.5 h-2.5 fill-current" />
              {skill.energy_cost ?? '—'}
            </span>
            {skill.element && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  <ElementBadge element={skill.element} />
                  {skill.element}
                </span>
            )}
            {isAttack && skill.power != null && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-rose-600 dark:text-rose-400">
                  <Swords className="w-2.5 h-2.5" />
                  {skill.power}
                </span>
            )}
            {skill.damage_kind && (
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{skill.damage_kind}</span>
            )}
            {skill.skill_type && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-400">
                  {skillTypeIcon(skill.skill_type)}
                  {skill.skill_type}
                </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5 line-clamp-2">
            {skill.desc || '暂无描述'}
          </p>
        </div>
      </div>
  );
}

export const PetSkillPanel: React.FC<PetSkillPanelProps> = ({ pet, className = '', compact = false }) => {
  const specialType = getPetSpecialType(pet);
  const displayName = formatPetName(pet.name);
  const hasData = pet.trait?.name || (pet.skills && pet.skills.length > 0);

  return (
      <div className={`bg-white dark:bg-slate-900 rounded-2xl border-2 border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden ${className}`}>
        <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-[#F5F9FF] dark:bg-slate-800/80">
          <div className="w-7 h-7 rounded-lg bg-[#2B78C4] text-white flex items-center justify-center shrink-0">
            <Atom className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-slate-800 dark:text-slate-100 truncate">
              {displayName}
            </div>
            <div className="flex items-center gap-1.5">
              {specialType && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-600 dark:text-amber-300">
                    {specialType === 'boss' ? <Crown className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
                    {specialType === 'boss' ? '首领化' : '多形态'}
                  </span>
              )}
              {pet.trait?.name && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 dark:text-emerald-400">
                    <Sparkles className="w-3 h-3" />
                    特性 · {pet.trait.name}
                  </span>
              )}
            </div>
          </div>
        </div>

        <div className={`p-2.5 space-y-1.5 overflow-y-auto ${compact ? 'max-h-60' : 'max-h-72'}`}>
          {!hasData && (
              <div className="text-center text-xs text-slate-400 py-4">该精灵暂无可展示的技能数据</div>
          )}
          {pet.trait?.desc && (
              <div className="px-2.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/50 text-[11px] text-emerald-800 dark:text-emerald-300 leading-snug">
                <span className="font-black">特性 · {pet.trait.name}：</span>
                {pet.trait.desc}
              </div>
          )}
          {(pet.skills || []).map((skill) => (
              <React.Fragment key={skill.sid + skill.name}>
                <SkillRow skill={skill} />
              </React.Fragment>
          ))}
        </div>
      </div>
  );
};
