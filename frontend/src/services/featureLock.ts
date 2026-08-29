import { useSyncExternalStore } from 'react';

type Listener = () => void;

let visible = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

/** 触发一次“请授权，解锁更多功能”提示（限时自动消失）。 */
export function showFeatureLockNotice() {
  visible = true;
  emit();
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    visible = false;
    emit();
  }, 2600);
}

/** 订阅“请授权”提示是否可见。 */
export function useFeatureLockNotice(): boolean {
  return useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => visible,
  );
}
