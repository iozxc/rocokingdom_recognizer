/**
 * 原生拖窗（-webkit-app-region: drag）期间的「暂停刷新」开关。
 *
 * 跟随识别窗口是靠标题栏的原生拖动在动，但页面重绘仍然跑在 WebView2 的 UI 线程上。
 * 抓包数据涌进来时高频 setState 会把主线程占满，窗口就表现为「飘、不跟手」。
 *
 * 所以：**拖动期间先不应用高频更新（只留最新一条），松手后补一次**。
 * 拖动时界面内容静止，但窗口跟手；松手立刻跳到最新状态。
 */

let dragging = false;
const listeners = new Set<(v: boolean) => void>();

export const isWindowDragging = (): boolean => dragging;

function emit(v: boolean): void {
  if (dragging === v) return;
  dragging = v;
  listeners.forEach((fn) => {
    try {
      fn(v);
    } catch {
      /* 单个监听出错不影响别人 */
    }
  });
}

export function onWindowDragChange(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * 拖动期间只留最新一条的门。
 * 用法：`const push = createDragGate<Msg>((m) => setState(m))` 然后把 push 当作原来的回调。
 */
export function createDragGate<T>(apply: (value: T) => void): (value: T) => void {
  let hasPending = false;
  let pending: T;
  onWindowDragChange((isDragging) => {
    if (isDragging || !hasPending) return;
    hasPending = false;
    apply(pending);
  });
  return (value: T) => {
    if (dragging) {
      pending = value;
      hasPending = true;
      return;
    }
    apply(value);
  };
}

let installed = false;

/** 全局只装一次：mousedown 落在拖拽区就开始「静止」，松手（或兜底超时）恢复 */
export function installWindowDragWatcher(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  let safety = 0;
  const end = (): void => {
    if (safety) {
      window.clearTimeout(safety);
      safety = 0;
    }
    emit(false);
  };
  const begin = (): void => {
    emit(true);
    if (safety) window.clearTimeout(safety);
    // 兜底：原生拖动有可能吞掉 mouseup，最长 8 秒强制解除，免得画面一直冻着
    safety = window.setTimeout(() => {
      safety = 0;
      emit(false);
    }, 8000);
  };

  document.addEventListener(
    'mousedown',
    (e) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest && el.closest('.pywebview-drag-region')) begin();
    },
    true,
  );
  window.addEventListener('mouseup', end, true);
  window.addEventListener('pointerup', end, true);
  window.addEventListener('blur', end);
}
