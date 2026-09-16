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
  private static readonly TIME_GATE = 100;

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
    return dw > 150 || dh > 150;
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
