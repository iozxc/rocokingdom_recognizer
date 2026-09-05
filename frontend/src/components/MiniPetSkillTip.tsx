import React from 'react';
import { Sparkles } from 'lucide-react';
import { PetItem } from '../types';
import { formatPetName } from '../utils/petHelper';
import { TsIcon } from './TsIcon';

export const MiniPetSkillTip: React.FC<{ pet: PetItem }> = ({ pet }) => {
  if (!pet.trait?.name && !(pet.skills && pet.skills.length > 0)) return null;
  return (
      <div className="w-[210px] max-h-[280px] overflow-y-auto rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-2xl p-2">
        {pet.trait?.name && (
            <div className="flex items-center gap-1.5 pb-1.5 mb-1.5 border-b border-slate-100 dark:border-slate-800">
              {pet.trait.icon_url ? (
                  <TsIcon url={pet.trait.icon_url} alt={pet.trait.name} className="w-6 h-6 rounded" />
              ) : (
                  <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-[11px] font-black text-amber-700 dark:text-amber-300 truncate">
                  特性 · {pet.trait.name}
                </div>
              </div>
            </div>
        )}
        <div className="space-y-1">
          {(pet.skills || []).map((s) => (
              <div key={s.sid + s.name} className="flex items-center gap-1.5 min-w-0">
                {s.icon_url ? (
                    <TsIcon url={s.icon_url} alt={s.name} className="w-5 h-5 rounded shrink-0" />
                ) : (
                    <span className="w-5 h-5 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[9px] font-black text-slate-500 shrink-0">
                      {s.element?.[0] || '技'}
                    </span>
                )}
                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">{s.name}</span>
                <span className="ml-auto text-[9px] font-mono text-slate-400 shrink-0">
                  ★{s.energy_cost ?? '-'}
                  {s.power != null && s.power > 0 ? ` ${s.power}` : ''}
                </span>
              </div>
          ))}
        </div>
        {!pet.skills?.length && (
            <div className="text-center text-[10px] text-slate-400 py-1">暂无技能数据</div>
        )}
      </div>
  );
};
