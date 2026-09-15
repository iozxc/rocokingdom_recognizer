/**
 * 推理后端状态文案（PC 端识别卡 / 设置面板共用）。
 *
 * 同一份状态要按「实际在用哪个后端」说人话：
 *  - 用 GPU：显示显卡型号与显存
 *  - 用户主动关掉 GPU 加速 / 机器上没有可用 GPU：明确写成 CPU 计算，并带上 CPU 型号
 */

export interface InferBackendLike {
  isGpu: boolean;
  gpuEnabled: boolean;
  gpuAvailable: boolean;
  gpuName: string;
  gpuVramMB: number;
  gpuCount: number;
  cpuName: string;
  activeLabel?: string;
}

/** 把 "13th Gen Intel(R) Core(TM) i5-13600KF" 缩成 "i5-13600KF"（识别不出就原样返回）。 */
export function shortCpuName(name?: string): string {
  const raw = (name || '').trim();
  if (!raw) return '';
  const m = /(i[3579]-\d{3,5}[A-Z]{0,3}|Ryzen\s+\d\s+\w+|Threadripper\s+\w+)/i.exec(raw);
  return m ? m[1] : raw;
}

/** 后端徽标下面那行硬件文案。info 为空时返回空串。 */
export function inferHardwareLine(info: InferBackendLike | null): string {
  if (!info) return '';
  if (info.isGpu) {
    const vram = info.gpuVramMB ? ` · ${(info.gpuVramMB / 1024).toFixed(0)}GB` : '';
    const multi = info.gpuCount > 1 ? `（共 ${info.gpuCount} 块）` : '';
    return `${info.gpuName || 'GPU'}${vram}${multi}`;
  }
  const reason = !info.gpuEnabled
      ? '已关闭 GPU 加速'
      : (info.gpuAvailable ? 'GPU 后端不可用，已降级' : '未检测到可用 GPU');
  const cpu = shortCpuName(info.cpuName);
  return `CPU 计算（${reason}）${cpu ? ` · ${cpu}` : ''}`;
}

/** 识别完成后那行「本地识别 · …」里的后端描述。 */
export function inferBackendSummary(info: InferBackendLike | null, fallback = ''): string {
  if (!info) return fallback;
  if (info.isGpu) {
    const vram = info.gpuVramMB ? ` ${(info.gpuVramMB / 1024).toFixed(0)}GB` : '';
    return info.gpuName
        ? `${info.activeLabel || 'GPU'} · ${info.gpuName}${vram}`
        : (info.activeLabel || 'GPU');
  }
  return `${info.activeLabel || 'CPU'}（${info.gpuEnabled ? '无可用 GPU' : '已关闭 GPU 加速'}）`;
}
