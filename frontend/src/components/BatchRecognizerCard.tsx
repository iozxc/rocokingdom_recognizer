import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sliders,
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
} from 'lucide-react';
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
import { formatPetName, isSamePetName } from '../utils/petHelper';

interface BatchRecognizerCardProps {
  currentMap: MapConfig;
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
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

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
      if (isEncountered(mapId, name) || isEncountered(mapId, formatPetName(name))) {
        return true;
      }
    }
    if (records) {
      const key1 = `${mapId}_${name}`;
      const key2 = `${mapId}_${formatPetName(name)}`;
      if (records[key1]?.encountered || records[key2]?.encountered) return true;
    }
    return false;
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
        throw new Error('请先上传或选择图片');
      }

      const { data } = await api.initBatch(fileToSend, selectedMapNum, threshold, 5);

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
  };

  const filteredItems = reviewItems.filter((item) => {
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      const cleanName = formatPetName(item.matchedPet?.name || item.filename).toLowerCase();
      const rawName = (item.matchedPet?.name || item.filename || '').toLowerCase();
      const reasonMatch = (item.reason || '').toLowerCase().includes(q);
      if (!cleanName.includes(q) && !rawName.includes(q) && !reasonMatch) return false;
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

  return (
    <div className="bg-white roco-card p-5 sm:p-6 mb-5">
      {/* Header & Help Button */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b-2 border-[#F1F5F9] flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-[#7ABCF4] text-white flex items-center justify-center shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">
                游戏画面识别
              </h3>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#EBF4FE] text-[#2B78C4] border border-[#BCD7F2] font-black flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-[#2B78C4]" />
                自选未遇精灵
              </span>
            </div>
            <p className="text-xs text-slate-500">
              上传含 1~3 只精灵的游戏画面，AI 识别预测并提供候选，您可以从中挑选未遇见的精灵点亮图鉴
            </p>
          </div>
        </div>

        {/* Action Controls & Help Button on Top Right */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Help Button */}
          <button
            type="button"
            id="batch-help-btn"
            onClick={() => {
              sound.playClick();
              setShowHelpModal(true);
            }}
            className="text-xs font-black text-[#2B78C4] hover:text-white bg-[#EBF4FE] hover:bg-[#7ABCF4] border border-[#BCD7F2] px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            title="查看图鉴批量识别使用指南与快捷键"
          >
            <HelpCircle className="w-4 h-4" />
            <span>帮助提示</span>
          </button>

          {(selectedFile || previewUrl || reviewItems.length > 0) && (
            <button
              type="button"
              onClick={handleClearUpload}
              className="text-xs font-black text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="清空当前截图与识别列表"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              <span>清空</span>
            </button>
          )}
        </div>
      </div>

      {/* Target Map Selector & Threshold Bar */}
      <div className="mt-4 p-4 bg-[#F5F9FF] rounded-2xl border-2 border-[#E6EEF8]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          {/* Target Map Selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black text-slate-700 whitespace-nowrap">目标地图:</span>
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
                      ? 'bg-[#7ABCF4] text-white border-[#5DA8E8] shadow-xs'
                      : 'bg-white text-slate-600 border-[#E2E8F0] hover:border-[#7ABCF4]'
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

          {/* Threshold Slider */}
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Sliders className="w-3.5 h-3.5 text-[#7ABCF4]" />
            <span className="font-bold">过滤阈值:</span>
            <input
              type="range"
              min="0.1"
              max="0.95"
              step="0.05"
              value={threshold}
              onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
              className="w-24 h-1.5 bg-slate-200 rounded-lg accent-[#7ABCF4] cursor-pointer"
            />
            <span className="font-mono font-black text-[#2B78C4]">{threshold}</span>
          </div>
        </div>

        {/* Upload Dropzone & Trigger */}
        <div className="mt-3.5 grid grid-cols-1 md:grid-cols-12 gap-3.5">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`md:col-span-8 border-3 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all flex items-center justify-between min-h-[105px] relative ${
              isDragOver
                ? 'border-[#95D151] bg-[#F4FDF0] scale-[1.01]'
                : previewUrl
                ? 'border-[#7ABCF4] bg-white'
                : 'border-[#BCD7F2] bg-white hover:bg-[#EBF4FE] hover:border-[#7ABCF4]'
            }`}
          >
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

            {previewUrl ? (
              <div className="flex items-center gap-4 text-left w-full pr-10">
                <img
                  src={previewUrl}
                  alt="预览图片"
                  className="w-16 h-16 rounded-xl object-contain bg-[#F5F9FF] border border-[#E6EEF8] p-1 shadow-inner shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-800 truncate">
                    {selectedFile ? selectedFile.name : '已选择样本截图'}
                  </p>
                  <p className="text-[11px] text-[#7ABCF4] font-bold mt-0.5">
                    点击更换图片 · 也可直接 Ctrl+V 粘贴截图
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#F5F9FF] text-[#7ABCF4] flex items-center justify-center border border-[#E6EEF8]">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-black text-slate-700">
                    点击或拖拽上传游戏画面截图（通常含 1~3 只精灵）
                  </p>
                  <p className="text-[11px] text-slate-400">
                    支持 PNG / JPG · 支持截图后直接 Ctrl+V 快速粘贴
                  </p>
                </div>
              </div>
            )}

            {previewUrl && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearUpload();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
                title="移除图片"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="md:col-span-4 flex flex-col gap-2 justify-center">
            <button
              id="batch-card-scan-btn"
              disabled={!previewUrl || isScanning}
              onClick={handleStartBatchScan}
              className="w-full py-3 px-4 roco-btn-primary flex items-center justify-center gap-2 text-xs sm:text-sm font-black shadow-md disabled:opacity-40 disabled:cursor-not-allowed min-h-[48px] cursor-pointer"
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>正在智能批量分割识别中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#FEE061]" />
                  <span>开始批量识别</span>
                </>
              )}
            </button>
          </div>
        </div>

        {scanError && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{scanError}</span>
          </div>
        )}
      </div>

      {/* Review Workbench (Filtered, Actions & STRICTLY 3 COLUMNS) */}
      {reviewItems.length > 0 && (
        <div className="mt-5 space-y-4 animate-in fade-in duration-300">
          {/* Summary Strip & User Guidance */}
          <div className="p-3.5 bg-[#FEF9E6] rounded-2xl border-2 border-[#FEE061] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-black text-[#854D0E]">识别汇总:</span>
              <span className="px-2.5 py-0.5 rounded-lg bg-white text-slate-800 font-black border border-[#E5C43B]">
                检测总数: {totalDetected} 只
              </span>
              <span className="px-2.5 py-0.5 rounded-lg bg-[#E1F7DB] text-[#2D6613] font-black border border-[#95D151] flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                未遇新精灵: {unencounteredNewCount} 只
              </span>
              {alreadyEncounteredCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-600 font-black border border-slate-300 flex items-center gap-1">
                  <Check className="w-3 h-3 text-[#2D6613]" />
                  已在图鉴: {alreadyEncounteredCount} 只
                </span>
              )}
              {unmatchedCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-lg bg-rose-100 text-rose-800 font-black border border-rose-300">
                  未匹配: {unmatchedCount} 只
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-lg bg-[#7ABCF4] text-white font-black">
                已勾选准备遇见: {checkedCount} 只
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleSelectOnlyUnencountered}
                className="px-2.5 py-1 rounded-lg bg-[#E1F7DB] hover:bg-[#D3F3CA] border border-[#95D151] text-[11px] font-black text-[#2D6613] flex items-center gap-1 cursor-pointer"
                title="一键仅勾选未遇见的精灵"
              >
                <Sparkle className="w-3 h-3" />
                选【未遇见】
              </button>
              <button
                type="button"
                onClick={() => handleSelectAll(true)}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 border border-[#D5E2F0] text-[11px] font-black text-slate-700 flex items-center gap-1 cursor-pointer"
              >
                <CheckSquare className="w-3 h-3 text-[#95D151]" />
                全选
              </button>
              <button
                type="button"
                onClick={() => handleSelectAll(false)}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 border border-[#D5E2F0] text-[11px] font-black text-slate-700 flex items-center gap-1 cursor-pointer"
              >
                <Square className="w-3 h-3 text-slate-400" />
                全不选
              </button>
            </div>
          </div>

          {/* Prompt banner for choosing pets */}
          <div className="px-4 py-2 bg-[#F5F9FF] border border-[#BCD7F2] rounded-xl flex items-center justify-between text-xs text-[#2B78C4] font-medium">
            <span className="flex items-center gap-1.5 font-bold">
              💡 提示：默认未勾选。点击下方任意精灵卡片空白处或候选即可选中，从中挑选您需要遇见的精灵！
            </span>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              (点击卡片空白处可切换勾选)
            </span>
          </div>

          {/* Filter tabs & search */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 p-1 bg-[#F5F9FF] rounded-xl border border-[#E2E8F0] w-full sm:w-auto flex-wrap">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  filterTab === 'all' ? 'bg-white text-[#2B78C4] shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                全部 ({reviewItems.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('unencountered')}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  filterTab === 'unencountered' ? 'bg-[#95D151] text-white shadow-xs' : 'text-[#2D6613] hover:text-slate-800'
                }`}
              >
                ✨ 未遇见 ({unencounteredNewCount})
              </button>
              {alreadyEncounteredCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterTab('alreadyEncountered')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                    filterTab === 'alreadyEncountered' ? 'bg-slate-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  已在图鉴 ({alreadyEncounteredCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => setFilterTab('checked')}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  filterTab === 'checked' ? 'bg-[#7ABCF4] text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                已勾选 ({checkedCount})
              </button>
              {unmatchedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterTab('unmatched')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                    filterTab === 'unmatched' ? 'bg-rose-500 text-white shadow-xs' : 'text-rose-600 hover:text-rose-800'
                  }`}
                >
                  未匹配 ({unmatchedCount})
                </button>
              )}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="按精灵名筛选..."
                className="w-full pl-8 pr-3 py-1 text-xs bg-[#F5F9FF] border border-[#E2E8F0] rounded-xl outline-hidden focus:border-[#7ABCF4] focus:bg-white text-slate-800 font-medium"
              />
            </div>
          </div>

          {/* CRITICAL REQUIREMENT: STRICTLY 3 COLUMNS PER ROW */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredItems.map((item) => {
              const isMatched = item.status === 'matched';
              const scorePercent = item.score ? (item.score * 100).toFixed(1) : '0';
              const isHighScore = (item.score || 0) >= 0.85;
              const isAlready = !!item.isAlreadyEncountered;
              const displayName = formatPetName(item.matchedPet?.name || item.filename);

              return (
                <div
                  key={item.index}
                  onClick={() => handleToggleCheck(item.index)}
                  className={`relative rounded-2xl border-3 p-3.5 transition-all flex flex-col justify-between cursor-pointer select-none group/card hover:shadow-md ${
                    item.isChecked
                      ? 'border-[#95D151] bg-[#F9FEF8] shadow-xs ring-2 ring-[#95D151]/30'
                      : item.status === 'unmatched'
                      ? 'border-rose-300 bg-rose-50/50 hover:border-rose-400'
                      : isAlready
                      ? 'border-slate-300 bg-slate-50/80 hover:border-slate-400'
                      : 'border-[#E6EEF8] bg-white hover:border-[#7ABCF4]'
                  }`}
                >
                  <div>
                    {/* Top Bar: Checkbox + Status */}
                    <div className="flex items-center justify-between mb-2">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleCheck(item.index);
                        }}
                        className="flex items-center gap-1.5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={item.isChecked}
                          onChange={() => {}}
                          className="w-4 h-4 rounded text-[#95D151] accent-[#95D151] cursor-pointer"
                        />
                        <span className="text-[11px] font-mono font-black text-slate-600">
                          检测图位 #{item.index + 1}
                        </span>
                      </div>

                      {isMatched ? (
                        <span
                          className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-md ${
                            item.isManuallyEdited
                              ? 'bg-[#EBF4FE] text-[#2B78C4] border border-[#BCD7F2]'
                              : isHighScore
                              ? 'bg-[#E1F7DB] text-[#2D6613]'
                              : 'bg-[#FEF9E6] text-[#854D0E]'
                          }`}
                        >
                          {item.isManuallyEdited ? '已选定' : `Top 1: ${scorePercent}%`}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-rose-100 text-rose-700">
                          未匹配
                        </span>
                      )}
                    </div>

                    {/* Main Pet Info */}
                    <div className="flex items-center gap-3.5 my-1.5 p-2 rounded-xl bg-white/70 border border-slate-100">
                      <div className="relative w-16 h-16 rounded-2xl bg-white p-1.5 border-2 border-[#E6EEF8] shadow-inner flex items-center justify-center shrink-0">
                        {isMatched && item.matchedPet ? (
                          <img
                            src={item.view_url || item.matchedPet.url}
                            alt={displayName}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              if (item.matchedPet?.url) {
                                (e.target as HTMLImageElement).src = item.matchedPet.url;
                              }
                            }}
                          />
                        ) : (
                          <HelpCircle className="w-8 h-8 text-rose-300" />
                        )}

                        {item.isChecked && isMatched && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-[#95D151] rounded-full flex items-center justify-center text-white shadow-xs border border-white">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        {isMatched && item.matchedPet ? (
                          <>
                            <h4 className="text-sm font-black text-slate-800 truncate" title={displayName}>
                              {displayName}
                            </h4>
                            {isAlready ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 mt-1">
                                <Check className="w-3 h-3 text-[#2D6613]" />
                                已在图鉴中
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-black text-[#2D6613] bg-[#E1F7DB] px-2 py-0.5 rounded-md border border-[#95D151] mt-1">
                                <Sparkle className="w-3 h-3 text-amber-600" />
                                未遇见新宠
                              </span>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-rose-600 font-bold">
                            {item.reason || '未匹配到精灵特征'}
                          </p>
                        )}

                        {/* Confidence Progress */}
                        {isMatched && (
                          <div className="mt-1.5">
                            <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mb-0.5">
                              <span>匹配置信度</span>
                              <span className="font-black text-slate-600">{scorePercent}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  isHighScore ? 'bg-[#95D151]' : 'bg-[#FEE061]'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, (item.score || 0) * 100))}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Candidates Vertical Selection List (Matches BatchInit style with clear progress bars & avatars) */}
                    {item.candidates && item.candidates.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-100/90 w-full space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-black text-slate-600 mb-1 px-0.5">
                          <span>所有预测候选 ({item.candidates.length})</span>
                          <span className="text-[10px] text-slate-400 font-normal">点击切换</span>
                        </div>

                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5 custom-scrollbar">
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

                            const getProgressBarColor = (score: number) => {
                              if (score >= 0.8) return 'from-emerald-200/25 to-teal-200/30';
                              if (score >= 0.5) return 'from-amber-200/25 to-yellow-200/30';
                              return 'from-rose-200/25 to-orange-200/30';
                            };

                            return (
                              <button
                                key={cand.filename + candIdx}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectCandidate(item.index, cand);
                                }}
                                className={`relative overflow-hidden w-full p-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer group/cand ${
                                  isSelectedCand
                                    ? 'bg-[#EEF6FF] border-[#7ABCF4] ring-2 ring-[#7ABCF4]/60 shadow-xs font-black'
                                    : 'bg-white/90 border-slate-200/80 hover:bg-[#F5F9FF] hover:border-[#BCD7F2] text-slate-700'
                                }`}
                                title={`点击切换为: ${candDisplayName} (置信度 ${candScorePercent}% · ${isCandAlready ? '已在图鉴中' : '未遇见新宠'})`}
                              >
                                {/* 置信度背景填充进度条 */}
                                <div
                                  className={`absolute inset-y-0 left-0 bg-gradient-to-r ${getProgressBarColor(scoreVal)} pointer-events-none transition-all duration-300 rounded-l-lg`}
                                  style={{ width: `${Math.min(100, Math.max(0, scoreVal * 100))}%` }}
                                />

                                <div className="relative z-10 flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`text-[9px] font-mono font-black px-1.5 py-0.5 rounded shrink-0 ${
                                    candIdx === 0
                                      ? 'bg-[#FEE061] text-[#854D0E]'
                                      : 'bg-slate-200 text-slate-600'
                                  }`}>
                                    #{candIdx + 1}
                                  </span>

                                  <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 p-0.5 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
                                    <img
                                      src={cand.view_url || cand.matchedPet?.url}
                                      alt={candDisplayName}
                                      className="w-full h-full object-contain"
                                    />
                                  </div>

                                  <span className="text-xs truncate flex-1 font-bold">
                                    {candDisplayName}
                                  </span>
                                </div>

                                <div className="relative z-10 flex items-center gap-1.5 shrink-0">
                                  {isCandAlready ? (
                                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100/90 text-slate-500 border border-slate-200/80 shadow-2xs">
                                      已在图鉴
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#E1F7DB]/95 text-[#2D6613] border border-[#95D151] shadow-2xs">
                                      未遇见
                                    </span>
                                  )}

                                  <span className="text-[10px] font-mono font-black text-slate-700">
                                    {candScorePercent}%
                                  </span>

                                  {isSelectedCand && (
                                    <span className="text-[9px] px-1.5 py-0.5 bg-[#7ABCF4] text-white rounded font-black shadow-2xs">
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

                  {/* Bottom Action: Manual Correction */}
                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-medium">
                      {item.isChecked ? '✅ 已勾选准备遇见' : '⚪ 点击卡片任意处勾选'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        sound.playClick();
                        setEditingItemIndex(item.index);
                        setPickerSearch('');
                      }}
                      className="text-[11px] font-black text-[#2B78C4] hover:text-[#1D5E9E] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>人工挑选修正</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Confirm Batch Encounter Button */}
          <div className="mt-5 pt-4 border-t-2 border-[#E6EEF8] flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-slate-500 font-bold">
              已选中 <strong className="text-[#2D6613] text-sm font-mono">{checkedCount}</strong> 只精灵准备点亮图鉴
            </p>

            <button
              type="button"
              id="confirm-batch-card-btn"
              disabled={checkedCount === 0}
              onClick={handleConfirmBatchEncounter}
              className="py-3 px-6 roco-btn-success text-sm font-black flex items-center gap-2 shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>{checkedCount > 0 ? `确认遇见勾选的精灵 (${checkedCount} 只)` : '请勾选要遇见的精灵'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelpModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-xs"
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className="relative w-full max-w-lg bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b-2 border-[#E6EEF8]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#EBF4FE] text-[#2B78C4] flex items-center justify-center">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <h3 className="text-base font-black text-slate-800">游戏画面识别 · 使用帮助与技巧</h3>
              </div>
              <button
                onClick={() => setShowHelpModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed max-h-[70vh] overflow-y-auto pr-1">
              {/* 推荐用图与截图示范 */}
              <div className="p-3.5 bg-gradient-to-br from-[#F5F9FF] to-[#EBF4FE] rounded-2xl border-2 border-[#BCD7F2] space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="font-black text-[#2B78C4] flex items-center gap-1.5 text-xs">
                    <span>🎯 推荐截图示范（游戏画面 1~3 只精灵）</span>
                  </p>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#2B78C4] text-white">
                    最佳识别效果
                  </span>
                </div>

                <p className="text-[11px] text-slate-600">
                  截取游戏界面上方出现的精灵横条（包含<strong>圆框头像与精灵名称</strong>），如下方图示：
                </p>

                {/* 模拟用户提供的推荐截图示意 */}
                <div className="relative rounded-xl overflow-hidden border-2 border-dashed border-[#2B78C4] bg-gradient-to-b from-[#8CB663]/40 via-[#A8D379]/20 to-[#EBF4FE] p-2.5 shadow-inner">
                  <div className="absolute top-1 right-2 text-[9px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md border border-rose-200 shadow-2xs">
                    ✂️ 推荐截取此区域
                  </div>

                  <div className="flex items-center justify-around gap-2 pt-2 pb-1">
                    {/* 精灵 1: 画精灵 */}
                    <div className="flex flex-col items-center bg-white/90 rounded-xl px-2.5 py-1.5 shadow-xs border border-white">
                      <div className="w-10 h-10 rounded-full bg-[#8B5A2B] text-white flex items-center justify-center font-black text-base shadow-xs">
                        🖼️
                      </div>
                      <span className="text-[10px] font-black text-slate-800 mt-1">画精灵</span>
                    </div>

                    {/* 精灵 2: 犀角鸟 (带掉落碎片) */}
                    <div className="flex flex-col items-center bg-[#F97316]/15 rounded-xl px-3 py-1.5 shadow-xs border-2 border-[#F97316]/40 relative">
                      <div className="absolute -top-2 -right-2 bg-amber-400 text-amber-950 text-[9px] font-black px-1.5 py-0.2 rounded-md shadow-2xs border border-amber-500">
                        碎片
                      </div>
                      <div className="w-10 h-10 rounded-full bg-[#1E293B] text-white flex items-center justify-center font-black text-base shadow-xs">
                        🦅
                      </div>
                      <span className="text-[10px] font-black text-[#C2410C] mt-1">犀角鸟</span>
                    </div>

                    {/* 精灵 3: 香草甜甜 */}
                    <div className="flex flex-col items-center bg-white/90 rounded-xl px-2.5 py-1.5 shadow-xs border border-white">
                      <div className="w-10 h-10 rounded-full bg-[#F59E0B] text-white flex items-center justify-center font-black text-base shadow-xs">
                        🍨
                      </div>
                      <span className="text-[10px] font-black text-slate-800 mt-1">香草甜甜</span>
                    </div>
                  </div>
                </div>

                <p className="text-[10px] text-[#2B78C4] font-medium leading-normal">
                  💡 提示：上传包含 1~3 只精灵的探索截图，系统会自动识别并分割各精灵。
                </p>
              </div>

              <div className="p-3 bg-[#F5F9FF] rounded-2xl border border-[#D5E2F0] space-y-1.5">
                <p className="font-black text-[#2B78C4] flex items-center gap-1">
                  <span>📸 1. 快捷截图与粘贴</span>
                </p>
                <p>
                  在游戏内按截图键（或 Win+Shift+S / 微信/QQ截图）截取，截完后<strong>无需保存文件</strong>，直接在网页任意位置按 <strong className="text-slate-800 font-mono">Ctrl + V</strong> 即可秒速上传！
                </p>
              </div>

              <div className="p-3 bg-[#F4FDF0] rounded-2xl border border-[#95D151]/40 space-y-1.5">
                <p className="font-black text-[#2D6613] flex items-center gap-1">
                  <span>✨ 2. 自选未遇见精灵（默认不勾选）</span>
                </p>
                <p>
                  识别完成后，系统<strong>默认不勾选</strong>任何精灵。您可以点击卡片任意空白处或候选按钮，从中挑选 1 只您希望点亮的未遇见精灵。
                </p>
              </div>

              <div className="p-3 bg-[#FEF9E6] rounded-2xl border border-[#FEE061] space-y-1.5">
                <p className="font-black text-[#854D0E] flex items-center gap-1">
                  <span>🔍 3. 竖向候选与置信度切换</span>
                </p>
                <p>
                  每张卡片下方均提供竖向候选列表与精确置信度百分比，点击即可快速切换指定精灵；也可以点击<strong>【人工挑选修正】</strong>从全图精灵库中精准搜索替换。
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
            className="relative w-full max-w-2xl bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl p-5 flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b-2 border-[#E6EEF8]">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-[#2B78C4]" />
                <h3 className="text-base font-black text-slate-800">
                  为检测位 #{editingItemIndex + 1} 手工挑选正确精灵
                </h3>
              </div>
              <button
                onClick={() => setEditingItemIndex(null)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center"
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
                placeholder="搜索精灵名称或编号..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-[#F5F9FF] border border-[#E2E8F0] rounded-xl outline-hidden focus:border-[#7ABCF4] focus:bg-white text-slate-800 font-medium"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-1">
              {targetMapPets
                .filter((p) => formatPetName(p.name).toLowerCase().includes(pickerSearch.toLowerCase().trim()))
                .map((pet) => {
                  const already = checkAlreadyEncountered(targetMap.id, pet.name);
                  return (
                    <button
                      key={pet.name}
                      type="button"
                      onClick={() => handleApplyPetCorrection(pet)}
                      className="p-2 rounded-xl border border-slate-200 hover:border-[#7ABCF4] hover:bg-[#F5F9FF] transition-all flex flex-col items-center text-center cursor-pointer group"
                    >
                      <div className="w-14 h-14 rounded-lg bg-[#F5F9FF] p-1 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <img src={pet.url} alt={pet.name} className="w-full h-full object-contain" />
                      </div>
                      <p className="text-xs font-black text-slate-800 mt-1 truncate w-full">
                        {formatPetName(pet.name)}
                      </p>
                      <span className={`text-[9px] font-bold mt-0.5 ${already ? 'text-[#2D6613]' : 'text-amber-600'}`}>
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
