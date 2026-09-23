import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { X, Upload, Download, Database, CheckCircle2, AlertTriangle, FileJson, Plus, UserRound, Trash2, Pencil, Search, Cloud, RefreshCw, Unlink, KeyRound, ShieldAlert, MonitorSmartphone } from 'lucide-react';
import { sound } from '../services/sound';
import { ModalHeader } from './ModalHeader';
import { storage } from '../services/storage';
import { fireStorage } from '../services/fireStorage';
import { api } from '../services/api';
import { IS_STATIC } from '../services/staticMode';
import { webAccounts, DEFAULT_ACCOUNT } from '../services/webAccounts';
import { cloudSync, type CloudSyncState } from '../services/cloudSync';
import { useAuthStatus } from '../services/auth';
import { ConfirmDialog } from './ConfirmDialog';

/** 毫秒时间戳 → 本地可读时间（空值显示 —）。 */
function fmtMs(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
}

interface DataManageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AccountMeta {
  name: string;
  updatedAt: string;
  maps?: Record<string, number>;
  fireMaps?: Record<string, number>;
}

const SORT_KEY = 'roco_account_sort';

export const DataManageModal: React.FC<DataManageModalProps> = ({ isOpen, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [accounts, setAccounts] = useState<AccountMeta[]>([]);
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
  const [cloudState, setCloudState] = useState<CloudSyncState>(() => cloudSync.getState());
  const [cloudCode, setCloudCode] = useState('');
  const [cloudMsg, setCloudMsg] = useState('');
  const [cloudMsgType, setCloudMsgType] = useState<'ok' | 'err'>('ok');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudRefreshing, setCloudRefreshing] = useState(false);
  // 桌面端：本机生成的配对码
  const [pairCode, setPairCode] = useState('');
  // 覆盖类操作的二次确认
  const [cloudConfirm, setCloudConfirm] = useState<null | 'pull' | 'push' | { revoke: string }>(null);
  const [showAgreement, setShowAgreement] = useState(false);
  // 桌面端：已配对的网页端列表
  const [bindings, setBindings] = useState<Array<{ webCode: string; shortId: string; createdAt: string; lastUsedAt: string | null; ip: string }>>([]);
  const [bindingsLoaded, setBindingsLoaded] = useState(false);
  const [cloudStatusLocal, setCloudStatusLocal] = useState<{
    lastSyncAt?: number; lastPushAt?: number; cloudUpdatedAt?: string | null;
    cloudAhead?: boolean; syncing?: boolean;
  }>({});
  // 桌面端的「已同意协议」标记。
  //
  // 存在**用户自己的 roco_user_data.json 顶层字段**（cloudSyncAgreed），不用
  // localStorage：桌面端 WebView 是 private 模式，localStorage 关掉 App 就没了，
  // 依赖它就会出现「每次打开都要重新同意一次」。
  // null = 还没从本机接口读回来（此时不显示"请先同意"，避免闪一下）。
  const [agreedLocal, setAgreedLocal] = useState<boolean | null>(null);

  // 云同步设备门禁：未授权（含等待绑定/过期/异常）时桌面端不允许同步。
  // 提示明确写「未授权」并指向角标绑定入口；网页端无需判断（authStore 恒为
  // authorized），因为它的绑定码只能由已授权的桌面端生成，源头已被后端拦住。
  const auth = useAuthStatus();
  const cloudLocked = !IS_STATIC && !['authorized', 'offline', 'pending'].includes(auth.status);

  /** 从本机接口读一次协议同意状态（打开「数据管理」时调用）。 */
  const loadAgreedLocal = async () => {
    try {
      const res = await axios.get(`${api.getApiBase()}/api/cloud/agreement`, { timeout: 5000 });
      const agreed = !!(res.data?.agreed ?? res.data?.data?.agreed);
      setAgreedLocal(agreed);
    } catch {
      // 本机服务不可用时保守处理：按「未同意」展示，用户仍可点同意重试
      setAgreedLocal(false);
    }
  };

  /** 把协议同意状态写进 roco_user_data.json（本机接口）。返回是否写入成功。 */
  const writeAgreedLocal = async (v: boolean): Promise<boolean> => {
    try {
      await axios.post(`${api.getApiBase()}/api/cloud/agreement`, { agreed: v }, { timeout: 5000 });
      setAgreedLocal(v);
      return true;
    } catch (e) {
      console.warn('保存《云端同步协议》同意状态失败', e);
      setCloudMsg('保存「已同意协议」状态失败，请确认本机服务正常后重试');
      setCloudMsgType('err');
      return false;
    }
  };
  const [renameValue, setRenameValue] = useState<string>('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const accountItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevAccountRects = useRef<Map<string, DOMRect>>(new Map());

  /**
   * 桌面端：本机后端的数据文件变了（云端覆盖本地 / 切账号 / 删账号 / 导入存档）之后，
   * 必须让前端的两个 storage 服务重新拉一次。
   *
   * 两个服务都在内存里缓存了一份副本，不重新拉的话：
   *   1) 界面还显示旧数据，要退出 App 重进才更新；
   *   2) 更糟的是，下一次落盘会拿这份旧副本把刚写进来的数据覆盖回去。
   * 草系走 storage（encounteredPets），火系走 fireStorage（encounteredPets2），两个都要刷。
   */
  const refreshLocalDataFromBackend = async () => {
    if (IS_STATIC) return;
    await storage.refreshFromServer();
    try {
      await fireStorage.fetchRemote();
    } catch {
      /* 火系数据拉取失败不影响草系刷新结果 */
    }
  };

  const refreshAccounts = async () => {
    if (!IS_STATIC) {
      try {
        const data = await api.accountList();
        const list = (data.accounts || []).map((a: any) => ({
          name: a.name,
          updatedAt: a.updated_at || '',
          maps: a.maps || { map1: 0, map2: 0, map3: 0 },
          fireMaps: a.fire_maps || { map1: 0, map2: 0, map3: 0 },
        }));
        setAccounts(list);
        setCurrentAccount(data.current || DEFAULT_ACCOUNT);
        return;
      } catch { /* 后端不可用时忽略 */ }
    }
    const list = webAccounts.list().map((m) => ({ ...m }));
    setAccounts(list);
    setCurrentAccount(webAccounts.current());
  };

  useEffect(() => {
    if (isOpen) {
      void refreshAccounts();
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

  const lastSyncAtRef = useRef<number | null>(null);
  useEffect(() => {
    const unsub = cloudSync.subscribe((st) => {
      setCloudState(st);
      if (st.lastSyncAt && st.lastSyncAt !== lastSyncAtRef.current) {
        lastSyncAtRef.current = st.lastSyncAt;
        void refreshAccounts();
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打开数据管理时：重读一次协议同意状态（避免 UI 缓存与真实状态不一致），
  // 桌面端再拉一次配对列表
  useEffect(() => {
    if (!isOpen) return;
    if (IS_STATIC) {
      cloudSync.refreshAgreed();
      void cloudSync.refreshMeta();
    } else {
      // 桌面端：协议状态存在用户自己的 roco_user_data.json 里，从本机接口读
      void loadAgreedLocal();
    }
    if (!IS_STATIC && !cloudLocked) {
      void loadCloudStatus();
      if (!bindingsLoaded) void loadBindings();
    }
  }, [isOpen, bindingsLoaded]);

  if (!isOpen) return null;

  const cloudAgreed = IS_STATIC ? cloudState.agreed : agreedLocal === true;
  // 桌面端协议状态还在读取中：此时不展示「请先同意」，避免闪一下
  const cloudAgreedLoading = !IS_STATIC && agreedLocal === null;

  const handleCloudBind = async () => {
    sound.playClick();
    setCloudBusy(true);
    setCloudMsg('');
    const res = await cloudSync.bind(cloudCode);
    setCloudMsg(res.msg);
    setCloudMsgType(res.ok ? 'ok' : 'err');
    if (res.ok) setCloudCode('');
    setCloudBusy(false);
  };

  const handleCloudPull = async () => {
    sound.playClick();
    setCloudBusy(true);
    setCloudMsg('');
    const res = await cloudSync.pullOverwrite();
    setCloudMsg(res.msg);
    setCloudMsgType(res.ok ? 'ok' : 'err');
    await refreshAccounts();
    setCloudBusy(false);
  };

  const handleCloudPush = async () => {
    sound.playClick();
    setCloudBusy(true);
    setCloudMsg('');
    const res = await cloudSync.pushOverwrite();
    setCloudMsg(res.msg);
    setCloudMsgType(res.ok ? 'ok' : 'err');
    await refreshAccounts();
    setCloudBusy(false);
  };

  /** 桌面端：向后端申请一次性配对码，显示给用户去网页版绑定。 */
  const handleCloudUnbind = async () => {
    sound.playClick();
    setCloudBusy(true);
    await cloudSync.unbind();
    setCloudMsg('已解除云端同步绑定（本地数据保留）');
    setCloudMsgType('ok');
    await refreshAccounts();
    setCloudBusy(false);
  };

  const handleDesktopPairCode = async () => {
    sound.playClick();
    setCloudBusy(true);
    setCloudMsg('');
    try {
      const res = await axios.get(`${api.getApiBase()}/api/cloud/pair_code`, { timeout: 20000 });
      if (res.data?.status === 'success' && res.data?.code) {
        setPairCode(String(res.data.code));
        setCloudMsg('配对码已生成：请在网页版「数据管理 → 云端同步」里填入');
        setCloudMsgType('ok');
      } else {
        setCloudMsg(res.data?.message || '生成配对码失败');
        setCloudMsgType('err');
      }
    } catch (e: any) {
      setCloudMsg(`生成配对码失败：${e?.message || '云端不可达'}`);
      setCloudMsgType('err');
    }
    setCloudBusy(false);
  };

  const loadCloudStatus = async () => {
    if (IS_STATIC) return;
    try {
      const res = await axios.get(`${api.getApiBase()}/api/cloud/status`, { timeout: 10000 });
      if (res.data?.status === 'success') {
        setCloudStatusLocal({
          lastSyncAt: Number(res.data.lastSyncAt) * 1000 || 0,
          lastPushAt: Number(res.data.lastPushAt) * 1000 || 0,
          cloudUpdatedAt: res.data.cloudUpdatedAt || null,
          cloudAhead: !!res.data.cloudAhead,
          syncing: !!res.data.syncing,
        });
      }
    } catch {
      /* 状态拿不到就不显示，不影响功能 */
    }
  };

  const handleRefreshCloudMetaWeb = async () => {
    sound.playClick();
    setCloudRefreshing(true);
    setCloudMsg('');
    const res = await cloudSync.refreshMeta();
    if (res.ok) {
      setCloudMsg('已刷新云端最后更新时间');
      setCloudMsgType('ok');
    } else {
      setCloudMsg(res.msg || '刷新云端时间失败');
      setCloudMsgType('err');
    }
    setCloudRefreshing(false);
  };

  const handleRefreshCloudMeta = async () => {
    sound.playClick();
    setCloudRefreshing(true);
    setCloudMsg('');
    try {
      const res = await axios.post(`${api.getApiBase()}/api/cloud/refresh`, {}, { timeout: 20000 });
      if (res.data?.status === 'success') {
        const at = res.data?.cloudUpdatedAt || null;
        setCloudStatusLocal((prev) => ({
          ...prev,
          cloudUpdatedAt: at,
          cloudAhead: !!res.data?.cloudAhead,
        }));
        if (at) {
          setCloudMsg(`云端最后更新：${at}`);
          setCloudMsgType('ok');
        } else {
          setCloudMsg('云端还没有数据，请先点「本地覆盖云端」上传');
          setCloudMsgType('err');
        }
      } else {
        setCloudMsg(res.data?.message || '刷新云端时间失败');
        setCloudMsgType('err');
      }
    } catch (e: any) {
      setCloudMsg(`刷新云端时间失败：${e?.message || '云端不可达'}`);
      setCloudMsgType('err');
    }
    setCloudRefreshing(false);
  };

  /** 桌面端：拉取已配对的网页端列表。 */
  const loadBindings = async () => {
    if (IS_STATIC) return;
    try {
      const res = await axios.get(`${api.getApiBase()}/api/cloud/bindings`, { timeout: 20000 });
      if (res.data?.status === 'success') {
        setBindings(Array.isArray(res.data.bindings) ? res.data.bindings : []);
      }
      setBindingsLoaded(true);
    } catch {
      setBindingsLoaded(true);
    }
  };

  /** 桌面端：撤销某个网页端的同步权限。 */
  const handleRevokeBinding = async (webCode: string) => {
    setCloudBusy(true);
    setCloudMsg('');
    try {
      const res = await axios.post(`${api.getApiBase()}/api/cloud/bindings/revoke`, { webCode }, { timeout: 20000 });
      if (res.data?.status === 'success') {
        setCloudMsg('已撤销该网页端的同步权限');
        setCloudMsgType('ok');
        await loadBindings();
      } else {
        setCloudMsg(res.data?.message || '撤销失败');
        setCloudMsgType('err');
      }
    } catch (e: any) {
      setCloudMsg(`撤销失败：${e?.message || '云端不可达'}`);
      setCloudMsgType('err');
    }
    setCloudBusy(false);
  };

  const handleDesktopPull = async () => {
    sound.playClick();
    setCloudBusy(true);
    setCloudMsg('');
    try {
      await storage.flushPendingSave();
      try {
        await fireStorage.flushPendingSave();
      } catch {
        /* 火系落盘失败不阻塞拉取 */
      }
      const res = await axios.post(`${api.getApiBase()}/api/cloud/pull`, {}, { timeout: 60000 });
      if (res.data?.status === 'success') {
        setCloudMsg('已用云端数据覆盖本地');
        setCloudMsgType('ok');
        // 桌面端同步走本机后端：前端两个 storage 服务的内存副本、账号列表、
        // 同步时间都要立刻刷新，否则界面还是旧数据（以前得退出 App 再进）
        await refreshLocalDataFromBackend();
        await refreshAccounts();
        await loadCloudStatus();
      } else {
        setCloudMsg(res.data?.message || '拉取失败');
        setCloudMsgType('err');
      }
    } catch (e: any) {
      setCloudMsg(`拉取失败：${e?.message || '云端不可达'}`);
      setCloudMsgType('err');
    }
    setCloudBusy(false);
  };

  const handleDesktopPush = async () => {
    sound.playClick();
    setCloudBusy(true);
    setCloudMsg('');
    try {
      const res = await axios.post(`${api.getApiBase()}/api/cloud/push`, {}, { timeout: 60000 });
      if (res.data?.status === 'success') {
        setCloudMsg('已用本地数据覆盖云端');
        setCloudMsgType('ok');
        await refreshAccounts();
        await loadCloudStatus();
      } else {
        setCloudMsg(res.data?.message || '上传失败');
        setCloudMsgType('err');
      }
    } catch (e: any) {
      setCloudMsg(`上传失败：${e?.message || '云端不可达'}`);
      setCloudMsgType('err');
    }
    setCloudBusy(false);
  };

  /** 二次确认弹窗里点「确定」后真正执行的动作。 */
  const runCloudConfirm = async () => {
    const c = cloudConfirm;
    if (!c) return;
    if (c === 'pull') {
      if (IS_STATIC) await handleCloudPull();
      else await handleDesktopPull();
    } else if (c === 'push') {
      if (IS_STATIC) await handleCloudPush();
      else await handleDesktopPush();
    } else if (typeof c === 'object' && 'revoke' in c) {
      await handleRevokeBinding(c.revoke);
    }
  };

  const handleExport = async () => {
    sound.playClick();
    const data = IS_STATIC ? webAccounts.exportSingle() : storage.exportData();
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
      const parsed = JSON.parse(text);

      const isArchive = !!parsed && parsed.app === 'roco-multi-account' && Array.isArray(parsed.accounts);

      // 整套多账号存档：web 版写 localStorage，桌面版交给后端拆成每个账号一个文件。
      // 桌面版此前没有这条分支，会被下面的单账号导入接住，把整份存档当成精灵
      // 记录写进主数据（进度被清空且界面还提示成功）。
      if (isArchive) {
        if (IS_STATIC) {
          const result = webAccounts.importAll(text);
          await refreshAccounts();
          setMessage(`导入成功：共 ${result.count} 个账号，当前为「${result.current}」`);
        } else {
          const result = await api.accountImportArchive(parsed);
          await refreshLocalDataFromBackend();
          await refreshAccounts();
          setMessage(`导入成功：共 ${result.count ?? parsed.accounts.length} 个账号，当前为「${result.name || parsed.current}」`);
        }
        setMsgType('ok');
        return;
      }

      if (IS_STATIC) {
        const ok = webAccounts.importSingle(text);
        await refreshAccounts();
        if (ok) {
          setMessage('导入成功！当前账号图鉴点亮记录与设置已更新。'); setMsgType('ok');
        } else {
          setMessage('导入失败：文件不是有效的 roco_user_data.json。'); setMsgType('err');
        }
        return;
      }

      const ok = storage.importData(text);
      if (ok) {
        // importData 内部是异步落盘（triggerSave → void saveToRemote），这里等它真正写完，
        // 否则紧接着的账号列表刷新会读到旧数据，多账号面板要重开才更新。
        await storage.flushPendingSave();
        await refreshAccounts();
        setMessage('导入成功！当前账号图鉴点亮记录与设置已更新。'); setMsgType('ok');
      } else {
        setMessage('导入失败：文件不是有效的 roco_user_data.json。'); setMsgType('err');
      }
    } catch {
      setMessage('导入失败：无法读取该文件。'); setMsgType('err');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadJsonFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportAllAccounts = async () => {
    if (!IS_STATIC) {
      setMessage('桌面版多账号在 accounts/ 目录中，请直接备份该目录'); setMsgType('ok'); return;
    }
    sound.playClick();
    const content = webAccounts.exportAll();
    downloadJsonFile(`roco_accounts_${new Date().toISOString().slice(0, 10)}.json`, content);
    setMessage('已导出全部账号（含当前账号最新数据）'); setMsgType('ok');
  };

  const handleCreateAccount = async () => {
    const name = newAccountName.trim();
    if (!name) { setAccountMsg('请输入账号名称'); setAccountMsgType('err'); return; }
    sound.playClick();
    try {
      if (!IS_STATIC) {
        await api.accountCreate(name); // 后端只创建空账号，不切换
      } else {
        webAccounts.create(name);
      }
      await refreshAccounts();
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
        await refreshLocalDataFromBackend();
      } else {
        webAccounts.switchTo(name);
      }
      await refreshAccounts();
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
      } else {
        webAccounts.rename(oldName, clean);
      }
      await refreshAccounts();
      setPopover(null);
      setSwitchNotice(`账号已重命名为「${clean}」`);
    } catch (e: any) {
      setAccountMsg(`重命名失败：${e?.message || e || '未知错误'}`); setAccountMsgType('err');
    }
  };

  const handleDeleteAccount = async (name: string) => {
    sound.playClick();
    const wasCurrent = name === currentAccount;
    try {
      if (!IS_STATIC) {
        const result = await api.accountDelete(name);
        await refreshLocalDataFromBackend();
        await refreshAccounts();
        setSwitchNotice(`账号「${name}」已删除${result?.name ? `，已切换到「${result.name}」` : ''}`);
      } else {
        const fallback = webAccounts.remove(name);
        await refreshAccounts();
        setSwitchNotice(wasCurrent ? `账号「${name}」已删除，已切换到「${fallback}」` : `账号「${name}」已删除`);
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
        <div className="bg-white dark:bg-slate-900 rounded-[26px] shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col transition-colors"
             onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <ModalHeader
              icon={Database}
              tone="sky"
              title="数据管理"
              subtitle="导入 / 导出 + 多账号管理"
              onClose={onClose}
              closeTitle="关闭 (Esc)"
          />

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

            {IS_STATIC && (
                <button type="button" onClick={handleExportAllAccounts}
                        className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 border-dashed border-[#95D151]/70 dark:border-emerald-700/70 bg-emerald-50/60 dark:bg-emerald-950/30 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-black transition-colors cursor-pointer">
                  <Download className="w-4 h-4" />
                  导出全部账号
                </button>
            )}

            {}
            {(
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 dark:text-slate-100">
                      <Cloud className="w-3.5 h-3.5 text-[#7ABCF4]" />
                      <span>云端同步</span>
                      <button
                          type="button"
                          onClick={() => { sound.playClick(); setShowAgreement(true); }}
                          className="text-[10px] font-black text-[#1E5B99] dark:text-sky-400 hover:underline cursor-pointer"
                          title="查看《云端同步协议》（数据上传说明与免责声明）"
                      >
                        《云端同步协议》
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {IS_STATIC && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                              cloudState.bound
                                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}>
                            {cloudState.syncing ? '同步中…' : cloudState.bound ? '已绑定' : '未绑定'}
                          </span>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                    只能<b>手动同步</b>：不会自动读写云端，只有你点下面的按钮才会同步，
                    全程<b>整体覆盖</b>（不合并）——「云端覆盖本地」会丢掉本地未上传的改动。
                  </p>

                  {cloudAgreedLoading ? (
                      <div className="rounded-2xl border-2 border-dashed border-[#BCD7F2] dark:border-sky-900/60 bg-[#F4F9FF] dark:bg-slate-800/90 p-3 text-[11px] text-slate-500 dark:text-slate-400">
                        正在读取《云端同步协议》状态…
                      </div>
                  ) : !cloudAgreed ? (
                      <div className="rounded-2xl border-2 border-dashed border-[#BCD7F2] dark:border-sky-900/60 bg-[#F4F9FF] dark:bg-slate-800/90 p-3 space-y-2">
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                          云端同步会把你的<b>全部账号</b>图鉴记录上传到作者的云端服务器，
                          并且同步是<b>整体覆盖</b>。首次使用前需要先阅读并同意《云端同步协议》。
                        </p>
                        <button
                            type="button"
                            onClick={() => { sound.playClick(); setShowAgreement(true); }}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl roco-btn-primary text-xs cursor-pointer"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                          阅读并同意《云端同步协议》
                        </button>
                      </div>
                  ) : cloudLocked ? (
                      <div className="rounded-2xl border-2 border-dashed border-[#BCD7F2] dark:border-sky-900/60 bg-[#F4F9FF] dark:bg-slate-800/90 p-3 space-y-1.5">
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                          当前设备<b>未授权</b>，云端同步暂不可用；图鉴、识别等其它功能均不受影响。
                        </p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
                          可点右上角「未授权」角标获取绑定指令，授权完成后回到这里即可正常使用。
                        </p>
                      </div>
                  ) : !IS_STATIC ? (
                      <>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                          想让<b>网页版/手机</b>共用这份数据：点「生成配对码」，在网页版
                          「数据管理 → 云端同步」里填入 6 位数字即可。
                        </p>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed space-y-0.5">
                          <div>本机最近上传：<span className="font-mono">{fmtMs(cloudStatusLocal.lastPushAt)}</span></div>
                          <div>本机上次同步：<span className="font-mono">{fmtMs(cloudStatusLocal.lastSyncAt)}</span></div>
                          <div className="flex items-center gap-1.5">
                            <span>云端最后更新：<span className="font-mono">{cloudStatusLocal.cloudUpdatedAt || '—'}</span></span>
                            <button
                                type="button"
                                onClick={handleRefreshCloudMeta}
                                disabled={cloudBusy || cloudRefreshing}
                                title="从服务器重新获取云端的最后更新时间（只读元信息，不会下载或上传数据）"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg border border-[#BCD7F2] dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-black text-[#1E5B99] dark:text-sky-400 hover:bg-[#EBF4FE] dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                            >
                              <RefreshCw className={`w-3 h-3 ${cloudRefreshing ? 'animate-spin' : ''}`} />
                              {cloudRefreshing ? '刷新中…' : '刷新'}
                            </button>
                          </div>
                        </div>
                        {(() => {
                          const newer = !!cloudStatusLocal.cloudAhead;
                          return newer ? (
                              <div className="text-[11px] font-bold text-[#854D0E] dark:text-amber-200 bg-[#FEF9E6] dark:bg-amber-950/60 border border-[#E5C43B] dark:border-amber-700 rounded-xl px-2.5 py-1.5 leading-snug">
                                云端数据比本机上次同步更新（可能是另一台设备上传的），建议先点「云端覆盖本地」
                              </div>
                          ) : null;
                        })()}
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={handleDesktopPairCode} disabled={cloudBusy}
                                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl roco-btn-primary text-xs disabled:opacity-50">
                            <KeyRound className="w-3.5 h-3.5" />
                            生成配对码
                          </button>
                          <button type="button" onClick={() => { sound.playClick(); setCloudConfirm('pull'); }} disabled={cloudBusy}
                                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl roco-btn-secondary text-xs disabled:opacity-50">
                            <Download className="w-3.5 h-3.5" />
                            云端覆盖本地
                          </button>
                        </div>
                        <button type="button" onClick={() => { sound.playClick(); setCloudConfirm('push'); }} disabled={cloudBusy}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl roco-btn-secondary text-xs disabled:opacity-50">
                          <Upload className="w-3.5 h-3.5" />
                          本地覆盖云端
                        </button>
                        {pairCode && (
                            <div className="rounded-2xl border-2 border-dashed border-[#7ABCF4] dark:border-sky-700 bg-[#F4F9FF] dark:bg-sky-950/30 py-3 text-center space-y-1">
                              <div className="text-3xl font-mono font-black tracking-[0.35em] text-[#1E5B99] dark:text-sky-300 pl-[0.35em]">
                                {pairCode}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                                10 分钟内有效 · 只能使用一次
                              </div>
                            </div>
                        )}

                        {/* 已配对的网页端：可以单独撤销（撤销后那个浏览器立刻失去同步权限） */}
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black text-slate-600 dark:text-slate-300 flex items-center gap-1">
                              <MonitorSmartphone className="w-3.5 h-3.5 text-[#7ABCF4]" />
                              已配对的网页端
                            </span>
                            <button type="button" onClick={() => void loadBindings()}
                                    className="text-[10px] font-black text-[#1E5B99] dark:text-sky-400 hover:underline cursor-pointer">
                              刷新
                            </button>
                          </div>
                          {bindings.length === 0 ? (
                              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                                {bindingsLoaded ? '还没有网页端配对过' : '正在读取…'}
                              </p>
                          ) : (
                              bindings.map((b) => (
                                  <div key={b.webCode}
                                       className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border-2 border-[#E6EEF8] dark:border-slate-700 bg-[#F8FBFE] dark:bg-slate-800">
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-mono font-black text-slate-700 dark:text-slate-200">
                                        {b.shortId}…
                                      </div>
                                      <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                        配对于 {b.createdAt || '—'}
                                        {' · '}最近使用 {b.lastUsedAt || '—'}
                                        {b.ip && b.ip !== '—' ? ` · ${b.ip}` : ''}
                                      </div>
                                    </div>
                                    <button type="button" disabled={cloudBusy}
                                            onClick={() => { sound.playClick(); setCloudConfirm({ revoke: b.webCode }); }}
                                            className="shrink-0 px-2 py-1 rounded-lg text-[10px] font-black text-rose-600 dark:text-rose-300 border border-rose-300 dark:border-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 disabled:opacity-50 cursor-pointer">
                                      解除
                                    </button>
                                  </div>
                              ))
                          )}
                        </div>
                      </>
                  ) : !cloudState.bound ? (
                      <>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                          在<b>桌面端「数据管理 → 云端同步」</b>点「生成配对码」，把 6 位数字填到这里，
                          之后浏览器与桌面端就会共用同一份图鉴记录。
                        </p>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                                value={cloudCode}
                                onChange={(e) => setCloudCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                onKeyDown={(e) => { if (e.key === 'Enter') void handleCloudBind(); }}
                                inputMode="numeric"
                                placeholder="6 位配对码"
                                className="w-full pl-8 pr-3 py-2 rounded-xl border-2 border-[#D5E3F0] dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono tracking-[0.3em] text-slate-800 dark:text-slate-100 outline-none focus:border-[#7ABCF4]"
                            />
                          </div>
                          <button type="button" onClick={handleCloudBind}
                                  disabled={cloudBusy || cloudCode.length !== 6}
                                  className="px-4 py-2 rounded-xl roco-btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                            {cloudBusy ? '绑定中…' : '绑定'}
                          </button>
                        </div>
                      </>
                  ) : (
                      <>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed space-y-0.5">
                          <div>本机最近上传：<span className="font-mono">{fmtMs(cloudState.lastPushAt)}</span></div>
                          <div>本机上次同步：<span className="font-mono">{fmtMs(cloudState.lastSyncAt)}</span></div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>
                              云端最后更新：<span className="font-mono">{cloudState.cloudUpdatedAt || '—'}</span>
                              {cloudState.cloudBytes > 0 && ` · 云端 ${(cloudState.cloudBytes / 1024).toFixed(1)} KB`}
                            </span>
                            <button
                                type="button"
                                onClick={handleRefreshCloudMetaWeb}
                                disabled={cloudBusy || cloudRefreshing}
                                title="从服务器重新获取云端的最后更新时间（只读元信息，不会下载或上传数据）"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg border border-[#BCD7F2] dark:border-slate-700 bg-white dark:bg-slate-800 text-[10px] font-black text-[#1E5B99] dark:text-sky-400 hover:bg-[#EBF4FE] dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                            >
                              <RefreshCw className={`w-3 h-3 ${cloudRefreshing ? 'animate-spin' : ''}`} />
                              {cloudRefreshing ? '刷新中…' : '刷新'}
                            </button>
                          </div>
                        </div>
                        {(() => {
                          const newer = cloudState.cloudAhead;
                          return newer ? (
                              <div className="text-[11px] font-bold text-[#854D0E] dark:text-amber-200 bg-[#FEF9E6] dark:bg-amber-950/60 border border-[#E5C43B] dark:border-amber-700 rounded-xl px-2.5 py-1.5 leading-snug">
                                云端数据比本机上次同步更新（可能是另一台设备上传的），建议先点「云端覆盖本地」
                              </div>
                          ) : null;
                        })()}
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => { sound.playClick(); setCloudConfirm('pull'); }} disabled={cloudBusy}
                                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl roco-btn-secondary text-xs disabled:opacity-50">
                            <Download className="w-3.5 h-3.5" />
                            云端覆盖本地
                          </button>
                          <button type="button" onClick={() => { sound.playClick(); setCloudConfirm('push'); }} disabled={cloudBusy}
                                  className="flex items-center justify-center gap-1.5 py-2 rounded-xl roco-btn-primary text-xs disabled:opacity-50">
                            <Upload className="w-3.5 h-3.5" />
                            本地覆盖云端
                          </button>
                        </div>
                        <button type="button" onClick={handleCloudUnbind} disabled={cloudBusy}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl roco-btn-secondary text-xs disabled:opacity-50">
                          <Unlink className="w-3.5 h-3.5" />
                          解除绑定
                        </button>
                      </>
                  )}

                  {(cloudMsg || cloudState.lastError) && (
                      <div className={`text-[11px] font-bold px-3 py-2 rounded-xl border ${
                          (cloudMsg ? cloudMsgType === 'ok' : false)
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                              : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                      }`}>
                        {cloudMsg || cloudState.lastError}
                      </div>
                  )}
                </div>
            )}

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
              <span>
                {IS_STATIC
                    ? '账号保存在当前浏览器本地存储中，清理浏览器数据会丢失，请及时用「导出全部账号」备份。'
                    : '账号保存在数据目录的 accounts/ 文件夹中，关闭 App 后依然保留。'}
              </span>
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

        {}
        {createPortal(
            /* React 的事件是按「React 树」冒泡的：portal 虽然挂到了 body，
               但它在 React 树里仍是本弹窗的子节点，点击会一路冒泡到外层遮罩的
               onClick={onClose} 把整个「数据管理」关掉。这里显式截断传播。 */
            <div onClick={(e) => e.stopPropagation()}>
        {}
        <ConfirmDialog
            isOpen={cloudConfirm !== null && cloudConfirm !== 'auto'}
            title={
              cloudConfirm === 'pull' ? '用云端覆盖本地？'
                  : cloudConfirm === 'push' ? '用本地覆盖云端？'
                      : '解除这台网页端的配对？'
            }
            description={
              cloudConfirm === 'pull'
                  ? '会用云端那份数据直接替换本机【全部账号】的图鉴记录。'
                  : cloudConfirm === 'push'
                      ? `会把本机【全部账号】（当前 ${accounts.length} 个）的图鉴记录上传覆盖云端。`
                      : '解除后，这个浏览器将立刻失去云端同步权限。'
            }
            detail={
              cloudConfirm === 'pull'
                  ? '本机所有账号里还没上传的改动都会丢失，且无法撤销。\n建议先点「本地覆盖云端」把本机数据存上去。'
                  : cloudConfirm === 'push'
                      ? '云端现有数据会被本机数据替换，其它已配对设备下次同步也会变成这一份。\n本机数据会被上传到作者的云端服务器。'
                      : '该浏览器本地已有的数据不受影响，只是不能再读写云端；如需恢复，重新配对即可。'
            }
            confirmText={
              cloudConfirm === 'pull' ? '确认覆盖本地'
                  : cloudConfirm === 'push' ? '确认覆盖云端' : '解除配对'
            }
            danger={cloudConfirm === 'pull' || (cloudConfirm !== null && typeof cloudConfirm === 'object')}
            onConfirm={() => void runCloudConfirm()}
            onClose={() => setCloudConfirm(null)}
        />

        {}
        {showAgreement && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
                 onWheel={(e) => e.stopPropagation()}>
              <div className="bg-white dark:bg-slate-900 rounded-[26px] shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 max-w-lg w-full max-h-[88vh] overflow-hidden flex flex-col">
                <ModalHeader
                    icon={ShieldAlert}
                    tone="amber"
                    title="云端同步协议"
                    subtitle="请阅读以下说明后再决定是否启用"
                    onClose={() => setShowAgreement(false)}
                    closeTitle="关闭"
                />

                <div className="p-5 space-y-3 overflow-y-auto">
                  <p className="text-xs font-black text-slate-800 dark:text-slate-100">使用云端同步会发生什么：</p>
                  <ul className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed space-y-1.5 list-disc pl-4">
                    <li>会被上传的是你<b>全部账号</b>的图鉴点亮记录（精灵 id / 名称 / 遇见时间、识别阈值），<b>会保存到作者的云端服务器</b>（api.omisheep.cn）。</li>
                    <li>同步单位是<b>多账号存档</b>：当前最多 <b>5 个账号</b>；超过 5 个账号时会同步失败，并提示你先删到只剩 5 个（<b>不会自动删除</b>你的账号）。</li>
                    <li><b>只能手动同步</b>：软件不会自动读写云端；点「云端覆盖本地」会用云端数据覆盖本地<span className="font-black">全部账号</span>，点「本地覆盖云端」会把本机数据上传覆盖云端。</li>
                    <li>云端数据按「已授权设备」归属，只有你本人配对的浏览器/设备能读写；服务端会记录网页设备的最近使用时间与 IP 网段，你可以在桌面端核对并随时解除配对。</li>
                    <li>数据<b>仅用于多设备间同步</b>，不含账号密码，也不会用于其它用途。</li>
                    <li><b>你确认并同意上述数据被上传到云端</b>；如果不想上传，请不要使用本功能（尤其不要点「本地覆盖云端」）。</li>
                  </ul>
                  <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-800">
                    <p className="text-[11px] font-black text-amber-800 dark:text-amber-200 mb-1">免责声明</p>
                    <ul className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed space-y-1 list-disc pl-4">
                      <li>本功能为个人开发者提供的免费服务，<b>不承诺可用性、不保证数据不丢失</b>：服务器故障、维护、迁移、误操作等都可能导致云端数据损坏或清空。</li>
                      <li>云端数据<b>不是备份</b>，请定期用「导出数据」自行保存到本机。</li>
                      <li>因使用本功能导致的数据丢失、进度回退、设备间不一致等后果，由使用者自行承担。</li>
                      <li>你随时可以解除配对，或联系作者删除云端数据。</li>
                    </ul>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    点击「同意并启用」即表示：<b>你已阅读并同意上述说明，并明确同意把你的图鉴数据上传到云端服务器</b>。
                  </p>
                </div>

                <div className="px-5 py-3.5 bg-[#F0F6FC] dark:bg-slate-800/80 border-t border-[#D5E3F0] dark:border-slate-800 flex items-center justify-end gap-2.5 shrink-0">
                  {cloudAgreed ? (
                      <button type="button"
                              onClick={() => { sound.playClick(); setShowAgreement(false); }}
                              className="px-4 py-2 rounded-xl roco-btn-primary text-xs cursor-pointer">
                        关闭
                      </button>
                  ) : (
                      <>
                        <button type="button" onClick={() => { sound.playClick(); setShowAgreement(false); }}
                                className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-[#EBF4FE] dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-black text-xs border-2 border-[#BCD7F2] dark:border-slate-700 cursor-pointer">
                          取消
                        </button>
                        <button type="button"
                                onClick={() => {
                                  void (async () => {
                                    sound.playClick();
                                    if (IS_STATIC) {
                                      cloudSync.setAgreed(true);
                                    } else {
                                      // 桌面端写进用户自己的 roco_user_data.json，写失败就不放行
                                      const ok = await writeAgreedLocal(true);
                                      if (!ok) return;
                                    }
                                    setCloudMsg('已同意《云端同步协议》，可以开始使用了');
                                    setCloudMsgType('ok');
                                    setShowAgreement(false);
                                  })();
                                }}
                                className="px-4 py-2 rounded-xl roco-btn-primary text-xs cursor-pointer">
                          同意并启用
                        </button>
                      </>
                  )}
                </div>
              </div>
            </div>
        )}
            </div>,
            document.body,
        )}

      </div>
  );
};
