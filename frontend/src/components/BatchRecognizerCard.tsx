import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sliders,
  SlidersHorizontal,
  Award,
  Check,
  Edit3,
  HelpCircle,
  CheckSquare,
  Square,
  Layers,
  Search,
  ZoomIn,
  Download,
  ChevronDown,
  ChevronUp,
  Cpu,
  Trash2,
  Sparkle,
  Info,
  X,
  Eye,
  Maximize2,
  ArrowLeftRight,
  ImageOff,
  Image as ImageIcon,
  MonitorPlay,
} from 'lucide-react';
import { ImageZoom } from './ImageZoom';
import { PetSprite } from './PetSprite';
import { collectAtlasObservation } from '../services/atlasCollector';
import { fireEncounterConfetti } from '../services/effect';
import { ThresholdSlider } from './ThresholdSlider';
import { HintTooltip } from './HintTooltip';
import {
  MapConfig,
  PetItem,
  BatchInitReviewItem,
  BatchInitCandidateItem,
  EncounterRecord,
  EffectLevel,
} from '../types';
import {
  cancelLocalRecognition,
  getLastBatchInfo,
  getRecognizerInfo,
  getRecognizerPerf,
  hasWebGPU,
  isRecognitionCanceled,
  recognizeImage,
} from '../services/recognition';
import { IS_STATIC } from '../services/staticMode';
import { api } from '../services/api';
import { inferBackendSummary, inferHardwareLine } from '../utils/inferBackendText';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { FALLBACK_MAPS_DATA, MAP_CONFIGS } from '../data/mockPets';
import { formatPetName, isSamePetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';
import { RecognitionSamplesHint } from './RecognitionSamplesHint';
import { ModelAssetsModal } from './ModelAssetsModal';
import { ElementBadges } from './ElementBadges';
import { PetSpecialTag } from './PetSpecialTag';
import { DuplicatePetHintToast } from './DuplicatePetHintToast';
import {
  VideoGuideModal,
  DEFAULT_VIDEO_GUIDE_ITEMS,
  parseVideoGuide,
  type VideoGuideItem,
} from './VideoGuideModal';

/** 占位符/空槽判定：没有任何精灵名（OCR）线索，且最高候选分低于「识别门槛」（或本就没检出头像），
 *  说明这一格是游戏里的「?」占位符或空槽、并不是精灵——不应按红色「未匹配」告警。 */
function isPlaceholderSlot(item: BatchInitReviewItem, threshold: number): boolean {
  if (item.status !== 'unmatched') return false;
  if (item.reason && item.reason.includes('未检出')) return true; // 纯前端：该槽位本就没检出头像
  const cands = item.candidates || [];
  if (cands.some((c) => c.source === 'ocr' || c.source === 'both')) return false; // 读到了精灵名，按真精灵处理
  const best = cands[0]?.score;
  // 最高候选仍低于识别门槛（或根本没有候选）：疑似占位符 / 空槽
  return best == null || best < threshold;
}

interface BatchRecognizerCardProps {
  currentMap: MapConfig;
  /** 当前试炼 key（如 'grass' / 'fire'）；用于开荒采集判断。 */
  trialKey?: string;
  allMapsPets: Record<string, { count: number; items: PetItem[] }>;
  records?: Record<string, EncounterRecord>;
  isEncountered?: (mapId: string, filename: string) => boolean;
  onBatchEncounterSuccess: (
      items: Array<{ mapId: string; filename: string; note?: string }>
  ) => void;
  onSelectMap?: (mapNum: number) => void;
  /** 识别进行中状态上报，供父级锁定顶部 / 悬浮的地图切换。 */
  onScanningChange?: (scanning: boolean) => void;
}

export const BatchRecognizerCard: React.FC<BatchRecognizerCardProps> = ({
                                                                          currentMap,
                                                                          trialKey = 'grass',
                                                                          allMapsPets,
                                                                          records,
                                                                          isEncountered,
                                                                          onBatchEncounterSuccess,
                                                                          onSelectMap,
                                                                          onScanningChange,
                                                                        }) => {
  const [selectedMapNum, setSelectedMapNum] = useState<number>(currentMap.num);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number>(() => storage.getThreshold('batch_threshold', 0.6));
  const [topK, setTopK] = useState<number>(() => storage.getTopK(3));
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  /** 识别成功但图里 0 个图位（空白/碎片截图）：给一个中性提示，不渲染假结果。 */
  const [scanEmpty, setScanEmpty] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  /** 纯前端版：模型/特征库加载与推理阶段进度（桌面版不显示）。 */
  const [scanProgress, setScanProgress] = useState<{ phase: string; pct: number; text?: string } | null>(null);
  /** 纯前端版：上一次识别用的后端/模型/耗时（排查「为什么慢/为什么没识别到」）。 */
  const [scanPerf, setScanPerf] = useState<{
    backend: string;
    totalMs: number;
    p95: number;
    samples: number;
    modelFile: string;
    modelKey: string;
    modelMB: number;
    fromCache: boolean;
    features: number;
  } | null>(null);
  /** 进度条显示的百分比：向真实进度平滑逼近，避免「卡住 → 突然结束」。 */
  const [displayPct, setDisplayPct] = useState<number>(0);
  const progressTargetRef = useRef<number>(0);
  const displayPctRef = useRef<number>(0);
  /** 进度行是否可见：识别结束后还会停留一小会儿做收尾动画，不会"嗖"地消失。 */
  const [progressVisible, setProgressVisible] = useState<boolean>(false);
  const progressHideTimerRef = useRef<number | null>(null);
  /** 本次识别已用时（秒）：OCR 这种长时间不回报的阶段靠它体现"还在动"。 */
  const [scanElapsed, setScanElapsed] = useState<number>(0);
  /** PC 端推理后端状态（GPU/CPU）：进页面就查一次，展示给用户看。 */
  const [inferBackend, setInferBackend] = useState<{
    activeLabel: string;
    activeShort: string;
    isGpu: boolean;
    gpuAvailable: boolean;
    gpuEnabled: boolean;
    onnxruntime: string;
    ocrGpu: boolean;
    mode: string;
    error: string | null;
    gpuName: string;
    gpuVramMB: number;
    gpuCount: number;
    cpuName: string;
    gpuUsable: boolean;
    gpuReason: string;
  } | null>(null);
  const [backendChecking, setBackendChecking] = useState<boolean>(false);
  /** PC 端：上一次识别的耗时/图位数（与 Web 端一样，识别完展示一行信息） */
  const [pcPerf, setPcPerf] = useState<{ ms: number; count: number; p95: number; samples: number } | null>(null);
  const pcPerfSamplesRef = useRef<number[]>([]);
  /** 纯前端版：本次切分出几个图位（单图=1）。 */
  const [batchInfo, setBatchInfo] = useState<{ count: number; mode: 'single' | 'batch' } | null>(null);
  /** 纯前端版：OCR 名字融合开关（关掉可省 15MB 下载与每次几百 ms 推理）。 */
  const [ocrEnabled, setOcrEnabled] = useState<boolean>(() => storage.getSetting<boolean>('webEnableOcr', true));
  /** 视角自动归位：识别完成自动下滚到结果区、确认点亮后回到识别区；关闭后识别全程不自动滚动。 */
  const [autoReturnView, setAutoReturnView] = useState<boolean>(() =>
    storage.getSetting<boolean>('autoReturnView', true)
  );

  // 识别参数小弹窗（识别门槛 / 候选数量收进此处，正常使用无需展开）
  const [showRecogSettings, setShowRecogSettings] = useState<boolean>(false);
  const recogSettingsRef = useRef<HTMLDivElement>(null);

  // Lightbox modal for original image high-res preview
  const [showOriginalImageLightbox, setShowOriginalImageLightbox] = useState<boolean>(false);

  // Review items state
  const [reviewItems, setReviewItems] = useState<BatchInitReviewItem[]>([]);
  const [totalDetected, setTotalDetected] = useState<number>(0);
  const [filterTab, setFilterTab] = useState<'all' | 'unencountered' | 'alreadyEncountered' | 'checked' | 'unmatched'>('all');

  // 批量初始化「疑似重复精灵」提醒：设置开关（默认开）+ 本次结果内手动关闭
  const [showDuplicateHint, setShowDuplicateHint] = useState<boolean>(() =>
    storage.getSetting<boolean>('showDuplicatePetHint', true)
  );
  const [dupHintDismissed, setDupHintDismissed] = useState<boolean>(false);

  // 纯前端版：模型列表弹窗（查看缓存状态 / 提前手动下载模型）
  const [showModelAssets, setShowModelAssets] = useState<boolean>(false);

  // 视频攻略弹窗：视频源由 resources/chat.json 的 video_guide 动态下发
  const [showVideoGuide, setShowVideoGuide] = useState<boolean>(false);
  const [videoGuideItems, setVideoGuideItems] = useState<VideoGuideItem[]>(DEFAULT_VIDEO_GUIDE_ITEMS);

  // Editing single item modal/picker
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewSectionRef = useRef<HTMLDivElement>(null);
  const gameViewRef = useRef<HTMLDivElement>(null);

  // 识别参数弹窗：点击外部或按 Esc 关闭
  useEffect(() => {
    if (!showRecogSettings) return;
    const onDown = (e: MouseEvent) => {
      if (recogSettingsRef.current && !recogSettingsRef.current.contains(e.target as Node)) {
        setShowRecogSettings(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowRecogSettings(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showRecogSettings]);

  // 纯前端版没有 WebGPU 就不提供识别入口：部署包只带 int8（受 Pages 单文件 25MiB 限制），
  // 保持与之前一致的策略 —— 无 WebGPU 的浏览器直接不显示识别模块。
  // 图鉴浏览、筛选、历史记录等纯静态功能不受影响。
  const webGpuMissing = IS_STATIC && !hasWebGPU();
  /** 纯前端版「当前生效模型」一行文案（模型固定 int8，不做切换）。 */
  const modelInfoLine = scanPerf?.modelFile
      ? `${scanPerf.modelFile} · ${scanPerf.modelMB ? scanPerf.modelMB.toFixed(0) + 'MB' : ''}` +
        ` · ${scanPerf.fromCache ? '已缓存' : '本次下载'}`
      : '';

  // 把识别进行中状态上报给父级（卸载时恢复为 false，避免父状态卡住）
  useEffect(() => {
    onScanningChange?.(isScanning);
    return () => onScanningChange?.(false);
  }, [isScanning]);

  // 真实进度（scanProgress.pct）只记录目标值；显示值走平滑动画：
  // 有目标时快速逼近，长时间没有新上报时缓慢爬升（最多比已上报值多 8%），
  // 这样 PC 端那种「OCR 之后几十毫秒就跑完」的场景也不会出现卡住再跳满。
  useEffect(() => {
    if (!progressVisible) {
      setDisplayPct(0);
      progressTargetRef.current = 0;
      return;
    }
    const id = window.setInterval(() => {
      setDisplayPct((prev) => {
        const target = progressTargetRef.current;
        if (target >= 100) return 100;
        if (prev < target) {
          // 收尾（target=100）时提快一点，让"完成后补满"只花半秒左右
          const gain = target >= 100 ? 0.45 : 0.22;
          return Math.min(target, prev + Math.max(0.8, (target - prev) * gain));
        }
        // 没有新上报时缓慢爬升，最多比已上报值多 12 个百分点（不假装快完成）
        const ceiling = Math.min(target + 12, 96);
        return prev < ceiling ? Math.min(ceiling, prev + 0.3) : prev;
      });
    }, 90);
    return () => window.clearInterval(id);
  }, [progressVisible]);

  useEffect(() => {
    displayPctRef.current = displayPct;
  }, [displayPct]);

  useEffect(() => {
    if (!progressVisible) {
      setScanElapsed(0);
      return;
    }
    const t0 = performance.now();
    const id = window.setInterval(() => setScanElapsed((performance.now() - t0) / 1000), 200);
    return () => window.clearInterval(id);
  }, [progressVisible]);

  // 卸载时清掉收尾定时器
  useEffect(() => () => {
    if (progressHideTimerRef.current !== null) window.clearTimeout(progressHideTimerRef.current);
  }, []);

  /** 查询/重新检测推理后端（PC 端）。Web 端没有这个概念，直接用本地识别后端那行展示。 */
  const loadInferBackend = React.useCallback((force: boolean) => {
    if (IS_STATIC) return;
    setBackendChecking(true);
    api.getInferBackend(force)
        .then((info) => setInferBackend(info ? {
          activeLabel: info.activeLabel,
          activeShort: info.activeShort,
          isGpu: info.isGpu,
          gpuAvailable: info.gpuAvailable,
          gpuEnabled: info.gpuEnabled,
          onnxruntime: info.onnxruntime,
          ocrGpu: info.ocrGpu,
          mode: info.mode,
          error: info.error,
          gpuName: info.gpuName,
          gpuVramMB: info.gpuVramMB,
          gpuCount: info.gpuCount,
          cpuName: info.cpuName,
          gpuUsable: info.gpuUsable,
          gpuReason: info.gpuReason,
        } : null))
        .catch(() => setInferBackend(null))
        .finally(() => setBackendChecking(false));
  }, []);

  useEffect(() => {
    loadInferBackend(false);
  }, [loadInferBackend]);

  // 设置里切换「GPU 加速」后，让这里的状态徽标也跟着刷新
  useEffect(() => {
    if (IS_STATIC) return;
    const onChange = () => loadInferBackend(false);
    window.addEventListener('roco-infer-backend-changed', onChange);
    return () => window.removeEventListener('roco-infer-backend-changed', onChange);
  }, [loadInferBackend]);

  // 真实进度只允许单调上升（后端阶段切换时偶发回退也不让进度条倒退）
  useEffect(() => {
    if (!isScanning || !scanProgress) return;
    progressTargetRef.current = Math.max(progressTargetRef.current, scanProgress.pct);
  }, [isScanning, scanProgress]);

  // Sync when currentMap changes from outside
  useEffect(() => {
    setSelectedMapNum(currentMap.num);
  }, [currentMap.num]);

  const targetMap = MAP_CONFIGS.find((m) => m.num === selectedMapNum) || currentMap;
  const targetMapPets: PetItem[] =
      allMapsPets[`map${selectedMapNum}`]?.items && allMapsPets[`map${selectedMapNum}`].items.length > 0
          ? allMapsPets[`map${selectedMapNum}`].items
          : FALLBACK_MAPS_DATA[`map${selectedMapNum}`]?.items || [];

  const checkAlreadyEncountered = (mapId: string, name?: string): boolean => {
    if (!name) return false;
    if (isEncountered) {
      return isEncountered(mapId, name);
    }
    return isPetEncounteredInRecords(records, mapId, name);
  };

  // Re-evaluate when target map changes
  useEffect(() => {
    if (reviewItems.length === 0) return;

    setReviewItems((prev) =>
        prev.map((item) => {
          let matchedPet = item.matchedPet;
          if (item.status === 'matched' && item.filename) {
            matchedPet = targetMapPets.find(
                (p) =>
                    isSamePetName(p.name, item.filename) ||
                    p.name.toLowerCase() === item.filename?.toLowerCase()
            );

            if (!matchedPet) {
              matchedPet = item.matchedPet || {
                name: item.filename,
                url: item.view_url || '',
              };
            }
          }

          const petName = matchedPet?.name || item.filename || '';
          const already = checkAlreadyEncountered(targetMap.id, petName);

          return {
            ...item,
            matchedPet,
            isAlreadyEncountered: already,
            isChecked: item.isChecked,
          };
        })
    );
  }, [selectedMapNum]);

  // 设置里「重复精灵提醒」开关变化时实时同步（设置弹窗/跨窗口修改也生效）
  useEffect(() => {
    const unsub = storage.subscribeSettings((s) => {
      if (typeof s.showDuplicatePetHint === 'boolean') setShowDuplicateHint(s.showDuplicatePetHint);
    });
    return () => unsub();
  }, []);

  // 视频攻略源：从 resources/videos.json 读取（Gitee raw 热更，改 JSON + push 即生效）。
  // 覆盖内置兜底配置；远程拉不到就继续用兜底，保证按钮点开一定有内容。
  useEffect(() => {
    let canceled = false;
    api.getVideos()
        .then((raw) => {
          if (canceled || !raw) return;
          const items = parseVideoGuide(raw);
          if (items.length > 0) setVideoGuideItems(items);
        })
        .catch(() => { /* 拉取失败保持兜底配置 */ });
    return () => { canceled = true; };
  }, []);

  // Keyboard Escape listener for Lightbox
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowOriginalImageLightbox(false);
      }
    };
    if (showOriginalImageLightbox) {
      window.addEventListener('keydown', onKey);
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [showOriginalImageLightbox]);

  // Clipboard paste listener
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        // If focusing search input, ignore
        if (target.getAttribute('type') === 'text') return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            handleFileSelect(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [selectedMapNum]);

  const handleFileSelect = (file: File) => {
    sound.playClick();
    // 换图即作废旧任务，避免上一张图的结果后到覆盖新图
    cancelLocalRecognition();
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setReviewItems([]);
    setScanError(null);
    setScanProgress(null);
  };

  const handleThresholdChange = (val: number) => {
    setThreshold(val);
    storage.setThreshold('batch_threshold', val);
  };

  const handleTopKChange = (k: number) => {
    setTopK(k);
    storage.setTopK(k);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleClearUpload = () => {
    sound.playClick();
    cancelLocalRecognition();
    setSelectedFile(null);
    setPreviewUrl(null);
    setReviewItems([]);
    setTotalDetected(0);
    setScanError(null);
    setScanProgress(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /** 纯前端版：取消进行中的本地识别。 */
  const handleCancelScan = () => {
    sound.playClick();
    cancelLocalRecognition();
    setScanProgress(null);
  };

  const handleStartBatchScan = async () => {
    if (!selectedFile && !previewUrl) return;

    sound.playScan();
    setIsScanning(true);
    setScanError(null);
    setScanEmpty(null);
    if (progressHideTimerRef.current !== null) {
      window.clearTimeout(progressHideTimerRef.current);
      progressHideTimerRef.current = null;
    }
    setProgressVisible(true);
    progressTargetRef.current = 1;
    setDisplayPct(1);
    setScanProgress({
      phase: 'manifest',
      pct: 0,
      text: IS_STATIC ? '正在准备识别资产' : '正在准备识别',
    });

    try {
      let fileToSend: File | Blob;
      if (selectedFile) {
        fileToSend = selectedFile;
      } else if (previewUrl) {
        const res = await fetch(previewUrl);
        fileToSend = await res.blob();
      } else {
        throw new Error('请先导入或选择图片');
      }

      // 纯前端版走浏览器内本地识别（LocalRecognizer），桌面版仍走 Flask；返回结构同构。
      const recognizeStart = performance.now();
      const { data } = await recognizeImage(
          fileToSend, selectedMapNum, threshold, topK, trialKey, targetMapPets,
          (phase, pct, text) => {
            setScanProgress({ phase, pct, text });
          },
          IS_STATIC ? { enableOcr: ocrEnabled, totalCount: 12 } : undefined
      );
      // PC 端：记录整次请求耗时，识别完成后像 Web 端一样展示一行信息
      const elapsedMs = performance.now() - recognizeStart;
      if (!IS_STATIC) {
        const samples = pcPerfSamplesRef.current;
        samples.push(elapsedMs);
        if (samples.length > 30) samples.shift();
        const sorted = samples.slice().sort((a, b) => a - b);
        const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
        setPcPerf({
          ms: elapsedMs,
          count: data.total_detected || data.results.length,
          p95,
          samples: samples.length,
        });
      }

      setTotalDetected(data.total_detected || data.results.length);

      const processed: BatchInitReviewItem[] = data.results.map((raw) => {
        const processedCandidates: BatchInitCandidateItem[] = (raw.candidates || []).map((cand) => {
          let matchedCandPet = targetMapPets.find(
              (p) =>
                  isSamePetName(p.name, cand.filename) ||
                  p.name.toLowerCase() === cand.filename.toLowerCase()
          );

          if (!matchedCandPet) {
            ['map1', 'map2', 'map3'].forEach((k) => {
              if (!matchedCandPet) {
                const list = allMapsPets[k]?.items || FALLBACK_MAPS_DATA[k]?.items || [];
                const match = list.find((p) => isSamePetName(p.name, cand.filename));
                if (match) matchedCandPet = match;
              }
            });
          }

          return {
            filename: cand.filename,
            match_path: cand.match_path,
            score: cand.score,
            view_url: cand.view_url,
            source: cand.source,
            out_of_map: cand.out_of_map,
            matchedPet: matchedCandPet || {
              name: cand.filename,
              url: cand.view_url || '',
            },
          };
        });

        // 调试环境守卫返回的占位结果（类型上不在 status 联合里，这里按字符串判断）
        if ((raw.status as string) === 'debug_guard') {
          console.warn('[batch] 识别被调试环境守卫跳过');
          setScanError('检测到调试环境（DevTools 停靠或窗口被判定为调试窗口），已跳过识别；关闭后重试即可');
          return;
        }

        const bestCand = processedCandidates[0];
        const activeFilename = raw.filename || bestCand?.filename;
        const activeScore = raw.score ?? bestCand?.score;
        const activeViewUrl = raw.view_url || bestCand?.view_url;

        let matchedPet: PetItem | undefined;
        if (raw.status === 'matched' && activeFilename) {
          matchedPet =
              bestCand?.matchedPet ||
              targetMapPets.find(
                  (p) =>
                      isSamePetName(p.name, activeFilename) ||
                      p.name.toLowerCase() === activeFilename.toLowerCase()
              );

          if (!matchedPet) {
            let foundAcrossOther: PetItem | undefined;
            ['map1', 'map2', 'map3'].forEach((k) => {
              if (!foundAcrossOther) {
                const list = allMapsPets[k]?.items || FALLBACK_MAPS_DATA[k]?.items || [];
                const match = list.find((p) => isSamePetName(p.name, activeFilename));
                if (match) foundAcrossOther = match;
              }
            });

            matchedPet = foundAcrossOther || {
              name: activeFilename,
              url: activeViewUrl || '',
            };
          }
        }

        // 识别门槛是「是否为真精灵」的判定线：Top1 仍低于门槛、且没有 OCR 读到精灵名时，
        // 这一格更可能是游戏里的「?」占位符 / 空槽，而不是一只低置信度精灵——按空槽处理。
        const bestScore = activeScore ?? bestCand?.score ?? 0;
        const hasOcrName = processedCandidates.some(
          (c) => c.source === 'ocr' || c.source === 'both'
        );
        const weakAsPlaceholder =
          raw.status === 'matched' && bestScore < threshold && !hasOcrName;
        const effectiveStatus: 'matched' | 'unmatched' =
          weakAsPlaceholder ? 'unmatched' : raw.status;

        const petName = matchedPet?.name || activeFilename || '';
        const alreadyEncountered = checkAlreadyEncountered(targetMap.id, petName);

        return {
          index: raw.index,
          status: effectiveStatus,
          filename: activeFilename,
          score: activeScore,
          view_url: activeViewUrl,
          crop_image: raw.crop_image,
          reason: weakAsPlaceholder
            ? `最高候选匹配度仅 ${Math.round(bestScore * 100)}%，低于识别门槛 ${Math.round(threshold * 100)}%`
            : raw.reason,
          matchedPet,
          candidates: processedCandidates,
          isAlreadyEncountered: alreadyEncountered,
          isChecked: false, // 默认不勾选，让用户从中挑选未遇见的精灵
          isManuallyEdited: false,
        };
      });

      setReviewItems(processed);
      setDupHintDismissed(false);
      if (processed.length === 0) {
        // 后端未检出任何图位（空白/碎片截图）：清空旧结果并提示，绝不保留上一张图的假数据。
        setScanError(null);
        setScanEmpty(
          '未检测到精灵图位。请确认截图里包含完整的精灵图鉴格子（而不是空白画面或界面碎片），再重新识别。'
        );
        return;
      }
      setScanEmpty(null);
      sound.playClick();

      // 开荒采集：无完整图鉴的试炼（如火系），把识别到的 (图, 精灵id, 置信度) 上报用于聚合
      processed.forEach((item) => {
        if (item.status === 'matched' && (item.score ?? 1) >= threshold && item.matchedPet?.id != null) {
          collectAtlasObservation(trialKey, {
            map_id: targetMap.id,
            pet_id: item.matchedPet.id,
            filename: item.filename,
            confidence: item.score,
          });
        }
      });

      // 识别完成后平滑往下滚到候选/结果区，方便直接核对候选（可在「识别参数」里关掉视角自动归位）
      if (autoReturnView) {
        setTimeout(() => {
          if (reviewSectionRef.current) {
            const rect = reviewSectionRef.current.getBoundingClientRect();
            // Leave comfortable 75px headroom so the entire control toolbar is fully visible
            const targetY = window.pageYOffset + rect.top - 75;
            window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
          }
        }, 120);
      }
    } catch (err: unknown) {
      if (isRecognitionCanceled(err)) {
        // 用户换图/主动取消：静默放弃，不当作错误提示
        setProgressVisible(false);
        return;
      }
      const error = err as Error;
      // 把完整堆栈打到控制台：只显示 message 时，定位问题非常困难
      console.error('[batch] 批量识别失败：', err);
      setScanError(error.message || '批量识别请求失败，请检查网络或后端接口');
      // 新图识别失败/未检出时，清空上一张图的结果，避免把旧图（或演示假数据）当成新图的识别结果。
      setReviewItems([]);
    } finally {
      setIsScanning(false);
      setScanProgress(null);
      // 收尾：先把进度条补满到 100% 再隐藏（等它真的爬到 100，最多等 1.6s）——
      // 识别只要几百毫秒时也不会出现「刚走到三四十就嗖地消失」。
      // 结果列表本身已经在上面渲染出来了，这一步只影响进度行。
      progressTargetRef.current = 100;
      const finishAt = performance.now();
      const waitAndHide = () => {
        if (displayPctRef.current >= 99.5 || performance.now() - finishAt > 1600) {
          setProgressVisible(false);
          progressHideTimerRef.current = null;
          return;
        }
        progressHideTimerRef.current = window.setTimeout(waitAndHide, 80);
      };
      progressHideTimerRef.current = window.setTimeout(waitAndHide, 80);
      if (IS_STATIC) {
        const perf = getRecognizerPerf();
        const info = getRecognizerInfo();
        if (perf && perf.last) {
          const modelPath = info?.model || '';
          const models = info?.manifest?.models || {};
          const modelKey = Object.keys(models).find((k) => models[k] === modelPath) || '';
          const modelBytes = (info?.manifest?.assets || []).find((a) => a.path === modelPath)?.bytes || 0;
          setScanPerf({
            backend: perf.backend || 'wasm',
            totalMs: Math.round(perf.last.totalMs),
            p95: Math.round(perf.totalP95),
            samples: perf.samples,
            modelFile: modelPath.split('/').pop() || '',
            modelKey,
            modelMB: modelBytes / 1e6,
            fromCache: !!info?.fromCache,
            features: info?.manifest?.features?.count || 0,
          });
        }
        const lastBatch = getLastBatchInfo();
        if (lastBatch) setBatchInfo({ count: lastBatch.count, mode: lastBatch.mode });
      }
    }
  };

  const handleToggleCheck = (index: number) => {
    sound.playClick();
    setReviewItems((prev) =>
        prev.map((item) =>
            item.index === index ? { ...item, isChecked: !item.isChecked } : item
        )
    );
  };

  const handleSelectAll = (check: boolean) => {
    sound.playClick();
    setReviewItems((prev) =>
        prev.map((item) => ({
          ...item,
          isChecked: check ? item.status === 'matched' : false,
        }))
    );
  };

  const handleSelectOnlyUnencountered = () => {
    sound.playClick();
    setReviewItems((prev) =>
        prev.map((item) => ({
          ...item,
          isChecked: item.status === 'matched' && !item.isAlreadyEncountered,
        }))
    );
  };

  const handleSelectCandidate = (itemIndex: number, candidate: BatchInitCandidateItem) => {
    sound.playClick();
    const candPetName = candidate.matchedPet?.name || candidate.filename;
    const already = checkAlreadyEncountered(targetMap.id, candPetName);
    const isGood = (candidate.score ?? 1) >= threshold;

    setReviewItems((prev) =>
        prev.map((item) => {
          if (item.index === itemIndex) {
            return {
              ...item,
              status: 'matched',
              filename: candidate.filename,
              score: candidate.score,
              view_url: candidate.view_url,
              matchedPet: candidate.matchedPet,
              isChecked: !already && isGood,
              isAlreadyEncountered: already,
              isManuallyEdited: true,
              reason: undefined,
            };
          }
          return item;
        })
    );
  };

  const handleApplyPetCorrection = (pet: PetItem) => {
    if (editingItemIndex === null) return;
    sound.playClick();

    const already = checkAlreadyEncountered(targetMap.id, pet.name);

    setReviewItems((prev) =>
        prev.map((item) => {
          if (item.index === editingItemIndex) {
            return {
              ...item,
              status: 'matched',
              filename: pet.name,
              view_url: pet.url,
              matchedPet: pet,
              score: 1.0,
              isChecked: true,
              isAlreadyEncountered: already,
              isManuallyEdited: true,
              reason: undefined,
            };
          }
          return item;
        })
    );

    setEditingItemIndex(null);
  };

  const handleConfirmBatchEncounter = () => {
    const selectedToEncounter = reviewItems.filter(
        (item) => item.isChecked && item.status === 'matched' && item.matchedPet
    );

    if (selectedToEncounter.length === 0) {
      alert('请至少勾选 1 只已正确匹配的精灵！');
      return;
    }

    sound.playEncounter();

    // 特效等级跟随「系统设置 → 视觉与特效」（0 关闭 / 1 轻微 / 2 标准 / 3 丰富），
    // 与首页、跟随识别、精灵详情用同一套彩花；以前这里写死 120 粒，设置不生效。
    fireEncounterConfetti(storage.getSetting<EffectLevel>('effectLevel', 0));

    const payload = selectedToEncounter.map((item) => ({
      mapId: targetMap.id,
      filename: item.matchedPet!.name,
      note: item.isManuallyEdited
          ? '批量识别（人工修正）'
          : `批量识别自动导入 (置信度: ${((item.score || 1) * 100).toFixed(1)}%)`,
    }));

    onBatchEncounterSuccess(payload);
    handleClearUpload();

    // 确认后回到「游戏画面识别」区，让它显示在最上面（关闭视角自动归位时不动）
    if (autoReturnView) {
      requestAnimationFrame(() => {
        if (gameViewRef.current) {
          gameViewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
  };

  const filteredItems = reviewItems.filter((item) => {
    if (filterTab === 'unencountered') return item.status === 'matched' && !item.isAlreadyEncountered;
    if (filterTab === 'alreadyEncountered') return item.status === 'matched' && item.isAlreadyEncountered;
    if (filterTab === 'checked') return item.isChecked;
    if (filterTab === 'unmatched') return item.status === 'unmatched';
    return true;
  });

  const checkedCount = reviewItems.filter((i) => i.isChecked && i.status === 'matched').length;
  const unencounteredNewCount = reviewItems.filter((i) => i.status === 'matched' && !i.isAlreadyEncountered).length;
  const alreadyEncounteredCount = reviewItems.filter((i) => i.status === 'matched' && i.isAlreadyEncountered).length;
  const unmatchedCount = reviewItems.filter((i) => i.status === 'unmatched').length;

  // 疑似重复精灵：同一只精灵（按 id，缺失时按文件名）在两个及以上图位命中
  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, { name: string; indexes: number[] }>();
    for (const item of reviewItems) {
      if (item.status !== 'matched' || !item.matchedPet) continue;
      const key = item.matchedPet.id != null ? `id:${item.matchedPet.id}` : `name:${item.filename || item.matchedPet.name}`;
      if (!key) continue;
      const name = formatPetName(item.matchedPet.name || item.filename);
      const g = groups.get(key) ?? { name, indexes: [] };
      g.indexes.push(item.index);
      groups.set(key, g);
    }
    return Array.from(groups.values()).filter((g) => g.indexes.length > 1);
  }, [reviewItems]);

  const hasDuplicateTop1 = duplicateGroups.length > 0;
  // 用户场景：批量初始化应全部是新精灵，若所有图位都命中却出现「已在图鉴」（未遇见 < 全部），
  // 往往是某一格重复或误识别。
  const allMatchedNoUnmatched = unmatchedCount === 0 && reviewItems.length > 0;
  const hasAlreadyWhenAllMatched = allMatchedNoUnmatched && alreadyEncounteredCount > 0;
  const showDuplicateBanner =
    showDuplicateHint &&
    !dupHintDismissed &&
    reviewItems.length >= 2 &&
    (hasDuplicateTop1 || hasAlreadyWhenAllMatched);
  // 提醒内容随批次变化即重新挂载，从而重新计算 3s 自动淡出
  const dupHintToastKey = useMemo(() => {
    if (hasDuplicateTop1) {
      return 'g:' + duplicateGroups.map((g) => g.name + '-' + g.indexes.join('')).join('|');
    }
    return `a:${reviewItems.length}:${alreadyEncounteredCount}`;
  }, [hasDuplicateTop1, duplicateGroups, reviewItems.length, alreadyEncounteredCount]);

  const handleDontShowDuplicateHint = () => {
    storage.setSetting('showDuplicatePetHint', false);
    setShowDuplicateHint(false);
    setDupHintDismissed(true);
  };

  // 卡片宽度随【结果区容器自身宽度】弹性变化（非固定像素、不看整个窗口）：
  // 祖先用 @container 建立容器查询上下文，这里按“结果容器宽度”选每行列数上限 N，
  // calc 把容器宽均分给 N 列（扣 N-1 个 gap=0.75rem）。阈值按单卡最小约 217px 仍可读标定，
  // 不受 Windows 缩放 / 侧栏 / 外层 padding 影响：容器够宽就能排到 6 列（最多 6）。
  // 配合 flex-wrap + justify-center：排满正好铺满；不足一行（1~2 个）整组水平居中、单卡不拉满。
  const getCardBasisClass = (count: number) => {
    if (count <= 3) {
      return 'w-full @[480px]:w-[calc((100%_-_0.75rem)/2)] @[700px]:w-[calc((100%_-_1.5rem)/3)]';
    }
    if (count === 4) {
      return 'w-full @[480px]:w-[calc((100%_-_0.75rem)/2)] @[700px]:w-[calc((100%_-_1.5rem)/3)] @[920px]:w-[calc((100%_-_2.25rem)/4)]';
    }
    if (count === 5) {
      return 'w-full @[480px]:w-[calc((100%_-_0.75rem)/2)] @[700px]:w-[calc((100%_-_1.5rem)/3)] @[920px]:w-[calc((100%_-_2.25rem)/4)] @[1140px]:w-[calc((100%_-_3rem)/5)]';
    }
    // 最多 6 列：结果容器 >=1360px 即排 6 列（单卡约 217px），1140~1360 为 5 列，再窄依次降级
    return 'w-full @[480px]:w-[calc((100%_-_0.75rem)/2)] @[700px]:w-[calc((100%_-_1.5rem)/3)] @[920px]:w-[calc((100%_-_2.25rem)/4)] @[1140px]:w-[calc((100%_-_3rem)/5)] @[1360px]:w-[calc((100%_-_3.75rem)/6)]';
  };

  // 没有 WebGPU：不渲染识别模块，只留一句说明（图鉴本身照常可用）
  if (webGpuMissing) {
    return (
        <div className="bg-white dark:bg-slate-900 roco-card p-4 sm:p-5 mb-5 shadow-xs border border-slate-100 dark:border-slate-800">
          <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
            <span>
              本机浏览器不支持 GPU 加速（<span className="font-mono">WebGPU</span>），本地识别模块已隐藏；
              图鉴浏览、地图筛选、记录功能一切照常。
              如需识别，请用 <span className="font-black text-slate-600 dark:text-slate-300">Chrome / Edge 113+</span>
              或 <span className="font-black text-slate-600 dark:text-slate-300">Safari 16.4+</span> 打开本页面。
            </span>
          </div>
        </div>
    );
  }

  return (
      <div className="bg-white dark:bg-slate-900 roco-card p-5 sm:p-6 mb-5 shadow-xs border border-slate-100 dark:border-slate-800 transition-colors">
        {/* Header & Help Button */}
        <div
            ref={gameViewRef}
            className="flex items-center justify-between gap-3 pb-4 border-b-2 border-[#F1F5F9] dark:border-slate-800 flex-wrap"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#7ABCF4] text-white flex items-center justify-center shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-slate-800 dark:text-slate-100 tracking-tight">
                  游戏画面识别
                </h3>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#EBF4FE] dark:bg-sky-950/70 text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800 font-black flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-[#2B78C4] dark:text-sky-300" />
                  本地 AI 离线推理
                </span>
                {/* 模型列表入口已移除：模型统一在识别时按需下载，界面不再提供手动下载 */}
                {/* PC 端：推理后端状态（GPU / CPU）——让用户一眼看到当前在用哪个后端 */}
                {!IS_STATIC && inferBackend && (
                    <HintTooltip
                        side="bottom"
                        content={
                          `${inferBackend.isGpu
                              ? '已启用 GPU 加速（DirectML/CUDA），识别更快。'
                              : (inferBackend.gpuAvailable
                                  ? `GPU 不可用，已自动降级为 CPU 计算。\n原因：${inferBackend.gpuReason || '未通过真机验证'}`
                                  : '当前环境未安装 GPU 版推理引擎，使用 CPU 计算。')}\n` +
                          `推理后端：${inferBackend.activeLabel}\n` +
                          `ONNX Runtime：${inferBackend.onnxruntime}\n` +
                          `OCR 加速：${inferBackend.ocrGpu ? 'GPU' : 'CPU'}\n` +
                          `后端偏好：${inferBackend.mode}\n` +
                          (inferBackend.gpuName
                              ? `显卡：${inferBackend.gpuName}${inferBackend.gpuVramMB ? `（显存 ${(inferBackend.gpuVramMB / 1024).toFixed(0)}GB）` : ''}`
                                + (inferBackend.gpuCount > 1 ? ` 等 ${inferBackend.gpuCount} 块` : '') + '\n'
                              : '显卡：未识别到独立 GPU\n') +
                          (inferBackend.cpuName ? `CPU：${inferBackend.cpuName}` : '') +
                          (inferBackend.error ? `\n探测信息：${inferBackend.error}` : '')
                        }
                        className="cursor-help"
                    >
                      <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-black flex items-center gap-1 ${
                          inferBackend.isGpu
                              ? 'bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border-[#95D151]'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        <Cpu className="w-3 h-3" />
                        {backendChecking ? '检测后端…' : inferBackend.activeShort}
                      </span>
                    </HintTooltip>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                导入含精灵图标或名字的截图，本地视觉模型离线计算并提供候选
              </p>
            </div>
          </div>

          {/* Action Controls on Top Right */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* 截图格式示例：悬停查看 5 张正确截图，点击可直接加载测试识别 */}
            <RecognitionSamplesHint onLoadSample={handleFileSelect} />

            {/* 视频攻略：打开内置播放器弹窗，视频源可远程动态更换 */}
            <button
                type="button"
                id="batch-video-guide-btn"
                onClick={() => {
                  sound.playClick();
                  setShowVideoGuide(true);
                }}
                className="text-xs font-black text-[#2B78C4] dark:text-sky-300 hover:text-white dark:hover:text-white bg-[#EBF4FE] dark:bg-sky-950/60 hover:bg-[#7ABCF4] dark:hover:bg-sky-600 border border-[#BCD7F2] dark:border-sky-800 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                title="查看首页识别的视频攻略"
            >
              <MonitorPlay className="w-3.5 h-3.5" />
              <span>视频攻略</span>
            </button>

            {(selectedFile || previewUrl || reviewItems.length > 0) && (
                <button
                    type="button"
                    onClick={handleClearUpload}
                    disabled={isScanning}
                    className="text-xs font-black text-rose-600 dark:text-rose-400 hover:text-rose-700 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 border border-rose-200 dark:border-rose-900/60 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-rose-50 dark:disabled:hover:bg-rose-950/40 disabled:hover:text-rose-600 dark:disabled:hover:text-rose-400"
                    title={isScanning ? '识别进行中，请稍候或等待识别完成' : '清空当前截图与识别列表'}
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>清空</span>
                </button>
            )}
          </div>
        </div>

        {/* Target Map Selector Bar（识别区不再套一层底色描边框，仅保留一条分隔线） */}
        <div className="mt-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 pb-3.5 border-b border-[#E2EAF4] dark:border-slate-700">
            {/* Target Map Selector（标签置于横向滚动容器之外，避免悬停气泡被 overflow 裁剪） */}
            <HintTooltip
                side="bottom"
                content="只在所选地图的精灵图鉴范围内匹配，过滤掉其它地图的结果，识别更准。"
                className="shrink-0 cursor-help self-center"
            >
              <span className="text-xs font-black text-slate-700 dark:text-slate-200 whitespace-nowrap flex items-center gap-0.5">
                目标地图:<Info className="w-3 h-3 text-slate-400" />
              </span>
            </HintTooltip>
            <div className="grid grid-cols-3 gap-1.5 lg:flex lg:items-center lg:gap-2 lg:flex-1 w-full lg:w-auto min-w-0">
              {MAP_CONFIGS.map((map) => {
                const isSelected = selectedMapNum === map.num;
                const mapPets = allMapsPets[`map${map.num}`]?.items || [];
                const totalPets = mapPets.length || 0;
                const encCount = mapPets.filter((p) => checkAlreadyEncountered(map.id, p.name)).length;
                const shortName = map.name.replace('记忆中的', '').replace('草原', '');

                return (
                    <button
                        key={map.id}
                        onClick={() => {
                          sound.playClick();
                          setSelectedMapNum(map.num);
                          if (onSelectMap) onSelectMap(map.num);
                        }}
                        disabled={isScanning}
                        className={`min-w-0 w-full lg:w-auto justify-center px-1.5 sm:px-2 lg:px-3 py-1.5 rounded-xl text-[10px] sm:text-xs font-black transition-all flex flex-col min-[420px]:flex-row items-center gap-0.5 min-[420px]:gap-1 lg:gap-1.5 border-2 whitespace-nowrap cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            isSelected
                                ? 'bg-[#7ABCF4] dark:bg-sky-500 text-white border-[#5DA8E8] dark:border-sky-400 shadow-xs'
                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-[#E2E8F0] dark:border-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500'
                        }`}
                    >
                      <span className="truncate max-w-full">{map.num}、{shortName}</span>
                      <span className={`text-[9px] sm:text-[10px] font-mono ${isSelected ? 'text-white/90' : 'text-slate-400'}`}>
                        ({encCount}/{totalPets})
                      </span>
                    </button>
                );
              })}
            </div>

            {/* 识别专业参数（识别门槛 / 候选数量）收进小弹窗，正常使用无需调整 */}
            <div className="relative shrink-0 w-full lg:w-auto" ref={recogSettingsRef}>
              <button
                  type="button"
                  onClick={() => { sound.playClick(); setShowRecogSettings((v) => !v); }}
                  disabled={isScanning}
                  className={`w-full lg:w-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black border-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      showRecogSettings
                          ? 'bg-[#7ABCF4] text-white border-[#5DA8E8] dark:border-sky-400 shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-[#E2E8F0] dark:border-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500'
                  }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>识别参数</span>
                <span className="hidden sm:inline font-mono text-[10px] opacity-80">
                  门槛{Math.round(threshold * 100)}% · TopK {topK}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showRecogSettings ? 'rotate-180' : ''}`} />
              </button>

              {showRecogSettings && (
                  <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-2xl border-2 border-[#E6EEF8] dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl p-4 space-y-4">
                    {/* 识别门槛 */}
                    <div>
                      <div className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200 mb-2">
                        <Sliders className="w-3.5 h-3.5 text-[#7ABCF4] dark:text-sky-400" />
                        <HintTooltip
                            side="bottom"
                            content="相似度达到该比例才算匹配。调高更严格、误判少但可能漏；调低更宽松、能找回边缘结果但可能混入不太像的。多数截图保持默认即可。"
                            className="cursor-help"
                        >
                          <span className="font-bold flex items-center gap-0.5 underline decoration-dotted decoration-slate-300 underline-offset-2">
                            识别门槛<Info className="w-3 h-3 text-slate-400" />
                          </span>
                        </HintTooltip>
                        <span className="ml-auto font-mono font-black text-[#2B78C4] dark:text-sky-300">{Math.round(threshold * 100)}%</span>
                      </div>
                      <ThresholdSlider
                          value={threshold}
                          onChange={handleThresholdChange}
                          min={0.1}
                          max={0.95}
                          step={0.01}
                          accent="#7ABCF4"
                          className="w-full"
                          showValue={false}
                      />
                    </div>
                    {/* 候选数量 */}
                    <div>
                      <div className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200 mb-2">
                        <Award className="w-3.5 h-3.5 text-amber-500" />
                        <HintTooltip
                            side="bottom"
                            content="每个检测图位最多保留几个最相似的图鉴候选，供你逐个点选比对。越多越不容易漏掉正确答案，但列表更长。"
                            className="cursor-help"
                        >
                          <span className="font-bold flex items-center gap-0.5 underline decoration-dotted decoration-slate-300 underline-offset-2">
                            候选数量(Top-K)<Info className="w-3 h-3 text-slate-400" />
                          </span>
                        </HintTooltip>
                      </div>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5, 6].map((k) => (
                            <button
                                key={k}
                                type="button"
                                disabled={isScanning}
                                onClick={() => handleTopKChange(k)}
                                className={`flex-1 px-1.5 py-1 rounded-md text-[11px] font-black cursor-pointer border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                    topK === k
                                        ? 'bg-amber-400 text-amber-950 border-amber-500'
                                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:border-slate-400'
                                }`}
                            >
                              {k}
                            </button>
                        ))}
                      </div>
                    </div>

                    {/* 视角自动归位：识别完自动下滚到结果、确认后回到识别区；关闭后全程不自动滚动（桌面 / Web 都生效） */}
                    <label className="flex items-start gap-2 cursor-pointer select-none pt-1 border-t border-slate-100 dark:border-slate-700">
                      <input
                          type="checkbox"
                          checked={autoReturnView}
                          disabled={isScanning}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setAutoReturnView(next);
                            storage.setSetting('autoReturnView', next);
                          }}
                          className="mt-0.5 w-3.5 h-3.5 accent-[#7ABCF4] cursor-pointer"
                      />
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        <HintTooltip
                            side="bottom"
                            content="开启后：识别完成自动把视角带到结果区，确认点亮后自动回到识别区（归位）。关闭后识别全程不自动滚动，视角停在你当前的位置。"
                            className="cursor-help"
                        >
                          <span className="font-black text-slate-600 dark:text-slate-300 underline decoration-dotted decoration-slate-300 underline-offset-2 flex items-center gap-0.5">
                            视角自动归位<Info className="w-3 h-3 text-slate-400" />
                          </span>
                        </HintTooltip>
                        <br />
                        识别完成自动定位到结果区、确认点亮后回到识别区；关闭后识别全程视角不自动滚动。
                      </span>
                    </label>

                    {/* 纯前端版：不再提供模型切换（部署包只带 int8，受 Pages 单文件 25MiB 限制），
                        只显示当前实际生效的模型 + OCR 增强开关。桌面版没有这一块。 */}
                    {IS_STATIC && (
                        <div className="pt-1 border-t border-slate-100 dark:border-slate-700 space-y-2">
                          <div className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200">
                            <Layers className="w-3.5 h-3.5 text-[#7ABCF4] dark:text-sky-400" />
                            <HintTooltip
                                side="bottom"
                                content="本地识别用的模型（固定 int8 量化版，体积 25MB 以内以便随站点分发；首次识别会下载并缓存到浏览器，之后不再重复下载）。"
                                className="cursor-help"
                            >
                              <span className="font-bold flex items-center gap-0.5 underline decoration-dotted decoration-slate-300 underline-offset-2">
                                本地模型<Info className="w-3 h-3 text-slate-400" />
                              </span>
                            </HintTooltip>
                            <span className="ml-auto">
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                                int8 · 25MB
                              </span>
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-slate-400 truncate">
                            当前生效：{modelInfoLine || '首次识别时加载（dino_int8.onnx）'}
                          </p>

                          {/* OCR 文字融合：增强项，可关闭以省流量与耗时 */}
                          <label className="flex items-start gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={ocrEnabled}
                                disabled={isScanning}
                                onChange={(e) => {
                                  const next = e.target.checked;
                                  setOcrEnabled(next);
                                  storage.setSetting('webEnableOcr', next);
                                }}
                                className="mt-0.5 w-3.5 h-3.5 accent-[#7ABCF4] cursor-pointer"
                            />
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              <span className="font-black text-slate-600 dark:text-slate-300">OCR 名字辅助（+15MB）</span>
                              <br />
                              用截图里的精灵名做文字匹配，和图像特征融合；关掉可省一次模型下载与每次几百毫秒。
                            </span>
                          </label>
                        </div>
                    )}

                    {/* PC 端：推理后端状态 + 重新检测（GPU 是否生效一眼可见） */}
                    {!IS_STATIC && (
                        <div className="pt-1 border-t border-slate-100 dark:border-slate-700">
                          <div className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200 mb-2">
                            <Cpu className="w-3.5 h-3.5 text-[#7ABCF4] dark:text-sky-400" />
                            <HintTooltip
                                side="bottom"
                                content="识别用的推理后端：GPU（DirectML/CUDA）会显著更快；没有可用 GPU 时会自动降级为 CPU，功能完全一致。"
                                className="cursor-help"
                            >
                              <span className="font-bold flex items-center gap-0.5 underline decoration-dotted decoration-slate-300 underline-offset-2">
                                推理后端<Info className="w-3 h-3 text-slate-400" />
                              </span>
                            </HintTooltip>
                            <button
                                type="button"
                                disabled={backendChecking}
                                onClick={() => {
                                  sound.playClick();
                                  loadInferBackend(true);
                                }}
                                className="ml-auto text-[10px] font-black text-[#2B78C4] dark:text-sky-300 hover:underline disabled:opacity-50 cursor-pointer"
                            >
                              {backendChecking ? '检测中…' : '重新检测'}
                            </button>
                          </div>
                          {/* 只留一个徽标：版本/OCR 等细节放进悬浮提示，避免窄弹窗里换行溢出 */}
                          <span className={`inline-block whitespace-nowrap text-[11px] font-black px-2 py-0.5 rounded ${
                              inferBackend?.isGpu
                                  ? 'bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                          }`}>
                            {inferBackend ? inferBackend.activeShort : '检测中…'}
                          </span>
                          {/* 硬件信息：跟随后端一起变（GPU 时显示显卡，CPU 时说明原因 + CPU 型号） */}
                          <p className="mt-1 text-[10px] text-slate-400 truncate">
                            {inferBackend ? inferHardwareLine(inferBackend) : ''}
                          </p>
                        </div>
                    )}
                  </div>
              )}
            </div>
          </div>

          {/* Upload Dropzone & Balanced Control Panel */}
          <div className="mt-4">
            <input
                type="file"
                ref={fileInputRef}
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelect(e.target.files[0]);
                  }
                }}
            />

            {/* If NO preview image is selected */}
            {!previewUrl ? (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                  <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`md:col-span-8 border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col sm:flex-row items-center justify-center gap-4 min-h-[140px] bg-white dark:bg-slate-800 ${
                          isDragOver
                              ? 'border-[#95D151] bg-[#F4FDF0] dark:bg-emerald-950/30 scale-[1.01]'
                              : 'border-[#BCD7F2] dark:border-slate-700 hover:bg-[#EBF4FE] dark:hover:bg-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-500'
                      }`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-[#EBF4FE] dark:bg-slate-700 text-[#2B78C4] dark:text-sky-300 flex items-center justify-center border border-[#BCD7F2] dark:border-slate-600 shrink-0 shadow-2xs">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <div className="text-center sm:text-left">
                      <p className="text-sm font-black text-slate-800 dark:text-slate-100">
                        点击或拖拽选择游戏画面截图
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        支持 PNG / JPG · 支持截图后直接 <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md font-mono text-[10px] text-slate-700 dark:text-slate-200">Ctrl + V</kbd> 快捷粘贴
                      </p>
                      <p className="text-[11px] text-[#7ABCF4] dark:text-sky-400 font-bold mt-1">
                        截取包含精灵图标/名称的界面，本地 AI 自动分割多精灵并预测候选
                      </p>
                    </div>
                  </div>

                  <div className="md:col-span-4 bg-white/70 dark:bg-slate-800/80 border border-[#E2E8F0] dark:border-slate-700 rounded-2xl p-4 flex flex-col justify-between items-center text-center">
                    <div className="w-full flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pb-2 border-b border-slate-100 dark:border-slate-700">
                      <span className="font-bold">识别准备状态</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black">
                        待导入画面
                      </span>
                    </div>

                    <div className="py-2 text-xs text-slate-400">
                      导入游戏画面后即可开启本地智能批量识别
                    </div>

                    <button
                        id="batch-card-scan-btn"
                        disabled={true}
                        className="w-full py-3 px-4 roco-btn-primary flex items-center justify-center gap-2 text-xs sm:text-sm font-black shadow-xs opacity-40 cursor-not-allowed rounded-xl"
                    >
                      <Sparkles className="w-4 h-4 text-white/70" />
                      <span>请先导入画面</span>
                    </button>
                  </div>
                </div>
            ) : (
                /* When Image is Selected: Large High-Clarity Viewport + Compact Control Station */
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                  {/* Left: High-Clarity Image Viewport (Supports Click-to-Zoom / Full Preview) */}
                  <div className="lg:col-span-7 xl:col-span-8 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs p-2.5 flex flex-col justify-between relative group overflow-hidden">
                    {/* Viewport Action Badges */}
                    <div className="flex items-center justify-between gap-2 mb-2 px-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded-md bg-[#7ABCF4] dark:bg-sky-600 text-white text-[10px] font-black flex items-center gap-1 shrink-0">
                          <ImageIcon className="w-3 h-3" />
                          画面截图
                        </span>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-200 truncate" title={selectedFile ? selectedFile.name : '已选择样本截图'}>
                          {selectedFile ? selectedFile.name : '已选择画面样本'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => setShowOriginalImageLightbox(true)}
                            className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 hover:bg-[#EBF4FE] dark:hover:bg-slate-600 border border-[#BCD7F2] dark:border-slate-600 text-[#1E5B99] dark:text-sky-300 text-[11px] font-black flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                            title="点击查看超高清原图"
                        >
                          <ZoomIn className="w-3.5 h-3.5 text-[#2B78C4] dark:text-sky-400" />
                          <span>放大原图</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-2 py-1 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                            title="更换其他截图"
                        >
                          <span>更换</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleClearUpload}
                            disabled={isScanning}
                            className="p-1 rounded-lg bg-white dark:bg-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-600 hover:border-rose-200 text-slate-400 hover:text-rose-600 shadow-2xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-slate-700 disabled:hover:text-slate-400"
                            title={isScanning ? '识别进行中，请稍候' : '移除图片'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Image Viewport: Height increased, object-contain, hover to zoom hint */}
                    <div
                        onClick={() => setShowOriginalImageLightbox(true)}
                        className="relative w-full h-48 sm:h-56 rounded-xl overflow-hidden border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60 flex items-center justify-center cursor-zoom-in group/img"
                    >
                      <img
                          src={previewUrl}
                          alt="游戏画面截图预览"
                          className="w-full h-full object-contain p-1 transition-transform duration-200 group-hover/img:scale-[1.02]"
                      />

                      {/* Hover Overlay Hint */}
                      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-2xs opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="px-3.5 py-1.5 rounded-xl bg-slate-900/85 text-white text-xs font-black flex items-center gap-1.5 shadow-lg border border-white/20">
                          <Maximize2 className="w-3.5 h-3.5 text-[#7ABCF4]" />
                          点击查看超高清大图
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 px-1 flex items-center justify-between text-[11px] text-slate-400">
                      <span>💡 提示：点击图片可随时放大全屏比对</span>
                      <span>支持粘贴 Ctrl+V 覆盖</span>
                    </div>
                  </div>

                  {/* Right: Control Station with Well-Proportioned Start Button */}
                  <div className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs p-4 sm:p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9] dark:border-slate-700">
                        <span className="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                          <Sparkle className="w-3.5 h-3.5 text-[#2B78C4] dark:text-sky-400" />
                          识别参数与控制
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300 border border-[#95D151]/50 text-[10px] font-black">
                          画面已就绪
                        </span>
                      </div>

                      <div className="mt-3 space-y-2.5">
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-xs">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300 mb-1">
                            <HintTooltip side="top" content="只在该地图图鉴范围内匹配，可在上方“目标地图”行切换。" className="cursor-help">
                              <span className="font-bold flex items-center gap-0.5">识别目标地图<Info className="w-3 h-3 text-slate-400" /></span>
                            </HintTooltip>
                            <span className="font-black text-[#1E5B99] dark:text-sky-300">{targetMap.num}、{targetMap.name.replace('记忆中的', '')}</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <HintTooltip side="top" content="相似度达到该比例才算匹配，可在右上角“识别参数”里调整。" className="cursor-help">
                              <span className="font-bold flex items-center gap-0.5">识别门槛<Info className="w-3 h-3 text-slate-400" /></span>
                            </HintTooltip>
                            <span className="font-mono font-black text-[#2B78C4] dark:text-sky-300">{Math.round(threshold * 100)}%</span>
                          </div>
                          {/* PC 端：把推理后端也放在这里，开跑前就能看到用的是 GPU 还是 CPU */}
                          {!IS_STATIC && (
                              <div className="flex items-center justify-between text-slate-600 dark:text-slate-300 mt-1">
                                <HintTooltip side="top" content="识别模型运行在 GPU 还是 CPU 上；可在「设置 → 推理后端」里开关 GPU 加速。" className="cursor-help">
                                  <span className="font-bold flex items-center gap-0.5">推理后端<Info className="w-3 h-3 text-slate-400" /></span>
                                </HintTooltip>
                                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                                    inferBackend?.isGpu
                                        ? 'bg-[#E1F7DB] dark:bg-emerald-950/60 text-[#2D6613] dark:text-emerald-300'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                }`}>
                                  {backendChecking ? '检测中…' : (inferBackend ? inferBackend.activeShort : '未知')}
                                </span>
                              </div>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed bg-[#FFFDF5] dark:bg-amber-950/20 rounded-xl p-2.5 space-y-1">
                          <div>✨ 识别完成后，系统将自动定位精灵候选并标出未遇状态，您可以勾选需要点亮的精灵。</div>
                          <div className="text-[10px] text-amber-700 dark:text-amber-400 font-medium pt-1 border-t border-amber-200/50 dark:border-amber-800/50">
                            💡 提示：首次识别时加载特征库可能较慢，请耐心等待片刻，后续识别将显著提速。
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Start Button: Well-proportioned, bold, attractive */}
                    <div className="mt-4 pt-3 border-t border-[#F1F5F9] space-y-2">
                      <button
                          id="batch-card-scan-btn"
                          disabled={!previewUrl || isScanning}
                          onClick={handleStartBatchScan}
                          className="w-full py-3.5 px-5 roco-btn-primary flex items-center justify-center gap-2 text-sm font-black shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed rounded-xl cursor-pointer transition-all active:scale-[0.98]"
                      >
                        {isScanning ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin text-white" />
                              <span>正在智能批量分割识别中...</span>
                            </>
                        ) : (
                            <>
                              <Sparkles className="w-4 h-4 text-[#FEE061]" />
                              <span>开始批量识别</span>
                            </>
                        )}
                      </button>

                      {/* 识别进度：纯前端版是本地推理进度，PC 端是后端阶段进度（轮询快照） */}
                      {progressVisible && (
                          <div className="rounded-xl border border-[#BCD7F2] dark:border-slate-600 bg-[#F8FBFE] dark:bg-slate-900 p-2.5 space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-300">
                              <span className="truncate pr-2">
                                {!isScanning && displayPct >= 99.5 ? '识别完成' : (scanProgress?.text || '正在识别')}
                                <span className="ml-1 font-mono text-[10px] font-normal text-slate-400">
                                  {scanElapsed >= 0.5 ? `${scanElapsed.toFixed(1)}s` : ''}
                                </span>
                              </span>
                              <span className="font-mono shrink-0">{Math.round(displayPct)}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div
                                  className="h-full bg-[#7ABCF4] dark:bg-sky-500 transition-[width] duration-100 ease-linear"
                                  style={{ width: `${Math.max(2, Math.min(100, displayPct))}%` }}
                              />
                            </div>
                            {isScanning && (
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-slate-400">
                                    {IS_STATIC ? '首次识别需下载本地模型，之后走缓存秒开' : '本地后端识别中，请稍候'}
                                  </span>
                                  {IS_STATIC && (
                                      <button
                                          type="button"
                                          onClick={handleCancelScan}
                                          className="text-[10px] font-black text-rose-500 hover:text-rose-600 cursor-pointer"
                                      >
                                        取消
                                      </button>
                                  )}
                                </div>
                            )}
                          </div>
                      )}

                      {IS_STATIC && !isScanning && scanPerf && (
                          <div className="text-[10px] text-slate-400 text-center font-mono leading-relaxed">
                            <div>
                              本地识别 · {scanPerf.backend}
                              {scanPerf.modelFile ? (
                                  <> · 模型 {scanPerf.modelKey || '—'}
                                    {scanPerf.modelMB ? ` ${scanPerf.modelMB.toFixed(0)}MB` : ''}
                                    <span className="opacity-70">
                                      （{scanPerf.modelFile}
                                      {scanPerf.fromCache ? ' · 已缓存' : ' · 本次下载'}）
                                    </span>
                                  </>
                              ) : null}
                              {scanPerf.features ? ` · 特征库 ${scanPerf.features} 条` : ''}
                            </div>
                            <div>
                              上次 {scanPerf.totalMs}ms
                              {batchInfo ? ` · ${batchInfo.mode === 'batch' ? `切分 ${batchInfo.count} 个图位` : '单图'}` : ''}
                              {scanPerf.samples > 1 ? `（P95 ${scanPerf.p95}ms / ${scanPerf.samples} 次）` : ''}
                            </div>
                          </div>
                      )}

                      {/* PC 端：识别完成后展示本次用了哪个后端 / 多久 / 切了几个图位 */}
                      {!IS_STATIC && !isScanning && pcPerf && (
                          <div className="text-[10px] text-slate-400 text-center font-mono leading-relaxed">
                            <div>
                              本地识别 · {inferBackendSummary(inferBackend)}
                            </div>
                            <div>
                              上次 {Math.round(pcPerf.ms)}ms
                              {pcPerf.count > 0
                                  ? ` · ${pcPerf.count > 1 ? `切分 ${pcPerf.count} 个图位` : '单图'}`
                                  : ''}
                              {pcPerf.samples > 1 ? `（P95 ${Math.round(pcPerf.p95)}ms / ${pcPerf.samples} 次）` : ''}
                            </div>
                          </div>
                      )}

                      <button
                          type="button"
                          onClick={handleClearUpload}
                          disabled={isScanning}
                          className="w-full py-1.5 px-3 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 text-xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
                      >
                        <Trash2 className="w-3 h-3 text-rose-400" />
                        <span>放弃当前截图</span>
                      </button>
                    </div>
                  </div>
                </div>
            )}
          </div>

          {scanError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{scanError}</span>
              </div>
          )}
          {scanEmpty && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
                <Info className="w-4 h-4 shrink-0 text-amber-500" />
                <span>{scanEmpty}</span>
              </div>
          )}
        </div>

        {/* High-Resolution Lightbox Modal for Uploaded Screenshot */}
        {showOriginalImageLightbox && previewUrl && (
            <div
                className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={() => setShowOriginalImageLightbox(false)}
            >
              <div
                  className="relative max-w-[94vw] max-h-[92vh] bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#7ABCF4] dark:border-sky-500 shadow-2xl p-3 sm:p-4 flex flex-col"
                  onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-2 py-0.5 rounded-md bg-[#7ABCF4] dark:bg-sky-600 text-white text-xs font-black">
                      高清全景原图
                    </span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                      {selectedFile ? selectedFile.name : '游戏画面截图'}
                    </span>
                  </div>
                  <button
                      type="button"
                      onClick={() => setShowOriginalImageLightbox(false)}
                      className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-black transition-colors cursor-pointer"
                      title="关闭 (Esc)"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-auto flex items-center justify-center max-h-[82vh] rounded-2xl bg-slate-950/5 dark:bg-slate-950/40 p-2">
                  <img
                      src={previewUrl}
                      alt="高清原图"
                      className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-md"
                  />
                </div>
              </div>
            </div>
        )}

        {/* Video Guide Modal（视频攻略） */}
        <VideoGuideModal
            isOpen={showVideoGuide}
            onClose={() => setShowVideoGuide(false)}
            items={videoGuideItems}
        />

        {/* Review Workbench (Filtered, Actions & STRICTLY 3 COLUMNS) */}
        {reviewItems.length > 0 && (
            <div ref={reviewSectionRef} className="mt-5 space-y-4 animate-in fade-in duration-300 scroll-mt-20">
              {/* 疑似重复精灵提醒：全局顶部悬浮 toast（自动停留 3s 并缓缓淡出，鼠标移上暂停） */}
              {showDuplicateBanner && (
                <DuplicatePetHintToast
                  key={dupHintToastKey}
                  hasDuplicateTop1={hasDuplicateTop1}
                  duplicateGroups={duplicateGroups}
                  reviewCount={reviewItems.length}
                  unencounteredNewCount={unencounteredNewCount}
                  alreadyEncounteredCount={alreadyEncounteredCount}
                  hasAlreadyWhenAllMatched={hasAlreadyWhenAllMatched}
                  onViewGroup={() => setFilterTab('all')}
                  onViewAlready={() => setFilterTab('alreadyEncountered')}
                  onDontShow={handleDontShowDuplicateHint}
                  onClose={() => setDupHintDismissed(true)}
                />
              )}

              {/* Integrated Control & Filter Strip (Tabs + Batch Actions) */}
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-slate-50/90 dark:bg-slate-800/90 p-2 sm:p-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
                {/* 1. Left: Filter Tabs */}
                <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto shrink-0 custom-scrollbar shadow-2xs">
                  <button
                      type="button"
                      onClick={() => setFilterTab('all')}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                          filterTab === 'all' ? 'bg-[#2B78C4] text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                  >
                    全部 ({reviewItems.length})
                  </button>
                  <button
                      type="button"
                      onClick={() => setFilterTab('unencountered')}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                          filterTab === 'unencountered' ? 'bg-[#95D151] text-white shadow-xs' : 'text-[#2D6613] dark:text-emerald-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                  >
                    ✨ 未遇见 ({unencounteredNewCount})
                  </button>
                  {alreadyEncounteredCount > 0 && (
                      <button
                          type="button"
                          onClick={() => setFilterTab('alreadyEncountered')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                              filterTab === 'alreadyEncountered' ? 'bg-slate-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                      >
                        已在图鉴 ({alreadyEncounteredCount})
                      </button>
                  )}
                  <button
                      type="button"
                      onClick={() => setFilterTab('checked')}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                          filterTab === 'checked' ? 'bg-[#7ABCF4] text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                  >
                    已勾选 ({checkedCount})
                  </button>
                  {unmatchedCount > 0 && (
                      <button
                          type="button"
                          onClick={() => setFilterTab('unmatched')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                              filterTab === 'unmatched' ? 'bg-rose-500 text-white shadow-xs' : 'text-rose-600 dark:text-rose-400 hover:text-rose-900 dark:hover:text-rose-200'
                          }`}
                      >
                        未匹配 ({unmatchedCount})
                      </button>
                  )}
                </div>

                {/* 3. Right: Quick Selection & Confirm Encounter Actions */}
                <div className="flex items-center gap-1.5 flex-wrap shrink-0 justify-end">
                  <button
                      type="button"
                      onClick={handleSelectOnlyUnencountered}
                      className="px-3 py-1.5 rounded-xl bg-[#E1F7DB] dark:bg-emerald-950/60 hover:bg-[#D3F3CA] border border-[#95D151] text-xs font-black text-[#2D6613] dark:text-emerald-300 flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                      title="一键仅勾选未遇见的精灵"
                  >
                    <Sparkle className="w-3.5 h-3.5 text-[#2D6613] dark:text-emerald-400" />
                    <span>选【未遇见】</span>
                  </button>
                  <button
                      type="button"
                      onClick={() => handleSelectAll(true)}
                      className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                  >
                    <CheckSquare className="w-3.5 h-3.5 text-[#95D151]" />
                    <span>全选</span>
                  </button>
                  <button
                      type="button"
                      onClick={() => handleSelectAll(false)}
                      className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                  >
                    <Square className="w-3.5 h-3.5 text-slate-400" />
                    <span>全不选</span>
                  </button>
                  <button
                      type="button"
                      disabled={checkedCount === 0}
                      onClick={handleConfirmBatchEncounter}
                      className="px-4 py-1.5 rounded-xl roco-btn-success text-xs font-black flex items-center gap-1.5 shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all active:scale-[0.98]"
                      title="确认遇见已勾选的精灵"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>确认遇见{checkedCount > 0 ? ` (${checkedCount})` : ''}</span>
                  </button>
                </div>
              </div>

              {/* Items Review Grid - identical responsive compact layout as BatchInitModal */}
              <div className="@container flex flex-wrap justify-center gap-3">
                {filteredItems.map((item) => {
                  const isMatched = item.status === 'matched';
                  const scorePercent = item.score ? (item.score * 100).toFixed(1) : '0';
                  const isHighScore = (item.score || 0) >= 0.88;
                  const isAlready = !!item.isAlreadyEncountered;
                  const isPlaceholder = isPlaceholderSlot(item, threshold);
                  const displayName = formatPetName(item.matchedPet?.name || item.filename);

                  return (
                      <div
                          key={item.index}
                          onClick={isPlaceholder ? undefined : () => handleToggleCheck(item.index)}
                          className={`relative rounded-2xl border shadow-xs p-3 transition-colors duration-150 flex flex-col justify-between ${isPlaceholder ? 'cursor-default' : 'cursor-pointer'} select-none group/card hover:shadow-md ${getCardBasisClass(filteredItems.length)} ${
                              item.isChecked
                                  ? 'border-[#95D151] bg-[#F9FEF8] dark:bg-emerald-950/40 shadow-xs ring-2 ring-[#95D151]/30'
                                  : isPlaceholder
                                      ? 'border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 hover:border-slate-400'
                                      : item.status === 'unmatched'
                                          ? 'border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/30 hover:border-rose-400'
                                          : isAlready
                                              ? 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 opacity-90 hover:border-slate-400'
                                              : 'border-[#E6EEF8] dark:border-slate-700 bg-white dark:bg-slate-800 opacity-80 hover:border-[#7ABCF4]'
                          }`}
                      >
                        <div>
                          {/* Top Row: Checkbox + Index */}
                          <div className="flex items-center justify-between mb-1.5">
                            <label
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isPlaceholder) handleToggleCheck(item.index);
                                }}
                                className={`flex items-center gap-1.5 select-none ${isPlaceholder ? 'cursor-default opacity-40' : 'cursor-pointer'}`}
                            >
                              <input
                                  type="checkbox"
                                  checked={item.isChecked}
                                  disabled={isPlaceholder}
                                  onChange={() => {}}
                                  className="w-4 h-4 rounded text-[#95D151] accent-[#95D151] cursor-pointer"
                              />
                              <span className="text-[10px] font-mono font-black text-slate-500 dark:text-slate-400">
                                检测图位 #{item.index + 1}
                              </span>
                            </label>

                            {/* Status / Score Tag */}
                            {isMatched ? (
                                <span
                                    className={`text-[9px] font-mono font-black px-1.5 py-0.2 rounded-md ${
                                        item.isManuallyEdited
                                            ? 'bg-[#EBF4FE] dark:bg-sky-950/70 text-[#2B78C4] dark:text-sky-300 border border-[#BCD7F2] dark:border-sky-800'
                                            : isHighScore
                                                ? 'bg-[#E1F7DB] dark:bg-emerald-950/70 text-[#2D6613] dark:text-emerald-300'
                                                : 'bg-[#FEF9E6] dark:bg-amber-950/70 text-[#854D0E] dark:text-amber-300'
                                    }`}
                                >
                                  {item.isManuallyEdited ? '已选定' : `Top 1: ${scorePercent}%`}
                                </span>
                            ) : isPlaceholder ? (
                                <span className="text-[9px] font-black px-1.5 py-0.2 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600">
                                  空槽
                                </span>
                            ) : (
                                <span className="text-[9px] font-black px-1.5 py-0.2 rounded-md bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300">
                                  未匹配
                                </span>
                            )}
                          </div>

                          {/* Main Selected Pet Display */}
                          <div className="flex flex-col items-center text-center my-1">
                            <div className="flex items-end justify-center gap-1.5 w-full">
                              {item.crop_image && (
                                <div className="flex flex-col items-center gap-0.5">
                                  <div className="w-16 h-16 rounded-lg bg-[#F5F9FF] dark:bg-slate-800 p-1 border border-dashed border-[#7ABCF4] dark:border-sky-500 flex items-center justify-center overflow-hidden">
                                    <ImageZoom src={item.crop_image} alt="截图裁剪实图" trigger="hover" className="w-full h-full" imgClassName="w-full h-full object-contain" />
                                  </div>
                                  <span className="text-[8px] font-bold text-sky-600 dark:text-sky-400 leading-none mt-0.5">截图实图</span>
                                </div>
                              )}
                              {item.crop_image && (
                                <div className="flex flex-col gap-0.5 shrink-0">
                                  <div className="w-16 h-16 flex items-center justify-center">
                                    <ArrowLeftRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                                  </div>
                                  <div className="h-[10px]" />
                                </div>
                              )}
                              <div className="flex flex-col items-center gap-0.5">
                            <div className="relative w-16 h-16 rounded-xl bg-white dark:bg-slate-900 p-1 border border-[#E6EEF8] dark:border-slate-700 shadow-inner flex items-center justify-center">
                              {isMatched && item.matchedPet ? (
                                  <ImageZoom
                                      src={item.view_url || undefined}
                                      alt={displayName}
                                      trigger="hover"
                                      className="w-full h-full"
                                      imgClassName="w-full h-full object-contain"
                                      // 纯前端版没有独立图标地址（view_url 为空），用雪碧图切片渲染：
                                      // 同样支持悬停放大，浮层里切片会跟着容器放大。
                                      thumb={
                                          <PetSprite
                                              pet={item.matchedPet}
                                              url={item.matchedPet?.url}
                                              alt={displayName}
                                              className="w-full h-full object-contain"
                                          />
                                      }
                                  />
                              ) : isPlaceholder ? (
                                  <ImageOff className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                              ) : (
                                  <HelpCircle className="w-8 h-8 text-rose-300 dark:text-rose-600" />
                              )}
                              <ElementBadges
                                  elements={item.matchedPet?.elements}
                                  className="absolute top-0.5 left-0.5 z-10"
                                  size="xs"
                              />
                              {item.matchedPet?.id != null && (
                                  <span className="absolute top-0.5 right-0.5 z-10 text-[8px] font-mono font-black leading-none px-1 py-0.5 rounded bg-slate-800/70 text-white/90">
                                    #{item.matchedPet.id}
                                  </span>
                              )}

                              {item.isChecked && isMatched && (
                                  <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-[#95D151] rounded-full flex items-center justify-center text-white shadow-xs border border-white">
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  </div>
                              )}
                            </div>

                                {item.crop_image && (
                                  <span className="text-[8px] font-bold leading-none text-slate-400 dark:text-slate-500 mt-0.5">图鉴候选</span>
                                )}
                              </div>
                            </div>
                            {/* Current Chosen Pet Name */}
                            <div className="mt-1.5 w-full">
                              {isMatched && item.matchedPet ? (
                                  <div className="flex items-center justify-center gap-1 flex-wrap">
                                    <p className="text-xs font-black text-slate-800 dark:text-slate-100 truncate" title={displayName}>
                                      {displayName}
                                    </p>
                                    <PetSpecialTag
                                        pet={item.matchedPet}
                                        filename={item.filename}
                                    />
                                  </div>
                              ) : isPlaceholder ? (
                                  <div className="w-full">
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold truncate">疑似占位符 / 空槽</p>
                                    <p
                                        className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 truncate"
                                        title="该位置不是精灵（可能是游戏的「?」占位或空图位），已自动忽略；若确为精灵可在下方人工挑选"
                                    >
                                      不是精灵，已忽略 · 可人工挑选
                                    </p>
                                  </div>
                              ) : (
                                  <p className="text-[10px] text-rose-600 dark:text-rose-400 font-bold truncate" title={item.reason || '特征不匹配'}>
                                    {item.reason || '未匹配到精灵'}
                                  </p>
                              )}
                            </div>

                            {/* Match Confidence Progress Bar */}
                            {isMatched && (
                                <div className="w-full mt-1.5 px-0.5">
                                  <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mb-0.5">
                                    <span>当前匹配度</span>
                                    <span className="font-black text-slate-600 dark:text-slate-300">{scorePercent}%</span>
                                  </div>
                                  <div className="w-full h-1.5 bg-slate-200/80 dark:bg-slate-700 rounded-full overflow-hidden p-[1px]">
                                    <div
                                        className={`h-full rounded-full transition-all duration-300 ${
                                            isHighScore
                                                ? 'bg-[#95D151]'
                                                : (item.score || 0) >= 0.5
                                                    ? 'bg-[#FEE061]'
                                                    : 'bg-rose-400'
                                        }`}
                                        style={{ width: `${Math.min(100, Math.max(0, (item.score || 0) * 100))}%` }}
                                    />
                                  </div>
                                </div>
                            )}

                            {/* Previously Encountered / New Discovery Badge */}
                            {isMatched && (
                                <div className="mt-1.5 w-full">
                                  {isAlready ? (
                                      <span className="inline-flex items-center justify-center gap-0.5 text-[10px] font-black text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-md border border-slate-300 dark:border-slate-600 w-full">
                                        已在图鉴中
                                      </span>
                                  ) : (
                                      <span className="inline-flex items-center justify-center gap-0.5 text-[10px] font-black text-[#2D6613] dark:text-emerald-300 bg-[#E1F7DB] dark:bg-emerald-950/60 px-1.5 py-0.5 rounded-md border border-[#95D151] w-full">
                                        <Sparkles className="w-2.5 h-2.5 text-[#2D6613] dark:text-emerald-400" />
                                        未遇见新宠
                                      </span>
                                  )}
                                </div>
                            )}
                          </div>

                          {/* Candidates Prediction List (Top 1~5) */}
                          {item.candidates && item.candidates.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-slate-100/90 dark:border-slate-700/90 w-full space-y-1">
                                <div className="flex items-center justify-between text-[10px] font-black text-slate-500 dark:text-slate-400 mb-1 px-0.5">
                                  <span>所有预测候选 ({item.candidates.length})</span>
                                  <span className="text-[9px] text-slate-400 font-normal">{item.crop_image ? "点击与左侧截图比对" : "点击直接切换"}</span>
                                </div>

                                <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5 custom-scrollbar">
                                  {item.candidates.map((cand, candIdx) => {
                                    const candPetName = cand.matchedPet?.name || cand.filename;
                                    const isSelectedCand = isMatched && (
                                        isSamePetName(item.matchedPet?.name || item.filename, cand.filename) ||
                                        item.filename === cand.filename
                                    );
                                    const scoreVal = cand.score || 0;
                                    const candScorePercent = (scoreVal * 100).toFixed(1);
                                    const candDisplayName = formatPetName(cand.filename);
                                    const isCandAlready = checkAlreadyEncountered(targetMap.id, candPetName);

                                    // Low-saturation, ultra-subtle color tint for progress bar according to confidence score
                                    const getProgressBarColor = (score: number) => {
                                      if (score >= 0.8) return 'from-emerald-200/20 to-teal-200/25';
                                      if (score >= 0.5) return 'from-amber-200/20 to-yellow-200/25';
                                      return 'from-rose-200/20 to-orange-200/25';
                                    };

                                    return (
                                        <div
                                            key={cand.filename + candIdx}
                                            className="@container w-full"
                                        >
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleSelectCandidate(item.index, cand);
                                                }}
                                                className={`relative overflow-hidden w-full p-1.5 rounded-xl border-2 text-left @max-[300px]:grid @max-[300px]:grid-cols-[auto_1fr] @max-[300px]:items-center @max-[300px]:gap-x-1.5 @max-[300px]:gap-y-0.5 @[300px]:flex @[300px]:flex-nowrap @[300px]:items-center @[300px]:gap-1.5 transition-colors duration-150 cursor-pointer group/cand ${
                                                    isSelectedCand
                                                        ? 'bg-[#EEF6FF] dark:bg-slate-700 border-[#7ABCF4] dark:border-sky-500 shadow-xs font-black'
                                                        : 'bg-white/90 dark:bg-slate-800/90 border-slate-200/80 dark:border-slate-700 hover:bg-[#F5F9FF] dark:hover:bg-slate-700 hover:border-[#BCD7F2] text-slate-700 dark:text-slate-200'
                                                }`}
                                                title={`点击切换为: ${candDisplayName} (置信度 ${candScorePercent}% · ${isCandAlready ? '已在图鉴中' : '未遇见新宠'})`}
                                            >
                                          {/* Low-saturation background confidence bar fill */}
                                          <div
                                              className={`absolute inset-y-0 left-0 bg-gradient-to-r ${getProgressBarColor(scoreVal)} pointer-events-none transition-[width] duration-300 rounded-l-lg`}
                                              style={{ width: `${Math.min(100, Math.max(0, scoreVal * 100))}%` }}
                                          />

                                          {/* 图标：窄卡跨两行铺满，宽卡内联小图 */}
                                          <div className="relative z-10 w-5 h-5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-0.5 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs @max-[300px]:w-9 @max-[300px]:h-auto @max-[300px]:min-h-9 @max-[300px]:row-span-2 @max-[300px]:self-stretch">
                                              <PetSprite
                                                  pet={cand.matchedPet}
                                                  url={cand.view_url}
                                                  alt={candDisplayName}
                                                  className="w-full h-full object-contain"
                                              />
                                            </div>

                                          {/* 名字 + 序号 */}
                                          <div className="relative z-10 flex items-center gap-1.5 min-w-0 flex-1">
                                            <span className={`text-[8px] font-mono font-black px-1 py-0.2 rounded shrink-0 ${
                                                candIdx === 0
                                                    ? 'bg-[#FEE061] text-[#854D0E]'
                                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                            }`}>
                                              #{candIdx + 1}
                                            </span>
                                            <span className="text-[11px] truncate flex-1 min-w-0 font-bold">
                                              {candDisplayName}
                                            </span>
                                            {cand.out_of_map && (
                                                <span
                                                    className="text-[8px] font-black px-1 py-0.2 rounded shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300/60"
                                                    title="该候选不在当前地图白名单，通常是别的图或别的试炼的精灵；点它仍可手动选中"
                                                >
                                                  非本图
                                                </span>
                                            )}
                                            {IS_STATIC && cand.source === 'ocr' && (
                                                <span
                                                    className="text-[8px] font-black px-1 py-0.2 rounded shrink-0 bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border border-sky-300/60"
                                                    title="该候选来自截图中的精灵名文字识别（OCR），图像相似度没有命中"
                                                >
                                                  文字
                                                </span>
                                            )}
                                          </div>

                                          <div className="relative z-10 flex items-center gap-1 flex-wrap shrink-0">
                                            <PetSpecialTag
                                                pet={cand.matchedPet}
                                                filename={cand.filename}
                                            />
                                            {/* In-Dex Encountered Status Pill */}
                                            {isCandAlready ? (
                                                <span className="text-[8px] font-black px-1 py-0.2 rounded bg-slate-100/90 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200/80 dark:border-slate-600 shadow-2xs backdrop-blur-2xs">
                                                  已在图鉴
                                                </span>
                                            ) : (
                                                <span className="text-[8px] font-black px-1 py-0.2 rounded bg-[#E1F7DB]/95 dark:bg-emerald-950/70 text-[#2D6613] dark:text-emerald-300 border border-[#95D151] shadow-2xs backdrop-blur-2xs">
                                                  未遇见
                                                </span>
                                            )}

                                            <span className="text-[9px] font-mono font-black text-slate-600 dark:text-slate-300">
                                              {candScorePercent}%
                                            </span>
                                          </div>
                                            </button>
                                        </div>
                                    );
                                  })}
                                </div>
                              </div>
                          )}
                        </div>

                        {/* Manual Selection Trigger */}
                        <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-end">
                          <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                sound.playClick();
                                setEditingItemIndex(item.index);
                                setPickerSearch('');
                              }}
                              className="text-[10px] font-black text-[#2B78C4] dark:text-sky-400 hover:text-[#1E5B99] dark:hover:text-sky-300 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>人工挑选修正</span>
                          </button>
                        </div>
                      </div>
                  );
                })}
              </div>
            </div>
        )}

        {/* Manual Pet Picker Modal */}
        {editingItemIndex !== null && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-xs"
                onClick={() => setEditingItemIndex(null)}
            >
              <div
                  className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#7ABCF4] dark:border-slate-700 shadow-2xl p-5 flex flex-col max-h-[85vh]"
                  onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-3 border-b-2 border-[#E6EEF8] dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-5 h-5 text-[#2B78C4] dark:text-sky-400" />
                    <h3 className="text-base font-black text-slate-800 dark:text-slate-100">
                      为检测位 #{editingItemIndex + 1} 手工挑选正确精灵
                    </h3>
                  </div>
                  <button
                      onClick={() => setEditingItemIndex(null)}
                      className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-3 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="搜索精灵名、图鉴id..."
                      className="w-full pl-9 pr-3 py-2 text-xs bg-[#F5F9FF] dark:bg-slate-800 border border-[#E2E8F0] dark:border-slate-700 rounded-xl outline-hidden focus:border-[#7ABCF4] dark:focus:border-sky-400 focus:bg-white dark:focus:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium"
                      autoFocus
                  />
                </div>

                <div className="flex-1 overflow-y-auto mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-1">
                  {targetMapPets
                      .filter((p) => {
                        const q = pickerSearch.toLowerCase().trim();
                        const cleanName = formatPetName(p.name).toLowerCase();
                        const idMatch = String(p.id ?? '').includes(q);
                        return cleanName.includes(q) || idMatch;
                      })
                      .map((pet) => {
                        const already = checkAlreadyEncountered(targetMap.id, pet.name);
                        return (
                            <button
                                key={pet.name}
                                type="button"
                                onClick={() => handleApplyPetCorrection(pet)}
                                className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-[#7ABCF4] dark:hover:border-sky-400 hover:bg-[#F5F9FF] dark:hover:bg-slate-800 transition-all flex flex-col items-center text-center cursor-pointer group"
                            >
                              <div className="relative w-14 h-14 rounded-lg bg-[#F5F9FF] dark:bg-slate-800 p-1 flex items-center justify-center group-hover:scale-105 transition-transform">
                                <img src={pet.url} alt={pet.name} className="w-full h-full object-contain" />
                                {pet.id != null && (
                                    <span className="absolute top-0.5 right-0.5 z-10 text-[8px] font-mono font-black leading-none px-1 py-0.5 rounded bg-slate-800/70 text-white/90">
                                      #{pet.id}
                                    </span>
                                )}
                              </div>
                              <p className="text-xs font-black text-slate-800 dark:text-slate-100 mt-1 truncate w-full">
                                {formatPetName(pet.name)}
                              </p>
                              <span className={`text-[9px] font-bold mt-0.5 ${already ? 'text-[#2D6613] dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {already ? '已在图鉴' : '未遇见'}
                      </span>
                            </button>
                        );
                      })}
                </div>
              </div>
            </div>
        )}

        {/* 纯前端版：模型列表（查看缓存状态 / 提前手动下载） */}
        {IS_STATIC && (
            <ModelAssetsModal isOpen={showModelAssets} onClose={() => setShowModelAssets(false)} />
        )}
      </div>
  );
};
