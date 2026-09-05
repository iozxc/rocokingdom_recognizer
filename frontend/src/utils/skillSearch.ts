import { PetItem } from '../types';
import { resolvePetSkillsAndTrait } from '../data/petSkillMock';

/**
 * 首页搜索模式：
 * - 'name'  默认：按精灵名 / 图鉴 id 搜索；
 * - 'skill' 激活后：按技能名 / 技能描述 / 特性名 / 特性描述搜索。
 */
export type PetSearchMode = 'name' | 'skill';

export interface SkillSuggestion {
  kind: 'skill' | 'trait';
  name: string;
  desc: string;
  /** 当前关卡中拥有该技能/特性的精灵数量。 */
  petCount: number;
}

function pushCatalogEntry(
    map: Map<string, SkillSuggestion>,
    kind: 'skill' | 'trait',
    name: string,
    desc: string
): void {
  const key = `${kind}:${name}`;
  const prev = map.get(key);
  if (prev) {
    prev.petCount += 1;
    // 同一名称可能出现描述略不同的条目，展示时保留更完整的描述。
    if ((desc || '').length > (prev.desc || '').length) {
      prev.desc = desc || '';
    }
  } else {
    map.set(key, { kind, name, desc: desc || '', petCount: 1 });
  }
}

/**
 * 汇总某个精灵列表内「可被搜索」的全部技能与特性（去重并统计拥有数量），
 * 口径与精灵技能面板 resolvePetSkillsAndTrait 完全一致，
 * 保证下拉提示与 petgrid 卡片过滤结果一致。
 */
export function buildSkillCatalog(pets: PetItem[]): SkillSuggestion[] {
  const map = new Map<string, SkillSuggestion>();
  for (const pet of pets) {
    const { trait, skills } = resolvePetSkillsAndTrait(pet);
    if (trait?.name) {
      pushCatalogEntry(map, 'trait', trait.name, trait.desc || '');
    }
    for (const skill of skills) {
      if (skill?.name) {
        pushCatalogEntry(map, 'skill', skill.name, skill.desc || '');
      }
    }
  }
  const entries = Array.from(map.values());
  entries.sort((a, b) => {
    if (a.name === b.name) {
      // 同名时技能优先于特性，保持顺序稳定
      return a.kind === b.kind ? 0 : a.kind === 'skill' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'zh');
  });
  return entries;
}

/** 按关键词过滤技能目录：命中名称或描述均算（不区分大小写）。 */
export function filterSkillCatalog(catalog: SkillSuggestion[], query: string): SkillSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return catalog;
  return catalog.filter(
      (it) => it.name.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q)
  );
}

/**
 * 判断一只精灵是否拥有命中关键词的技能/特性。
 * 命中范围：技能名 / 技能描述 / 特性名 / 特性描述。
 */
export function petMatchesSkillQuery(pet: PetItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const { trait, skills } = resolvePetSkillsAndTrait(pet);
  if (trait?.name) {
    if (trait.name.toLowerCase().includes(q) || (trait.desc || '').toLowerCase().includes(q)) {
      return true;
    }
  }
  return skills.some(
      (s) => s.name.toLowerCase().includes(q) || (s.desc || '').toLowerCase().includes(q)
  );
}
