/**
 * 打开“跟随识别”独立窗口的公共入口。
 *
 * 带防重入保护：快速连点时只发起一次，避免并发调用 pywebview 开窗
 * 造成竞态（卡住 / 白屏）。
 */
import { authStore } from './auth';
import { showFeatureLockNotice } from './featureLock';

let openingScanner = false;

export async function openFollowScanner(): Promise<void> {
  if (authStore.getState().status !== 'authorized') {
    showFeatureLockNotice();
    return;
  }
  if (openingScanner) {
    console.warn('跟随识别窗口正在打开，忽略本次点击');
    return;
  }
  openingScanner = true;
  try {
    let openedViaPywebview = false;
    try {
      const pyApi = (window as any).pywebview?.api;
      if (pyApi) {
        if (typeof pyApi.open_scanner_to_app === 'function') {
          await pyApi.open_scanner_to_app('洛克王国：世界');
          openedViaPywebview = true;
        } else if (typeof pyApi.open_scanner_window === 'function') {
          await pyApi.open_scanner_window();
          openedViaPywebview = true;
        }
      }
    } catch (e) {
      console.warn('调用 pywebview 打开跟随识别窗口失败，使用兜底直接打开:', e);
    }
    if (!openedViaPywebview) {
      window.open(
          '/scanner.html',
          'RocoFollowScanner',
          'width=540,height=340,resizable=yes,scrollbars=no,status=no,location=no,toolbar=no,menubar=no'
      );
    }
  } finally {
    openingScanner = false;
  }
}
