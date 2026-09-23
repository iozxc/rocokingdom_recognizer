/**
 * 全局「打开授权弹窗」信号。
 *
 * 授权弹窗（AuthDialog）原本只挂在右上角 AuthBadge 内部，只有点那个角标才打得开。
 * 现在跟随识别底部状态栏也要能唤起它，所以把「打开」这个动作抽成一个全局外部存储，
 * 谁都能请求打开，弹窗本体仍由 AuthBadge 统一渲染（避免出现两份弹窗状态）。
 */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

let seq = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

/** 请求打开授权弹窗（每调用一次 seq +1，订阅方据此触发）。 */
export function requestAuthDialog() {
  seq += 1;
  emit();
}

/** 订阅打开信号；返回值变化即代表有新的一次打开请求。 */
export function useAuthDialogRequest(): number {
  return useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => seq,
  );
}
