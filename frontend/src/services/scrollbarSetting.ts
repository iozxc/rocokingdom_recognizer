/**
 * 把「自定义滚动条」设置应用到某个文档的 <html>。
 *
 * 为什么需要这个函数而不是在 App.tsx 内联：
 *   跟随识别有两套独立文档，首页里写的副作用在那边根本不会执行 ——
 *     · 桌面版：ScannerApp 跑在 pywebview 的另一个窗口里（另一个 <html>）
 *     · 纯前端版：WebFollowScanner 跑在独立窗口 / Document PiP 小窗里
 *   两者都靠本函数把开关翻译成 <html> 上的 class + CSS 变量。
 *
 * 两种状态都**显式**挂在 <html> 上（不用「有类 = 开 / 无类 = 关」）：
 *   · .roco-scrollbar-on  → 全站显示统一的极简滚动条（含首页右侧覆盖条）
 *   · .roco-scrollbar-off → 全站不显示任何滚动条（内容照常可滚动）
 *
 * 为什么必须显式区分：
 *   1. 桌面端构造 StorageService 时是「远程优先」异步加载，组件挂载那一刻
 *      user_data.json 还没回来，只读内存会拿到默认值——独立窗口就会错过用户
 *      已经关掉的设置。所以这里统一走 getSettingCached（内存 → localStorage 兜底）。
 *   2. 设置改完还要能立刻生效：订阅 storage 设置变化（含跟随识别窗口的轮询同步），
 *      远程数据到达后再重放一次。
 *   3. 早期版本用「没有 class」表示关闭，于是关闭后容器回落到**系统原生滚动条**，
 *      看起来就像开关没生效（历史 bug：设置里关了，跟随识别的图鉴里照样有条）。
 */
import { IS_STATIC } from './staticMode';
import { storage } from './storage';

const ON_CLASS = 'roco-scrollbar-on';
const OFF_CLASS = 'roco-scrollbar-off';
const WIDTH_VAR = '--roco-scrollbar-w';

const MIN_WIDTH = 4;
const MAX_WIDTH = 16;

/**
 * 自定义滚动条默认是否显示。
 * Web 端默认开启（浏览器里滚动条是必要的滚动提示），桌面端默认关闭（界面更干净）。
 */
export const DEFAULT_SHOW_SCROLLBAR: boolean = IS_STATIC;

/** 自定义滚动条默认宽度（px）。 */
export const DEFAULT_SCROLLBAR_WIDTH = 10;

/** 把任意输入夹到合法宽度区间（4 ~ 16px）。 */
export function clampScrollbarWidth(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_SCROLLBAR_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
}

/**
 * 读取滚动条设置。
 * 用 getSettingCached 而不是 getSetting：桌面端/独立窗口启动瞬间远程设置还没到，
 * 只读内存会拿到默认值，表现就是「设置里明明关了，窗口里还开着」。
 */
export function readScrollbarSetting(): { on: boolean; width: number } {
  const raw = storage.getSettingCached<unknown>('showHomeScrollbar', DEFAULT_SHOW_SCROLLBAR);
  return {
    on: typeof raw === 'boolean' ? raw : DEFAULT_SHOW_SCROLLBAR,
    width: clampScrollbarWidth(
        storage.getSettingCached<unknown>('homeScrollbarWidth', DEFAULT_SCROLLBAR_WIDTH),
    ),
  };
}

/**
 * 读取设置并写入目标文档的 <html>；返回清理函数。
 *
 * @param targetDoc 目标文档；默认当前文档。Document PiP 小窗要显式传它自己的 document
 *                  （面板 portal 到小窗后，当前 document 已经不是它了）。
 */
export function applyScrollbarSetting(targetDoc?: Document | null): () => void {
  const doc = targetDoc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const root = doc.documentElement;

  const apply = () => {
    const { on, width } = readScrollbarSetting();
    root.classList.toggle(ON_CLASS, on);
    root.classList.toggle(OFF_CLASS, !on);
    root.style.setProperty(WIDTH_VAR, `${width}px`);
  };

  apply();

  // 远程 user_data.json 到达（或本地兜底加载完成）后再重放一次：
  // 否则独立窗口会一直停留在「启动瞬间读到的默认值」上。
  void storage.initialLoad.then(() => apply()).catch(() => {
    /* 重放失败不影响已应用的值 */
  });

  // 设置变化即时生效：同窗口改动、跨窗口 storage 事件、跟随识别窗口的后端轮询同步
  // 都会走到这里。changedKeys 为空表示「不知道具体谁变了」，此时无条件重放。
  const unsubscribe = storage.subscribeSettings((_settings, changedKeys) => {
    if (changedKeys && !changedKeys.includes('showHomeScrollbar') && !changedKeys.includes('homeScrollbarWidth')) {
      return;
    }
    apply();
  });

  return () => {
    unsubscribe();
    root.classList.remove(ON_CLASS);
    root.classList.remove(OFF_CLASS);
    root.style.removeProperty(WIDTH_VAR);
  };
}
