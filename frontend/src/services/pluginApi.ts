import axios from 'axios';
import { api } from './api';

/** 插件中心接口：/api/plugins（仅桌面端可用）。 */

/** 远程 version_ext.json 里的一个插件条目 */
export interface PluginUpdateInfo {
  id: string;
  name: string;
  version: string;
  currentVersion?: string;
  url: string;
  md5: string;
  size: number;
  changelog: string;
  /** 插件市场用：描述 / 作者 / 标签 / 平台 / 安装状态 */
  description?: string;
  author?: string;
  tags?: string[];
  platform?: string;
  installed?: boolean;
  installedVersion?: string;
  enabled?: boolean;
  updateAvailable?: boolean;
  /** 版本兼容：false = 与当前主程序不匹配（前端要挡住安装/更新并说明原因） */
  compatible?: boolean;
  compatibleReason?: string;
  /** 人类可读的适配范围，如「主程序 1.6.0 ~ 1.7.0」 */
  requiredRange?: string;
  /** 语义图标名（如 radar）或相对图片路径 */
  icon?: string;
  /** 需要管理员权限：启用时主程序会主动申请提权 */
  requireAdmin?: boolean;
  /** 依赖的其它插件（安装时会自动一起装上） */
  requires?: Array<{ id: string; min_version?: string }>;
}

export interface PluginUpdateResult {
  url: string;
  updated: string;
  updates: PluginUpdateInfo[];
  installable: PluginUpdateInfo[];
  /** 清单里的全部插件（含已安装），供「插件市场」展示 */
  catalog: PluginUpdateInfo[];
}

export interface PluginInfo {
  id: string;
  name: string;
  title: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  platform: string;
  minAppVersion: string;
  subtitle: string;
  accent: string;
  tags: string[];
  hasBackend: boolean;
  hasFrontend: boolean;
  enabled: boolean;
  error: string;
  source: string;
  installedAt: number;
  /** ui.icon：相对图片路径，或语义图标名（如 radar / radio） */
  icon?: string;
  /** ui.fullscreen：插件页面按整页打开（生育规划这类需要大画布的工具） */
  fullscreen?: boolean;
  /** 插件前端页面路径，如 /plugin-ui/<id>/（未启用时也返回，用于预览入口） */
  uiUrl: string;
  /** 插件后端接口前缀，如 /api/plugin-run/<id> */
  apiBase: string;
  /** 插件声明的「同步源」（可选）：主程序据此显示「同步」按钮 */
  sync: PluginSyncDecl | null;
  /** 需要管理员权限：启用时主程序会主动申请提权 */
  requireAdmin?: boolean;
  /** 依赖的其它插件（安装时会自动一起装上） */
  requires?: Array<{ id: string; min_version?: string }>;
  /** 版本兼容：false = 与当前主程序不匹配（不能启用） */
  compatible?: boolean;
  compatibleReason?: string;
  requiredRange?: string;
  maxAppVersion?: string;
}

export interface PluginSyncDecl {
  kind: string;
  endpoint: string;
  label: string;
  description: string;
}

interface ApiResult<T> {
  status: string;
  message?: string;
  data?: T;
}

function base(): string {
  return api.getApiBase();
}

function unwrap<T>(res: { data: ApiResult<T> }): T {
  const body = res.data;
  if (body && body.status === 'error') {
    throw new Error(body.message || '插件操作失败');
  }
  return (body?.data ?? ({} as T));
}

/** 把 axios 的 "Request failed with status code 400" 换成后端返回的真实 message。 */
function toError(err: unknown): Error {
  const ax = err as { response?: { data?: { message?: string } }; message?: string };
  const serverMsg = ax?.response?.data?.message;
  return new Error(serverMsg || ax?.message || '请求失败');
}

export class PluginApiService {
  /** 列出全部已安装插件。 */
  public async list(): Promise<PluginInfo[]> {
    const res = await axios.get<ApiResult<{ items: PluginInfo[] }>>(`${base()}/api/plugins`, { timeout: 8000 });
    return unwrap(res).items || [];
  }

  /** 重新扫描插件目录（把手工解压放进去的文件夹识别出来）。 */
  public async rescan(): Promise<PluginInfo[]> {
    const res = await axios.post<ApiResult<{ items: PluginInfo[] }>>(`${base()}/api/plugins/rescan`, {}, { timeout: 15000 });
    return unwrap(res).items || [];
  }

  /** 导入一个插件 zip。 */
  public async importZip(file: File): Promise<PluginInfo> {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await axios.post<ApiResult<{ plugin: PluginInfo }>>(`${base()}/api/plugins/import`, form, {
      timeout: 60000,
    });
    return unwrap(res).plugin;
  }

  /** 导入一个本机文件夹（插件仓库里的子项目目录 / 解压后的目录）。 */
  public async importFolder(path: string): Promise<PluginInfo> {
    const res = await axios.post<ApiResult<{ plugin: PluginInfo }>>(`${base()}/api/plugins/import-folder`, { path }, { timeout: 60000 });
    return unwrap(res).plugin;
  }

  public async enable(id: string): Promise<PluginInfo> {
    const res = await axios.post<ApiResult<{ plugin: PluginInfo }>>(`${base()}/api/plugins/${encodeURIComponent(id)}/enable`, {}, { timeout: 20000 });
    return unwrap(res).plugin;
  }

  public async disable(id: string): Promise<PluginInfo> {
    const res = await axios.post<ApiResult<{ plugin: PluginInfo }>>(`${base()}/api/plugins/${encodeURIComponent(id)}/disable`, {}, { timeout: 20000 });
    return unwrap(res).plugin;
  }

  public async remove(id: string): Promise<void> {
    const res = await axios.delete<ApiResult<Record<string, unknown>>>(`${base()}/api/plugins/${encodeURIComponent(id)}`, { timeout: 20000 });
    unwrap(res);
  }

  /**
   * 调用插件声明的同步接口（如草系试炼数据）。
   * lite=true 时只取内容指纹 + 抓包状态（几百字节），用于高频轮询。
   */
  public async fetchSync(plugin: PluginInfo, lite = false): Promise<any> {
    if (!plugin.sync) throw new Error('该插件没有同步能力');
    const url = `${base()}${plugin.apiBase}${plugin.sync.endpoint}${lite ? '?lite=1' : ''}`;
    const res = await axios.get(url, { timeout: 12000 });
    return res.data;
  }

  /** 检查插件更新（读取远程 version_ext.json）。 */
  public async checkUpdates(): Promise<PluginUpdateResult> {
    try {
      const res = await axios.post<ApiResult<PluginUpdateResult>>(`${base()}/api/plugins/check_update`, {}, { timeout: 20000 });
      return unwrap(res);
    } catch (err) {
      throw toError(err);
    }
  }

  /** 从插件市场一键安装。 */
  public async installPlugin(id: string, entry?: PluginUpdateInfo): Promise<PluginInfo> {
    try {
      const res = await axios.post<ApiResult<{ plugin: PluginInfo }>>(
        `${base()}/api/plugins/install`,
        { id, entry },
        { timeout: 180000 },
      );
      return unwrap(res).plugin;
    } catch (err) {
      throw toError(err);
    }
  }

  /** 下载并安装某个插件的新版本。 */
  public async update(id: string, entry?: PluginUpdateInfo): Promise<PluginInfo> {
    try {
      const res = await axios.post<ApiResult<{ plugin: PluginInfo }>>(
        `${base()}/api/plugins/${encodeURIComponent(id)}/update`,
        { entry },
        { timeout: 180000 },
      );
      return unwrap(res).plugin;
    } catch (err) {
      throw toError(err);
    }
  }

  /** 插件后端某个路径的完整地址（同源）。 */
  public pluginUrl(plugin: PluginInfo, path: string): string {
    return `${base()}${plugin.apiBase}${path}`;
  }

  /**
   * 插件的运行状态（只有后端插件有）。
   * 用途：区分「插件已启用」和「插件真的在干活」——抓包插件必须点过「开始抓包」才在跑。
   */
  public async runtimeStatus(plugin: PluginInfo): Promise<{ running: boolean } | null> {
    if (!plugin.apiBase) return null;
    try {
      const res = await axios.get<{ running?: boolean }>(`${base()}${plugin.apiBase}/status`, { timeout: 6000 });
      return { running: Boolean(res.data?.running) };
    } catch {
      return null;
    }
  }

  /** 当前主程序是否以管理员身份运行。 */
  public async isAdmin(): Promise<boolean> {
    try {
      const res = await axios.get<{ ok: boolean; admin?: boolean }>(`${base()}/api/app/is_admin`, { timeout: 5000 });
      return Boolean(res.data?.admin);
    } catch {
      return false;
    }
  }

  /** 以管理员身份重启主程序（会弹 UAC；确认后当前进程退出）。 */
  public async restartAsAdmin(): Promise<void> {
    try {
      const res = await axios.post<{ ok: boolean; reason?: string }>(
        `${base()}/api/app/restart_as_admin`, {}, { timeout: 20000 },
      );
      if (res.data?.ok === false && res.data?.reason) {
        throw new Error(res.data.reason);
      }
    } catch (err) {
      throw toError(err);
    }
  }

  /**
   * 插件 iframe 的完整地址。
   * 顺带把主程序的深浅色带过去：iframe 里读不到父窗口的 class，只能靠参数传。
   */
  public frameUrl(plugin: PluginInfo): string {
    let theme = 'light';
    try {
      if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) theme = 'dark';
    } catch {
      /* ignore */
    }
    return `${base()}${plugin.uiUrl}?api=${encodeURIComponent(plugin.apiBase)}&theme=${theme}`;
  }
}

export const pluginApi = new PluginApiService();
