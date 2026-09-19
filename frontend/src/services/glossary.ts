import { fetchJson } from './secureFetch';
import { dataUrl } from './assetUrl';

export interface GlossaryTerm {
  id: string;
  name: string;
  desc: string;
}

let glossaryMap: Record<string, GlossaryTerm> | null = null;
let glossaryPromise: Promise<Record<string, GlossaryTerm>> | null = null;

/** 加载术语表（data/glossary.json），结果缓存，多个调用共享同一次请求。 */
export function loadGlossary(): Promise<Record<string, GlossaryTerm>> {
  if (!glossaryPromise) {
    glossaryPromise = fetchJson<GlossaryTerm[]>(dataUrl('data/glossary.json'), 10000)
        .then((list) => {
          glossaryMap = {};
          list.forEach((term) => {
            if (term && term.id) glossaryMap[term.id] = term;
          });
          return glossaryMap;
        })
        .catch(() => (glossaryMap = {}));
  }
  return glossaryPromise;
}

/** 同步读取某个术语；未加载或不存在返回 null。 */
export function getGlossaryTerm(id?: string): GlossaryTerm | null {
  return id ? (glossaryMap?.[id] || null) : null;
}
