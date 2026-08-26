import React, { useState, useRef, useEffect } from 'react';
import {
  X,
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
  ArrowRight,
  Search,
  ZoomIn,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  Trash2,
  Sparkle,
  Maximize2,
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
import { formatPetName, isSamePetName, isPetEncounteredInRecords, getBasePetName } from '../utils/petHelper';
import { ElementBadges } from './ElementBadges';

interface BatchInitModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMap: MapConfig;
  allMapsPets: Record<string, { count: number; items: PetItem[] }>;
  records?: Record<string, EncounterRecord>;
  isEncountered?: (mapId: string, filename: string) => boolean;
  onBatchEncounterSuccess: (
      items: Array<{ mapId: string; filename: string; note?: string }>
  ) => void;
}

export const BatchInitModal: React.FC<BatchInitModalProps> = ({
                                                                isOpen,
                                                                onClose,
                                                                currentMap,
                                                                allMapsPets,
                                                                records,
                                                                isEncountered,
                                                                onBatchEncounterSuccess,
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

  // Original Image Lightbox Modal View State
  const [showOriginalImageLightbox, setShowOriginalImageLightbox] = useState<boolean>(false);

  // Editing single item modal/picker
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState<string>('');
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewSectionRef = useRef<HTMLDivElement>(null);
  const scrollBodyRef = useRef<HTMLDivElement>(null);

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      setSelectedMapNum(currentMap.num);
    }
  }, [isOpen, currentMap.num]);

  // Target map config & pets
  const targetMap = MAP_CONFIGS.find((m) => m.num === selectedMapNum) || currentMap;
  const targetMapPets: PetItem[] =
      allMapsPets[`map${selectedMapNum}`]?.items && allMapsPets[`map${selectedMapNum}`].items.length > 0
          ? allMapsPets[`map${selectedMapNum}`].items
          : FALLBACK_MAPS_DATA[`map${selectedMapNum}`]?.items || [];

  // Helper to check if a pet is already encountered in target map
  const checkAlreadyEncountered = (mapId: string, name?: string): boolean => {
    if (!name) return false;
    if (isEncountered) {
      return isEncountered(mapId, name);
    }
    return isPetEncounteredInRecords(records, mapId, name);
  };

  // When target map changes, re-evaluate review items against the new map's library
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
            isChecked: item.status === 'matched' && !already,
          };
        })
    );
  }, [selectedMapNum]);

  // Clipboard paste support
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
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
  }, [isOpen]);

  if (!isOpen) return null;

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

  // Drag & drop handlers
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

  // Clear all upload boxes and review state
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

  // Execute Batch Recognition
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

      // Process and pair with pet library
      const processed: BatchInitReviewItem[] = data.results.map((raw) => {
        // Process candidate list if present
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
            // Find across other maps or generate fallback
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
          // By default auto-check matched & unencountered pets
          isChecked: isGoodMatch && !alreadyEncountered,
          isManuallyEdited: false,
        };
      });

      setReviewItems(processed);
      sound.playClick();

      // 识别完成后滚到候选/结果区，方便直接核对候选
      setTimeout(() => {
        if (reviewSectionRef.current) {
          reviewSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 120);
    } catch (err: unknown) {
      const error = err as Error;
      setScanError(error.message || '批量识别请求失败，请检查网络或后端接口');
    } finally {
      setIsScanning(false);
    }
  };

  // Toggle single item checked state
  const handleToggleCheck = (index: number) => {
    sound.playClick();
    setReviewItems((prev) =>
        prev.map((item) =>
            item.index === index ? { ...item, isChecked: !item.isChecked } : item
        )
    );
  };

  // Batch Select / Unselect
  const handleSelectAll = (check: boolean) => {
    sound.playClick();
    setReviewItems((prev) =>
        prev.map((item) => ({
          ...item,
          isChecked: check ? item.status === 'matched' : false,
        }))
    );
  };

  // Quick select: only select unencountered new pets
  const handleSelectOnlyUnencountered = () => {
    sound.playClick();
    setReviewItems((prev) =>
        prev.map((item) => ({
          ...item,
          isChecked: item.status === 'matched' && !item.isAlreadyEncountered,
        }))
    );
  };

  // Manual correction: pick another pet for item
  const handleOpenPicker = (itemIndex: number) => {
    sound.playClick();
    setEditingItemIndex(itemIndex);
    setPickerSearch('');
  };

  // Switch to one of the predicted candidates directly
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

    // 人工修正回流：把「识别到的名字 -> 用户修正后的正确名」上报到 OCR 纠错表，
    // 后续同类 OCR 误识会被自动纠正。
    const originalItem = reviewItems.find((x) => x.index === editingItemIndex);
    if (originalItem?.filename) {
      api.submitOcrCorrection(originalItem.filename, pet.name);
    }

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
              score: 1.0, // manually verified
              isChecked: true, // auto select corrected item
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

  // Final Batch Confirmation: "批量遇见"
  const handleConfirmBatchEncounter = () => {
    const selectedToEncounter = reviewItems.filter(
        (item) => item.isChecked && item.status === 'matched' && item.matchedPet
    );

    if (selectedToEncounter.length === 0) {
      alert('请至少勾选 1 只已正确匹配的精灵！');
      return;
    }

    sound.playEncounter();

    // Trigger celebration
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
          ? '批量初始化（人工修正）'
          : `批量识别自动导入 (置信度: ${((item.score || 1) * 100).toFixed(1)}%)`,
    }));

    onBatchEncounterSuccess(payload);

    // 点击批量遇见之后清空所有上传框
    handleClearUpload();

    // 确认后回到弹窗内容最上方（游戏画面/初始区）
    requestAnimationFrame(() => {
      if (scrollBodyRef.current) {
        scrollBodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  };

  // Filtered review items
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
  const matchedCount = reviewItems.filter((i) => i.status === 'matched').length;
  const unmatchedCount = reviewItems.filter((i) => i.status === 'unmatched').length;
  const unencounteredNewCount = reviewItems.filter((i) => i.status === 'matched' && !i.isAlreadyEncountered).length;
  const alreadyEncounteredCount = reviewItems.filter((i) => i.status === 'matched' && i.isAlreadyEncountered).length;

  const hasResults = reviewItems.length > 0;

  return (
      <div
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-5 bg-slate-900/65 backdrop-blur-xs overflow-y-auto"
          onClick={onClose}
      >
        <div
            className={`relative w-full bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ease-in-out ${
                hasResults
                    ? 'max-w-[97vw] 2xl:max-w-[1880px] h-[95vh] max-h-[96vh]'
                    : 'max-w-5xl lg:max-w-6xl max-h-[92vh]'
            }`}
            onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#7ABCF4] to-[#5DA8E8] px-6 py-4 text-white flex items-center justify-between shadow-sm shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#FEE061] text-[#854D0E] flex items-center justify-center shadow-xs border-2 border-white">
                <Layers className="w-5 h-5 text-[#854D0E]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg sm:text-xl font-black">图鉴智能批量初始化</h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/20 text-white font-black border border-white/30">
                  全景智能分割
                </span>
                </div>
                <p className="text-xs text-white/80">
                  上传游戏全景截图，智能检测识别精灵并标注图鉴已有状态，防止重复遇见
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                  id="batch-init-help-btn"
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    setIsHelpOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-black transition-all border border-white/30 hover:shadow-xs cursor-pointer"
                  title="查看批量初始化截图与使用帮助"
              >
                <HelpCircle className="w-4 h-4 text-white" />
                <span>帮助提示</span>
              </button>

              <button
                  onClick={() => {
                    sound.playClick();
                    onClose();
                  }}
                  className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Scrollable Body */}
          <div
              ref={scrollBodyRef}
              className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5"
          >
            {/* Step 1: Upload & Map Selection Toolbar */}
            <div className="p-4 sm:p-5 bg-[#F5F9FF] rounded-2xl border-2 border-[#E6EEF8]">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                {/* Target Map Selector */}
                <div className="flex items-center gap-3">
                <span className="text-xs font-black text-slate-700 whitespace-nowrap">
                  目标地图:
                </span>
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
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
                              }}
                              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 border-2 whitespace-nowrap ${
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
                </div>

                {/* Threshold Setting */}
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

              {/* Upload Box & Control Station */}
              <div className="mt-4">
                {!previewUrl ? (
                    /* Pre-upload: Balanced 2-Column Landing State */
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
                      {/* Left: Upload Dropzone (7 Cols) */}
                      <div
                          onClick={() => fileInputRef.current?.click()}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          className={`lg:col-span-7 border-2 border-dashed rounded-2xl p-5 sm:p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[160px] bg-white group ${
                              isDragOver
                                  ? 'border-[#95D151] bg-[#F4FDF0] scale-[1.01]'
                                  : 'border-[#BCD7F2] hover:border-[#2B78C4] hover:bg-[#F5F9FF]'
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

                        <div className="w-12 h-12 rounded-2xl bg-[#EBF4FE] text-[#2B78C4] group-hover:bg-[#2B78C4] group-hover:text-white transition-all flex items-center justify-center shadow-2xs mb-2.5">
                          <UploadCloud className="w-6 h-6" />
                        </div>

                        <p className="text-xs sm:text-sm font-black text-slate-700 group-hover:text-[#1E5B99] transition-colors">
                          点击选择图片 或 拖拽截图至此
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          也可在页面任意位置直接按 <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono text-[10px] text-slate-600 font-bold">Ctrl + V</kbd> 粘贴
                        </p>
                      </div>

                      {/* Right: Ready Status & Disabled Button (5 Cols) */}
                      <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E6EEF8] p-4 sm:p-5 flex flex-col justify-between shadow-2xs">
                        <div>
                          <div className="flex items-center justify-between pb-2.5 border-b border-[#F1F5F9]">
                            <span className="text-xs font-black text-slate-700">识别状态</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black">
                              等待上传
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                            请先上传或粘贴游戏全景截图，系统将自动分割识别图中的所有精灵。
                          </p>
                        </div>

                        <div className="pt-3 border-t border-[#F1F5F9]">
                          <button
                              disabled
                              className="w-full py-3 px-4 rounded-xl bg-slate-100 text-slate-400 font-black text-xs sm:text-sm cursor-not-allowed flex items-center justify-center gap-1.5"
                          >
                            <Sparkles className="w-4 h-4 text-slate-300" />
                            <span>请先上传游戏截图</span>
                          </button>
                        </div>
                      </div>
                    </div>
                ) : (
                    /* Post-upload: Balanced Split View (Left: Clear Preview Viewport, Right: Control Station) */
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
                      {/* Left: Clear Screenshot Preview Viewport (7-8 Cols) */}
                      <div className="lg:col-span-7 xl:col-span-8 bg-white rounded-2xl border-2 border-[#BCD7F2] p-3 sm:p-4 shadow-xs flex flex-col">
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E6EEF8]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="px-2 py-0.5 rounded-md bg-[#2B78C4] text-white text-[10px] font-black shrink-0">
                              已选截图
                            </span>
                            <span className="text-xs font-bold text-slate-700 truncate" title={selectedFile ? selectedFile.name : '游戏截图'}>
                              {selectedFile ? selectedFile.name : '已选择样本截图'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowOriginalImageLightbox(true)}
                                className="px-2.5 py-1 rounded-lg bg-[#F0F7FF] hover:bg-[#E0EFFF] border border-[#BCD7F2] text-[#2B78C4] text-[11px] font-black flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                                title="点击放大查看原图"
                            >
                              <ZoomIn className="w-3.5 h-3.5 text-[#2B78C4]" />
                              <span>放大原图</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="px-2 py-1 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                                title="更换其他截图"
                            >
                              <span>更换</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleClearUpload}
                                className="p-1 rounded-lg bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-400 hover:text-rose-600 shadow-2xs transition-colors cursor-pointer"
                                title="移除图片"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Image Viewport */}
                        <div
                            onClick={() => setShowOriginalImageLightbox(true)}
                            className="relative w-full h-48 sm:h-56 rounded-xl overflow-hidden bg-white border border-[#E6EEF8] flex items-center justify-center cursor-zoom-in group/img shadow-inner"
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
                      <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-2xl border-2 border-[#E6EEF8] p-4 sm:p-5 flex flex-col justify-between shadow-xs">
                        <div>
                          <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
                            <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                              <Sparkle className="w-3.5 h-3.5 text-[#2B78C4]" />
                              识别参数与控制
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-[#E1F7DB] text-[#2D6613] border border-[#95D151]/50 text-[10px] font-black">
                              画面已就绪
                            </span>
                          </div>

                          <div className="mt-3 space-y-2.5">
                            <div className="p-2.5 rounded-xl bg-[#F8FBFE] border border-[#E6EEF8] text-xs">
                              <div className="flex items-center justify-between text-slate-600 mb-1">
                                <span className="font-bold">识别目标地图:</span>
                                <span className="font-black text-[#1E5B99]">{targetMap.num}、{targetMap.name.replace('记忆中的', '')}</span>
                              </div>
                              <div className="flex items-center justify-between text-slate-600">
                                <span className="font-bold">检测过滤阈值:</span>
                                <span className="font-mono font-black text-[#2B78C4]">{threshold}</span>
                              </div>
                            </div>

                            <div className="text-[11px] text-slate-500 leading-relaxed bg-[#FFFDF5] border border-[#FEE061]/50 rounded-xl p-2.5">
                              ✨ 识别完成后，系统将自动定位精灵候选并标出未遇状态，您可以勾选需要点亮的精灵。
                            </div>
                          </div>
                        </div>

                        {/* Start Button: Well-proportioned, bold, attractive */}
                        <div className="mt-4 pt-3 border-t border-[#F1F5F9] space-y-2">
                          <button
                              id="start-batch-scan-btn"
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
                                  <span>开始智能批量识别</span>
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

              {/* Error Message */}
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

            {/* Step 2: Review & Correction Workbench */}
            {reviewItems.length > 0 && (
                <div ref={reviewSectionRef} className="space-y-4 animate-in fade-in duration-300 scroll-mt-6">
                  {/* Integrated Control & Filter Strip (Tabs + Search Bar + Batch Actions) */}
                  <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-slate-50/90 p-2 sm:p-2.5 rounded-2xl border border-slate-200 shadow-xs">
                    {/* 1. Left: Filter Tabs */}
                    <div className="flex items-center gap-1 p-1 bg-white rounded-xl border border-slate-200 overflow-x-auto shrink-0 custom-scrollbar shadow-2xs">
                      <button
                          type="button"
                          onClick={() => setFilterTab('all')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                              filterTab === 'all'
                                  ? 'bg-[#2B78C4] text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                          }`}
                      >
                        全部 ({reviewItems.length})
                      </button>
                      <button
                          type="button"
                          onClick={() => setFilterTab('unencountered')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                              filterTab === 'unencountered'
                                  ? 'bg-[#95D151] text-white shadow-xs'
                                  : 'text-[#2D6613] hover:text-slate-900'
                          }`}
                      >
                        <span>✨ 未遇见 ({unencounteredNewCount})</span>
                      </button>
                      {alreadyEncounteredCount > 0 && (
                          <button
                              type="button"
                              onClick={() => setFilterTab('alreadyEncountered')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                                  filterTab === 'alreadyEncountered'
                                      ? 'bg-slate-600 text-white shadow-xs'
                                      : 'text-slate-600 hover:text-slate-900'
                              }`}
                          >
                            <span>已在图鉴 ({alreadyEncounteredCount})</span>
                          </button>
                      )}
                      <button
                          type="button"
                          onClick={() => setFilterTab('checked')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                              filterTab === 'checked'
                                  ? 'bg-[#7ABCF4] text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                          }`}
                      >
                        已勾选 ({checkedCount})
                      </button>
                      {unmatchedCount > 0 && (
                          <button
                              type="button"
                              onClick={() => setFilterTab('unmatched')}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap cursor-pointer ${
                                  filterTab === 'unmatched'
                                      ? 'bg-rose-500 text-white shadow-xs'
                                      : 'text-rose-600 hover:text-rose-900'
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
                          className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl outline-hidden focus:border-[#2B78C4] focus:ring-2 focus:ring-[#2B78C4]/15 text-slate-800 font-medium transition-all shadow-2xs"
                      />
                      {searchFilter && (
                          <button
                              type="button"
                              onClick={() => setSearchFilter('')}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-lg text-xs font-bold cursor-pointer"
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
                          className="px-3 py-1.5 rounded-xl bg-[#E1F7DB] hover:bg-[#D3F3CA] border border-[#95D151] text-xs font-black text-[#2D6613] flex items-center gap-1.5 shadow-2xs cursor-pointer transition-colors"
                          title="仅勾选之前未遇见的全新精灵，避免重复遇见"
                      >
                        <Sparkle className="w-3.5 h-3.5 text-[#2D6613]" />
                        <span>选【未遇见】</span>
                      </button>
                      <button
                          type="button"
                          onClick={() => handleSelectAll(true)}
                          className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-black text-slate-700 flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                      >
                        <CheckSquare className="w-3.5 h-3.5 text-[#95D151]" />
                        <span>全选</span>
                      </button>
                      <button
                          type="button"
                          onClick={() => handleSelectAll(false)}
                          className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-black text-slate-700 flex items-center gap-1 cursor-pointer shadow-2xs transition-colors"
                      >
                        <Square className="w-3.5 h-3.5 text-slate-400" />
                        <span>全不选</span>
                      </button>
                      <button
                          type="button"
                          disabled={checkedCount === 0}
                          onClick={handleConfirmBatchEncounter}
                          className="px-4 py-1.5 rounded-xl roco-btn-success text-xs font-black flex items-center gap-1.5 shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all active:scale-[0.98]"
                          title="确认遇见勾选的精灵"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>确认遇见{checkedCount > 0 ? ` (${checkedCount})` : ''}</span>
                      </button>
                    </div>
                  </div>

                  {/* Items Review Grid - 6 columns per row for compact rich overview */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                    {filteredItems.map((item) => {
                      const isMatched = item.status === 'matched';
                      const scorePercent = item.score ? (item.score * 100).toFixed(1) : '0';
                      const isHighScore = (item.score || 0) >= 0.88;
                      const isAlready = !!item.isAlreadyEncountered;
                      const displayName = formatPetName(item.matchedPet?.name || item.filename);

                      return (
                          <div
                              key={item.index}
                              className={`relative rounded-2xl border-3 p-3 transition-colors duration-150 flex flex-col justify-between ${
                                  item.isChecked
                                      ? 'border-[#95D151] bg-[#F9FEF8] shadow-xs'
                                      : item.status === 'unmatched'
                                          ? 'border-rose-300 bg-rose-50/50'
                                          : isAlready
                                              ? 'border-slate-300 bg-slate-50/70 opacity-90'
                                              : 'border-[#E6EEF8] bg-white opacity-80'
                              }`}
                          >
                            {/* Top Row: Checkbox + Index */}
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={item.isChecked}
                                    onChange={() => handleToggleCheck(item.index)}
                                    className="w-4 h-4 rounded text-[#95D151] accent-[#95D151] cursor-pointer"
                                />
                                <span className="text-[10px] font-mono font-black text-slate-500">
                            检测图位 #{item.index + 1}
                          </span>
                              </label>

                              {/* Status / Score Tag */}
                              {isMatched ? (
                                  <span
                                      className={`text-[9px] font-mono font-black px-1.5 py-0.2 rounded-md ${
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
                                  <span className="text-[9px] font-black px-1.5 py-0.2 rounded-md bg-rose-100 text-rose-700">
                            未匹配
                          </span>
                              )}
                            </div>

                            {/* Main Selected Pet Display */}
                            <div className="flex flex-col items-center text-center my-1">
                              <div className="relative w-16 h-16 rounded-xl bg-white p-1 border border-[#E6EEF8] shadow-inner flex items-center justify-center">
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
                                    <p className="text-xs font-black text-slate-800 truncate" title={displayName}>
                                      {displayName}
                                    </p>
                                ) : (
                                    <p className="text-[10px] text-rose-600 font-bold truncate" title={item.reason || '特征不匹配'}>
                                      {item.reason || '未匹配到精灵'}
                                    </p>
                                )}
                              </div>

                              {/* Match Confidence Progress Bar */}
                              {isMatched && (
                                  <div className="w-full mt-1.5 px-0.5">
                                    <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mb-0.5">
                                      <span>当前匹配度</span>
                                      <span className="font-black text-slate-600">{scorePercent}%</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-slate-200/80 rounded-full overflow-hidden p-[1px]">
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
                                        <span className="inline-flex items-center justify-center gap-0.5 text-[10px] font-black text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-300 w-full">
                                已在图鉴中
                              </span>
                                    ) : (
                                        <span className="inline-flex items-center justify-center gap-0.5 text-[10px] font-black text-[#2D6613] bg-[#E1F7DB] px-1.5 py-0.5 rounded-md border border-[#95D151] w-full">
                                <Sparkles className="w-2.5 h-2.5 text-[#2D6613]" />
                                未遇见新宠
                              </span>
                                    )}
                                  </div>
                              )}
                            </div>

                            {/* Candidates Prediction List (Top 1~5) */}
                            {item.candidates && item.candidates.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-slate-100/90 w-full space-y-1">
                                  <div className="flex items-center justify-between text-[10px] font-black text-slate-500 mb-1 px-0.5">
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
                                                      ? 'bg-[#EEF6FF] border-[#7ABCF4] shadow-xs font-black'
                                                      : 'bg-white/90 border-slate-200/80 hover:bg-[#F5F9FF] hover:border-[#BCD7F2] text-slate-700'
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
                                            : 'bg-slate-200 text-slate-600'
                                    }`}>
                                      #{candIdx + 1}
                                    </span>

                                              <div className="w-5 h-5 rounded-md bg-white border border-slate-200 p-0.5 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
                                                <img
                                                    src={cand.view_url || cand.matchedPet?.url}
                                                    alt={candDisplayName}
                                                    className="w-full h-full object-contain"
                                                />
                                              </div>

                                              <span className="text-[11px] truncate flex-1 font-bold">
                                      {candDisplayName}
                                    </span>
                                            </div>

                                            <div className="relative z-10 flex items-center gap-1 shrink-0">
                                              {/* In-Dex Encountered Status Pill */}
                                              {isCandAlready ? (
                                                  <span className="text-[8px] font-black px-1 py-0.2 rounded bg-slate-100/90 text-slate-500 border border-slate-200/80 shadow-2xs backdrop-blur-2xs">
                                        已在图鉴
                                      </span>
                                              ) : (
                                                  <span className="text-[8px] font-black px-1 py-0.2 rounded bg-[#E1F7DB]/95 text-[#2D6613] border border-[#95D151] shadow-2xs backdrop-blur-2xs">
                                        未遇见
                                      </span>
                                              )}

                                              <span className="text-[9px] font-mono font-black text-slate-600">
                                      {candScorePercent}%
                                    </span>
                                              {isSelectedCand && (
                                                  <span className="text-[8px] px-1 py-0.2 bg-[#7ABCF4] text-white rounded font-black shadow-2xs">
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

                            {/* Bottom Quick Modify Button */}
                            <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between gap-1">
                              <button
                                  type="button"
                                  onClick={() => handleOpenPicker(item.index)}
                                  className="w-full py-1 px-2 rounded-lg bg-[#F5F9FF] hover:bg-[#EBF4FE] border border-[#D5E2F0] text-[10px] font-black text-[#2B78C4] hover:text-[#1D5E9E] flex items-center justify-center gap-1 transition-all cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>手动搜索指定其他精灵</span>
                              </button>
                            </div>
                          </div>
                      );
                    })}
                  </div>
                </div>
            )}
          </div>

          {/* Sticky Bottom Action Bar */}
          <div className="bg-slate-50 border-t-2 border-[#E6EEF8] p-4 px-6 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <div className="text-xs sm:text-sm text-slate-600 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#95D151]" />
              <span>
              已选入 <strong className="text-[#2D6613] text-sm sm:text-base font-black">{checkedCount}</strong> 只精灵
              （将点亮写入【{targetMap.name}】的图鉴中）
            </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end">
              <button
                  type="button"
                  onClick={handleSelectOnlyUnencountered}
                  className="px-3 py-2 rounded-xl bg-[#E1F7DB] hover:bg-[#D3F3CA] border border-[#95D151] text-xs font-black text-[#2D6613] flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="仅勾选之前未遇见的全新精灵"
              >
                <Sparkle className="w-3.5 h-3.5 text-[#2D6613]" />
                <span>选【未遇见】</span>
              </button>
              <button
                  type="button"
                  onClick={() => handleSelectAll(true)}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-[#D5E2F0] text-xs font-black text-slate-700 flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <CheckSquare className="w-3.5 h-3.5 text-[#95D151]" />
                <span>全选</span>
              </button>
              <button
                  type="button"
                  onClick={() => handleSelectAll(false)}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-[#D5E2F0] text-xs font-black text-slate-700 flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Square className="w-3.5 h-3.5 text-slate-400" />
                <span>全不选</span>
              </button>

              <button
                  onClick={() => {
                    sound.playClick();
                    onClose();
                  }}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-600 text-xs font-black hover:bg-slate-100 transition-colors cursor-pointer"
              >
                取消
              </button>

              <button
                  disabled={checkedCount === 0}
                  onClick={handleConfirmBatchEncounter}
                  className="py-2.5 px-6 roco-btn-success text-xs sm:text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-md cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" />
                <span>批量一次性遇见 ({checkedCount} 只)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Secondary Modal / Lightbox: Fullscreen Original Image Lightbox */}
          {showOriginalImageLightbox && previewUrl && (
              <div
                  className="fixed inset-0 z-70 flex items-center justify-center p-3 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150"
                  onClick={() => setShowOriginalImageLightbox(false)}
              >
                <div
                    className="relative max-w-6xl w-full max-h-[92vh] bg-slate-900 rounded-3xl border-2 border-white/20 shadow-2xl p-4 flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                >
                  {/* Lightbox Header */}
                  <div className="flex items-center justify-between pb-3 text-white border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-[#7ABCF4]" />
                      <div>
                        <h4 className="text-sm font-black">原始游戏截图高清比对</h4>
                        <p className="text-[11px] text-slate-400">
                          对照此截图中的精灵位置与特征，核实下方各个图鉴卡片的识别准确度
                        </p>
                      </div>
                    </div>
                    <button
                        onClick={() => setShowOriginalImageLightbox(false)}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Lightbox Image Container */}
                  <div className="flex-1 overflow-auto p-2 flex items-center justify-center min-h-[300px]">
                    <img
                        src={previewUrl}
                        alt="原始截图大图"
                        className="max-w-full max-h-[78vh] object-contain rounded-xl shadow-2xl"
                    />
                  </div>
                </div>
              </div>
          )}

          {/* Secondary Modal / Picker: Manual Pet Picker for a specific index */}
          {editingItemIndex !== null && (
              <div
                  className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
                  onClick={() => setEditingItemIndex(null)}
              >
                <div
                    className="relative w-full max-w-lg bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl p-5 max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-150"
                    onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between pb-3 border-b-2 border-[#E6EEF8]">
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-5 h-5 text-[#7ABCF4]" />
                      <h4 className="text-base font-black text-slate-800">
                        手动纠错：为 #{editingItemIndex + 1} 选择正确精灵
                      </h4>
                    </div>
                    <button
                        onClick={() => setEditingItemIndex(null)}
                        className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Search */}
                  <div className="mt-3 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        placeholder="搜索精灵名、图鉴id..."
                        className="w-full pl-9 pr-4 py-2 text-xs bg-[#F5F9FF] border-2 border-[#E6EEF8] rounded-xl outline-hidden focus:border-[#7ABCF4] focus:bg-white text-slate-800 font-medium"
                    />
                  </div>

                  {/* Pets Selection Grid */}
                  <div className="mt-3 flex-1 overflow-y-auto pr-1 grid grid-cols-3 sm:grid-cols-4 gap-2.5 py-1">
                    {targetMapPets
                        .filter((p) => {
                          if (!pickerSearch.trim()) return true;
                          const q = pickerSearch.toLowerCase().trim();
                          const cleanName = formatPetName(p.name).toLowerCase();
                          const rawName = p.name.toLowerCase();
                          const idMatch = String(p.id ?? '').includes(q);
                          return cleanName.includes(q) || rawName.includes(q) || idMatch;
                        })
                        .map((pet) => {
                          const isAlready = checkAlreadyEncountered(targetMap.id, pet.name);
                          const cleanPetName = formatPetName(pet.name);
                          return (
                              <button
                                  key={pet.name}
                                  onClick={() => handleApplyPetCorrection(pet)}
                                  className={`p-2 rounded-2xl border-2 hover:shadow-xs flex flex-col items-center text-center transition-all group cursor-pointer ${
                                      isAlready
                                          ? 'border-slate-300 bg-slate-50 hover:bg-white hover:border-[#7ABCF4]'
                                          : 'border-[#E6EEF8] bg-[#F5F9FF] hover:bg-white hover:border-[#7ABCF4]'
                                  }`}
                              >
                                <div className="relative w-14 h-14 rounded-xl bg-white p-1 flex items-center justify-center border border-[#E6EEF8] shadow-inner group-hover:scale-105 transition-transform">
                                  <img
                                      src={pet.url}
                                      alt={cleanPetName}
                                      className="w-full h-full object-contain"
                                  />
                                  {pet.id != null && (
                                      <span className="absolute top-0.5 right-0.5 z-10 text-[8px] font-mono font-black leading-none px-1 py-0.5 rounded bg-slate-800/70 text-white/90">
                                        #{pet.id}
                                      </span>
                                  )}
                                </div>
                                <p className="mt-1.5 text-xs font-black text-slate-800 truncate w-full" title={cleanPetName}>
                                  {cleanPetName}
                                </p>
                                {isAlready && (
                                    <span className="mt-1 text-[9px] text-slate-500 font-bold bg-white px-1.5 py-0.2 rounded border border-slate-200">
                            已在图鉴中
                          </span>
                                )}
                              </button>
                          );
                        })}
                  </div>
                </div>
              </div>
          )}
          {/* Help Modal */}
          {isHelpOpen && (
              <div
                  className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
                  onClick={() => setIsHelpOpen(false)}
              >
                <div
                    className="relative w-full max-w-xl bg-white rounded-3xl border-4 border-[#7ABCF4] shadow-2xl p-6 space-y-4"
                    onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between pb-3 border-b-2 border-[#E6EEF8]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-[#FEE061] text-[#854D0E] flex items-center justify-center font-black">
                        <Layers className="w-4 h-4 text-[#854D0E]" />
                      </div>
                      <h3 className="text-base font-black text-slate-800">
                        图鉴批量初始化 · 使用帮助与截图示范
                      </h3>
                    </div>
                    <button
                        onClick={() => setIsHelpOpen(false)}
                        className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-3 text-xs text-slate-600 leading-relaxed max-h-[70vh] overflow-y-auto pr-1">
                    {/* 推荐用图与截图示范 (整页图鉴) */}
                    <div className="p-3.5 bg-gradient-to-br from-[#FEF9E6] to-[#FFF7D6] rounded-2xl border-2 border-[#FEE061] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="font-black text-[#854D0E] flex items-center gap-1.5 text-xs">
                          <span>🎯 推荐截图示范（整页图鉴批量初始化）</span>
                        </p>
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#F59E0B] text-white shadow-2xs">
                      最佳批量初始化效果
                    </span>
                      </div>

                      <p className="text-[11px] text-[#78350F]">
                        直接截取游戏内精灵图鉴多只精灵网格区域（包含<strong>圆框精灵头像</strong>），如下方图示：
                      </p>

                      {/* 模拟游戏图鉴整页截图示范 (与用户提供的 init_batch.png 高度一致的网格展示) */}
                      <div className="relative rounded-xl overflow-hidden border-2 border-dashed border-[#D97706] bg-[#ECE5D8] p-3 shadow-inner">
                        <div className="absolute top-1.5 right-2 text-[9px] font-black text-amber-900 bg-amber-200/90 px-2 py-0.5 rounded-md border border-amber-400 shadow-2xs">
                          ✂️ 推荐截取整页网格区域（单张识别 10~20+ 只）
                        </div>

                        <div className="space-y-2.5 pt-4 pb-1">
                          {/* 第一排 6 只精灵 */}
                          <div className="grid grid-cols-6 gap-2 justify-items-center">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🪻
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🌵
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🕊️
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🐲
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              👺
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🐉
                            </div>
                          </div>

                          {/* 第二排 6 只精灵 */}
                          <div className="grid grid-cols-6 gap-2 justify-items-center">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🍄
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🦔
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🦎
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🦉
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              ⛄
                            </div>
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#262626] border border-white/60 shadow-xs flex items-center justify-center text-sm sm:text-base">
                              🦊
                            </div>
                          </div>
                        </div>
                      </div>

                      <p className="text-[10px] text-[#92400E] font-medium leading-normal">
                        💡 提示：无需单只裁切，一次性截取包含整页或多排精灵的图鉴画面，系统即可全景分割并批量录入！
                      </p>
                    </div>

                    <div className="p-3 bg-[#F5F9FF] rounded-2xl border border-[#D5E2F0] space-y-1.5">
                      <p className="font-black text-[#2B78C4] flex items-center gap-1">
                        <span>📸 1. 快捷截图与秒速粘贴</span>
                      </p>
                      <p>
                        在游戏图鉴界面按快捷键截取整页网格后，<strong>无需保存文件</strong>，直接在此弹窗按 <strong className="text-slate-800 font-mono">Ctrl + V</strong> (或 Cmd+V) 即可秒速上传并触发全景识别！
                      </p>
                    </div>

                    <div className="p-3 bg-[#F4FDF0] rounded-2xl border border-[#95D151]/40 space-y-1.5">
                      <p className="font-black text-[#2D6613] flex items-center gap-1">
                        <span>✨ 2. 自动标记已点亮图鉴</span>
                      </p>
                      <p>
                        系统会智能比对本地已有图鉴记录：
                        <br />• <strong>未收录精灵</strong>：默认自动勾选，方便一键批量录入。
                        <br />• <strong>已在图鉴精灵</strong>：自动标注为“已在图鉴中”，避免重复记录。
                      </p>
                    </div>

                    <div className="p-3 bg-[#FEF9E6] rounded-2xl border border-[#FEE061] space-y-1.5">
                      <p className="font-black text-[#854D0E] flex items-center gap-1">
                        <span>🔍 3. 智能纠错与一键保存</span>
                      </p>
                      <p>
                        如个别精灵因置信度需要调整，点击该项右侧的<strong>编辑图标</strong>即可手动纠错。点击右上角“一键记录勾选的精灵”即可秒速点亮所有图鉴！
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                        type="button"
                        onClick={() => setIsHelpOpen(false)}
                        className="px-5 py-2 roco-btn-primary text-xs font-black rounded-xl cursor-pointer"
                    >
                      我知道了
                    </button>
                  </div>
                </div>
              </div>
          )}
        </div>
      </div>
  );
};
