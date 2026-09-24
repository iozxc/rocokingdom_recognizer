import axios from 'axios';
import { api } from './api';

export interface WechatBindingState {
  configured: boolean;
  provider: string;
  bound: boolean;
  status: 'unbound' | 'active' | 'pending' | 'bound' | 'expired' | string;
  credits?: number;
  template_id?: string;
  created_at?: string | null;
}

export interface WechatBindStart {
  ticket: string;
  qr_url: string;
  expires_in: number;
  provider: string;
}

export interface WechatPromoQr {
  qr_url: string;
  provider: string;
}

export interface WechatBindStatus {
  status: 'pending' | 'bound' | 'expired' | string;
  provider: string;
}

export interface WechatSubscriptionRules {
  refreshReminder: boolean;
  rareOnly: boolean;
  highValueOnly: boolean;
  minLeadMinutes: number;
}

const DEFAULT_RULES: WechatSubscriptionRules = {
  refreshReminder: true,
  rareOnly: true,
  highValueOnly: true,
  minLeadMinutes: 5,
};

function unwrap<T>(response: { data?: any }): T {
  const body = response?.data;
  if (!body) {
    throw new Error('微信小程序服务返回异常');
  }
  // 新接口（/api/mini/*）返回 { ok: true, ... } 平铺结构
  if (body.ok === true) {
    return body as T;
  }
  // 兼容旧接口（/api/wechat/*）的 { status: 'success', data: {...} }
  if (body.status === 'success') {
    return (body.data || {}) as T;
  }
  throw new Error(body.msg || body.message || '微信小程序服务返回异常');
}

function normalizeError(err: unknown): never {
  const anyErr = err as { response?: { data?: { message?: string } }; message?: string };
  const data = anyErr?.response?.data as { msg?: string; message?: string } | undefined;
  throw new Error(data?.msg || data?.message || anyErr?.message || '微信小程序服务暂不可用');
}

async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  try {
    return unwrap<T>(await axios.get(`${api.getApiBase()}${path}`, { params, timeout: 25000 }));
  } catch (err) {
    return normalizeError(err);
  }
}

async function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  try {
    return unwrap<T>(await axios.post(`${api.getApiBase()}${path}`, body || {}, { timeout: 25000 }));
  } catch (err) {
    return normalizeError(err);
  }
}

export const wechatPush = {
  defaultRules: DEFAULT_RULES,

  getBinding(): Promise<WechatBindingState> {
    return get<WechatBindingState>('/api/wechat/binding');
  },

  /** 生成小程序码（纯引流，不建立绑定）。target：merchant=远行商人 / trial=草系徽章试炼。 */
  getPromoQr(target: 'merchant' | 'trial' = 'merchant'): Promise<WechatPromoQr> {
    return post<WechatPromoQr>('/api/wechat/promo/qr', { target });
  },

  startBinding(target: 'merchant' | 'trial' = 'merchant'): Promise<WechatBindStart> {
    return post<WechatBindStart>('/api/wechat/bind/start', { target });
  },

  /** 统一设备标识码（PC / Web / 小程序显示同一个码） */
  getDeviceTag(): Promise<{ tag: string; owner_code: string; bound: boolean }> {
    return get<{ tag: string; owner_code: string; bound: boolean }>('/api/wechat/device_tag');
  },

  getBindStatus(ticket: string): Promise<WechatBindStatus> {
    return get<WechatBindStatus>('/api/wechat/bind/status', { ticket });
  },

  unbind(): Promise<{ status: string }> {
    return post<{ status: string }>('/api/wechat/unbind');
  },

  sendTest(): Promise<{ message?: string }> {
    return post<{ message?: string }>('/api/wechat/test');
  },

  getProgress(): Promise<{ payload?: { encounters?: Record<string, unknown> } }> {
    return get<{ payload?: { encounters?: Record<string, unknown> } }>('/api/wechat/progress');
  },

  saveProgress(encounters: Record<string, unknown>): Promise<{ payload?: unknown }> {
    return post<{ payload?: unknown }>('/api/wechat/progress', { payload: { encounters } });
  },

  async getSubscriptions(): Promise<WechatSubscriptionRules> {
    const data = await get<{ rules?: WechatSubscriptionRules } & Partial<WechatSubscriptionRules>>('/api/wechat/subscriptions');
    return data.rules || (data as WechatSubscriptionRules);
  },

  async saveSubscriptions(rules: WechatSubscriptionRules): Promise<WechatSubscriptionRules> {
    const data = await post<{ rules?: WechatSubscriptionRules } & Partial<WechatSubscriptionRules>>('/api/wechat/subscriptions', { rules });
    return data.rules || (data as WechatSubscriptionRules);
  },
};
