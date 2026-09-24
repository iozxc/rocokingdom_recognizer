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
  if (!body || body.status !== 'success') {
    throw new Error(body?.message || '微信推送服务返回异常');
  }
  return (body.data || {}) as T;
}

function normalizeError(err: unknown): never {
  const anyErr = err as { response?: { data?: { message?: string } }; message?: string };
  throw new Error(anyErr?.response?.data?.message || anyErr?.message || '微信推送服务暂不可用');
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

  getPromoQr(): Promise<WechatPromoQr> {
    return post<WechatPromoQr>('/api/wechat/promo/qr');
  },

  startBinding(): Promise<WechatBindStart> {
    return post<WechatBindStart>('/api/wechat/bind/start');
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

  async getSubscriptions(): Promise<WechatSubscriptionRules> {
    const data = await get<{ rules?: WechatSubscriptionRules } & Partial<WechatSubscriptionRules>>('/api/wechat/subscriptions');
    return data.rules || (data as WechatSubscriptionRules);
  },

  async saveSubscriptions(rules: WechatSubscriptionRules): Promise<WechatSubscriptionRules> {
    const data = await post<{ rules?: WechatSubscriptionRules } & Partial<WechatSubscriptionRules>>('/api/wechat/subscriptions', { rules });
    return data.rules || (data as WechatSubscriptionRules);
  },
};
