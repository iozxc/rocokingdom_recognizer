import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronLeft, Download, Loader2, Package, Pin, Power, Puzzle, RefreshCw, ShieldAlert, Trash2, Upload,
} from 'lucide-react';
import { ModalHeader } from './ModalHeader';
import { PluginFrame } from './plugins/PluginFrame';
import { pluginIconOf } from './plugins/pluginIcon';
import { pluginApi, PluginInfo, PluginUpdateInfo } from '../services/pluginApi';
import { sound } from '../services/sound';

interface PluginCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 插件启用/停用/导入/删除后通知外部刷新（如首页「插件中心」卡片） */
  onPluginsChanged?: (plugins: PluginInfo[]) => void;
  /** 打开弹窗后直接进入某个插件的界面（首页卡片直达） */
  initialPluginId?: string | null;
  /** 声明了 ui.fullscreen 的插件：不要塞进弹窗，交给外面整页打开 */
  onOpenFullscreen?: (plugin: PluginInfo) => void;
  /** 固定到右下角（主程序悬浮区） */
  pinnedIds?: string[];
  onTogglePin?: (plugin: PluginInfo) => void;
}

export const PluginCenterModal: React.FC<PluginCenterModalProps> = ({
  isOpen, onClose, onPluginsChanged, initialPluginId, onOpenFullscreen, pinnedIds = [], onTogglePin,
}) => {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [busyId, setBusyId] = useState<string>('');
  const [importing, setImporting] = useState<boolean>(false);
  const [active, setActive] = useState<PluginInfo | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<PluginInfo | null>(null);
  // 需要管理员权限的插件：启用时先问一句「要不要以管理员身份重启」
  const [elevateTarget, setElevateTarget] = useState<PluginInfo | null>(null);
  // 插件更新：id -> 远程新版本信息
  const [updates, setUpdates] = useState<Record<string, PluginUpdateInfo>>({});
  const [checking, setChecking] = useState<boolean>(false);
  const [updateNote, setUpdateNote] = useState<string>('');
  const [updatingId, setUpdatingId] = useState<string>('');
  // 插件「运行状态」：区分"插件已启用"和"插件真的在抓包"
  const [runtimeState, setRuntimeState] = useState<Record<string, boolean>>({});
  // 插件市场：清单里的全部插件（含未安装）
  const [tab, setTab] = useState<'installed' | 'market'>('installed');
  const [catalog, setCatalog] = useState<PluginUpdateInfo[]>([]);
  const [installingId, setInstallingId] = useState<string>('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 外部回调放 ref：effect 里用它，但不进依赖数组（避免调用方每次渲染换引用就把 effect 重新跑一遍）
  const fullscreenRef = useRef(onOpenFullscreen);
  fullscreenRef.current = onOpenFullscreen;

  const publish = useCallback((items: PluginInfo[]) => {
    setPlugins(items);
    onPluginsChanged?.(items);
  }, [onPluginsChanged]);

  /** 拉一次各后端插件的运行状态（失败按未运行显示） */
  const refreshRuntimeState = useCallback(async (items: PluginInfo[]) => {
    const targets = (items || []).filter((p) => p.enabled && p.hasBackend);
    if (!targets.length) { setRuntimeState({}); return; }
    const pairs = await Promise.all(targets.map(async (p) => {
      const st = await pluginApi.runtimeStatus(p);
      return [p.id, Boolean(st?.running)] as const;
    }));
    setRuntimeState(Object.fromEntries(pairs));
  }, []);

  const refresh = useCallback(async (): Promise<PluginInfo[]> => {
    setLoading(true);
    setError('');
    try {
      const items = await pluginApi.list();
      publish(items);
      void refreshRuntimeState(items);
      return items;
    } catch (err) {
      setError((err as Error).message || '无法连接插件服务');
      return [];
    } finally {
      setLoading(false);
    }
  }, [publish]);

  // 顶部紫色提示（「已更新到 vX」/「发现可更新插件」/「已安装…」）只是即时反馈，
  // 显示几秒就收起，避免一直挂在插件中心顶部。
  useEffect(() => {
    if (!updateNote) return;
    const timer = window.setTimeout(() => setUpdateNote(''), 6000);
    return () => window.clearTimeout(timer);
  }, [updateNote]);

  // 回到插件列表（从插件页面返回）时立刻重查一次抓包状态
  useEffect(() => {
    if (!isOpen || active) return;
    void refreshRuntimeState(plugins);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, active]);

  // 弹窗开着的时候每 3 秒刷一次抓包状态，保证"回去就能看到正在抓包"
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setInterval(() => {
      if (!active) void refreshRuntimeState(plugins);
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, active, plugins]);

  useEffect(() => {
    if (!isOpen) return;
    setActive(null);
    setUpdateNote('');
    setTab('installed');
    (async () => {
      const items = await refresh();
      void refreshRuntimeState(items);
      const target = initialPluginId ? items.find((p) => p.id === initialPluginId) : null;
      const openFull = fullscreenRef.current;
      if (target && target.fullscreen && openFull) {
        // 直达一个整页插件：别在弹窗里渲染，交给外面整页打开
        openFull(target);
        setActive(null);
      } else if (target) {
        setActive(target);
      }
      // 静默拉一次插件市场清单（失败不打扰用户）
      void handleCheckUpdates(true);
    })();
  }, [isOpen, initialPluginId, refresh]);

  const handleImportZip = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      await pluginApi.importZip(file);
      await refresh();
    } catch (err) {
      setError((err as Error).message || '导入失败');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRescan = async () => {
    setLoading(true);
    setError('');
    try {
      publish(await pluginApi.rescan());
    } catch (err) {
      setError((err as Error).message || '重新扫描失败');
    } finally {
      setLoading(false);
    }
  };

  const togglePlugin = async (plugin: PluginInfo) => {
    // 声明了 require_admin 的插件（如抓包）：没管理员权限就先申请提权
    if (!plugin.enabled && plugin.requireAdmin) {
      const admin = await pluginApi.isAdmin();
      if (!admin) {
        sound.playClick();
        setElevateTarget(plugin);
        return;
      }
    }
    setBusyId(plugin.id);
    setError('');
    try {
      const updated = plugin.enabled ? await pluginApi.disable(plugin.id) : await pluginApi.enable(plugin.id);
      const next = plugins.map((p) => (p.id === updated.id ? updated : p));
      publish(next);
      void refreshRuntimeState(next);
    } catch (err) {
      setError((err as Error).message || '操作失败');
    } finally {
      setBusyId('');
    }
  };

  /** 检查插件更新 / 拉取插件市场清单（读取远程 version_ext.json） */
  const handleCheckUpdates = async (silent = false) => {
    setChecking(true);
    if (!silent) { setUpdateNote(''); setError(''); }
    try {
      const res = await pluginApi.checkUpdates();
      const map: Record<string, PluginUpdateInfo> = {};
      res.updates.forEach((u) => { map[u.id] = u; });
      setUpdates(map);
      setCatalog(res.catalog || []);
      if (!silent) {
        setUpdateNote(res.updates.length ? `发现 ${res.updates.length} 个可更新插件` : '所有插件都是最新版本');
      } else if (res.updates.length) {
        setUpdateNote(`发现 ${res.updates.length} 个可更新插件`);
      }
    } catch (err) {
      if (!silent) {
        setUpdateNote('');
        setError((err as Error).message || '检查更新失败');
      }
    } finally {
      setChecking(false);
    }
  };

  /** 从插件市场一键安装 */
  const handleInstall = async (item: PluginUpdateInfo) => {
    setInstallingId(item.id);
    setError('');
    try {
      await pluginApi.installPlugin(item.id, item);
      await refresh();
      await handleCheckUpdates(true);
      setUpdateNote(`「${item.name}」已安装 v${item.version}，可在「已安装」里启用`);
      setTab('installed');
    } catch (err) {
      setError((err as Error).message || '安装失败');
    } finally {
      setInstallingId('');
    }
  };

  const handleUpdate = async (plugin: PluginInfo) => {
    const entry = updates[plugin.id];
    if (!entry) return;
    setUpdatingId(plugin.id);
    setError('');
    try {
      const updated = await pluginApi.update(plugin.id, entry);
      publish(plugins.map((p) => (p.id === updated.id ? updated : p)));
      setUpdates((prev) => {
        const next = { ...prev };
        delete next[plugin.id];
        return next;
      });
      setUpdateNote(`「${updated.title}」已更新到 v${updated.version}`);
    } catch (err) {
      setError((err as Error).message || '更新失败');
    } finally {
      setUpdatingId('');
    }
  };

  /** 点击删除：只打开应用内确认弹窗（不用浏览器原生 confirm） */
  const requestRemove = (plugin: PluginInfo) => {
    sound.playClick();
    setConfirmTarget(plugin);
  };

  /** 申请管理员权限：重启主程序（确认 UAC 后当前进程会退出并拉起新实例） */
  const doElevate = async () => {
    const target = elevateTarget;
    setElevateTarget(null);
    if (!target) return;
    setError('');
    try {
      await pluginApi.restartAsAdmin();
      setUpdateNote('已申请管理员权限，主程序正在以管理员身份重启…重启后插件可直接启用');
    } catch (err) {
      setError((err as Error).message || '申请管理员权限失败');
    }
  };

  const doRemove = async () => {
    const plugin = confirmTarget;
    setConfirmTarget(null);
    if (!plugin) return;
    setBusyId(plugin.id);
    setError('');
    try {
      await pluginApi.remove(plugin.id);
      publish(plugins.filter((p) => p.id !== plugin.id));
    } catch (err) {
      setError((err as Error).message || '删除失败');
    } finally {
      setBusyId('');
    }
  };

  if (!isOpen) return null;

  const activePlugin = active ? plugins.find((p) => p.id === active.id) || active : null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`relative w-full flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl ring-1 ring-slate-900/5 dark:ring-slate-700/60 overflow-hidden ${
          activePlugin?.fullscreen ? 'max-w-[1500px] h-[94vh]' : 'max-w-4xl max-h-[86vh]'
        }`}
      >
        <ModalHeader
          icon={Puzzle}
          tone="violet"
          title={activePlugin ? activePlugin.title : '插件中心'}
          subtitle={activePlugin ? activePlugin.description : '导入、管理并在应用内使用插件'}
          onClose={() => {
            if (activePlugin) { setActive(null); return; }
            onClose();
          }}
          closeTitle={activePlugin ? '返回插件列表' : '关闭'}
          actions={
            activePlugin ? (
              <button
                type="button"
                onClick={() => { sound.playClick(); setActive(null); }}
                className="h-8 px-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" /> 返回
              </button>
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => handleImportZip(e.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => { sound.playClick(); fileRef.current?.click(); }}
                  disabled={importing}
                  className="h-8 px-2.5 rounded-xl text-xs font-bold text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/15 hover:bg-violet-100 dark:hover:bg-violet-500/25 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  title="导入插件 zip 包"
                >
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  导入 zip
                </button>
                <button
                  type="button"
                  onClick={() => { sound.playClick(); handleCheckUpdates(); }}
                  title="检查插件更新（读取远程 version_ext.json）"
                  className="h-8 px-2.5 rounded-xl text-xs font-bold text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/15 hover:bg-violet-100 dark:hover:bg-violet-500/25 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  disabled={checking}
                >
                  <Download className={`w-3.5 h-3.5 ${checking ? 'animate-pulse' : ''}`} /> 检查更新
                </button>
                <button
                  type="button"
                  onClick={() => { sound.playClick(); handleRescan(); }}
                  title="重新扫描插件目录"
                  className="h-8 px-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  disabled={loading}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 重新扫描
                </button>
              </>
            )
          }
        />

        {activePlugin ? (
          /* 插件视图：高度由 PluginFrame 按插件页面内容自适应，超出上限的部分在这里滚动 */
          <div
            className={`min-h-0 flex-1 bg-slate-50 dark:bg-slate-950 ${
              activePlugin.fullscreen ? 'overflow-hidden' : 'overflow-y-auto'
            }`}
          >
            {activePlugin.enabled ? (
              <PluginFrame plugin={activePlugin} fill={activePlugin.fullscreen} />
            ) : (
              <div className="min-h-[240px] flex flex-col items-center justify-center gap-3 text-sm text-slate-500">
                <Power className="w-8 h-8 text-slate-300" />
                <div>插件未启用，请先在插件列表里启用。</div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {updateNote && (
              <div className="mx-4 sm:mx-5 mt-3 rounded-xl bg-violet-50 dark:bg-violet-950/30 px-3 py-2 text-xs font-bold text-violet-600 dark:text-violet-300 ring-1 ring-inset ring-violet-200/70 dark:ring-violet-900/50">
                {updateNote}
              </div>
            )}

            {error && (
              <div className="mx-4 sm:mx-5 mt-3 flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-600 dark:text-rose-300 ring-1 ring-inset ring-rose-200/70 dark:ring-rose-900/50">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="break-all">{error}</span>
              </div>
            )}

            {/* 已安装 / 插件市场 */}
            <div className="px-4 sm:px-5 pt-3 flex items-center gap-2 shrink-0">
              {([['installed', `已安装 ${plugins.length}`], ['market', `插件市场 ${catalog.length}`]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { sound.playClick(); setTab(key); }}
                  className={`h-7 px-3 rounded-xl text-xs font-black transition-colors cursor-pointer ${
                    tab === key
                      ? 'bg-[#EBF4FE] dark:bg-sky-950/60 text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800'
                      : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 插件列表 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4">
              {tab === 'market' ? (
                catalog.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center gap-3 text-center">
                    <Package className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                    <div className="text-sm font-bold text-slate-500 dark:text-slate-400">还没有拿到插件市场清单</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 max-w-md leading-relaxed">
                      点右上角「检查更新」重新拉取；若一直失败，请确认插件仓库是<b>公开</b>的。
                    </div>
                    <button
                      type="button"
                      onClick={() => { sound.playClick(); handleCheckUpdates(); }}
                      disabled={checking}
                      className="h-8 px-3.5 rounded-xl bg-gradient-to-b from-[#7ABCF4] to-[#5DA8E8] text-white text-xs font-black disabled:opacity-60 cursor-pointer"
                    >
                      重新拉取
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {catalog.map((item) => (
                      <div key={item.id} className="rounded-2xl bg-white dark:bg-slate-800 border-2 border-[#E6EEF8] dark:border-slate-700 p-3.5 sm:p-4 flex gap-3.5">
                        <div
                          className="w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center border"
                          style={{ backgroundColor: `${item.accent || '#7abcf4'}22`, color: item.accent || '#7abcf4', borderColor: `${item.accent || '#7abcf4'}55` }}>
                          {(() => { const Icon = pluginIconOf(item); return <Icon className="w-5 h-5" strokeWidth={2.2} />; })()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black text-slate-800 dark:text-slate-100">{item.name}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500">v{item.version}</span>
                            {item.installed && (
                              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border border-[#95D151]/50">
                                已安装 v{item.installedVersion || '-'}
                              </span>
                            )}
                            {item.updateAvailable && item.compatible !== false && (
                              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-300">
                                可更新
                              </span>
                            )}
                            {item.compatible === false && (
                              <span
                                className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                                title={item.compatibleReason || '与当前主程序版本不匹配'}
                              >
                                不兼容当前主程序
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {item.description || item.changelog || '—'}
                          </div>
                          {item.compatible === false && (
                            <div className="mt-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300 break-all">
                              {item.compatibleReason || '与当前主程序版本不匹配'}
                              {item.requiredRange ? `（适配范围：${item.requiredRange}）` : ''}
                            </div>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                            {(item.requires || []).length > 0 && (
                              <span className="text-[10px] font-bold text-violet-500 dark:text-violet-300">
                                依赖 {(item.requires || []).map((r) => `${r.id}${r.min_version ? ` ≥ ${r.min_version}` : ''}`).join('、')}（会自动一起安装）
                              </span>
                            )}
                            {item.size ? <span>{(item.size / 1024 / 1024).toFixed(2)} MB</span> : null}
                            {(item.tags || []).map((t) => (
                              <span key={t} className="rounded-full bg-[#EBF4FE] dark:bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-bold text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center">
                          {item.compatible === false ? (
                            <span className="text-[11px] font-black text-amber-600 dark:text-amber-300">不可安装</span>
                          ) : item.installed && !item.updateAvailable ? (
                            <span className="text-[11px] font-black text-[#2D6613] dark:text-emerald-300">已安装</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { sound.playClick(); handleInstall(item); }}
                              disabled={installingId === item.id}
                              title="直接从插件市场下载并导入"
                              className="h-8 px-3 rounded-xl bg-gradient-to-b from-[#7ABCF4] to-[#5DA8E8] text-white text-xs font-black flex items-center gap-1.5 shadow-xs active:scale-95 disabled:opacity-60 cursor-pointer"
                            >
                              {installingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                              {item.updateAvailable ? '更新' : '安装'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : loading && plugins.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-sm text-slate-400 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> 正在加载…
                </div>
              ) : plugins.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center gap-3 text-center">
                  <Package className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                  <div className="text-sm font-bold text-slate-500 dark:text-slate-400">还没有安装任何插件</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 max-w-md leading-relaxed">
                    点击「导入 zip」选择插件压缩包，或用「从文件夹导入」指向插件仓库里的子项目目录。<br />
                    插件默认不会自动运行，启用后其界面会出现在这里，也会出现在首页的「插件中心」。
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {plugins.map((plugin) => (
                    <PluginCard
                      key={plugin.id}
                      plugin={plugin}
                      busy={busyId === plugin.id}
                      captureRunning={runtimeState[plugin.id]}
                      onToggle={() => togglePlugin(plugin)}
                      onRemove={() => requestRemove(plugin)}
                      onOpen={() => {
                        sound.playClick();
                        // ui.fullscreen 的插件不塞弹窗：交给外面整页打开（和火系徽章试炼一样的观感）
                        if (plugin.fullscreen && onOpenFullscreen) { onOpenFullscreen(plugin); return; }
                        setActive(plugin);
                      }}
                      update={updates[plugin.id]}
                      updating={updatingId === plugin.id}
                      onUpdate={() => handleUpdate(plugin)}
                      pinned={pinnedIds.includes(plugin.id)}
                      onTogglePin={onTogglePin ? () => onTogglePin(plugin) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 应用内删除确认（不用浏览器原生 confirm） */}
        {elevateTarget && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/45 backdrop-blur-xs p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#E6EEF8] dark:border-slate-700 shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200/70 dark:border-slate-800">
                <span className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                </span>
                <span className="text-sm font-black text-slate-800 dark:text-slate-100">申请管理员权限</span>
              </div>
              <div className="px-4 py-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                「<b className="text-slate-800 dark:text-slate-100">{elevateTarget.title}</b>」需要<b>管理员权限</b>才能正常抓包。
                <div className="mt-2 text-slate-500 dark:text-slate-400">
                  现在以管理员身份重启主程序？（会弹出系统 UAC 授权框；选「否」也可以继续启用，只是抓包可能因权限不足失败）
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-3 bg-slate-50/70 dark:bg-slate-800/50 border-t border-slate-200/70 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => { sound.playClick(); setElevateTarget(null); }}
                  className="h-8 px-3.5 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:ring-slate-300 active:scale-95 transition cursor-pointer"
                >
                  暂不重启
                </button>
                <button
                  type="button"
                  onClick={() => { sound.playClick(); void doElevate(); }}
                  className="h-8 px-3.5 rounded-xl bg-gradient-to-b from-[#7ABCF4] to-[#5DA8E8] text-white text-xs font-black shadow-xs active:scale-95 transition cursor-pointer"
                >
                  以管理员身份重启
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmTarget && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/45 backdrop-blur-xs p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#E6EEF8] dark:border-slate-700 shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200/70 dark:border-slate-800">
                <span className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <span className="text-sm font-black text-slate-800 dark:text-slate-100">删除插件</span>
              </div>
              <div className="px-4 py-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                确定要删除插件「<b className="text-slate-800 dark:text-slate-100">{confirmTarget.title}</b>」吗？
                删除后需要重新导入才能再次使用。
              </div>
              <div className="flex items-center justify-end gap-2 px-4 py-3 bg-slate-50/70 dark:bg-slate-800/50 border-t border-slate-200/70 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setConfirmTarget(null)}
                  className="h-8 px-3.5 rounded-xl bg-white dark:bg-slate-800 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:ring-slate-300 active:scale-95 transition cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={doRemove}
                  className="h-8 px-3.5 rounded-xl bg-gradient-to-b from-[#f87171] to-[#ef4444] text-white text-xs font-black shadow-xs active:scale-95 transition cursor-pointer"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface PluginCardProps {
  pinned?: boolean;
  onTogglePin?: () => void;
  plugin: PluginInfo;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onOpen: () => void;
  /** 后端插件是否正在运行（如抓包中）；undefined = 未知/不适用 */
  captureRunning?: boolean;
  update?: PluginUpdateInfo;
  updating?: boolean;
  onUpdate?: () => void;
}

const PluginCard: React.FC<PluginCardProps> = ({ plugin, busy, onToggle, onRemove, onOpen, captureRunning, update, updating, onUpdate, pinned, onTogglePin }) => {
  const canOpen = plugin.enabled && plugin.hasFrontend && !plugin.error;
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border-2 border-[#E6EEF8] dark:border-slate-700 p-3.5 sm:p-4 flex gap-3.5">
      <div
        className="w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center border"
        style={{ backgroundColor: `${plugin.accent || '#7abcf4'}22`, color: plugin.accent || '#7abcf4', borderColor: `${plugin.accent || '#7abcf4'}55` }}>
        {(() => { const Icon = pluginIconOf(plugin); return <Icon className="w-5 h-5" strokeWidth={2.2} />; })()}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black text-slate-800 dark:text-slate-100">{plugin.title}</span>
          <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500">v{plugin.version}</span>
          {/* 后端插件：紧跟版本号显示"功能是否真的在跑"（启用了插件 ≠ 正在抓包） */}
          {plugin.enabled && plugin.hasBackend && (
            captureRunning ? (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border border-[#95D151]/50 dark:border-emerald-700/50 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                抓包中
              </span>
            ) : (
              <span
                className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-600"
                title="插件已启用 ≠ 正在抓包：请打开插件页面点「开始抓包」"
              >
                未抓包
              </span>
            )
          )}
          {plugin.source === 'dev' && (
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-300">DEV</span>
          )}
          {plugin.compatible === false && (
            <span
              className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
              title={plugin.compatibleReason || '与当前主程序版本不匹配'}
            >
              不兼容当前主程序
            </span>
          )}
          {plugin.error && plugin.compatible !== false && (
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300">异常</span>
          )}
          {update && (
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-300">
              可更新 v{update.version}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{plugin.description || plugin.subtitle}</div>
        {(plugin.requires || []).length > 0 && (
          <div className="mt-1.5 text-[10px] font-bold text-violet-500 dark:text-violet-300">
            依赖 {(plugin.requires || []).map((r) => `${r.id}${r.min_version ? ` ≥ ${r.min_version}` : ''}`).join('、')}
          </div>
        )}
        {plugin.tags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {plugin.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-[#EBF4FE] dark:bg-sky-950/60 px-2 py-0.5 text-[10px] font-bold text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800">{tag}</span>
            ))}
          </div>
        )}
        {plugin.compatible === false ? (
          <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300 break-all">
            {plugin.compatibleReason || '与当前主程序版本不匹配'}
            {plugin.requiredRange ? `（适配范围：${plugin.requiredRange}）` : ''}
          </div>
        ) : plugin.error && (
          <div className="mt-2 text-[11px] text-rose-500 dark:text-rose-400 break-all">{plugin.error}</div>
        )}
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggle}
              disabled={busy || (plugin.compatible === false && !plugin.enabled)}
            title={plugin.compatible === false && !plugin.enabled
              ? (plugin.compatibleReason || '与当前主程序版本不匹配，无法启用')
              : (plugin.enabled ? '停用插件' : '启用插件')}
            className={`h-7 px-2.5 rounded-xl text-[11px] font-black flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 ${
              plugin.enabled
                ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
            }`}
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
            {plugin.enabled ? '已启用' : '未启用'}
          </button>
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              title={pinned ? '取消固定（右下角不再显示入口）' : '固定到右下角，之后点右下角悬浮栏里的入口就能直接打开'}
              className={`h-7 px-2.5 rounded-xl text-[11px] font-black flex items-center gap-1 transition-colors cursor-pointer ${
                pinned
                  ? 'bg-[#EBF4FE] dark:bg-sky-950/60 text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
              }`}
            >
              <Pin className="w-3 h-3" />
              {pinned ? '已固定' : '固定'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {update && onUpdate && (
            <button
              type="button"
              onClick={onUpdate}
              disabled={updating}
              title={update.changelog || `更新到 v${update.version}`}
              className="h-7 px-2.5 rounded-xl bg-violet-100 dark:bg-violet-500/20 text-[11px] font-black text-violet-600 dark:text-violet-300 hover:bg-violet-200/80 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1"
            >
              {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              更新
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            disabled={!canOpen}
            className="h-7 px-2.5 rounded-xl bg-[#EBF4FE] dark:bg-sky-950/60 text-[11px] font-black text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800 hover:bg-[#E1F0FD] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            打开
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy || plugin.source === 'dev'}
            title={plugin.source === 'dev' ? '开发目录插件不可删除' : '删除插件'}
            className="w-7 h-7 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 flex items-center justify-center transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
