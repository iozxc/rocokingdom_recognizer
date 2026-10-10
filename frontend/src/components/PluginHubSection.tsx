import React from 'react';
import { ChevronRight, Puzzle, Sparkles } from 'lucide-react';
import { PluginInfo } from '../services/pluginApi';
import { pluginIconOf } from './plugins/pluginIcon';
import { sound } from '../services/sound';

interface PluginHubSectionProps {
  plugins: PluginInfo[];
  onOpenCenter: () => void;
  onOpenPlugin?: (plugin: PluginInfo) => void;
}

/**
 * 首页「插件中心」分区：展示已启用的插件（参考「实用工具」卡片风格）。
 * 未启用 / 未安装任何插件时，提供一个进入插件中心的入口卡片。
 */
export const PluginHubSection: React.FC<PluginHubSectionProps> = ({ plugins, onOpenCenter, onOpenPlugin }) => {
  const enabled = plugins.filter((p) => p.enabled);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-violet-100 dark:bg-violet-950/80 text-violet-600 dark:text-violet-400">
          <Puzzle className="w-3.5 h-3.5" />
        </div>
        <h2 className="text-base font-black text-slate-700 dark:text-slate-200 tracking-wide">插件中心</h2>
        <span className="text-xs font-bold text-slate-400">({enabled.length})</span>
        <button
          type="button"
          onClick={() => { sound.playClick(); onOpenCenter(); }}
          className="ml-auto text-[11px] font-bold text-violet-500 hover:text-violet-600 dark:text-violet-300 flex items-center gap-0.5 cursor-pointer"
        >
          管理插件 <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {enabled.length === 0 ? (
        <button
          type="button"
          onClick={() => { sound.playClick(); onOpenCenter(); }}
          className="group flex w-full max-w-2xl items-center gap-4 rounded-2xl bg-white dark:bg-slate-800 px-4 py-3.5 text-left ring-1 ring-slate-900/5 dark:ring-slate-700/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,0.35)] hover:ring-violet-200/70 dark:hover:ring-violet-500/50 hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-200 cursor-pointer"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950/60 text-violet-500">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-slate-800 dark:text-slate-100">还没有启用任何插件</div>
            <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
              打开插件中心导入插件 zip，例如「抓包核心服务」可显示背包精灵与用户信息。
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-violet-400 transition-transform group-hover:translate-x-0.5" />
        </button>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 sm:gap-5">
          {enabled.map((plugin) => (
            <button
              key={plugin.id}
              type="button"
              onClick={() => {
                sound.playClick();
                if (onOpenPlugin) onOpenPlugin(plugin);
                else onOpenCenter();
              }}
              /* 插件没有配图，所以不套「大图 + 标题」的图卡模板（那块占位图很丑），
                 改成和「实用工具」一致的横向信息卡：语义图标 + 标题/副标题 + 箭头。 */
              className="group flex w-full items-center gap-3.5 rounded-2xl bg-white dark:bg-slate-800 px-4 py-3.5 text-left ring-1 ring-slate-900/5 dark:ring-slate-700/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,0.35)] hover:ring-violet-200/70 dark:hover:ring-violet-500/50 hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-200 cursor-pointer"
              title={plugin.description}
            >
              {/* 图标：不再用单色线框，改成插件自己的主题色渐变底 + 白色图标（更有颜色） */}
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ring-1 ring-inset ring-white/25"
                style={{ background: `linear-gradient(140deg, ${plugin.accent || '#7abcf4'} 0%, #2B78C4 100%)` }}
              >
                {(() => { const Icon = pluginIconOf(plugin); return <Icon className="h-5 w-5" />; })()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-black text-slate-800 dark:text-slate-100 truncate">{plugin.title}</span>
                  <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500">v{plugin.version}</span>
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-slate-400 line-clamp-2">
                  {plugin.subtitle || plugin.description}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-violet-400 transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
