/**
 * 同步模式全局标记。
 *
 * 同步同步是「以同步数据为权威」的：如果用户在同步期间手动点亮/取消，两边会互相覆盖
 * （典型：手动点了却被下一轮同步刷回去，或者反过来把同步结果改错）。
 * 所以同步中就把手动点亮/取消**直接拦掉**并给出提示。
 *
 * 由 usePluginTrial 的消费方（首页 / 跟随识别）设置，任何手动点亮入口都可以读。
 */
let captureLive = false;

export const CAPTURE_CONFLICT_MSG =
  '目前正在同步同步数据，若需进行手动操作请先关闭同步功能避免冲突。';

export const setCaptureLive = (live: boolean): void => {
  captureLive = Boolean(live);
};

export const isCaptureLive = (): boolean => captureLive;

// ---- 极简通知总线：让"查图鉴"这类子组件也能把冲突提示冒到跟随识别窗口上 ----
type ConflictListener = (msg: string) => void;
const listeners = new Set<ConflictListener>();

export const subscribeCaptureConflict = (fn: ConflictListener): (() => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export const notifyCaptureConflict = (): void => {
  listeners.forEach((fn) => {
    try { fn(CAPTURE_CONFLICT_MSG); } catch { /* 忽略 */ }
  });
};
