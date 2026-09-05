import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { getGlossaryTerm, GlossaryTerm } from '../services/glossary';

/**
 * 术语语义色相表（0-360）：按中文语义人工整理，不使用随机/哈希色相。
 * 例如：中毒→紫（嘴唇发紫）、雨天→蓝、冻结/暴风雪→冰蓝。
 * 新增术语时请在此补充对应的语义色相；未收录术语用 DEFAULT_TERM_HUE 中性蓝兜底。
 */
const TERM_HUE_BY_NAME: Record<string, number> = {
  // 中毒：紫色（中毒嘴唇发紫）
  中毒: 280,
  中毒印记: 280,
  中毒效果: 280,
  附加中毒: 280,
  // 灼烧 / 火
  灼烧: 18,
  // 冻结 / 冰雪：淡冰蓝
  冻结: 200,
  暴风雪: 200,
  减速印记: 208,
  // 雨天 / 水
  雨天: 220,
  湿润印记: 205,
  暗涌印记: 235,
  // 寄生 / 植物
  寄生: 100,
  光合印记: 135,
  棘刺印记: 110,
  萌芽印记: 100,
  // 萌化 / 治愈系
  萌化: 330,
  吸血: 345,
  混血精灵: 315,
  巧变: 315,
  // 雷 / 电
  蓄电印记: 50,
  引电: 230,
  雷鸣: 55,
  // 蓄力 / 蓄势
  蓄力: 45,
  蓄势印记: 38,
  // 速度 / 先手
  迅捷: 170,
  先手: 165,
  风起印记: 172,
  // 攻击类
  攻击印记: 5,
  打断: 0,
  连击数: 25,
  迸发: 25,
  应对攻击: 265,
  // 防御 / 护盾
  应对防御: 265,
  传动: 190,
  // 增益 / 正面
  增益: 48,
  属性增益: 48,
  奉献: 48,
  // 减益 / 负面
  减益: 255,
  属性减益: 252,
  降灵印记: 268,
  星陨印记: 255,
  龙噬印记: 340,
  印记: 245,
  应对状态: 265,
  // 沙 / 土
  沙暴: 55,
  // 脱离 / 离场 / 返场 / 禁足
  脱离: 215,
  紧急脱离: 215,
  离场: 225,
  返场: 210,
  禁足: 218,
  选择: 230,
};

/** 未在语义表里的新术语，统一使用中性天蓝，避免随机颜色。 */
const DEFAULT_TERM_HUE = 210;

/** 少量按语义微调明暗/饱和的术语（如冰蓝要更淡一些）。 */
const TERM_TUNE: Record<string, { sl: number; ll: number; sd: number; ld: number }> = {
  冻结: { sl: 62, ll: 54, sd: 78, ld: 70 },
  暴风雪: { sl: 62, ll: 54, sd: 78, ld: 70 },
};

function hslColor(hue: number, sat: number, light: number): string {
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function termColors(name: string): { light: string; dark: string } {
  const hue = TERM_HUE_BY_NAME[name] ?? DEFAULT_TERM_HUE;
  const tune = TERM_TUNE[name];
  return {
    light: tune
        ? hslColor(hue, tune.sl, tune.ll)
        : hslColor(hue, 70, 50),
    dark: tune
        ? hslColor(hue, tune.sd, tune.ld)
        : hslColor(hue, 85, 72),
  };
}

interface TermMatch {
  start: number;
  end: number;
  term: GlossaryTerm;
}

function computeMatches(text: string, ids: string[] | undefined): TermMatch[] {
  if (!text || !ids || ids.length === 0) return [];
  const terms = ids
      .map((id) => getGlossaryTerm(id))
      .filter((term): term is GlossaryTerm => !!term && !!term.name && text.includes(term.name));
  terms.sort((a, b) => b.name.length - a.name.length);

  const picked: TermMatch[] = [];
  for (const term of terms) {
    let from = 0;
    while (true) {
      const at = text.indexOf(term.name, from);
      if (at < 0) break;
      const end = at + term.name.length;
      // 避免重叠命中（长术语优先）
      if (!picked.some((p) => at < p.end && end > p.start)) {
        picked.push({ start: at, end, term });
        picked.sort((a, b) => a.start - b.start);
      }
      from = at + 1;
    }
  }
  return picked;
}

interface TermHighlightTextProps {
  text?: string;
  /** 术语 id 列表（对应 glossary.json）。 */
  ids?: string[];
  className?: string;
  /** 完整详情中开启悬浮解释弹层；紧凑/下拉场景无需开启（保留原生 title）。 */
  interactive?: boolean;
}

/**
 * 统一的术语渲染组件：把文本中命中的术语词标成「下划线 + 按术语名生成的颜色」。
 * 应用范围：技能/特性面板描述、悬浮技能提示、搜索下拉候选等所有展示术语的文本。
 */
export const TermHighlightText: React.FC<TermHighlightTextProps> = ({
  text = '',
  ids,
  className = '',
  interactive = false,
}) => {
  const matches = React.useMemo(() => computeMatches(text, ids), [text, ids]);
  const [popup, setPopup] = useState<{ x: number; y: number; term: GlossaryTerm } | null>(null);

  if (matches.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const nodes: React.ReactNode[] = [];
  let pos = 0;
  matches.forEach((match, index) => {
    if (match.start > pos) {
      nodes.push(text.slice(pos, match.start));
    }
    const colors = termColors(match.term.name);
    nodes.push(
        <span
            key={`${match.term.id}-${index}`}
            className="term-text-hl"
            title={`${match.term.name}：${match.term.desc}`}
            onMouseEnter={(e) => {
              if (!interactive) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const width = 250;
              const height = 170;
              const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
              const below = rect.bottom + 8;
              const top = below + height > window.innerHeight && rect.top - height - 8 > 0
                  ? rect.top - height - 8
                  : below;
              setPopup({ x: left, y: top, term: match.term });
            }}
            onMouseLeave={() => {
              if (interactive) setPopup(null);
            }}
            style={
              {
                '--term-color': colors.light,
                '--term-color-dark': colors.dark,
              } as React.CSSProperties
            }
        >
          {text.slice(match.start, match.end)}
        </span>
    );
    pos = match.end;
  });
  if (pos < text.length) {
    nodes.push(text.slice(pos));
  }

  return (
      <>
        <span className={className}>{nodes}</span>
        {interactive && popup && createPortal(
            <div
                role="tooltip"
                className="fixed z-[220] w-[250px] pointer-events-none select-none animate-in fade-in zoom-in-95 duration-100"
                style={{ left: popup.x, top: popup.y }}
            >
              <div className="overflow-hidden rounded-xl border-2 border-amber-300/80 dark:border-amber-500/40 bg-[#FFFDF2] dark:bg-[#2a2438] shadow-[0_14px_30px_-10px_rgba(146,92,20,0.45)] dark:shadow-[0_14px_30px_-8px_rgba(0,0,0,0.6)]">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gradient-to-r from-amber-200/80 via-yellow-100/70 to-sky-100/70 dark:from-amber-500/25 dark:via-yellow-500/10 dark:to-sky-500/20 border-b-2 border-amber-200/90 dark:border-amber-400/20">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 shrink-0" />
                  <span className="text-xs font-black text-amber-900 dark:text-amber-200 truncate">
                    {popup.term.name}
                  </span>
                  <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-white/10 text-amber-700 dark:text-amber-300/90 border border-amber-300/70 dark:border-amber-300/20 shrink-0">
                    术语
                  </span>
                </div>
                <p className="px-2.5 py-2 text-[11px] leading-relaxed font-medium text-slate-600 dark:text-slate-200">
                  {popup.term.desc}
                </p>
              </div>
            </div>,
            document.body,
        )}
      </>
  );
};
