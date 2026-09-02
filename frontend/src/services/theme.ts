import { ThemeMode } from '../types';
import { storage } from './storage';

const THEME_STORAGE_KEY = 'roco_theme_mode';

class ThemeService {
  private currentTheme: ThemeMode = 'light';
  private listeners: Set<(theme: ThemeMode) => void> = new Set();

  constructor() {
    this.init();
  }

  private init() {
    if (typeof window === 'undefined') return;

    // 1. 优先读取 storage 设置或 localStorage
    let savedTheme = storage.getSetting<ThemeMode | undefined>('theme', undefined);
    if (!savedTheme) {
      try {
        const local = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
        if (local === 'dark' || local === 'light') {
          savedTheme = local;
        }
      } catch {
        // ignore
      }
    }

    // 默认明亮
    this.currentTheme = savedTheme === 'dark' ? 'dark' : 'light';
    this.applyTheme(this.currentTheme, false);

    // 订阅 storage 设置变更
    storage.subscribeSettings((settings) => {
      if (settings.theme && (settings.theme === 'light' || settings.theme === 'dark')) {
        if (settings.theme !== this.currentTheme) {
          this.setTheme(settings.theme, false);
        }
      }
    });

    // 监听跨标签/跨窗口 storage 事件
    window.addEventListener('storage', (e) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        this.setTheme(e.newValue as ThemeMode, false);
      }
    });
  }

  public getTheme(): ThemeMode {
    return this.currentTheme;
  }

  public isDark(): boolean {
    return this.currentTheme === 'dark';
  }

  public setTheme(theme: ThemeMode, persist = true): void {
    this.currentTheme = theme;
    this.applyTheme(theme, persist);
    this.listeners.forEach((listener) => {
      try {
        listener(theme);
      } catch (err) {
        console.error('Theme listener error:', err);
      }
    });
  }

  public toggleTheme(): ThemeMode {
    const nextTheme: ThemeMode = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme, true);
    return nextTheme;
  }

  public subscribe(listener: (theme: ThemeMode) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private applyTheme(theme: ThemeMode, persist: boolean) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    // 切换期间临时禁用所有 transition / animation：让主题色在同一个 frame 内一起变成新值，
    // 避免“逐元素渐变 / View Transition 交叉淡化”造成中途半亮半暗的奇怪中间态。
    root.classList.add('theme-switching');

    const apply = () => {
      if (theme === 'dark') {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
      }
    };
    apply();

    // 两帧后恢复过渡，保证常规 hover 等动画仍正常。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.remove('theme-switching'));
    });

    if (persist) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // ignore
      }
      storage.setSetting('theme', theme);
    }
  }
}

export const themeService = new ThemeService();
