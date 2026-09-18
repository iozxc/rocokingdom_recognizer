/**
 * 游戏画面捕获（纯前端版跟随识别专用）。
 *
 * 桌面端靠 win32 的 PrintWindow 静默截取游戏窗口；浏览器没有这个能力，只能用
 * Screen Capture API（getDisplayMedia）——由用户在浏览器的选择器里**手动选中游戏窗口**，
 * 拿到一条 MediaStream 后长期持有，每次识别从这条流里抓一帧。
 *
 * 必须知道的三个浏览器约束（决定了本模块的形态）：
 *  1) getDisplayMedia 需要瞬时用户手势 + 安全上下文（https / localhost），
 *     所以 start() 只能在 click 回调里直接调用，不能包在 setTimeout / Promise 链里；
 *  2) 不能枚举窗口、不能替用户选中目标，用户没选对就只能重来一次；
 *  3) MediaStream 绑定在 document 上：刷新页面/关标签即失效，必须重新授权。
 *
 * 因此「跟随识别」的交互是：点一次「选择游戏窗口」-> 之后每次识别都复用这条流。
 */
import { IS_STATIC } from '../staticMode';

export type CaptureErrorCode =
    | 'unsupported'
    | 'insecure'
    | 'denied'
    | 'no-frame'
    | 'unknown';

export interface CaptureState {
  /** 浏览器是否具备 Screen Capture API */
  supported: boolean;
  /** 是否已持有可用流 */
  active: boolean;
  /** 当前捕获源的名称（浏览器给什么显示什么，通常是窗口标题） */
  label: string;
  /** 上一次失败的原因（成功时清空） */
  error: string | null;
  errorCode: CaptureErrorCode | null;
}

export interface GrabbedFrame {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** 8x8 灰度指纹：连续两次相同说明画面没更新（窗口最小化/被遮挡/共享已暂停）。 */
  signature: string;
  /** 与上一次抓帧是否完全相同 */
  repeated: boolean;
}

type Listener = (state: CaptureState) => void;

/** getDisplayMedia 的非标准提示项：Chromium 支持，其它浏览器会忽略。 */
const DISPLAY_HINTS: Record<string, unknown> = {
  // 优先让用户选「窗口」而不是整个屏幕 —— 整屏共享会把置顶的识别浮窗一起录进去
  displaySurface: 'window',
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  systemAudio: 'exclude',
  preferCurrentTab: false,
};

function isSupported(): boolean {
  return typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getDisplayMedia === 'function';
}

/** 安全上下文判断：getDisplayMedia 在 http（非 localhost）下直接不可用。 */
function isSecure(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const host = window.location?.hostname || '';
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function describeError(err: unknown): { code: CaptureErrorCode; message: string } {
  const e = err as { name?: string; message?: string };
  switch (e?.name) {
    case 'NotAllowedError':
      return { code: 'denied', message: '已取消或拒绝了屏幕共享授权，请重新点击「选择游戏窗口」' };
    case 'NotFoundError':
    case 'NotReadableError':
      return { code: 'no-frame', message: '没有可用的捕获源，或该窗口当前无法被捕获' };
    case 'AbortError':
      return { code: 'denied', message: '浏览器中止了共享（可能在选择器里点了取消）' };
    case 'InvalidStateError':
      return { code: 'no-frame', message: '当前页面已有共享请求在进行中，请稍后重试' };
    default:
      return { code: 'unknown', message: e?.message || String(err) };
  }
}

class ScreenCaptureSession {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: OffscreenCanvas | null = null;
  private listeners = new Set<Listener>();
  private lastSignature = '';
  private starting = false;
  private state: CaptureState = {
    supported: isSupported(),
    active: false,
    label: '',
    error: null,
    errorCode: null,
  };

  // ---------------- 状态订阅 ----------------

  getState(): CaptureState {
    return { ...this.state };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  private patch(next: Partial<CaptureState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((fn) => {
      try {
        fn(this.getState());
      } catch {
        /* 订阅者异常不影响采集 */
      }
    });
  }

  // ---------------- 采集生命周期 ----------------

  isActive(): boolean {
    return !!(this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live'));
  }

  /** 预览用的 video 元素（UI 拿去做缩略图；未开始共享时为 null）。 */
  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  /**
   * 请求共享。**必须在用户手势的同步调用栈里调用**（click handler 里直接 await 可以，
   * 但不要先 setTimeout / 先 await 别的网络请求）。
   */
  async start(): Promise<CaptureState> {
    if (this.starting) return this.getState();
    if (!isSupported()) {
      this.patch({ supported: false, active: false, errorCode: 'unsupported', error: '当前浏览器不支持屏幕捕获（需 Chrome / Edge 等 Chromium 内核浏览器）' });
      return this.getState();
    }
    if (!isSecure()) {
      this.patch({ errorCode: 'insecure', error: '屏幕捕获只能在 HTTPS 或 localhost 下使用' });
      return this.getState();
    }
    this.starting = true;
    try {
      // 已有流先释放，避免多次点击堆积多条轨道
      this.releaseStream();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { ...DISPLAY_HINTS } as MediaStreamConstraints['video'],
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        this.patch({ active: false, errorCode: 'no-frame', error: '浏览器返回了空的视频轨道，请重新选择窗口' });
        return this.getState();
      }
      // 用户在浏览器悬浮条上点「停止共享」时同步状态
      track.addEventListener('ended', () => this.handleTrackEnded());

      const video = this.ensureVideoElement();
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // 自动播放被拦时不致命：抓帧走的是 video 元素的当前帧
      }
      // 等到至少有一帧可读，避免第一次识别抓到空白
      await this.waitForFrame(video);

      this.stream = stream;
      this.lastSignature = '';
      this.patch({
        active: true,
        label: track.label || '已选择画面',
        error: null,
        errorCode: null,
      });
    } catch (err) {
      const { code, message } = describeError(err);
      this.patch({ active: false, error: message, errorCode: code });
    } finally {
      this.starting = false;
    }
    return this.getState();
  }

  stop(): void {
    this.releaseStream();
    this.patch({ active: false, label: '', errorCode: null, error: null });
  }

  private handleTrackEnded(): void {
    this.releaseStream();
    this.patch({
      active: false,
      label: '',
      errorCode: null,
      error: '共享已结束（浏览器侧停止或被捕获窗口关闭），需要重新选择游戏窗口',
    });
  }

  private releaseStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
      this.stream = null;
    }
    if (this.video) {
      try {
        this.video.pause();
      } catch {
        /* ignore */
      }
      this.video.srcObject = null;
    }
    this.lastSignature = '';
  }

  private ensureVideoElement(): HTMLVideoElement {
    if (this.video) return this.video;
    if (typeof document === 'undefined') throw new Error('无法创建 video 元素');
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    // 不放进 DOM 也能解码（srcObject + play）；但部分浏览器对脱离文档的 video
    // 会降低刷新频率，所以 UI 会把同一个元素挂到预览容器里。
    this.video = video;
    return video;
  }

  private waitForFrame(video: HTMLVideoElement, timeoutMs = 2500): Promise<void> {
    return new Promise((resolve) => {
      if (video.videoWidth > 0 && video.readyState >= 2) {
        resolve();
        return;
      }
      const done = () => {
        window.clearTimeout(timer);
        video.removeEventListener('loadeddata', done);
        resolve();
      };
      const timer = window.setTimeout(done, timeoutMs);
      video.addEventListener('loadeddata', done, { once: true });
    });
  }

  // ---------------- 抓帧 ----------------

  /**
   * 从当前流里抓一帧。返回的 ImageBitmap 可以直接 transfer 给 Worker。
   * `repeated=true` 表示与上一帧逐像素相同 → 画面多半没在更新。
   */
  async grab(): Promise<GrabbedFrame> {
    const video = this.video;
    if (!this.stream || !video || !this.isActive()) {
      throw Object.assign(new Error('尚未选择游戏窗口'), { code: 'denied' as CaptureErrorCode });
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      throw Object.assign(new Error('捕获画面还没有可用帧，请确认游戏窗口未被最小化'), { code: 'no-frame' as CaptureErrorCode });
    }

    // 有 requestVideoFrameCallback 就等一帧新的合成帧，尽量拿到「按下识别那一刻」的画面
    await new Promise<void>((resolve) => {
      const anyVideo = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (typeof anyVideo.requestVideoFrameCallback !== 'function') {
        resolve();
        return;
      }
      const timer = window.setTimeout(resolve, 120);
      anyVideo.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });

    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = new OffscreenCanvas(w, h);
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法创建抓帧画布');
    ctx.drawImage(video, 0, 0, w, h);

    const signature = this.frameSignature(ctx, w, h);
    const repeated = signature === this.lastSignature;
    this.lastSignature = signature;

    const bitmap = this.canvas.transferToImageBitmap();
    // transferToImageBitmap 之后画布被重置为透明，尺寸保留，可直接复用
    return { bitmap, width: w, height: h, signature, repeated };
  }

  /** 8x8 灰度指纹：只用于判断「画面有没有变」，不参与识别。 */
  private frameSignature(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): string {
    const probe = new OffscreenCanvas(8, 8);
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    if (!pctx) return '';
    pctx.drawImage(this.canvas as OffscreenCanvas, 0, 0, w, h, 0, 0, 8, 8);
    const d = pctx.getImageData(0, 0, 8, 8).data;
    let out = '';
    for (let i = 0; i < 64; i++) {
      const s = i * 4;
      out += ((d[s] * 0.299 + d[s + 1] * 0.587 + d[s + 2] * 0.114) | 0).toString(16).padStart(2, '0');
    }
    return out;
  }
}

export const screenCapture = new ScreenCaptureSession();

/** 纯前端版（IS_STATIC）才走浏览器内采集；桌面版仍由 pywebview 桥接截屏。 */
export function isWebFollowSupported(): boolean {
  return IS_STATIC && isSupported() && isSecure();
}
