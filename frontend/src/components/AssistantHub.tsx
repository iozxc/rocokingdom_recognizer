import React from 'react';
import { Flame, Leaf } from 'lucide-react';
import { Trial } from '../types';

interface AssistantHubProps {
  trials: Trial[];
  onSelectAssistant: (trialKey: string) => void;
}

const TRIAL_CARD_CONFIG: Record<string, {
  title: string;
  subtitle: string;
  image?: string;
  gradient: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  grass: {
    title: '草系徽章试炼',
    subtitle: '洛克王国草系徽章识别助手',
    image: './tag_1.png',
    gradient: 'from-[#7ABCF4] to-[#2B78C4]',
    Icon: Leaf,
  },
  fire: {
    title: '火系徽章试炼',
    subtitle: '洛克王国火系徽章自选图鉴（开发环境）',
    gradient: 'from-orange-500 to-red-600',
    Icon: Flame,
  },
};

export const AssistantHub: React.FC<AssistantHubProps> = ({ trials, onSelectAssistant }) => {
  const assistants = trials
      .filter((trial) => TRIAL_CARD_CONFIG[trial.key])
      .map((trial) => ({
        key: trial.key,
        ...TRIAL_CARD_CONFIG[trial.key],
      }));

  return (
      <main className="flex-1 w-full mx-auto px-8 sm:px-16 pt-12 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
          {assistants.map((a) => {
            const Icon = a.Icon;
            return (
              <button
                  key={a.key}
                  type="button"
                  onClick={() => onSelectAssistant(a.key)}
                  className="group relative overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm hover:border-[#7ABCF4] hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 cursor-pointer text-left"
                  title="点击进入"
              >
                <div className={`relative w-full aspect-[16/10] bg-gradient-to-br ${a.gradient} flex items-center justify-center`}>
                  <Icon className="w-10 h-10 text-white/70" />
                  {a.image && (
                      <img
                          src={a.image}
                          alt={a.title}
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                      />
                  )}
                  {a.key === 'fire' && (
                      <span className="absolute top-2 right-2 text-[10px] font-black text-white bg-white/25 border border-white/40 px-2 py-0.5 rounded-full">
                        DEV
                      </span>
                  )}
                </div>
                <div className="p-3.5">
                  <div className="text-sm font-black text-slate-800">{a.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{a.subtitle}</div>
                </div>
              </button>
            );
          })}
        </div>
      </main>
  );
};
