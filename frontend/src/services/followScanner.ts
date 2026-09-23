/**
 * 打开“跟随识别”独立窗口的公共入口。
 *
 * 带防重入保护：快速连点时只发起一次，避免并发调用 pywebview 开窗
 * 造成竞态（卡住 / 白屏）。
 */
import { IS_STATIC } from './staticMode';

let openingScanner = false;

/**
 * 纯前端版跟随识别的入口。
 *
 * 优先用 **Document PiP 直接开小窗**（Chromium 113+）：没有地址栏、始终置顶，
 * 而且只多一个窗口 —— 由主页面把识别面板 portal 渲染进去
 * （PiP 窗口的寿命绑定在打开它的文档上，所以必须由常驻的首页来开，不能由弹窗开）。
 *
 * 不支持 PiP 的浏览器退化为普通弹窗（此时面板里的「置顶」按钮仍可把它转成小窗）。
 */
export function openWebFollowScanner(trialKey?: string): Window | null {
  if (trialKey) {
    try {
      localStorage.setItem('roco_active_trial', trialKey);
    } catch {
      /* ignore */
    }
  }
  const base = import.meta.env.BASE_URL || '/';
  const url = `${base}?view=scanner`;

  // 优先：直接开无边框置顶小窗，由首页把识别面板渲染进去
  const pip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } }).documentPictureInPicture;
  if (pip && typeof pip.requestWindow === 'function') {
    try {
      void pip.requestWindow({ width: 480, height: 760 }).then((win) => {
        window.dispatchEvent(new CustomEvent('roco:open-scanner-pip', { detail: win }));
      }).catch((e) => {
        console.warn('Document PiP 打开失败，退化为普通弹窗:', e);
        window.open(url, 'RocoFollowScanner', features);
      });
      return null;
    } catch (e) {
      console.warn('Document PiP 不可用，退化为普通弹窗:', e);
    }
  }
  // 注意：Chrome/Edge 出于防伪冒考虑会忽略 location/toolbar/menubar 这些开关，
  // 弹出窗口一定带地址栏 —— 想完全没有浏览器工具栏只能用 Document PiP（面板右上角 📌）。
  // width/height 是默认尺寸，与 WebFollowScanner 的 SCANNER_WIDTH / SCANNER_HEIGHT 保持一致。
  // 注意：这个尺寸只在「第一次创建这个窗口」时生效，浏览器复用同名窗口时会沿用旧尺寸 ——
  // 面板挂载后会自己再校准一次（见 WebFollowScanner 里的 resizeTo 兜底）。
  const features = 'width=480,height=740,resizable=yes,scrollbars=no';
  const win = window.open(url, 'RocoFollowScanner', features);
  if (win) return win;
  const tab = window.open(url, '_blank');
  if (tab) return tab;
  window.location.href = url;
  return null;
}

export async function openFollowScanner(trialKey?: string): Promise<void> {
  // 纯前端版无授权门禁（识别完全离线），直接开弹窗
  if (IS_STATIC) {
    openWebFollowScanner(trialKey);
    return;
  }
  // 跟随识别已放开：未授权也能直接用（改为底部角标 + 定时温和提醒，不再拦门）
  if (openingScanner) {
    console.warn('跟随识别窗口正在打开，忽略本次点击');
    return;
  }
  openingScanner = true;
  try {
    // 打开前刷新当前试炼标记：扫描窗口以此作为初始试炼（之后可在窗口内自行切换）
    if (trialKey) {
      try {
        localStorage.setItem('roco_active_trial', trialKey);
      } catch {
        // ignore
      }
    }
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
