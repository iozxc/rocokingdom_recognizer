/**
 * 首页「试炼助手」卡片的静态资源。
 *
 * 图片放在 public 下，由 App 启动后在浏览器空闲时预热；这样首次进入首页助手区时，
 * 徽章封面可以直接命中缓存，不会先闪一下渐变占位。
 */
export const TRIAL_ASSISTANT_IMAGES = {
  grass: './tag_1.png',
} as const;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
};

let preloadScheduled = false;

export function scheduleTrialAssistantImagePreload(): void {
  if (typeof window === 'undefined' || preloadScheduled) return;
  preloadScheduled = true;

  const preload = () => {
    Object.values(TRIAL_ASSISTANT_IMAGES).forEach((src) => {
      const image = new window.Image();
      image.decoding = 'async';
      image.src = src;
    });
  };

  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(preload, { timeout: 1200 });
    return;
  }

  // 老版 WebView 没有 requestIdleCallback：让首屏先完成一轮绘制再预加载。
  window.setTimeout(preload, 200);
}
