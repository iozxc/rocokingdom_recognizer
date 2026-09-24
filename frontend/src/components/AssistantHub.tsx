import React from 'react';
import { BellRing, ChevronRight, Flame, Leaf, QrCode, Sparkles, Wrench } from 'lucide-react';
import { IS_STATIC } from '../services/staticMode';
import { Trial } from '../types';

interface AssistantHubProps {
  trials: Trial[];
  onSelectAssistant: (trialKey: string) => void;
}

interface TrialItem {
  key: string;
  title: string;
  subtitle: string;
  image?: string;
  gradient: string;
  Icon: React.ComponentType<{ className?: string }>;
  devOnly?: boolean;
}

interface ToolItem {
  key: string;
  title: string;
  subtitle: string;
  image: string;
  gradient: string;
  Icon: React.ComponentType<{ className?: string }>;
  tags: string[];
}

const WECHAT_TOOL_CARD: ToolItem = {
  key: 'merchant',
  title: '远行商人提醒',
  subtitle: '微信小程序独立使用，点一次增加一次提醒',
  image: './assets/merchant-avatar.png',
  gradient: 'from-[#6CC8F5] via-[#3D9BE8] to-[#1D5EAF]',
  Icon: BellRing,
  tags: ['点一次 +1 次', '微信服务通知'],
};

const TRIAL_CARD_CONFIG: Record<string, TrialItem> = {
  grass: {
    key: 'grass',
    title: '草系徽章试炼',
    subtitle: '洛克王国草系徽章识别助手',
    image: './tag_1.png',
    gradient: 'from-[#7ABCF4] to-[#2B78C4]',
    Icon: Leaf,
  },
  fire: {
    key: 'fire',
    title: '火系徽章试炼',
    subtitle: '洛克王国火系徽章自选图鉴（开发环境）',
    gradient: 'from-orange-500 to-red-600',
    Icon: Flame,
  },
};

export const AssistantHub: React.FC<AssistantHubProps> = ({ trials, onSelectAssistant }) => {
  const trialAssistants = trials
    .filter((trial) => TRIAL_CARD_CONFIG[trial.key])
    .map((trial) => ({ ...TRIAL_CARD_CONFIG[trial.key], devOnly: trial.dev_only }));

  // 静态网页版没有本机后端，不展示依赖桌面端签名的微信小程序入口。
  const toolAssistants = IS_STATIC ? [] : [WECHAT_TOOL_CARD];

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto px-1 sm:px-6 lg:px-12 pt-2 sm:pt-6 pb-12 flex flex-col gap-6 sm:gap-10">
      {/* 试炼助手 分类 */}
      {trialAssistants.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-sky-100 dark:bg-sky-950/80 text-sky-600 dark:text-sky-400">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-base font-black text-slate-700 dark:text-slate-200 tracking-wide">试炼助手</h2>
            <span className="text-xs font-bold text-slate-400">({trialAssistants.length})</span>
          </div>
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 gap-3.5 sm:gap-5">
            {trialAssistants.map((a) => {
              const Icon = a.Icon;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => onSelectAssistant(a.key)}
                  className="group relative overflow-hidden rounded-2xl border-2 border-[#E6EEF8] dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xs hover:border-[#7ABCF4] dark:hover:border-sky-500 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 cursor-pointer text-left"
                  title="点击进入"
                >
                  <div className={`relative w-full aspect-square bg-gradient-to-br ${a.gradient} flex items-center justify-center border-b border-[#EDF3FA] dark:border-slate-700/60`}>
                    <span className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.28),transparent_38%)]" />
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
                  <div className="p-3 sm:p-3.5">
                    <div className="text-sm font-black text-slate-800 dark:text-slate-100">{a.title}</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-400 mt-0.5">{a.subtitle}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 实用工具 分类：使用紧凑横向卡片，避免和试炼大卡片混淆 */}
      {toolAssistants.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
              <Wrench className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-base font-black text-slate-700 dark:text-slate-200 tracking-wide">实用工具</h2>
            <span className="text-xs font-bold text-slate-400">({toolAssistants.length})</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {toolAssistants.map((a) => {
              const Icon = a.Icon;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => onSelectAssistant(a.key)}
                  className="group flex w-full max-w-2xl items-center gap-4 rounded-2xl bg-white dark:bg-slate-800 px-4 py-3.5 text-left ring-1 ring-slate-900/5 dark:ring-slate-700/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,0.35)] hover:ring-sky-200/70 dark:hover:ring-sky-500/50 hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-200 cursor-pointer"
                  title="打开微信小程序入口"
                >
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                    <Icon className="absolute h-6 w-6 text-sky-500" style={{ display: 'none' }} />
                    <img
                      src={a.image}
                      alt={a.title}
                      className="relative h-14 w-14 object-contain"
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement;
                        const fallback = img.previousElementSibling as HTMLElement | null;
                        img.style.display = 'none';
                        if (fallback) fallback.style.display = 'block';
                      }}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-slate-800 dark:text-slate-100">{a.title}</span>
                      <span className="rounded-full bg-[#EAF4FF] px-2 py-0.5 text-[10px] font-black text-[#2B78C4] dark:bg-sky-950/60 dark:text-sky-300">
                        微信小程序
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-slate-400">{a.subtitle}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {a.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-700/70 dark:text-slate-300">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="hidden items-center gap-1 text-[#2B78C4] dark:text-sky-300 sm:flex">
                    <QrCode className="h-5 w-5" />
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
