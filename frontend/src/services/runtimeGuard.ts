import { IS_STATIC } from './staticMode';
import { useState, useEffect } from 'react';

type Listener = (active: boolean) => void;

class RuntimeGuard {
  private _active = false;
  private _listeners = new Set<Listener>();
  private _started = false;
  private _hit = 0;
  private _miss = 0;
  private static readonly HIT_N = 2;
  private static readonly MISS_N = 3;
  private static readonly INTERVAL = 3500;
  /**
   * `debugger` 语句的耗时阈值（ms）。
   * 打开 devtools 时该语句会真的中断执行、等人继续，耗时会远超这个值；
   * 留 200ms 是因为主线程偶尔会被重渲染/GC 占住，100ms 太容易被误判成「调试环境」。
   */
  private static readonly TIME_GATE = 200;
  /**
   * 「视口比窗口外框小多少」才算停靠式 devtools（px）。
   *
   * 这个探测原本是 150px，会**误判**：浏览器自己的标题栏 + 标签栏 + 地址栏 + 书签栏
   * 在 125%/150% 显示缩放下就可能超过 150px（把跟随识别开成普通标签页时尤其明显，
   * 于是出现「没开 F12 却说检测到调试环境」）。停靠的 devtools 一般会让某一侧骤减
   * 300px 以上，所以阈值放宽到 300。
   */
  private static readonly CHROME_DELTA = 300;

  get isActive(): boolean {
    return this._active;
  }

  watch(fn: Listener): () => void {
    this._listeners.add(fn);
    fn(this._active);
    return () => this._listeners.delete(fn);
  }

  private _set(v: boolean): void {
    if (this._active === v) return;
    this._active = v;
    this._listeners.forEach((fn) => {
      try {
        fn(v);
      } catch {
      }
    });
  }

  private _probeA(): boolean {
    const t0 = performance.now();
    (function () {
      return false;
    })['constructor']('debugger')();
    return performance.now() - t0 > RuntimeGuard.TIME_GATE;
  }

  private _probeB(): boolean {
    if (typeof window === 'undefined') return false;
    const dw = window.outerWidth - window.innerWidth;
    const dh = window.outerHeight - window.innerHeight;
    return dw > RuntimeGuard.CHROME_DELTA || dh > RuntimeGuard.CHROME_DELTA;
  }

  private _probe(): boolean {
    return this._probeA() || this._probeB();
  }

  init(): void {
    if (this._started || !IS_STATIC || typeof window === 'undefined') return;
    this._started = true;

    const tick = () => {
      try {
        if (this._probe()) {
          this._hit++;
          this._miss = 0;
          if (this._hit >= RuntimeGuard.HIT_N) this._set(true);
        } else {
          this._miss++;
          this._hit = 0;
          if (this._miss >= RuntimeGuard.MISS_N) this._set(false);
        }
      } catch {
      }
    };

    tick();
    window.setInterval(tick, RuntimeGuard.INTERVAL);
  }
}

export const runtimeGuard = new RuntimeGuard();

export function useGuarded(): boolean {
  const [active, setActive] = useState(runtimeGuard.isActive);
  useEffect(() => runtimeGuard.watch(setActive), []);
  return active;
}
