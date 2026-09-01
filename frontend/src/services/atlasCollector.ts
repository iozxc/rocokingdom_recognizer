/**
 * 「开荒图鉴」采集器（试炼图鉴 bootstrap 专用）。
 *
 * 新试炼（如火系）还没有完整 map_petsN.json，客户端在【跟随识别】与【首页识别】时
 * 把识别到的 {map_id, pet_id, filename, confidence} 批量上报到远端服务器，服务端聚合后
 * 生成社区版（部分）图鉴。
 *
 * 注意：
 * - 只采集“识别结果”（pet_id/置信度/所在图），不传截图/原图（隐私 & 版权更友好）。
 * - 识别本身仍走该试炼自己的 assets（title pkl / names_dic 等），本采集器只读结果，不碰识别资产。
 * - 有“贡献开荒数据”开关（默认开，可在设置关闭）；关闭后不入队不上报。
 */
import { IS_STATIC, PLATFORM } from './staticMode';
import { APP_VERSION } from '../version';
import { authStore } from './auth';

// 远端统计/采集服务器（与 webTelemetry 同源），可用 VITE_ROCO_AUTH_SERVER 覆盖
const ATLAS_SERVER: string =
    ((import.meta.env.VITE_ROCO_AUTH_SERVER as string | undefined) ?? '')
        .replace(/\/+$/, '') ||
    'https://api.omisheep.cn';

// 需要开荒采集的试炼 key（新试炼加入时补充）
const ATLAS_TRIALS: string[] = ['fire'];

const CONSENT_KEY = 'roco_atlas_contrib_consent_v1';
const DEVICE_KEY = 'roco_atlas_device_hash_v1';
const FLUSH_MS = 30_000;       // 每 30s 尝试批量上报一次
const MAX_BATCH = 50;          // 单次最多上报条数

export interface AtlasObservation {
  map_id: string;
  pet_id: number;
  filename?: string;
  confidence?: number;
}

type FeedbackType = 'wrong' | 'missing' | 'confirm' | 'agree' | 'disagree';

/** 从数据集文件名解析形态唯一键 id_serial：如 '258_02_乌达_极夜.png' -> '258_2'；'002_喵喵.png' -> '2'。 */
export function petKeyOf(filename: string, id?: number, seq?: number | null): string {
  if (id != null) {
    return seq != null ? `${id}_${seq}` : `${id}`;
  }
  const m = (filename || '').match(/^(\d{1,4})_(?:(\d{1,3})_)?/);
  if (m) {
    const i = m[1];
    return m[2] ? `${i}_${parseInt(m[2], 10)}` : i;
  }
  return filename || '';
}

export interface AtlasEntry {
  id?: number;
  pet_key?: string;
  name: string;
  confirmed_by: number;
  confidence: number;
  observation_count: number;
  agree_ratio?: number;
  agree_weight?: number;
  total_weight?: number;
  voter_count?: number;
  my_vote?: 'agree' | 'disagree' | 'none';
}

export interface TrialAtlas {
  ok?: boolean;
  trial_key?: string;
  partial?: boolean;
  meta?: { version?: string; source?: string; generated_at?: string; confirmed_total?: number };
  maps?: Record<string, Record<string, AtlasEntry>>;
}

let queue: Array<{ trial: string } & AtlasObservation> = [];
const seen = new Set<string>(); // 会话内去重：trial|map|pet
let timer: ReturnType<typeof setInterval> | null = null;
let sessionHash = ''; // 会话级稳定兜底（localStorage 不可用时保证同设备同 hash）

function deviceHash(): string {
  // 优先用稳定设备码(machine_code)，避免随机 UUID 在不同页面/会话被当成不同设备
  const mc = authStore.getState().machine_code;
  if (mc) return mc;
  // 兜底：localStorage（web / 授权尚未加载）
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (d) return d;
    d = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `atlas-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, d);
    return d;
  } catch {
    if (!sessionHash) sessionHash = `atlas-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return sessionHash;
  }
}

/** 是否已开启“贡献开荒数据”。默认开；可在设置里关闭。 */
export function isAtlasContribEnabled(): boolean {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

/** 设置“贡献开荒数据”开关。 */
export function setAtlasContribEnabled(on: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
}

/** 当前待上报的观测数（调试用）。 */
export function atlasQueueSize(): number {
  return queue.length;
}

/** 记录一条开荒观测（入队，批量上报）。 */
export function collectAtlasObservation(trial: string, obs: AtlasObservation): void {
  if (!ATLAS_TRIALS.includes(trial)) return;
  if (!isAtlasContribEnabled()) return;
  if (!obs.map_id || obs.pet_id == null) return;
  const key = `${trial}|${obs.map_id}|${obs.pet_id}`;
  if (seen.has(key)) return; // 同一 (trial,map,pet) 会话内只报一次
  seen.add(key);
  queue.push({ trial, ...obs });
  if (queue.length >= MAX_BATCH) void flushAtlasObservations();
  if (!timer) {
    timer = setInterval(() => void flushAtlasObservations(), FLUSH_MS);
  }
}

/** 主动把队列里待上报的观测批量 POST。 */
export async function flushAtlasObservations(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  if (!isAtlasContribEnabled()) {
    batch.length = 0; // 已关闭贡献：清空丢弃
    return;
  }
  const byTrial = new Map<string, AtlasObservation[]>();
  for (const item of batch) {
    if (!byTrial.has(item.trial)) byTrial.set(item.trial, []);
    byTrial.get(item.trial)!.push({ map_id: item.map_id, pet_id: item.pet_id, filename: item.filename, confidence: item.confidence });
  }
  for (const [trial, observations] of byTrial) {
    try {
      await fetch(`${ATLAS_SERVER}/api/trials/${encodeURIComponent(trial)}/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_hash: deviceHash(),
          platform: PLATFORM,
          client_version: APP_VERSION,
          observations,
        }),
        mode: 'cors',
        credentials: 'omit',
      });
    } catch {
      // 网络/跨域失败：静默忽略（避免影响识别主流程）
    }
  }
}

/** 用户对社区版图鉴的纠错/投票：wrong/missing/confirm/agree/disagree。 */
export async function submitAtlasFeedback(
    trial: string,
    type: FeedbackType,
    payload: { map_id?: string; pet_id?: number; filename?: string }
): Promise<void> {
  if (!ATLAS_TRIALS.includes(trial)) return;
  if (!isAtlasContribEnabled()) return;
  try {
    await fetch(`${ATLAS_SERVER}/api/trials/${encodeURIComponent(trial)}/atlas/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_hash: deviceHash(),
        client_version: APP_VERSION,
        platform: PLATFORM,
        type,
        map_id: payload.map_id,
        pet_id: payload.pet_id,
        filename: payload.filename,
      }),
      mode: 'cors',
      credentials: 'omit',
    });
  } catch {
    // ignore
  }
}

/** 拉取某试炼的社区（部分）图鉴，供「开荒图鉴」界面展示；失败返回 null。 */
export async function fetchTrialAtlas(trial: string): Promise<TrialAtlas | null> {
  try {
    const res = await fetch(`${ATLAS_SERVER}/api/trials/${encodeURIComponent(trial)}/atlas?device_hash=${encodeURIComponent(deviceHash())}`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
    });
    return (await res.json()) as TrialAtlas;
  } catch {
    return null;
  }
}

/** 整体同步（快照替换）：maps = 当前已点亮 pet_id 集合；votes = 手动 agree/disagree（互斥）。 */
export async function syncTrialAtlas(
    trial: string,
    maps: Record<string, string[]>,
    votes: Record<string, Record<string, 'agree' | 'disagree'>>,
    overrideHash?: string
): Promise<boolean> {
  if (!ATLAS_TRIALS.includes(trial)) return false;
  if (!isAtlasContribEnabled()) return false;
  try {
    const res = await fetch(`${ATLAS_SERVER}/api/trials/${encodeURIComponent(trial)}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_hash: overrideHash || deviceHash(),
        platform: PLATFORM,
        client_version: APP_VERSION,
        maps,
        votes,
      }),
      mode: 'cors',
      credentials: 'omit',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 页面关闭时尽量 flush（仅 web；桌面端由生命周期收尾）
if (!IS_STATIC && typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushAtlasObservations());
}
