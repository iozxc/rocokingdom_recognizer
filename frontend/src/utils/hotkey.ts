/**
 * 全局热键（跟随识别：窗口开启时立即识别一次）的规范串工具。
 *
 * 规范串固定为 "Ctrl+D" 这种形式：修饰键顺序固定为 Ctrl / Alt / Shift / Win，
 * 最后一项是主键；前端录制、设置落盘与后端 desktop/hotkey.py 注册都使用同一套
 * token 命名，避免中英文键名不一致。
 *
 * 注意：全局热键仅桌面版可注册（浏览器无权注册系统热键），Web 版不展示该设置。
 */

export const DEFAULT_FOLLOW_HOTKEY = 'Ctrl+D';

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Win'] as const;
const MOD_SET = new Set<string>(MOD_ORDER);

/** KeyboardEvent → 主键 token（仅修饰键按下时返回 null，表示还没录到主键）。 */
export function keyEventToken(e: KeyboardEvent): string | null {
  // 只按修饰键时不录制
  if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') {
    return null;
  }
  if (e.key === ' ' || e.code === 'Space') return 'Space';
  if (e.key.length === 1) {
    const up = e.key.toUpperCase();
    if (/^[A-Z0-9]$/.test(up)) return up;
    // 其它符号键跨键盘布局不稳定，不允许作为热键
    return null;
  }
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  const named: Record<string, string> = {
    Enter: 'Enter',
    Escape: 'Esc',
    Tab: 'Tab',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Delete',
    Backspace: 'Backspace',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
  };
  return named[e.key] ?? null;
}

/** 由一次按键事件组装规范串；仅修饰键时返回 null。 */
export function eventToChord(e: KeyboardEvent): string | null {
  const token = keyEventToken(e);
  if (!token) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Win');
  return [...mods, token].join('+');
}

/** 解析规范串为 { mods, key }，非法返回 null。 */
export function parseChord(chord: string): { mods: Set<string>; key: string } | null {
  if (!chord) return null;
  const parts = chord.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  if (!key) return null;
  return { mods, key };
}

/** 前端本地校验，返回错误原因（与后端 reason 对齐）；合法返回 null。 */
export function validateChord(chord: string): string | null {
  const p = parseChord(chord);
  if (!p) return 'invalid';
  const { mods, key } = p;
  for (const m of mods) {
    if (!MOD_SET.has(m)) return 'invalid';
  }
  if (mods.size === 0) return 'modifier_required';
  if (mods.has('Win')) return 'win_reserved';
  const k = key.toLowerCase();
  if (mods.has('Ctrl') && mods.has('Alt') && (k === 'delete' || k === 'del')) {
    return 'system_reserved';
  }
  if (mods.has('Alt') && k === 'tab') return 'system_reserved';
  if (mods.has('Alt') && k === 'f4') return 'system_reserved';
  if (mods.has('Ctrl') && mods.has('Shift') && k === 'esc') return 'system_reserved';
  return null;
}

/** 把规范串渲染成可显示的 "Ctrl + Alt + R"，空串/禁用返回空串。 */
export function formatChord(chord: string): string {
  if (!chord) return '';
  const p = parseChord(chord);
  if (!p) return chord;
  const mods = MOD_ORDER.filter((m) => p.mods.has(m));
  return [...mods, p.key].join(' + ');
}

/** 后端 reason 转中文提示。 */
export function hotkeyErrorText(reason?: string): string {
  switch (reason) {
    case 'conflict':
      return '该快捷键已被其他程序（如 QQ/微信/游戏）占用，请换一个组合键';
    case 'modifier_required':
      return '快捷键需包含 Ctrl、Alt 或 Shift 键';
    case 'win_reserved':
      return '含 Win 键的组合已被系统占用，请去掉 Win 键';
    case 'system_reserved':
      return '这是系统保留快捷键，无法使用';
    case 'invalid':
    case 'invalid_key':
    default:
      return '该按键组合无效，请使用 Ctrl/Alt + 字母/数字/功能键';
  }
}
