/**
 * 跟随识别的「未授权」温和提醒。
 *
 * 背景：跟随识别已经放开（未授权也能用），但作者仍希望用户能注意到授权入口。
 * 所以这里不做拦门，只做两件事：
 *   1. 跟随识别窗口底部状态栏常驻一个「未授权」角标（点击可直接打开授权弹窗）；
 *   2. 主窗口打开时先提醒一次，之后每 10~30 分钟随机再提醒一次。
 *
 * 随机间隔是刻意做的：固定周期会让人形成“每 N 分钟必弹”的预期而变得麻木，
 * 随机化后更难被忽略，但又不至于打扰（最短也有 10 分钟）。
 */
import { useSyncExternalStore } from 'react';

const MIN_DELAY_MS = 10 * 60 * 1000;
const MAX_DELAY_MS = 30 * 60 * 1000;

type Listener = () => void;

let visible = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let nextTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

/** 10~30 分钟之间的随机间隔（含抖动，避免固定节奏）。 */
function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

/** 立即弹一次提醒（限时自动消失）。 */
export function showAuthReminder() {
  visible = true;
  emit();
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    visible = false;
    emit();
  }, 6000);
}

/** 安排下一次随机提醒。 */
function scheduleNext() {
  if (nextTimer) clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    showAuthReminder();
    scheduleNext();
  }, randomDelay());
}

/**
 * 启动定时提醒（幂等）。`shouldRemind` 每次触发前重新求值 ——
 * 授权成功后要能立刻停下来，而不是等定时器自然过期。
 */
export function startAuthReminderLoop(shouldRemind: () => boolean) {
  if (started) return;
  started = true;
  // 打开 App 先提醒一次
  if (shouldRemind()) showAuthReminder();

  const tick = () => {
    if (!shouldRemind()) {
      // 已授权：停表，并让调用方在状态变化时重新 start
      started = false;
      if (nextTimer) clearTimeout(nextTimer);
      nextTimer = null;
      return;
    }
    showAuthReminder();
    scheduleNext();
  };
  if (nextTimer) clearTimeout(nextTimer);
  nextTimer = setTimeout(tick, randomDelay());
}

/** 停止定时提醒（授权成功后调用）。 */
export function stopAuthReminderLoop() {
  started = false;
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  visible = false;
  emit();
}

/** 订阅提醒是否可见。 */
export function useAuthReminder(): boolean {
  return useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => visible,
  );
}
