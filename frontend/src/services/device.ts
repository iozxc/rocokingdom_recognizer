/**
 * 设备类型判断（给纯 web 版区分「手机/平板」和「桌面浏览器」用）。
 *
 * 为什么不能只看 `navigator.maxTouchPoints > 0`：
 *   · 带触摸屏的 Windows 笔记本也有触点数，但它其实是桌面浏览器（宽屏 + 鼠标），
 *     不该按移动端处理；
 *   · iPadOS 13+ 的 Safari 会把自己伪装成桌面版 macOS（UA 里既没有 iPad 也没有 Mobile），
 *     只能靠「Macintosh + maxTouchPoints > 1」这个组合认出来。
 *
 * 判定顺序：
 *   1) UA-CH 的 `userAgentData.mobile`（Chromium 可直接问）；
 *   2) UA 里的移动关键字（Android / iPhone / iPad / HarmonyOS / Mobile ...）；
 *   3) 伪装成 Mac 的 iPad；
 *   4) 兜底：有触点数且小屏（Android 平板这类 UA 不带 Mobile 的设备）。
 *
 * 只在纯 web 版（IS_STATIC）下有意义：桌面 app 跑在 pywebview 里，UA 是桌面版。
 */
import { IS_STATIC } from './staticMode';

function detectMobile(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const uaDataMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
      .userAgentData?.mobile;
  if (uaDataMobile === true) return true;
  if (/Android|iPhone|iPod|iPad|Windows Phone|HarmonyOS|Mobile|webOS|BlackBerry|Opera Mini/i.test(ua)) {
    return true;
  }
  // iPadOS 13+：UA 是桌面版 macOS，只能靠触点数区分
  if (/Macintosh|Mac OS X/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  // 兜底：触屏 + 窄屏
  const minSide = Math.min(window.innerWidth || 9999, window.innerHeight || 9999);
  return (navigator.maxTouchPoints || 0) > 1 && minSide < 768;
}

/** 当前设备是不是手机/平板（与平台无关）。 */
export const IS_MOBILE_DEVICE: boolean = detectMobile();

/** 纯 web 版 + 移动端：手机 / iPad 浏览器打开的就是这一套。 */
export const IS_MOBILE_WEB: boolean = IS_STATIC && IS_MOBILE_DEVICE;
