import axios from 'axios';

type SpriteMetaMap = Record<string, { cols: number; rows: number }>;
type ElementSpriteMap = Record<string, { sprite: string; col: number; row: number }>;

let sMeta: SpriteMetaMap | null = null;
let sMetaPromise: Promise<SpriteMetaMap> | null = null;
let eMeta: ElementSpriteMap | null = null;
let eMetaPromise: Promise<ElementSpriteMap> | null = null;

/** 加载雪碧图元信息（每张的 cols/rows），结果缓存，多个调用共享同一次请求。 */
export function loadSpriteMeta(): Promise<SpriteMetaMap> {
  if (!sMetaPromise) {
    sMetaPromise = axios
        .get(`${import.meta.env.BASE_URL}data/sprites.json`, { timeout: 10000 })
        .then((r) => (sMeta = (r.data as SpriteMetaMap) || {}))
        .catch(() => (sMeta = {}));
  }
  return sMetaPromise;
}

/** 同步读取某张雪碧图的格数；未加载/不存在返回 null。 */
export function getSpriteMeta(name: string): { cols: number; rows: number } | null {
  return sMeta?.[name] || null;
}

/** 雪碧图完整 URL。 */
export function getSpriteUrl(name: string): string {
  return `${import.meta.env.BASE_URL}icons/${name}`;
}

/** 加载 18 系别属性图在雪碧图上的坐标，结果缓存。 */
export function loadElementSprites(): Promise<ElementSpriteMap> {
  if (!eMetaPromise) {
    eMetaPromise = axios
        .get(`${import.meta.env.BASE_URL}data/elements.json`, { timeout: 10000 })
        .then((r) => (eMeta = (r.data as ElementSpriteMap) || {}))
        .catch(() => (eMeta = {}));
  }
  return eMetaPromise;
}

/** 同步读取某属性的雪碧图坐标。 */
export function getElementSprite(element: string): { sprite: string; col: number; row: number } | null {
  return eMeta?.[element] || null;
}
