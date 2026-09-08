import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Upload, Download, Database, CheckCircle2, AlertTriangle, FileJson, Plus, UserRound, Trash2, Pencil, Search } from 'lucide-react';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { api } from '../services/api';
import { IS_STATIC } from '../services/staticMode';

interface DataManageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AccountProfile {
  name: string;
  payload: unknown;
  updatedAt: string;
  maps?: Record<string, number>;
  fireMaps?: Record<string, number>;
}

const ACCOUNTS_KEY = 'roco_account_profiles_v1';
const CURRENT_ACCOUNT_KEY = 'roco_current_account_name';
const SORT_KEY = 'roco_account_sort';
const DEFAULT_ACCOUNT = '默认账号';

function readLocalAccounts(): AccountProfile[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocalAccounts(list: AccountProfile[]) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list)); } catch { /* 忽略 */ }
}

function readLocalCurrent(): string {
  try { return localStorage.getItem(CURRENT_ACCOUNT_KEY) || DEFAULT_ACCOUNT; } catch { return DEFAULT_ACCOUNT; }
}

export const DataManageModal: React.FC<DataManageModalProps> = ({ isOpen, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [currentAccount, setCurrentAccount] = useState<string>(DEFAULT_ACCOUNT);
  const [newAccountName, setNewAccountName] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');
  const [sortMode, setSortMode] = useState<'recent' | 'name'>(() => {
    try { return (localStorage.getItem(SORT_KEY) as 'recent' | 'name') || 'recent'; } catch { return 'recent'; }
  });
  const [accountMsg, setAccountMsg] = useState<string>('');
  const [accountMsgType, setAccountMsgType] = useState<'ok' | 'err'>('ok');
  const [switchNotice, setSwitchNotice] = useState<string>('');
  const [popover, setPopover] = useState<{ kind: 'rename' | 'delete'; name: string; x: number; y: number } | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const accountItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevAccountRects = useRef<Map<string, DOMRect>>(new Map());

  const currentPayload = () => {
    try { return JSON.parse(storage.exportData()); } catch { return {}; }
  };

  const emptyPayloadFromCurrent = () => {
    const p = currentPayload();
    return { ...p, encounteredPets: {}, encounteredPets2: {} };
  };

  const saveLocalCurrent = (name: string) => {
    const list = readLocalAccounts();
    const payload = currentPayload();
    const idx = list.findIndex((a) => a.name === name);
    const item: AccountProfile = { name, payload, updatedAt: new Date().toISOString() };
    if (idx >= 0) list[idx] = item; else list.push(item);
    writeLocalAccounts(list);
    setAccounts(list);
  };

  const refreshAccounts = async () => {
    if (!IS_STATIC) {
      try {
        const data = await api.accountList();
        const list = (data.accounts || []).map((a: any) => ({
          name: a.name,
          payload: null,
          updatedAt: a.updated_at || '',
          maps: a.maps || { map1: 0, map2: 0, map3: 0 },
          fireMaps: a.fire_maps || { map1: 0, map2: 0, map3: 0 },
        }));
        setAccounts(list);
        setCurrentAccount(data.current || DEFAULT_ACCOUNT);
        return true;
      } catch { /* 后端不可用时回退本地 */ }
    }
    let list = readLocalAccounts();
    if (list.length === 0) {
      list = [{ name: DEFAULT_ACCOUNT, payload: currentPayload(), updatedAt: new Date().toISOString() }];
      writeLocalAccounts(list);
    }
    setAccounts(list);
    const current = readLocalCurrent();
    setCurrentAccount(list.some((a) => a.name === current) ? current : list[0].name);
    return false;
  };

  const loadAccounts = async () => { await refreshAccounts(); };

  useEffect(() => {
    if (isOpen) {
      void loadAccounts();
      setMessage('');
      setAccountMsg('');
      setSwitchNotice('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 排序：当前账号永远第一位，其余按“最近更新”或“名称”
  const filteredAccounts = accounts.filter((a) => a.name.includes(searchText.trim()));
  const sortedAccounts = [...filteredAccounts].sort((a, b) => {
    if (a.name === currentAccount) return -1;
    if (b.name === currentAccount) return 1;
    if (sortMode === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  // FLIP：账号重排时平滑移动，避免突然跳动
  const sortedNamesKey = sortedAccounts.map((a) => a.name).join('|');
  useLayoutEffect(() => {
    const currentRects = new Map<string, DOMRect>();
    sortedAccounts.forEach((a) => {
      const el = accountItemRefs.current.get(a.name);
      if (el) currentRects.set(a.name, el.getBoundingClientRect());
    });
    sortedAccounts.forEach((a) => {
      const el = accountItemRefs.current.get(a.name);
      const prev = prevAccountRects.current.get(a.name);
      const cur = currentRects.get(a.name);
      if (!el || !prev || !cur) return;
      const dy = prev.top - cur.top;
      if (Math.abs(dy) > 1) {
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';
          el.style.transform = 'translateY(0px)';
        });
      }
    });
    prevAccountRects.current = currentRects;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedNamesKey, currentAccount]);

  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  const openPopover = (kind: 'rename' | 'delete', name: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setRenameValue(kind === 'rename' ? name : '');
    setPopover({ kind, name, x: rect.left, y: rect.bottom });
  };

  if (!isOpen) return null;

  const handleExport = async () => {
    sound.playClick();
    const data = storage.exportData();
    const defaultFilename = `roco_user_data_${new Date().toISOString().slice(0, 10)}.json`;

    if (!IS_STATIC && typeof window !== 'undefined' && (window as any).pywebview?.api?.save_export_file) {
      try {
        setIsExporting(true);
        const res = await (window as any).pywebview.api.save_export_file(data, defaultFilename);
        if (res?.status === 'ok') {
          setMessage(`导出成功！文件已保存至：${res.path || defaultFilename}`);
          setMsgType('ok');
          return;
        } else if (res?.status === 'cancelled') {
          setMessage('已取消导出'); setMsgType('ok'); return;
        }
      } catch (e: any) {
        console.warn('调用原生保存文件失败，回退到浏览器下载:', e);
      } finally { setIsExporting(false); }
    }

    const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMessage(`已成功导出 ${defaultFilename}（图鉴点亮记录与设置）`); setMsgType('ok');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    sound.playClick();
    try {
      const text = await file.text();
      const ok = storage.importData(text);
      if (ok) {
        setMessage('导入成功！图鉴点亮记录与设置已更新。'); setMsgType('ok');
      } else {
        setMessage('导入失败：文件不是有效的 roco_user_data.json。'); setMsgType('err');
      }
    } catch {
      setMessage('导入失败：无法读取该文件。'); setMsgType('err');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateAccount = async () => {
    const name = newAccountName.trim();
    if (!name) { setAccountMsg('请输入账号名称'); setAccountMsgType('err'); return; }
    sound.playClick();
    try {
      if (!IS_STATIC) {
        await api.accountCreate(name); // 后端只创建空账号，不切换
        await refreshAccounts();
      } else {
        if (readLocalAccounts().some((a) => a.name === name)) {
          setAccountMsg(`账号「${name}」已存在`); setAccountMsgType('err'); return;
        }
        const current = readLocalCurrent();
        saveLocalCurrent(current);
        const list = readLocalAccounts();
        list.push({ name, payload: emptyPayloadFromCurrent(), updatedAt: new Date().toISOString() });
        writeLocalAccounts(list);
        setAccounts(list);
      }
      setNewAccountName('');
      setSwitchNotice(`已新建空账号「${name}」`);
      setAccountMsg(''); setAccountMsgType('ok');
    } catch (e: any) {
      setAccountMsg(`创建失败：${e?.message || e || '未知错误'}`); setAccountMsgType('err');
    }
  };

  const handleSwitchAccount = async (name: string) => {
    if (name === currentAccount) return;
    sound.playClick();
    try {
      if (!IS_STATIC) {
        await api.accountSwitch(name); // 后端自动保存原账号
        await storage.refreshFromServer();
        await refreshAccounts();
        try { localStorage.setItem(CURRENT_ACCOUNT_KEY, name); } catch { /* 忽略 */ }
      } else {
        saveLocalCurrent(currentAccount);
        try { localStorage.setItem(CURRENT_ACCOUNT_KEY, name); } catch { /* 忽略 */ }
        const target = readLocalAccounts().find((a) => a.name === name);
        setCurrentAccount(name);
        if (target) storage.importData(JSON.stringify(target.payload));
        setAccounts(readLocalAccounts());
      }
      setSwitchNotice(`已切换到账号「${name}」`);
      setAccountMsg(''); setAccountMsgType('ok');
    } catch (e: any) {
      setAccountMsg(`切换失败：${e?.message || e || '未知错误'}`); setAccountMsgType('err');
    }
  };

  const handleRenameAccount = async (oldName: string, newName: string) => {
    const clean = newName.trim();
    if (!clean) {
      setAccountMsg('账号名称不能为空'); setAccountMsgType('err'); return;
    }
    if (clean === oldName) { setPopover(null); return; }
    sound.playClick();
    try {
      if (!IS_STATIC) {
        await api.accountRename(oldName, clean);
        await refreshAccounts();
      } else {
        const list = readLocalAccounts();
        if (list.some((a) => a.name === clean)) { setAccountMsg('账号名已存在'); setAccountMsgType('err'); return; }
        const item = list.find((a) => a.name === oldName);
        if (item) {
          item.name = clean;
          writeLocalAccounts(list);
          if (readLocalCurrent() === oldName) { try { localStorage.setItem(CURRENT_ACCOUNT_KEY, clean); } catch { /* 忽略 */ } }
          setAccounts(list);
          setCurrentAccount(clean);
        }
      }
      setPopover(null);
      setSwitchNotice(`账号已重命名为「${clean}」`);
    } catch (e: any) {
      setAccountMsg(`重命名失败：${e?.message || e || '未知错误'}`); setAccountMsgType('err');
    }
  };

  const handleDeleteAccount = async (name: string) => {
    sound.playClick();
    try {
      if (!IS_STATIC) {
        const result = await api.accountDelete(name);
        await storage.refreshFromServer();
        await refreshAccounts();
        setSwitchNotice(`账号「${name}」已删除${result?.name ? `，已切换到「${result.name}」` : ''}`);
      } else {
        const list = readLocalAccounts();
        if (list.length <= 1) { setAccountMsg('至少保留一个账号'); setAccountMsgType('err'); return; }
        saveLocalCurrent(currentAccount);
        const nextList = readLocalAccounts().filter((a) => a.name !== name);
        writeLocalAccounts(nextList);
        setAccounts(nextList);
        if (currentAccount === name) {
          const fallback = nextList[0];
          try { localStorage.setItem(CURRENT_ACCOUNT_KEY, fallback.name); } catch { /* 忽略 */ }
          setCurrentAccount(fallback.name);
          storage.importData(JSON.stringify(fallback.payload));
          setSwitchNotice(`账号「${name}」已删除，已切换到「${fallback.name}」`);
        } else {
          setSwitchNotice(`账号「${name}」已删除`);
        }
      }
      setPopover(null);
      setAccountMsg('');
    } catch (e: any) {
      setAccountMsg(`删除失败：${e?.message || e || '未知错误'}`); setAccountMsgType('err');
    }
  };

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
           onWheel={(e) => e.stopPropagation()} onClick={onClose}>
        <div className="bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#5DA8E8] dark:border-slate-700 shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col transition-colors"
             onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="bg-[#7ABCF4] dark:bg-slate-800 px-5 py-4 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
                <Database className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-base font-black tracking-tight">数据管理</h3>
                <p className="text-[11px] text-white/80 dark:text-slate-300 font-medium">导入 / 导出 + 多账号管理</p>
              </div>
            </div>
            <button type="button" onClick={() => { sound.playClick(); onClose(); }}
                    className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 sm:p-6 space-y-4 overflow-y-auto max-h-[92vh]">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              数据包含图鉴点亮记录、识别门槛与偏好设置。
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={handleExport} disabled={isExporting}
                      className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#EBF4FE] dark:hover:bg-slate-700 hover:border-[#7ABCF4] transition-colors cursor-pointer disabled:opacity-50">
                <div className="w-11 h-11 rounded-xl bg-[#95D151]/20 dark:bg-emerald-950/60 text-[#689F38] dark:text-emerald-400 flex items-center justify-center">
                  <Download className="w-5 h-5" />
                </div>
                <span className="text-xs font-black">{IS_STATIC ? '导出数据' : '自选路径导出'}</span>
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-[#EBF4FE] dark:hover:bg-slate-700 hover:border-[#7ABCF4] transition-colors cursor-pointer">
                <div className="w-11 h-11 rounded-xl bg-[#7ABCF4]/20 dark:bg-sky-950/60 text-[#2B78C4] dark:text-sky-400 flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <span className="text-xs font-black">导入数据</span>
              </button>
            </div>

            {/* 多账号管理 */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 dark:text-slate-100">
                  <UserRound className="w-3.5 h-3.5 text-[#7ABCF4]" />
                  <span>多账号管理</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/60 text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800 font-bold">
                  当前：{currentAccount}
                </span>
              </div>

              {switchNotice && (
                  <div className="flex items-start justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs font-black">
                    <span className="min-w-0 flex-1">
                      <CheckCircle2 className="w-3.5 h-3.5 inline-block mr-1" />
                      {switchNotice}
                    </span>
                    <button type="button" onClick={() => setSwitchNotice('')}
                            className="shrink-0 text-emerald-500 hover:text-emerald-800 dark:hover:text-emerald-200 cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
              )}

              {/* 搜索 + 排序 */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                      type="text"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="搜索账号..."
                      className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-sky-400"
                  />
                </div>
                <select
                    value={sortMode}
                    onChange={(e) => {
                      const v = e.target.value as 'recent' | 'name';
                      setSortMode(v);
                      try { localStorage.setItem(SORT_KEY, v); } catch { /* 忽略 */ }
                    }}
                    className="shrink-0 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 focus:outline-none"
                >
                  <option value="recent">最近更新</option>
                  <option value="name">名称排序</option>
                </select>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {sortedAccounts.map((acc) => {
                  const isCurrent = acc.name === currentAccount;
                  return (
                      <div
                          key={acc.name}
                          ref={(el) => {
                            if (el) accountItemRefs.current.set(acc.name, el);
                            else accountItemRefs.current.delete(acc.name);
                          }}
                          className={`flex items-center justify-between gap-2 p-2 rounded-xl border text-[11px] ${
                               isCurrent
                                   ? 'bg-sky-50 dark:bg-sky-950/50 border-[#7ABCF4] dark:border-sky-700'
                                   : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                           }`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-black text-slate-800 dark:text-slate-100 truncate flex items-center gap-1">
                            {acc.name}
                            {isCurrent && <span className="text-[9px] px-1 rounded bg-[#7ABCF4] text-white">当前</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {['map1', 'map2', 'map3'].map((m) => (
                                <span key={m} className="px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-[9px] font-bold text-slate-600 dark:text-slate-300">
                                  {m.replace('map', '图')}·{acc.maps?.[m] ?? 0}
                                </span>
                            ))}
                          </div>
                          <div className="text-[9px] text-slate-400 font-mono mt-0.5">更新于 {acc.updatedAt || '—'}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!isCurrent && (
                              <button type="button" onClick={() => handleSwitchAccount(acc.name)}
                                      className="px-2 py-1 rounded-lg bg-[#7ABCF4] hover:bg-[#5DA8E8] text-white text-[10px] font-black cursor-pointer">
                                切换
                              </button>
                          )}
                          <button type="button" onClick={(e) => { setRenameValue(acc.name); openPopover('rename', acc.name, e); }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer" title="重命名">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={(e) => openPopover('delete', acc.name, e)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer" title="删除账号">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                  );
                })}
                {sortedAccounts.length === 0 && (
                    <div className="text-[11px] text-slate-400 text-center py-2">没有匹配的账号</div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAccount(); }}
                    placeholder="新账号名称（空图鉴）"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-sky-400"
                />
                <button type="button" onClick={handleCreateAccount}
                        className="shrink-0 px-2.5 py-1.5 rounded-lg bg-[#95D151] hover:bg-[#84C242] text-white text-xs font-black flex items-center gap-1 cursor-pointer">
                  <Plus className="w-3.5 h-3.5" />
                  新建
                </button>
              </div>
              <div className="text-[10px] text-slate-400 leading-snug">
                新建账号只清空精灵图鉴，系统设置与识别门槛等全局数据保留。
              </div>

              {accountMsg && (
                  <div className={`flex items-start justify-between gap-2 text-[10px] font-medium ${
                      accountMsgType === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                  }`}>
                    <span className="min-w-0 flex-1">{accountMsg}</span>
                    <button type="button" onClick={() => setAccountMsg('')} className="shrink-0 cursor-pointer opacity-70 hover:opacity-100">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <FileJson className="w-3.5 h-3.5 shrink-0" />
              <span>账号保存在数据目录的 accounts/ 文件夹中，关闭 App 后依然保留。</span>
            </div>

            {message && (
                <div className={`flex items-start gap-2 p-3 rounded-xl border-2 text-[11px] font-medium break-all ${
                    msgType === 'ok'
                        ? 'bg-[#F0FDF4] dark:bg-emerald-950/60 border-[#BBF7D0] dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                }`}>
                  {msgType === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <span className="min-w-0 flex-1">{message}</span>
                  <button type="button" onClick={() => setMessage('')} className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
            )}
          </div>

          <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
        </div>

        {/* 重命名 / 删除气泡弹窗（小气泡，非全屏） */}
        {popover && (
            <div
                ref={popoverRef}
                style={{ left: Math.min(popover.x, window.innerWidth - 270), top: popover.y + 6 }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="fixed z-[70] w-[260px] max-w-[90vw] bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl p-3 space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-slate-800 dark:text-slate-100">
                  {popover.kind === 'rename' ? `重命名「${popover.name}」` : `删除「${popover.name}」`}
                </div>
                <button type="button" onClick={() => setPopover(null)}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {popover.kind === 'rename' ? (
                  <>
                    <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRenameAccount(popover.name, renameValue);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:border-sky-400"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => setPopover(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer">
                        取消
                      </button>
                      <button type="button" onClick={() => void handleRenameAccount(popover.name, renameValue)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-black text-white bg-[#7ABCF4] hover:bg-[#5DA8E8] cursor-pointer">
                        确定
                      </button>
                    </div>
                  </>
              ) : (
                  <>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      删除前会自动保存当前数据，且至少保留一个账号。
                    </p>
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => setPopover(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer">
                        取消
                      </button>
                      <button type="button" onClick={() => void handleDeleteAccount(popover.name)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-black text-white bg-rose-500 hover:bg-rose-600 cursor-pointer">
                        删除
                      </button>
                    </div>
                  </>
              )}
            </div>
        )}

      </div>
  );
};
