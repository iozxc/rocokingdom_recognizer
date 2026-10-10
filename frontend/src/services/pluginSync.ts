/**
 * 抓包插件「同步」能力：把游戏里的草系试炼数据接进本机图鉴。
 *
 * 数据契约（插件 manifest 里声明 sync.endpoint，返回结构由本文件解析）：
 * {
 *   available, active, inTrial, selectionActive,
 *   maps: [{ logConfId, total, discoveredCount, discoveredNames, ... }],
 *   challenge: {...}, selection: {...}
 * }
 *
 * 主程序只依赖这份「通用同步载荷」，不关心是哪个插件提供的。
 */
import { useEffect, useState } from 'react';
import { pluginApi, PluginInfo } from './pluginApi';
import { api } from './api';
import { IS_STATIC } from './staticMode';
import { storage } from './storage';
import { formatPetName } from '../utils/petHelper';
import { PetItem } from '../types';

/**
 * 三选一界面的一张卡（来自抓包 + 游戏配置表 GRASS_TRIAL_EVENT_CONF）。
 * book/form 是图鉴编号与形态序号，与项目图标文件名 `<book>_<seq>_<名字>.png` 完全对应。
 */
export interface TrialSelectionSlot {
  slot_index?: number;
  event_conf_id?: number;
  name?: string;
  card_level?: number | null;
  coin?: number | null;
  refresh?: number[] | null;
  reset?: number[] | null;
  book?: number;
  form?: number;
  /** 1 = book 只是线索（PET_HANDBOOK 未收录），需要按名字回退匹配 */
  hint?: number;
  /** false = 非战斗事件（研究员 / 易西 / 罗兰 / 远行商人 / 魔力之源 / 祝福）：仍展示，但只显示名字且不点亮 */
  battle?: boolean;
}

/** 抓包给出的「已点亮精灵」明细：图鉴号/形态序号来自游戏 PET_HANDBOOK。 */
export interface TrialPetRef {
  id?: number;
  name: string;
  book?: number;
  seq?: number;
}

export interface TrialMapProgress {
  logConfId: number;
  total: number;
  discoveredCount: number;
  discoveredIds?: number[];
  discoveredNames: string[];
  discovered?: TrialPetRef[];
  unlocked?: boolean;
}

export interface TrialPayload {
  ok?: boolean;
  available?: boolean;
  /** 插件算出的内容指纹：变了说明试炼数据有更新（SSE 推送里也带） */
  revision?: string;
  maps?: TrialMapProgress[];
  challenge?: {
    state?: number;
    log_id?: number;
    node_index?: number;
    remaining_coin?: number;
    accumulated_score?: number;
    completed_nodes?: number;
    /** 已完成节点（真正打过的事件）。用于「打完才点亮」，与三选一候选区分开 */
    completed?: Array<{ node_index?: number; event_conf_id?: number; name?: string; book?: number; seq?: number; battle?: boolean; log?: number }>;
    pet?: { name?: string; level?: number; hp?: number; max_hp?: number; elements?: string[] };
  } | null;
  selection?: {
    slots?: TrialSelectionSlot[];
    log_id?: number;
    remaining_coin?: number;
    event_refresh_count?: number;
  } | null;
  selectionActive?: boolean;
  inTrial?: boolean;
  active?: boolean;
  updatedAt?: number | null;
  /** 插件自身状态（抓包是否在跑），用于底栏 capture live 指示 */
  status?: { running?: boolean; mode?: string } | null;
}

export interface MapPlan {
  mapId: string;
  logConfId: number;
  total: number;
  discoveredCount: number;
  mark: PetItem[];
  unmark: PetItem[];
  unmatchedNames: string[];
  ambiguous: number;
  /** true = 名字全部对上且没有歧义形态，可以安全地把「游戏里没有的」也清掉 */
  strict: boolean;
}

const ZERO_WIDTH = /[\u200b\u200c\u200d\ufeff]/g;

/** 展示名（去掉 id 前缀/形态后缀前的部分由 formatPetName 处理），再取「基础名」。 */
function baseName(name?: string | null): string {
  return formatPetName(name || '').replace(ZERO_WIDTH, '').split('_')[0].trim();
}

export interface ResolvedRef {
  item: PetItem;
  /** true = 由 图鉴号+形态序号 精确命中；false = 名字/图鉴号回退命中 */
  exact: boolean;
}

/**
 * 把抓包给的一条精灵引用解析成本机图鉴条目。
 *
 * 依次尝试：
 *  1. 图鉴号 + 形态序号（PET_HANDBOOK 权威编号）—— 精确；
 *  2. 名字完全相同；
 *  3. 基础名相同（去掉 `_形态` 后缀），并用图鉴号收窄；
 *  4. 该图鉴号在本图只有一条时直接采用。
 */
export function resolvePetRef(
  ref: { name?: string | null; book?: number | null; seq?: number | null },
  items: PetItem[],
): ResolvedRef | null {
  const book = ref.book || 0;
  const seq = ref.seq || 0;
  if (book && seq) {
    const hit =
      items.find((p) => p.id === book && p.seq === seq) ||
      (seq === 1 ? items.find((p) => p.id === book && !p.seq) : undefined);
    if (hit) return { item: hit, exact: true };
  }
  const name = baseName(ref.name || '');
  if (!name) return null;
  let pool = items.filter((p) => formatPetName(p.name) === name);
  if (pool.length !== 1) {
    const basePool = items.filter((p) => baseName(p.name) === name);
    if (basePool.length) pool = basePool;
  }
  if (pool.length > 1 && book) {
    const byBook = pool.filter((p) => p.id === book);
    if (byBook.length) pool = byBook;
  }
  if (pool.length) return { item: pool[0], exact: pool.length === 1 };
  if (book) {
    const byBook = items.filter((p) => p.id === book);
    if (byBook.length === 1) return { item: byBook[0], exact: false };
  }
  return null;
}

/** 找到第一个「已启用 + 声明了同步能力」的插件。 */
export function findSyncPlugin(plugins: PluginInfo[]): PluginInfo | null {
  return plugins.find((p) => p.enabled && !!p.sync && !p.error) || null;
}

export async function fetchTrial(plugin: PluginInfo): Promise<TrialPayload | null> {
  if (!plugin.sync?.endpoint) return null;
  try {
    return (await pluginApi.fetchSync(plugin)) as TrialPayload;
  } catch {
    return null;
  }
}

/**
 * 轻量轮询：只拿一个内容指纹（revision）和抓包状态。
 * 抓包数据没变就不拉完整 payload，避免每次轮询都解析几十 KB 造成界面卡顿。
 */
export async function fetchTrialLite(
  plugin: PluginInfo,
): Promise<{ revision?: string; available?: boolean; status?: { running?: boolean } } | null> {
  if (!plugin.sync?.endpoint) return null;
  try {
    return await pluginApi.fetchSync(plugin, true);
  } catch {
    return null;
  }
}

/**
 * 按「该图精灵总数」把插件给的三张图数据匹配到本机的图（count 相等即认为是同一张）。
 * 同一形态名有多个（如 乌达 / 乌达_极夜）时，只有「发现数 == 本机条目数」才批量点亮，否则跳过以免误标。
 */
export function buildSyncPlan(
  trial: TrialPayload,
  mapsData: Record<string, { count: number; items: PetItem[] }>,
): MapPlan[] {
  const mapIds = Object.keys(mapsData || {});
  const used = new Set<string>();
  const plans: MapPlan[] = [];

  for (const rec of trial.maps || []) {
    // 优先用抓包给的明细（含游戏 PET_HANDBOOK 的 图鉴号/形态序号）；老数据只有名字时退回名字匹配。
    const refs: TrialPetRef[] = rec.discovered && rec.discovered.length
      ? rec.discovered
      : (rec.discoveredNames || []).filter(Boolean).map((n) => ({ name: n, book: 0, seq: 0 }));
    if (!refs.length) continue;

    // 按「该图精灵总数」把抓包的日志对应到本机地图
    let mapId = mapIds.find((id) => !used.has(id) && (mapsData[id].items?.length || 0) === rec.total);
    if (!mapId) mapId = mapIds.find((id) => !used.has(id) && (mapsData[id].items?.length || 0) >= rec.total);
    if (!mapId) continue;
    used.add(mapId);

    const items = mapsData[mapId].items || [];
    const mark: PetItem[] = [];
    const seen = new Set<string>();
    const unresolved: string[] = [];
    let inexact = 0;

    refs.forEach((ref) => {
      const res = resolvePetRef(ref, items);
      if (!res) {
        unresolved.push(ref.name || String(ref.id || ''));
        return;
      }
      if (!res.exact) inexact++;
      if (!seen.has(res.item.name)) {
        seen.add(res.item.name);
        mark.push(res.item);
      }
    });

    // 名字全部落地才允许反向清理（把游戏里没点亮的从本机取消），避免误删。
    const strict = unresolved.length === 0;
    plans.push({
      mapId,
      logConfId: rec.logConfId,
      total: rec.total,
      discoveredCount: rec.discoveredCount,
      mark,
      unmark: strict ? items.filter((pet) => !seen.has(pet.name)) : [],
      unmatchedNames: unresolved,
      ambiguous: inexact,
      strict,
    });
  }
  return plans;
}

export interface SyncSummary {
  plans: Array<{
    mapId: string;
    logConfId: number;
    total: number;
    discoveredCount: number;
    marked: number;
    unmarked: number;
    strict: boolean;
    unmatched: number;
  }>;
  marked: number;
  unmarked: number;
  unmatched: number;
}

/** 落库：把计划写进本机图鉴记录，并返回一份可展示的汇总。 */
/**
 * 把同步计划落库。
 *
 * @param options.manual 手动点「同步」时为 true：
 *   忽略「用户手动取消过点亮」的抑制，按抓包数据强制重新点亮（并解除抑制），
 *   这样手滑取消的精灵能一键恢复；自动同步仍尊重用户的手动取消。
 */
export function applySyncPlan(plans: MapPlan[], options: { manual?: boolean } = {}): SyncSummary {
  const manual = Boolean(options.manual);
  const summary: SyncSummary = { plans: [], marked: 0, unmarked: 0, unmatched: 0 };
  const markItems: Array<{ mapId: string; filename: string; note: string }> = [];
  const unmarkItems: Array<{ mapId: string; filename: string }> = [];

  // 本次同步要点亮的全部条目（含三选一卡片）。反向清理时必须排除它们，否则会出现
  // 「刚遇见/正在挑战的第三只」先被点亮、又被“游戏精灵足迹里没有它”清掉
  //（表现就是打完第三只却没有自动点亮）。
  const keep = new Set<string>();
  plans.forEach((plan) => plan.mark.forEach((pet) => keep.add(`${plan.mapId}_${pet.name}`)));

  plans.forEach((plan) => {
    // 自动同步：用户手动取消过点亮的条目不再自动点亮（避免"取消了又被点亮"）；
    // 手动同步：忽略抑制，按抓包数据强制恢复。
    const toMark = plan.mark.filter((pet) => {
      if (storage.isEncountered(plan.mapId, pet.name)) return false;
      if (!manual && storage.isSuppressed(plan.mapId, pet.name)) return false;
      return true;
    });
    if (manual) toMark.forEach((pet) => storage.unsuppress(plan.mapId, pet.name));
    // 反向清理（把游戏里没点亮的从本机取消）额外跳过「用户手动点亮过」的条目：
    // 手动点亮代表用户明确知道结果，不能被自动同步又翻回去（典型：手动点亮后又被取消）。
    const toUnmark = plan.unmark.filter(
        (pet) =>
          !keep.has(`${plan.mapId}_${pet.name}`) &&
          storage.isEncountered(plan.mapId, pet.name) &&
          !storage.isManualMark(plan.mapId, pet.name),
    );
    toMark.forEach((pet) => markItems.push({ mapId: plan.mapId, filename: pet.name, note: '抓包同步' }));
    toUnmark.forEach((pet) => unmarkItems.push({ mapId: plan.mapId, filename: pet.name }));

    summary.plans.push({
      mapId: plan.mapId,
      logConfId: plan.logConfId,
      total: plan.total,
      discoveredCount: plan.discoveredCount,
      marked: toMark.length,
      unmarked: toUnmark.length,
      strict: plan.strict,
      unmatched: plan.unmatchedNames.length,
    });
    summary.marked += toMark.length;
    summary.unmarked += toUnmark.length;
    summary.unmatched += plan.unmatchedNames.length;
  });

  if (markItems.length) storage.batchMarkEncountered(markItems);
  if (unmarkItems.length) storage.batchUnmarkEncountered(unmarkItems);
  return summary;
}


/**
 * 轮询「同步插件」的试炼数据（跟随识别窗口是独立浏览器窗口，自己拉一份）。
 * 插件未安装/未启用时 plugin 与 trial 都是 null。
 */
export function usePluginTrial(): { plugin: PluginInfo | null; trial: TrialPayload | null; running: boolean } {
  const [plugin, setPlugin] = useState<PluginInfo | null>(null);
  const [trial, setTrial] = useState<TrialPayload | null>(null);
  const [running, setRunning] = useState<boolean>(false);

  useEffect(() => {
    if (IS_STATIC) return;
    let alive = true;
    let es: EventSource | null = null;
    let esKey = '';
    let sseOk = false;
    let current: PluginInfo | null = null;
    let lastRev: string | null = null;
    // SSE 看门狗：最后一次收到任何 SSE 消息（含插件每 10s 发的 ping）的时间。
    // 光靠 sseOk 不够——连接"看起来成功但服务器再也不推"时（曾经真实发生：
    // 插件侧 _LAST_REVISION 抛异常导致 _publish 从未执行），界面会永远停在首帧。
    let lastSseAt = 0;

    // SSE 不可用时的兜底：轻量指纹轮询（2.4KB，不是 45KB 全量）
    const litePoll = async () => {
      if (!alive || !current) return;
      const lite = await fetchTrialLite(current);
      if (!alive || !lite) return;
      setRunning(Boolean(lite.status?.running));
      const rev = lite.revision ?? null;
      if (rev === lastRev) return;
      lastRev = rev;
      const data = await fetchTrial(current);
      if (alive) setTrial(data);
    };

    const connect = (found: PluginInfo) => {
      try {
        es = new EventSource(pluginApi.pluginUrl(found, '/stream'));
        es.onmessage = (ev) => {
          sseOk = true;
          lastSseAt = Date.now();
          let msg: any;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (msg.type === 'ping') return;   // 心跳：只用来刷新看门狗
          if (msg.type === 'trial' && msg.data) {
            lastRev = msg.data.revision ?? null;
            if (!alive) return;
            setTrial(msg.data as TrialPayload);
            setRunning(Boolean(msg.status?.running ?? msg.data?.status?.running));
          } else if (msg.type === 'status') {
            if (alive) setRunning(Boolean(msg.data?.running));
          }
        };
        es.onerror = () => {
          sseOk = false; // EventSource 自身会重连，期间用轮询兜底
        };
      } catch {
        es = null;
      }
    };

    // SSE 超过这个时长没有任何消息（含 ping）就认为它挂了，改用轮询兜底
    const SSE_STALE_MS = 20000;

    const bootstrap = async () => {
      let items: PluginInfo[] = [];
      try {
        items = await pluginApi.list();
      } catch {
        return;
      }
      if (!alive) return;
      const found = findSyncPlugin(items);
      setPlugin(found);
      current = found;
      if (!found) {
        setTrial(null);
        setRunning(false);
        if (es) {
          es.close();
          es = null;
          esKey = '';
        }
        return;
      }
      const key = `${found.id}@${found.apiBase}`;
      if (!es || esKey !== key) {
        if (es) es.close();
        esKey = key;
        lastRev = null;
        sseOk = false;
        lastSseAt = Date.now();
        connect(found);
      }
    };

    void bootstrap();
    const listTimer = window.setInterval(bootstrap, 5000);
    // 只在 SSE 没跑起来时才轮询（避免"用轮询假装实时"）
    const fallbackTimer = window.setInterval(() => {
      // SSE 失败、或虽连着但长时间没消息（看门狗超时）→ 用轻量轮询兜底
      const stalled = sseOk && Date.now() - lastSseAt > SSE_STALE_MS;
      if (!sseOk || stalled) void litePoll();
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(listTimer);
      window.clearInterval(fallbackTimer);
      if (es) es.close();
    };
  }, []);

  return { plugin, trial, running };
}


export interface SelectionResolution {
  mapId: string;
  logId: number;
  /** 卡面对应的本机图鉴条目（按 图鉴号+形态 精确匹配） */
  pets: Array<{
    item: PetItem;
    name: string;
    slot: number;
    eventId: number;
    cardLevel?: number | null;
    coin?: number | null;
    isMerchant: boolean;
  }>;
  unresolved: string[];
}

/**
 * 把「三选一界面」的 3 张卡解析成本机图鉴条目。
 *
 * 地图判定：抓包给出 `challenge.log_id`（100/101/102）→ 对应 trial.maps 里同 logConfId 的
 * total → 本机条目数相同的那张图。卡片用 book(图鉴号) + form(形态序号) 精确匹配，
 * 因此不会像纯名字匹配那样在「神圣狮鹫_迎击 / _腾山」这类多形态上产生歧义。
 */
export function resolveSelectionPets(
  trial: TrialPayload,
  mapsData: Record<string, { count: number; items: PetItem[] }>,
): SelectionResolution | null {
  const sel = trial.selection;
  const slots = sel?.slots || [];
  if (!slots.length) return null;

  const logId = sel?.log_id || trial.challenge?.log_id || 0;
  const mapIds = Object.keys(mapsData || {});
  let mapId = '';
  const rec = (trial.maps || []).find((m) => m.logConfId === logId);
  if (rec) mapId = mapIds.find((id) => (mapsData[id].items?.length || 0) === rec.total) || '';
  if (!mapId && logId) {
    const order = [100, 101, 102];
    const idx = order.indexOf(logId);
    if (idx >= 0 && mapIds[idx]) mapId = mapIds[idx];
  }
  if (!mapId) return null;

  const items = mapsData[mapId].items || [];
  const pets: SelectionResolution['pets'] = [];
  const unresolved: string[] = [];

  slots.forEach((slot) => {
    const name = (slot.name || '').trim();
    const book = slot.book || 0;
    if (!name && !book) return;
    if (slot.battle === false) return;   // 非战斗事件不点亮
    if (!book) {
      // 远行商人这类非战斗卡：只展示，不进图鉴
      return;
    }
    const res = resolvePetRef({ name, book, seq: slot.form || 0 }, items);
    if (!res) {
      unresolved.push(name || String(book));
      return;
    }
    pets.push({
      item: res.item,
      name: name || formatPetName(res.item.name),
      slot: slot.slot_index || 0,
      eventId: slot.event_conf_id || 0,
      cardLevel: slot.card_level,
      coin: slot.coin,
      isMerchant: false,
    });
  });

  return { mapId, logId, pets, unresolved };
}

/** 三选一卡片里非战斗（商人等）也返回给界面展示。 */
export function selectionCards(trial: TrialPayload | null | undefined): TrialSelectionSlot[] {
  return (trial?.selection?.slots || []).filter((s) => Boolean(s.name));
}

/**
 * 「已完成节点」→ 本机图鉴条目。
 *
 * completed_nodes 里的每个 event_conf_id 就是你**实际打过**的那只（点挑战 → 进战斗 → 结算），
 * 与 0x1962/0x1966 的三选一候选不同：后者只刷新出来看，不代表遇见。
 */
export function resolveCompletedPets(
  trial: TrialPayload | null | undefined,
  mapsData: Record<string, { count: number; items: PetItem[] }>,
): SelectionResolution | null {
  const done = trial?.challenge?.completed || [];
  if (!trial || !done.length) return null;

  const logId = trial.challenge?.log_id || 0;
  const mapIds = Object.keys(mapsData || {});
  let mapId = '';
  const rec = (trial.maps || []).find((m) => m.logConfId === logId);
  if (rec) mapId = mapIds.find((id) => (mapsData[id].items?.length || 0) === rec.total) || '';
  if (!mapId && logId) {
    const order = [100, 101, 102];
    const idx = order.indexOf(logId);
    if (idx >= 0 && mapIds[idx]) mapId = mapIds[idx];
  }
  if (!mapId) return null;

  const items = mapsData[mapId].items || [];
  const pets: SelectionResolution['pets'] = [];
  const unresolved: string[] = [];
  done.forEach((c) => {
    const name = (c.name || '').trim();
    if (!name || !c.book) return;
    if (c.battle === false) return;      // 非战斗事件不点亮
    // completed_nodes 是整个试炼的历史（含其它图打过的精灵），必须按节点自己的
    // log 归图；否则第一张图打的精灵会被算进当前这张图（实测 129 -> 131）。
    if (c.log && logId && c.log !== logId) return;
    const res = resolvePetRef({ name, book: c.book, seq: c.seq || 0 }, items);
    if (!res) {
      unresolved.push(name);
      return;
    }
    pets.push({
      item: res.item,
      name,
      slot: c.node_index || 0,
      eventId: c.event_conf_id || 0,
      isMerchant: false,
    });
  });
  return { mapId, logId, pets, unresolved };
}

export interface TrialSyncResult {
  trial: TrialPayload | null;
  summary: SyncSummary | null;
  selection: SelectionResolution | null;
  selectionPets: number;
}

/**
 * 一键同步：把「三张图的精灵足迹」+「当前三选一的 3 张卡」写进本机图鉴记录。
 * 任何窗口都能调用（内部自己取插件列表与图鉴列表）。
 */
export async function runTrialSync(
  trialKey = 'grass',
  mapsDataIn?: Record<string, { count: number; items: PetItem[] }>,
  options: { manual?: boolean } = {},
): Promise<TrialSyncResult> {
  const empty: TrialSyncResult = { trial: null, summary: null, selection: null, selectionPets: 0 };
  if (IS_STATIC) return empty;
  let plugins: PluginInfo[] = [];
  try {
    plugins = await pluginApi.list();
  } catch {
    return empty;
  }
  const plugin = findSyncPlugin(plugins);
  if (!plugin) return empty;
  const trial = await fetchTrial(plugin);
  if (!trial?.available) return { ...empty, trial };

  // 调用方通常已经加载过图鉴（首页 mapsData / 跟随窗口 mapsPets），直接用，避免每次同步
  // 都再拉一次几百 KB 的 /icons（那是卡顿的主要来源之一）。
  let mapsData: Record<string, { count: number; items: PetItem[] }> = mapsDataIn || {};
  if (!Object.keys(mapsData).length) {
    try {
      const res = await api.getIcons(trialKey);
      mapsData = res.data || {};
    } catch {
      return { ...empty, trial };
    }
  }
  if (!Object.keys(mapsData).length) return { ...empty, trial };

  const plans = buildSyncPlan(trial, mapsData);

  // 「打完才点亮」：只把已完成节点（真正打过的事件）算作遇见；
  // 三选一里刷新出来的候选**只展示、不点亮**，否则刷新一下就会被误标成已遇见。
  const completed = resolveCompletedPets(trial, mapsData);
  if (completed && completed.pets.length) {
    plans.push({
      mapId: completed.mapId,
      logConfId: completed.logId,
      total: 0,
      discoveredCount: completed.pets.length,
      mark: completed.pets.map((x) => x.item),
      unmark: [],
      unmatchedNames: [],
      ambiguous: 0,
      strict: false,
    });
  }

  const summary = applySyncPlan(plans, options);
  if (summary.marked > 0 || summary.unmarked > 0) {
    try {
      await storage.flushPendingSave();
    } catch {
      /* 静默：保存失败时由 storage 自己的重试兜底 */
    }
  }
  return { trial, summary, selection: completed, selectionPets: completed?.pets.length || 0 };
}


export function trialSignature(trial: TrialPayload | null | undefined): string {
  if (!trial?.available) return '';
  const maps = (trial.maps || [])
    .map((m) => `${m.logConfId}:${m.discoveredCount}/${m.total}`)
    .join('|');
  const sel = (trial.selection?.slots || [])
    .map((s) => `${s.slot_index}-${s.event_conf_id}-${s.book}-${s.form}`)
    .join(',');
  const node = trial.challenge?.node_index ?? '';
  return `${maps}#${sel}#${node}`;
}


export interface CaptureSlot {
  /** 卡片位次（1/2/3） */
  slot: number;
  eventId: number;
  /** 抓包解析出的游戏内名字（如 旋叶虫 / 远行商人） */
  name: string;
  /** 匹配到的本机图鉴条目；非战斗卡（商人 / 研究员等）为 undefined */
  item?: PetItem;
  /** false = 非战斗事件（研究员 / 易西 / 罗兰 / 远行商人 / 魔力之源 / 祝福） */
  battle?: boolean;
}

/**
 * 把「三选一界面」直接整理成跟随识别的结果槽位（用于在跟随窗口按原样式展示，无需截图识别）。
 */
export function buildCaptureSlots(
  trial: TrialPayload | null | undefined,
  mapsData: Record<string, { count: number; items: PetItem[] }>,
): { mapId: string; logId: number; slots: CaptureSlot[] } | null {
  const sel = trial?.selection;
  const raw = sel?.slots || [];
  if (!trial || !raw.length) return null;

  const logId = sel?.log_id || trial.challenge?.log_id || 0;
  const mapIds = Object.keys(mapsData || {});
  let mapId = '';
  const rec = (trial.maps || []).find((m) => m.logConfId === logId);
  if (rec) mapId = mapIds.find((id) => (mapsData[id].items?.length || 0) === rec.total) || '';
  if (!mapId && logId) {
    const order = [100, 101, 102];
    const idx = order.indexOf(logId);
    if (idx >= 0 && mapIds[idx]) mapId = mapIds[idx];
  }
  if (!mapId) return null;

  const items = mapsData[mapId].items || [];
  const slots: CaptureSlot[] = [];
  raw.forEach((slot) => {
    const name = (slot.name || '').trim();
    if (!name) return;
    // 非战斗事件（研究员 / 易西 / 罗兰 / 远行商人 / 魔力之源 / 祝福）**保留展示**，
    // 但绝不解析成本机精灵：不给图、不覆盖名字、也不点亮图鉴 ——
    // 否则「草系徽章-研究员-1」会被 book 59 解析成真正的精灵（错误）。
    const isBattle = slot.battle !== false;
    let item: PetItem | undefined;
    if (isBattle && slot.book) {
      const res = resolvePetRef({ name, book: slot.book, seq: slot.form || 0 }, items);
      item = res?.item;
    }
    slots.push({
      slot: slot.slot_index || slots.length + 1,
      eventId: slot.event_conf_id || 0,
      name,
      item,
      battle: isBattle,
    });
  });
  return slots.length ? { mapId, logId, slots } : null;
}
