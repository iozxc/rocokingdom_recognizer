import React from 'react';
import { Flame, Leaf, Map as MapIcon, Sparkles, Wrench } from 'lucide-react';
import { Trial } from '../types';

interface AssistantHubProps {
  trials: Trial[];
  onSelectAssistant: (trialKey: string) => void;
}

interface AssistantItem {
  key: string;
  category: 'trial' | 'tool';
  title: string;
  subtitle: string;
  image?: string;
  gradient: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const TRIAL_CARD_CONFIG: Record<string, AssistantItem> = {
  grass: {
    key: 'grass',
    category: 'trial',
    title: '草系徽章试炼',
    subtitle: '洛克王国草系徽章识别助手',
    image: './tag_1.png',
    gradient: 'from-[#7ABCF4] to-[#2B78C4]',
    Icon: Leaf,
  },
  fire: {
    key: 'fire',
    category: 'trial',
    title: '火系徽章试炼',
    subtitle: '洛克王国火系徽章自选图鉴（开发环境）',
    gradient: 'from-orange-500 to-red-600',
    Icon: Flame,
  },
  map: {
    key: 'map',
    category: 'tool',
    title: '地图感知',
    subtitle: '世界实时地图 · 位置 / 朝向 / 周边刷新',
    gradient: 'from-sky-500 to-indigo-600',
    Icon: MapIcon,
  },
};

export const AssistantHub: React.FC<AssistantHubProps> = ({ trials, onSelectAssistant }) => {
  const assistants = trials
    .filter((trial) => TRIAL_CARD_CONFIG[trial.key])
    .map((trial) => ({
      ...TRIAL_CARD_CONFIG[trial.key],
      devOnly: trial.dev_only,
    }));

  const trialAssistants = assistants.filter((a) => a.category === 'trial');
  const toolAssistants = assistants.filter((a) => a.category === 'tool');

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-6 sm:px-12 pt-8 pb-12 flex flex-col gap-10">
      {/* 试炼助手 分类 */}
      {trialAssistants.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4 px-1">
            <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-sky-100 text-sky-600">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-base font-black text-slate-700 tracking-wide">试炼助手</h2>
            <span className="text-xs font-bold text-slate-400">({trialAssistants.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
            {trialAssistants.map((a) => {
              const Icon = a.Icon;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => onSelectAssistant(a.key)}
                  className="group relative overflow-hidden rounded-2xl border-2 border-[#E6EEF8] bg-white shadow-xs hover:border-[#7ABCF4] hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 cursor-pointer text-left"
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
                    {a.devOnly && (
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
        </section>
      )}

      {/* 实用工具 分类 */}
      {toolAssistants.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4 px-1">
            <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600">
              <Wrench className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-base font-black text-slate-700 tracking-wide">实用工具</h2>
            <span className="text-xs font-bold text-slate-400">({toolAssistants.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
            {toolAssistants.map((a) => {
              const Icon = a.Icon;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => onSelectAssistant(a.key)}
                  className="group relative overflow-hidden rounded-2xl border-2 border-[#E6EEF8] bg-white shadow-xs hover:border-[#7ABCF4] hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 cursor-pointer text-left"
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
                    {a.devOnly && (
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
        </section>
      )}
    </main>
  );
};
