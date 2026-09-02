import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sliders,
  Award,
  Check,
  Edit3,
  HelpCircle,
  CheckSquare,
  Square,
  Layers,
  Search,
  ZoomIn,
  ChevronDown,
  ChevronUp,
  Trash2,
  Sparkle,
  Info,
  X,
  Eye,
  Maximize2,
  Image as ImageIcon,
} from 'lucide-react';
import { ImageZoom } from './ImageZoom';
import { collectAtlasObservation } from '../services/atlasCollector';
import confetti from 'canvas-confetti';
import {
  MapConfig,
  PetItem,
  BatchInitReviewItem,
  BatchInitCandidateItem,
  EncounterRecord,
} from '../types';
import { api } from '../services/api';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { FALLBACK_MAPS_DATA, MAP_CONFIGS } from '../data/mockPets';
import { formatPetName, isSamePetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';
import { RecognitionSamplesHint } from './RecognitionSamplesHint';
import { ElementBadges } from './ElementBadges';

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
}

export const BatchRecognizerCard: React.FC<BatchRecognizerCardProps> = ({
                                                                          currentMap,
                                                                          trialKey = 'grass',
                                                                          allMapsPets,
                                                                          records,
                                                                          isEncountered,
                                                                          onBatchEncounterSuccess,
                                                                          onSelectMap,
                                                                        }) => {
  const [selectedMapNum, setSelectedMapNum] = useState<number>(currentMap.num);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number>(() => storage.getThreshold('batch_threshold', 0.25));
  const [topK, setTopK] = useState<number>(() => storage.getTopK(4));
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Lightbox modal for original image high-res preview
  const [showOriginalImageLightbox, setShowOriginalImageLightbox] = useState<boolean>(false);

  // Review items state
  const [reviewItems, setReviewItems] = useState<BatchInitReviewItem[]>([]);
  const [totalDetected, setTotalDetected] = useState<number>(0);
  const [filterTab, setFilterTab] = useState<'all' | 'unencountered' | 'alreadyEncountered' | 'checked' | 'unmatched'>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Help modal
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);

  // Editing single item modal/picker
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewSectionRef = useRef<HTMLDivElement>(null);
  const gameViewRef = useRef<HTMLDivElement>(null);

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
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setReviewItems([]);
    setScanError(null);
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
    setSelectedFile(null);
    setPreviewUrl(null);
    setReviewItems([]);
    setTotalDetected(0);
    setScanError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleStartBatchScan = async () => {
    if (!selectedFile && !previewUrl) return;

    sound.playScan();
    setIsScanning(true);
    setScanError(null);

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

      const { data } = await api.initBatch(fileToSend, selectedMapNum, threshold, topK, trialKey);

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
            matchedPet: matchedCandPet || {
              name: cand.filename,
              url: cand.view_url || '',
            },
          };
        });

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

        const isGoodMatch = raw.status === 'matched' && (activeScore ?? 1) >= threshold;
        const petName = matchedPet?.name || activeFilename || '';
        const alreadyEncountered = checkAlreadyEncountered(targetMap.id, petName);

        return {
          index: raw.index,
          status: raw.status,
          filename: activeFilename,
          score: activeScore,
          view_url: activeViewUrl,
          reason: raw.reason,
          matchedPet,
          candidates: processedCandidates,
          isAlreadyEncountered: alreadyEncountered,
          isChecked: false, // 默认不勾选，让用户从中挑选未遇见的精灵
          isManuallyEdited: false,
        };
      });

      setReviewItems(processed);
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

      // 识别完成后平滑往下滚到候选/结果区，方便直接核对候选
      setTimeout(() => {
        if (reviewSectionRef.current) {
          const rect = reviewSectionRef.current.getBoundingClientRect();
          // Leave comfortable 75px headroom so the entire control toolbar is fully visible
          const targetY = window.pageYOffset + rect.top - 75;
          window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
        }
      }, 120);
    } catch (err: unknown) {
      const error = err as Error;
      setScanError(error.message || '批量识别请求失败，请检查网络或后端接口');
    } finally {
      setIsScanning(false);
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

    confetti({
      particleCount: 120,
      spread: 90,
      origin: { y: 0.5 },
      colors: ['#10b981', '#38bdf8', '#fbbf24', '#f43f5e', '#a855f7'],
    });

    const payload = selectedToEncounter.map((item) => ({
      mapId: targetMap.id,
      filename: item.matchedPet!.name,
      note: item.isManuallyEdited
          ? '批量识别（人工修正）'
          : `批量识别自动导入 (置信度: ${((item.score || 1) * 100).toFixed(1)}%)`,
    }));

    onBatchEncounterSuccess(payload);
    handleClearUpload();

    // 确认后回到「游戏画面识别」区，让它显示在最上面
    requestAnimationFrame(() => {
      if (gameViewRef.current) {
        gameViewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  const filteredItems = reviewItems.filter((item) => {
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      const cleanName = formatPetName(item.matchedPet?.name || item.filename).toLowerCase();
      const rawName = (item.matchedPet?.name || item.filename || '').toLowerCase();
      const reasonMatch = (item.reason || '').toLowerCase().includes(q);
      const idMatch = String(item.matchedPet?.id ?? '').includes(q);
      if (!cleanName.includes(q) && !rawName.includes(q) && !reasonMatch && !idMatch) return false;
    }

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

  // 动态计算响应式网格列数（和批量导入弹窗保持一致的高效紧凑排版）
  const getDynamicGridClass = (count: number) => {
    if (count <= 3) {
      return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3';
    }
    if (count === 4) {
      return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
    }
    if (count === 5) {
      return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';
    }
    return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';
  };

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
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                导入含精灵图标或名字的截图，本地视觉模型离线计算并提供候选（数据仅在本地运算不上传）
              </p>
            </div>
          </div>

          {/* Action Controls & Help Button on Top Right */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* 截图格式示例：悬停查看 5 张正确截图，点击可直接加载测试识别 */}
            <RecognitionSamplesHint onLoadSample={handleFileSelect} />

            {/* Help Button */}
            <button
                type="button"
                id="batch-help-btn"
                onClick={() => {
                  sound.playClick();
                  setShowHelpModal(true);
                }}
                className="text-xs font-black text-[#2B78C4] dark:text-sky-300 hover:text-white bg-[#EBF4FE] dark:bg-slate-800 hover:bg-[#7ABCF4] dark:hover:bg-sky-600 border border-[#BCD7F2] dark:border-slate-700 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title="查看图鉴批量识别使用指南与快捷键"
            >
              <HelpCircle className="w-4 h-4" />
              <span>帮助提示</span>
            </button>

            {(selectedFile || previewUrl || reviewItems.length > 0) && (
                <button
                    type="button"
                    onClick={handleClearUpload}
                    className="text-xs font-black text-rose-600 dark:text-rose-400 hover:text-rose-700 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 border border-rose-200 dark:border-rose-900/60 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                    title="清空当前截图与识别列表"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>清空</span>
                </button>
            )}
          </div>
        </div>

        {/* Target Map Selector & Threshold Bar */}
        <div className="mt-4 p-4 sm:p-5 bg-[#F5F9FF] dark:bg-slate-800/80 rounded-2xl border-2 border-[#E6EEF8] dark:border-slate-700">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 pb-3.5 border-b border-[#E2EAF4] dark:border-slate-700">
            {/* Target Map Selector */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black text-slate-700 dark:text-slate-200 whitespace-nowrap">目标地图:</span>
              {MAP_CONFIGS.map((map) => {
                const isSelected = selectedMapNum === map.num;
                const mapPets = allMapsPets[`map${map.num}`]?.items || [];
                const totalPets = mapPets.length || 0;
                const encCount = mapPets.filter((p) => checkAlreadyEncountered(map.id, p.name)).length;

                return (
                    <button
                        key={map.id}
                        onClick={() => {
                          sound.playClick();
                          setSelectedMapNum(map.num);
                          if (onSelectMap) onSelectMap(map.num);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 border-2 cursor-pointer ${
                            isSelected
                                ? 'bg-[#7ABCF4] dark:bg-sky-500 text-white border-[#5DA8E8] dark:border-sky-400 shadow-xs'
                                : 'bg-white dark:bg-slate-750 text-slate-600 dark:text-slate-300 border-[#E2E8F0] dark:border-slate-700 hover:border-[#7ABCF4]'
                        }`}
                    >
                      <span>{map.num}、{map.name.replace('记忆中的', '')}</span>
                      <span className={`text-[10px] font-mono ${isSelected ? 'text-white/90' : 'text-slate-400'}`}>
                        ({encCount}/{totalPets})
                      </span>
                    </button>
                );
              })}
            </div>

            {/* 识别门槛 + 候选数量(top-k) */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-[#7ABCF4] dark:text-sky-400" />
                <span className="font-bold">识别门槛:</span>
                <input
                    type="range"
                    min="0.1"
                    max="0.95"
                    step="0.05"
                    value={threshold}
                    onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
                    className="w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg accent-[#7ABCF4] cursor-pointer"
                />
                <span className="font-mono font-black text-[#2B78C4] dark:text-sky-300">{Math.round(threshold * 100)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <Award className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-bold">候选数量 (Top-K):</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5, 6].map((k) => (
                      <button
                          key={k}
                          type="button"
                          onClick={() => handleTopKChange(k)}
                          className={`px-1.5 py-0.5 rounded-md text-[11px] font-black cursor-pointer border transition-colors ${
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
                              : 'border-[#BCD7F2] dark:border-slate-700 hover:bg-[#EBF4FE] dark:hover:bg-slate-750 hover:border-[#7ABCF4] dark:hover:border-sky-500'
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
                  <div className="lg:col-span-7 xl:col-span-8 bg-slate-900/5 dark:bg-slate-950/20 rounded-2xl border-2 border-[#BCD7F2] dark:border-slate-700 p-2.5 flex flex-col justify-between relative group overflow-hidden bg-[#FBFDFF] dark:bg-slate-800">
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
                            className="p-1 rounded-lg bg-white dark:bg-slate-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-600 hover:border-rose-200 text-slate-400 hover:text-rose-600 shadow-2xs transition-colors cursor-pointer"
                            title="移除图片"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Image Viewport: Height increased, object-contain, hover to zoom hint */}
                    <div
                        onClick={() => setShowOriginalImageLightbox(true)}
                        className="relative w-full h-48 sm:h-56 rounded-xl overflow-hidden bg-white dark:bg-slate-900 border border-[#E6EEF8] dark:border-slate-700 flex items-center justify-center cursor-zoom-in group/img shadow-inner"
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
                  <div className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-slate-800 rounded-2xl border-2 border-[#E6EEF8] dark:border-slate-700 p-4 sm:p-5 flex flex-col justify-between shadow-xs">
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
                        <div className="p-2.5 rounded-xl bg-[#F8FBFE] dark:bg-slate-900 border border-[#E6EEF8] dark:border-slate-700 text-xs">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300 mb-1">
                            <span className="font-bold">识别目标地图:</span>
                            <span className="font-black text-[#1E5B99] dark:text-sky-300">{targetMap.num}、{targetMap.name.replace('记忆中的', '')}</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span className="font-bold">识别门槛:</span>
                            <span className="font-mono font-black text-[#2B78C4] dark:text-sky-300">{Math.round(threshold * 100)}%</span>
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed bg-[#FFFDF5] dark:bg-amber-950/20 border border-[#FEE061]/50 dark:border-amber-700/50 rounded-xl p-2.5 space-y-1">
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

                      <button
                          type="button"
                          onClick={handleClearUpload}
                          className="w-full py-1.5 px-3 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 text-xs font-bold transition-colors flex items-center justify-center gap-1 cursor-pointer"
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
        </div>

        {/* High-Resolution Lightbox Modal for Uploaded Screenshot */}
        {showOriginalImageLightbox && previewUrl && (
            <div
                className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={() => setShowOriginalImageLightbox(false)}
            >
              <div
                  className="relative max-w-[94vw] max-h-[92vh] bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl p-3 sm:p-4 flex flex-col"
                  onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-2 py-0.5 rounded-md bg-[#7ABCF4] text-white text-xs font-black">
                      高清全景原图
                    </span>
                    <span className="text-xs font-bold text-slate-700 truncate">
                      {selectedFile ? selectedFile.name : '游戏画面截图'}
                    </span>
                  </div>
                  <button
                      type="button"
                      onClick={() => setShowOriginalImageLightbox(false)}
                      className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-black transition-colors cursor-pointer"
                      title="关闭 (Esc)"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-auto flex items-center justify-center max-h-[82vh] rounded-2xl bg-slate-950/5 p-2">
                  <img
                      src={previewUrl}
                      alt="高清原图"
                      className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-md"
                  />
                </div>
              </div>
            </div>
        )}

        {/* Review Workbench (Filtered, Actions & STRICTLY 3 COLUMNS) */}
        {reviewItems.length > 0 && (
            <div ref={reviewSectionRef} className="mt-5 space-y-4 animate-in fade-in duration-300 scroll-mt-20">
              {/* Integrated Control & Filter Strip (Tabs + Search Bar + Batch Actions) */}
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

                {/* 2. Middle: Large Search Input */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="搜索精灵名称、编号..."
                      className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-hidden focus:border-[#2B78C4] focus:ring-2 focus:ring-[#2B78C4]/15 text-slate-800 dark:text-slate-100 font-medium transition-all shadow-2xs placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                  {searchFilter && (
                      <button
                          type="button"
                          onClick={() => setSearchFilter('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
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
              <div className={`grid gap-3 ${getDynamicGridClass(filteredItems.length)}`}>
                {filteredItems.map((item) => {
                  const isMatched = item.status === 'matched';
                  const scorePercent = item.score ? (item.score * 100).toFixed(1) : '0';
                  const isHighScore = (item.score || 0) >= 0.88;
                  const isAlready = !!item.isAlreadyEncountered;
                  const displayName = formatPetName(item.matchedPet?.name || item.filename);

                  return (
                      <div
                          key={item.index}
                          onClick={() => handleToggleCheck(item.index)}
                          className={`relative rounded-2xl border-3 p-3 transition-colors duration-150 flex flex-col justify-between cursor-pointer select-none group/card hover:shadow-md ${
                              item.isChecked
                                  ? 'border-[#95D151] bg-[#F9FEF8] dark:bg-emerald-950/40 shadow-xs ring-2 ring-[#95D151]/30'
                                  : item.status === 'unmatched'
                                      ? 'border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/30 hover:border-rose-400'
                                      : isAlready
                                          ? 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 opacity-90 hover:border-slate-400'
                                          : 'border-[#E6EEF8] dark:border-slate-700 bg-white dark:bg-slate-800 opacity-80 hover:border-[#7ABCF4]'
                          }`}
                      >
                        <div>
                          {/* Top Row: Checkbox + Index */}
                          <div className="flex items-center justify-between mb-1.5">
                            <label
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleCheck(item.index);
                                }}
                                className="flex items-center gap-1.5 cursor-pointer select-none"
                            >
                              <input
                                  type="checkbox"
                                  checked={item.isChecked}
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
                            ) : (
                                <span className="text-[9px] font-black px-1.5 py-0.2 rounded-md bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300">
                                  未匹配
                                </span>
                            )}
                          </div>

                          {/* Main Selected Pet Display */}
                          <div className="flex flex-col items-center text-center my-1">
                            <div className="relative w-16 h-16 rounded-xl bg-white dark:bg-slate-900 p-1 border border-[#E6EEF8] dark:border-slate-700 shadow-inner flex items-center justify-center">
                              {isMatched && item.matchedPet ? (
                                  <ImageZoom
                                      src={item.view_url || item.matchedPet.url}
                                      alt={displayName}
                                      trigger="hover"
                                      className="w-full h-full"
                                      imgClassName="w-full h-full object-contain"
                                  />
                              ) : (
                                  <HelpCircle className="w-8 h-8 text-rose-300 dark:text-rose-600" />
                              )}
                              <ElementBadges
                                  elements={item.matchedPet?.elements}
                                  className="absolute top-0.5 left-0.5 z-10"
                                  size="sm"
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

                            {/* Current Chosen Pet Name */}
                            <div className="mt-1.5 w-full">
                              {isMatched && item.matchedPet ? (
                                  <p className="text-xs font-black text-slate-800 dark:text-slate-100 truncate" title={displayName}>
                                    {displayName}
                                  </p>
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
                                  <span className="text-[9px] text-slate-400 font-normal">点击直接切换</span>
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
                                        <button
                                            key={cand.filename + candIdx}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleSelectCandidate(item.index, cand);
                                            }}
                                            className={`relative overflow-hidden w-full p-1.5 rounded-xl border-2 text-left flex items-center justify-between gap-1.5 transition-colors duration-150 cursor-pointer group/cand ${
                                                isSelectedCand
                                                    ? 'bg-[#EEF6FF] dark:bg-slate-750 border-[#7ABCF4] dark:border-sky-500 shadow-xs font-black'
                                                    : 'bg-white/90 dark:bg-slate-800/90 border-slate-200/80 dark:border-slate-700 hover:bg-[#F5F9FF] dark:hover:bg-slate-750 hover:border-[#BCD7F2] text-slate-700 dark:text-slate-200'
                                            }`}
                                            title={`点击切换为: ${candDisplayName} (置信度 ${candScorePercent}% · ${isCandAlready ? '已在图鉴中' : '未遇见新宠'})`}
                                        >
                                          {/* Low-saturation background confidence bar fill */}
                                          <div
                                              className={`absolute inset-y-0 left-0 bg-gradient-to-r ${getProgressBarColor(scoreVal)} pointer-events-none transition-[width] duration-300 rounded-l-lg`}
                                              style={{ width: `${Math.min(100, Math.max(0, scoreVal * 100))}%` }}
                                          />

                                          <div className="relative z-10 flex items-center gap-1.5 min-w-0 flex-1">
                                            <span className={`text-[8px] font-mono font-black px-1 py-0.2 rounded shrink-0 ${
                                                candIdx === 0
                                                    ? 'bg-[#FEE061] text-[#854D0E]'
                                                    : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                            }`}>
                                              #{candIdx + 1}
                                            </span>

                                            <div className="w-5 h-5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-0.5 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
                                              <img
                                                  src={cand.view_url || cand.matchedPet?.url}
                                                  alt={candDisplayName}
                                                  className="w-full h-full object-contain"
                                                  onError={(e) => {
                                                    if (cand.matchedPet?.url) {
                                                      (e.target as HTMLImageElement).src = cand.matchedPet.url;
                                                    }
                                                  }}
                                              />
                                            </div>

                                            <span className="text-[11px] truncate flex-1 font-bold">
                                              {candDisplayName}
                                            </span>
                                          </div>

                                          <div className="relative z-10 flex items-center gap-1 shrink-0">
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
                                            {isSelectedCand && (
                                                <span className="text-[8px] px-1 py-0.2 bg-[#7ABCF4] dark:bg-sky-500 text-white rounded font-black shadow-2xs">
                                                  当前
                                                </span>
                                            )}
                                          </div>
                                        </button>
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

        {/* Help Modal */}
        {showHelpModal && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
                onClick={() => setShowHelpModal(false)}
            >
              <div
                  className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#7ABCF4] dark:border-slate-700 shadow-2xl p-6 flex flex-col space-y-4"
                  onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between pb-3 border-b-2 border-[#E6EEF8] dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-6 h-6 text-[#2B78C4] dark:text-sky-400" />
                    <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">游戏画面识别使用指南</h3>
                  </div>
                  <button
                      onClick={() => setShowHelpModal(false)}
                      className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
                  <div className="p-3 bg-[#F5F9FF] dark:bg-slate-800 border border-[#BCD7F2] dark:border-slate-700 rounded-xl">
                    <h4 className="font-black text-[#2B78C4] dark:text-sky-400 mb-1">1. 如何获取最佳识别效果？</h4>
                    <p>
                      截取洛克王国游戏内<strong>清晰的地图全景或含有精灵名称、头像的画面</strong>。支持 PNG 和 JPG 格式。
                    </p>
                  </div>

                  <div className="p-3 bg-[#F5F9FF] dark:bg-slate-800 border border-[#BCD7F2] dark:border-slate-700 rounded-xl">
                    <h4 className="font-black text-[#2B78C4] dark:text-sky-400 mb-1">2. 快捷粘贴截图</h4>
                    <p>
                      使用截图工具（如微信截图、QQ截图或 Win+Shift+S）完成截屏后，直接在页面上按下 <strong>Ctrl + V</strong> 即可快速加载图片。
                    </p>
                  </div>

                  <div className="p-3 bg-[#F5F9FF] dark:bg-slate-800 border border-[#BCD7F2] dark:border-slate-700 rounded-xl">
                    <h4 className="font-black text-[#2B78C4] dark:text-sky-400 mb-1">3. 勾选与挑选未遇精灵</h4>
                    <p>
                      识别完成后，系统会自动区分<strong>【未遇新宠】</strong>与<strong>【已在图鉴中】</strong>的精灵，您可以直接勾选或使用一键<strong>【选未遇见】</strong>批量点亮。
                    </p>
                  </div>

                  <div className="p-3 bg-[#F5F9FF] dark:bg-slate-800 border border-[#BCD7F2] dark:border-slate-700 rounded-xl">
                    <h4 className="font-black text-[#2B78C4] dark:text-sky-400 mb-1">4. 候选切换与手工挑选</h4>
                    <p>
                      每张卡片下方均提供候选列表与置信度，点击即可快速切换；若识别有偏差，点击<strong>【人工挑选修正】</strong>即可精准搜索替换。
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                      type="button"
                      onClick={() => setShowHelpModal(false)}
                      className="px-5 py-2 roco-btn-primary text-xs font-black rounded-xl cursor-pointer"
                  >
                    我知道了
                  </button>
                </div>
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
      </div>
  );
};
