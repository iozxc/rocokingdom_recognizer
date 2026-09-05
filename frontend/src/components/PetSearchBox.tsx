import React, { useState, useMemo, useRef } from 'react';
import { Search, Sparkles, X, Wand2 } from 'lucide-react';
import { PetItem } from '../types';
import { sound } from '../services/sound';
import { PetSearchMode, buildSkillCatalog, filterSkillCatalog } from '../utils/skillSearch';
import { TermHighlightText } from './TermHighlightText';

interface PetSearchBoxProps {
  /** 当前关卡精灵列表，用于技能/特性搜索时生成全部可能的候选提示。 */
  pets: PetItem[];
  searchQuery: string;
  searchMode: PetSearchMode;
  onSearchChange: (query: string) => void;
  onSearchModeChange: (mode: PetSearchMode) => void;
  /** 外层容器 className（默认在 StatsBanner 里的定位/宽度；悬浮栏等场景可覆盖）。 */
  containerClassName?: string;
  /** 输入框 DOM id（同一页面可能出现多个搜索框，避免 id 冲突）。 */
  inputId?: string;
}

/**
 * 精灵名 / 技能·特性 搜索框（含激活按钮与技能/特性候选下拉）。
 * 首页 StatsBanner 与「下滑后固定在 header 下方的悬浮搜索栏」共用同一份状态与样式。
 */
export const PetSearchBox: React.FC<PetSearchBoxProps> = ({
  pets,
  searchQuery,
  searchMode,
  onSearchChange,
  onSearchModeChange,
  containerClassName = 'relative flex-1 md:w-88 lg:w-112',
  inputId = 'search-pet-input',
}) => {
  const isDefaultId = inputId === 'search-pet-input';
  const toggleBtnId = isDefaultId ? 'skill-search-toggle-btn' : `${inputId}-toggle-btn`;
  const clearBtnId = isDefaultId ? 'clear-search-btn' : `${inputId}-clear-btn`;

  const [isSkillOpen, setIsSkillOpen] = useState<boolean>(false);
  const skillInputRef = useRef<HTMLInputElement>(null);
  const skillCatalog = useMemo(() => buildSkillCatalog(pets), [pets]);
  const skillSuggestions = useMemo(
      () => filterSkillCatalog(skillCatalog, searchQuery),
      [skillCatalog, searchQuery]
  );

  const handleToggleSearchMode = () => {
    sound.playClick();
    const next: PetSearchMode = searchMode === 'skill' ? 'name' : 'skill';
    onSearchModeChange(next);
    setIsSkillOpen(next === 'skill');
    // 激活后聚焦输入框：失焦时下拉可自然收起
    if (next === 'skill') {
      skillInputRef.current?.focus();
    }
  };

  const handlePickSkill = (name: string) => {
    sound.playClick();
    onSearchChange(name);
    setIsSkillOpen(false);
  };

  return (
      <div className={containerClassName}>
        {searchMode === 'skill' ? (
            <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        ) : (
            <Search className="w-4 h-4 text-[#7ABCF4] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
        <input
            ref={skillInputRef}
            type="text"
            id={inputId}
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              if (searchMode === 'skill') setIsSkillOpen(true);
            }}
            onFocus={() => {
              if (searchMode === 'skill') setIsSkillOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => setIsSkillOpen(false), 150);
            }}
            placeholder={searchMode === 'skill' ? '搜索技能/特性（名称或描述）...' : '搜索精灵名、图鉴id...'}
            className={`w-full pl-10 ${searchQuery ? 'pr-14' : 'pr-10'} py-2 text-xs sm:text-sm rounded-xl shadow-2xs focus:shadow-xs outline-hidden transition-all font-medium ${
                searchMode === 'skill'
                    ? 'bg-violet-50/70 dark:bg-slate-800 border border-violet-400/70 dark:border-violet-500/60 focus:border-violet-500 dark:focus:border-violet-400 text-slate-800 dark:text-slate-100 placeholder:text-violet-500/70 dark:placeholder:text-violet-300/70'
                    : 'bg-white dark:bg-slate-800 border border-[#7ABCF4]/60 dark:border-slate-700 focus:border-[#7ABCF4] dark:focus:border-sky-400 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500'
            }`}
        />
        {/* 技能/特性搜索激活按钮（默认关闭，点击后在输入框内切换搜索技能/特性） */}
        <button
            type="button"
            id={toggleBtnId}
            aria-pressed={searchMode === 'skill'}
            onClick={handleToggleSearchMode}
            title={
              searchMode === 'skill'
                  ? '当前为技能/特性搜索，点击切回精灵名/图鉴id搜索'
                  : '开启技能/特性搜索（可搜技能名、技能描述、特性名、特性描述）'
            }
            className={`absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
                searchMode === 'skill'
                    ? 'bg-violet-500/15 dark:bg-violet-500/25 border-violet-400/60 dark:border-violet-500/50 text-violet-600 dark:text-violet-300'
                    : 'bg-transparent border-transparent text-slate-400 hover:text-violet-500 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:border-violet-200 dark:hover:border-violet-500/30'
            }`}
        >
          <Wand2 className="w-3.5 h-3.5" />
        </button>
        {searchQuery && (
            <button
                type="button"
                id={clearBtnId}
                onClick={() => {
                  sound.playClick();
                  onSearchChange('');
                }}
                className="absolute right-9 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-200/80 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
                title="清空输入内容"
            >
              <X className="w-3.5 h-3.5" />
            </button>
        )}

        {/* 技能/特性候选：列出当前关卡全部可能的技能与特性，输入时实时过滤 */}
        {searchMode === 'skill' && isSkillOpen && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-white dark:bg-slate-800/95 backdrop-blur-md border border-violet-200 dark:border-violet-500/30 rounded-xl shadow-lg overflow-hidden">
              <div className="max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-600">
                {skillSuggestions.length === 0 ? (
                    <div className="px-3 py-5 text-center text-xs text-slate-400">
                      未找到匹配的技能/特性，试试搜技能名、特性名或其描述关键词
                    </div>
                ) : (
                    skillSuggestions.map((item) => (
                        <button
                            key={`${item.kind}:${item.name}`}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handlePickSkill(item.name);
                            }}
                            className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors cursor-pointer border-b border-slate-100 dark:border-slate-700/60 last:border-b-0"
                        >
                          <span
                              className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-md border ${
                                  item.kind === 'skill'
                                      ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300 border-sky-300/60 dark:border-sky-500/40'
                                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-300/60 dark:border-amber-500/40'
                              }`}
                          >
                            {item.kind === 'skill' ? '技能' : '特性'}
                          </span>
                          <span className="min-w-0 flex-1">
                            <TermHighlightText
                                text={item.name}
                                ids={item.termIds}
                                className="block text-xs font-black text-slate-700 dark:text-slate-200 truncate"
                            />
                            {item.desc && (
                                <TermHighlightText
                                    text={item.desc}
                                    ids={item.termIds}
                                    className="block text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5"
                                />
                            )}
                          </span>
                          <span className="shrink-0 text-[10px] font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap">
                            {item.petCount}只
                          </span>
                        </button>
                    ))
                )}
              </div>
              <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-700/60 text-[10px] text-slate-400 dark:text-slate-500 flex items-center justify-between gap-2">
                <span>共 {skillSuggestions.length} 项技能/特性</span>
                <span>点击填入精确技能名</span>
              </div>
            </div>
        )}
      </div>
  );
};
