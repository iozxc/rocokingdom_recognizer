import React from 'react';
import { getGlossaryTerm, GlossaryTerm } from '../services/glossary';

/**
 * 根据术语名稳定生成「既不偏深也不偏淡、清晰可读」的强调色。
 * 返回明暗两套（浅色主题用深一档，深色主题用亮一档），由 CSS .dark 自动切换。
 */
function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function termColors(name: string): { light: string; dark: string } {
  const hue = hashString(name) % 360;
  return {
    light: `hsl(${hue}, 70%, 50%)`,
    dark: `hsl(${hue}, 85%, 72%)`,
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
}

/**
 * 把文本中命中的术语词渲染为「下划线 + 按术语名生成的颜色」。
 * 用于搜索下拉候选等紧凑场景，展示术语而不占用徽章空间。
 */
export const TermHighlightText: React.FC<TermHighlightTextProps> = ({ text = '', ids, className = '' }) => {
  const matches = React.useMemo(() => computeMatches(text, ids), [text, ids]);
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
  return <span className={className}>{nodes}</span>;
};
