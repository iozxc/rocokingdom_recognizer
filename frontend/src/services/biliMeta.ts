/**
 * B 站视频元信息自动获取（标题 / 时长 / 发布日期 / 播放量 / 封面）。
 *
 * 为什么用 JSONP 而不是 fetch：
 *   B 站 web-interface/view 接口不返回 Access-Control-Allow-Origin，
 *   而浏览器 fetch 一旦带上 Origin 头就会被对方 403（已实测：desktop 的 127.0.0.1
 *   与网页版域名都一样）。`<script>` 标签不受 CORS 限制，所以用 jsonp 回调形式拿数据。
 *
 * 结果做两级缓存（内存 + localStorage，7 天），避免每次打开弹窗都发请求。
 * 任何一步失败都静默降级：调用方只用拿到手的字段，拿不到就退化成纯文字卡片。
 */

export interface BiliMeta {
  bvid: string;
  title?: string;
  /** 已经格式化好的时长，如 "06:11" */
  duration?: string;
  /** 发布日期 yyyy-MM-dd */
  date?: string;
  /** 播放量（数字字符串） */
  views?: string;
  /** 封面图（已把 http: 升成 https:） */
  cover?: string;
  /** 可嵌入的播放器地址（只靠 bvid 即可定位） */
  embed?: string;
  /** 原站观看地址 */
  url?: string;
}

const CACHE_KEY = 'roco_bili_meta_v1';
const TTL = 7 * 24 * 60 * 60 * 1000; // 7 天
const JSONP_TIMEOUT = 8000;

type CacheShape = Record<string, { ts: number; data: BiliMeta }>;

let memCache: CacheShape | null = null;
const inflight = new Map<string, Promise<BiliMeta | null>>();

function readCache(): CacheShape {
  if (memCache) return memCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    memCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    memCache = {};
  }
  return memCache;
}

function writeCache(key: string, data: BiliMeta) {
  const cache = readCache();
  cache[key] = { ts: Date.now(), data };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 隐私模式 / 容量满：忽略，内存缓存仍然有效 */
  }
}

/** 从任意文本里抽出 BV 号（支持直接粘贴整段 iframe / 播放器 URL / 纯 BV 号） */
export function extractBvid(value?: string): string | undefined {
  if (!value) return undefined;
  const m = String(value).match(/BV[0-9A-Za-z]{10}/);
  return m ? m[0] : undefined;
}

/** 把秒数格式化成 mm:ss（超过 1 小时用 h:mm:ss） */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function toDateStr(ts?: number): string | undefined {
  if (!ts) return undefined;
  try {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return undefined;
  }
}

/** JSONP 拉取单个视频元信息 */
function fetchViaJsonp(bvid: string): Promise<BiliMeta | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);

    const cbName = `__roco_bili_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let done = false;

    const cleanup = () => {
      try {
        delete (window as any)[cbName];
      } catch {
        (window as any)[cbName] = undefined;
      }
      script.remove();
    };
    const finish = (v: BiliMeta | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(v);
    };

    const timer = window.setTimeout(() => finish(null), JSONP_TIMEOUT);

    (window as any)[cbName] = (payload: any) => {
      if (!payload || payload.code !== 0 || !payload.data) return finish(null);
      const v = payload.data;
      finish({
        bvid: v.bvid || bvid,
        title: typeof v.title === 'string' ? v.title : undefined,
        duration: formatDuration(Number(v.duration)) || undefined,
        date: toDateStr(Number(v.pubdate)),
        views: v?.stat?.view != null ? String(v.stat.view) : undefined,
        cover: typeof v.pic === 'string' ? v.pic.replace(/^http:/, 'https:') : undefined,
        // 只靠 bvid 就能定位视频，不需要 aid/cid
        embed: `//player.bilibili.com/player.html?isOutside=true&bvid=${v.bvid || bvid}&p=1`,
        url: `https://www.bilibili.com/video/${v.bvid || bvid}`,
      });
    };

    script.onerror = () => finish(null);
    script.src =
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}` +
        `&jsonp=jsonp&callback=${cbName}`;
    document.head.appendChild(script);
  });
}

/**
 * 取单个视频元信息（带缓存 + 并发去重）。
 * 拿不到返回 null，调用方自行降级。
 */
export async function getBiliMeta(bvid: string): Promise<BiliMeta | null> {
  if (!bvid) return null;

  const cache = readCache();
  const hit = cache[bvid];
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const running = inflight.get(bvid);
  if (running) return running;

  const task = fetchViaJsonp(bvid)
      .then((data) => {
        if (data) writeCache(bvid, data);
        return data;
      })
      .catch(() => null)
      .finally(() => inflight.delete(bvid));

  inflight.set(bvid, task);
  return task;
}

/** 批量并发取（数量不多，直接 Promise.all） */
export async function getBiliMetaBatch(bvids: string[]): Promise<Record<string, BiliMeta | null>> {
  const uniq = Array.from(new Set(bvids.filter(Boolean)));
  const list = await Promise.all(uniq.map((b) => getBiliMeta(b)));
  const out: Record<string, BiliMeta | null> = {};
  uniq.forEach((b, i) => {
    out[b] = list[i];
  });
  return out;
}
