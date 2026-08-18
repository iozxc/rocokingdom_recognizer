import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Sliders,
  Check,
  Compass,
  Layers,
  Trash2,
  RotateCcw,
  Sparkle,
  Award,
  Info,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { MapConfig, PetItem, PredictResult, PredictCandidateItem, EncounterRecord } from '../types';
import { api } from '../services/api';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { formatPetName } from '../utils/petHelper';
import { MAP_CONFIGS, FALLBACK_MAPS_DATA } from '../data/mockPets';

interface SinglePetRecognizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMap: MapConfig;
  allMapsPets: Record<string, { count: number; items: PetItem[] }>;
  records: Record<string, EncounterRecord>;
  onEncounterSuccess: (mapId: string, filename: string, note?: string) => void;
  onOpenManualSelect: (predictResult: PredictResult | null) => void;
  isEncountered: (mapId: string, filename: string) => boolean;
}

export const SinglePetRecognizerModal: React.FC<SinglePetRecognizerModalProps> = ({
  isOpen,
  onClose,
  currentMap,
  allMapsPets,
  records,
  onEncounterSuccess,
  onOpenManualSelect,
  isEncountered,
}) => {
  const [selectedMapNum, setSelectedMapNum] = useState<number>(currentMap.num);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number>(() => storage.getThreshold('predict_threshold', 0.25));
  const [topK, setTopK] = useState<number>(() => storage.getTopK(3));
  const [showThresholdSettings, setShowThresholdSettings] = useState<boolean>(false);
  const [isPredicting, setIsPredicting] = useState<boolean>(false);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number>(0);
  const [predictError, setPredictError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [justEncountered, setJustEncountered] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedMapNum(currentMap.num);
    }
  }, [isOpen, currentMap.num]);

  const targetMap = MAP_CONFIGS.find((m) => m.num === selectedMapNum) || currentMap;
  const targetMapPets: PetItem[] =
    allMapsPets[`map${selectedMapNum}`]?.items && allMapsPets[`map${selectedMapNum}`].items.length > 0
      ? allMapsPets[`map${selectedMapNum}`].items
      : FALLBACK_MAPS_DATA[`map${selectedMapNum}`]?.items || [];

  // Clipboard paste listener
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            handleFileSelected(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, selectedMapNum]);

  if (!isOpen) return null;

  const handleFileSelected = (file: File) => {
    sound.playClick();
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setPrediction(null);
    setSelectedCandidateIndex(0);
    setPredictError(null);
    setJustEncountered(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleClear = () => {
    sound.playClick();
    setSelectedFile(null);
    setPreviewUrl(null);
    setPrediction(null);
    setSelectedCandidateIndex(0);
    setPredictError(null);
    setJustEncountered(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTopKChange = (newK: number) => {
    sound.playClick();
    const clamped = Math.max(1, Math.min(6, newK));
    setTopK(clamped);
    storage.setTopK(clamped);
  };

  const executePrediction = async () => {
    if (!selectedFile && !previewUrl) return;

    sound.playScan();
    setIsPredicting(true);
    setPredictError(null);
    setJustEncountered(false);
    setSelectedCandidateIndex(0);

    try {
      let fileToSend: File | Blob;
      if (selectedFile) {
        fileToSend = selectedFile;
      } else if (previewUrl) {
        const res = await fetch(previewUrl);
        fileToSend = await res.blob();
      } else {
        throw new Error('未选择图片');
      }

      const { result } = await api.predictPet(fileToSend, selectedMapNum, threshold, topK);

      if (result.candidates && result.candidates.length > 0) {
        result.candidates = result.candidates.map((cand) => {
          const localMatched = targetMapPets.find((p) => p.name === cand.filename);
          if (localMatched) {
            return { ...cand, matchedPet: localMatched };
          }
          return cand;
        });
      }

      const localTop = targetMapPets.find((p) => p.name === result.filename);
      if (localTop) {
        result.matchedPet = localTop;
      }

      setPrediction(result);
      setSelectedCandidateIndex(0);
      sound.playClick();
    } catch (err: unknown) {
      const error = err as Error;
      setPredictError(error.message || '识别失败，请检查网络或后端接口');
    } finally {
      setIsPredicting(false);
    }
  };

  const candidatesList: PredictCandidateItem[] = prediction?.candidates || (prediction ? [{
    filename: prediction.filename,
    score: prediction.score,
    view_url: prediction.view_url,
    match_path: prediction.match_path,
    matchedPet: prediction.matchedPet,
  }] : []);

  const activeCandidate: PredictCandidateItem | null = candidatesList[selectedCandidateIndex] || candidatesList[0] || null;

  const handleConfirmEncounter = (candidateToEncounter?: PredictCandidateItem) => {
    const target = candidateToEncounter || activeCandidate;
    if (!target) return;

    sound.playEncounter();

    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#10b981', '#38bdf8', '#fbbf24', '#f43f5e', '#a855f7'],
    });

    onEncounterSuccess(
      targetMap.id,
      target.filename,
      `通过单个精灵AI识别遇见 (置信度: ${(target.score * 100).toFixed(1)}%)`
    );

    handleClear();
  };

  const handleManualSelect = () => {
    sound.playClick();
    onOpenManualSelect(prediction);
  };

  const confidencePercentage = activeCandidate ? (activeCandidate.score * 100).toFixed(1) : '0.0';
  const scoreNum = activeCandidate ? activeCandidate.score : 0;
  const isHighConfidence = scoreNum >= 0.85;
  const isMediumConfidence = scoreNum >= threshold && scoreNum < 0.85;

  const currentPetAlreadyEncountered = activeCandidate
    ? isEncountered(targetMap.id, activeCandidate.filename) ||
      (activeCandidate.matchedPet ? isEncountered(targetMap.id, activeCandidate.matchedPet.name) : false)
    : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/65 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl lg:max-w-5xl bg-white rounded-3xl border-4 border-[#95D151] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#95D151] to-[#689F38] px-6 py-4 text-white flex items-center justify-between shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white text-[#2D6613] flex items-center justify-center shadow-xs border-2 border-white/80">
              <Sparkles className="w-5 h-5 text-[#2D6613]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg sm:text-xl font-black">单个精灵图鉴智能识别</h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/20 text-white font-black border border-white/30">
                  Top-{topK} 候选分析
                </span>
              </div>
              <p className="text-xs text-white/90">
                上传精灵截图或直接粘贴，高精度智能匹配对应精灵并快速点亮图鉴
              </p>
            </div>
          </div>

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

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {/* Target Map Selector & Settings Toolbar */}
          <div className="p-3.5 bg-[#F5F9FF] rounded-2xl border-2 border-[#E6EEF8] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black text-slate-700">目标地图:</span>
              {MAP_CONFIGS.map((map) => {
                const isSelected = selectedMapNum === map.num;
                return (
                  <button
                    key={map.id}
                    onClick={() => {
                      sound.playClick();
                      setSelectedMapNum(map.num);
                    }}
                    className={`px-3 py-1 rounded-xl text-xs font-black transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-[#95D151] text-white border-[#76B032] shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-[#95D151]'
                    }`}
                  >
                    {map.num}、{map.name.replace('记忆中的', '')}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white border border-[#D5E2F0] p-0.5 rounded-xl">
                <span className="text-[11px] font-black text-slate-500 px-1.5 hidden sm:inline">
                  候选数:
                </span>
                {[1, 2, 3, 4, 5, 6].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleTopKChange(k)}
                    className={`px-2 py-0.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      topK === k
                        ? 'bg-[#95D151] text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    Top-{k}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowThresholdSettings(!showThresholdSettings)}
                className="text-xs font-black text-[#2D6613] bg-white border border-[#D5E2F0] px-2.5 py-1 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5 text-[#95D151]" />
                <span>阈值 ({threshold})</span>
              </button>
            </div>
          </div>

          {/* Collapsible Threshold Panel */}
          {showThresholdSettings && (
            <div className="p-3 bg-[#F9FEF8] rounded-2xl border border-[#95D151]/40 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#95D151]" />
                <span className="font-black text-slate-700">置信度过滤阈值:</span>
                <span className="font-mono font-black text-[#2D6613]">{threshold}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.99"
                step="0.05"
                value={threshold}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setThreshold(val);
                  storage.setThreshold('predict_threshold', val);
                }}
                className="w-40 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#95D151]"
              />
            </div>
          )}

          {/* Main Content: Left Upload Box & Right Prediction Result */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Col: Upload */}
            <div className="lg:col-span-5 flex flex-col gap-3">
              <div className="rounded-3xl border-2 border-[#E6EEF8] bg-[#F8FAFC] p-4 flex flex-col gap-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                    <UploadCloud className="w-4 h-4 text-[#95D151]" />
                    待识别精灵图片
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">支持 Ctrl+V 直接粘贴</span>
                </div>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative border-3 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[170px] ${
                    isDragOver
                      ? 'border-[#95D151] bg-[#F4FDF0] scale-[1.01]'
                      : previewUrl
                      ? 'border-[#95D151] bg-white'
                      : 'border-[#BCD7F2] bg-white hover:bg-[#F5F9FF] hover:border-[#95D151]'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/png,image/jpeg,image/jpg"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileSelected(e.target.files[0]);
                      }
                    }}
                  />

                  {previewUrl ? (
                    <div className="flex flex-col items-center justify-center gap-2.5 relative py-1 w-full">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClear();
                        }}
                        className="absolute -top-2 -right-2 z-10 w-7 h-7 rounded-full bg-white hover:bg-rose-500 hover:text-white text-slate-500 border-2 border-slate-200 hover:border-rose-600 flex items-center justify-center transition-all shadow-md cursor-pointer"
                        title="移除当前图片"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="relative w-28 h-28 rounded-2xl overflow-hidden bg-white shadow-sm border-2 border-[#95D151] p-1.5 flex items-center justify-center">
                        <img
                          src={previewUrl}
                          alt="待识别精灵"
                          className="w-full h-full object-contain"
                        />
                        {isPredicting && <div className="magic-scan-line" />}
                      </div>
                      <div className="text-center w-full px-2">
                        <p className="text-xs font-black text-slate-800 truncate">
                          {selectedFile ? selectedFile.name : '已载入精灵图片'}
                        </p>
                        <p className="text-[11px] text-[#2D6613] font-bold hover:underline mt-0.5">
                          点击重新上传或更换图片
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-4">
                      <div className="w-12 h-12 rounded-2xl bg-[#F0F7FF] text-[#95D151] flex items-center justify-center shadow-xs border border-[#E6EEF8]">
                        <UploadCloud className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-black text-slate-700">
                          点击或拖拽上传精灵截图
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          支持截图后在窗口内按 Ctrl+V 快速粘贴
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {(selectedFile || previewUrl || prediction || predictError) && (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="py-2.5 px-3 rounded-xl border-2 border-[#CBD5E1] bg-white hover:bg-slate-50 text-slate-600 hover:text-rose-600 text-xs font-black transition-all flex items-center justify-center gap-1 shadow-2xs shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>清空</span>
                    </button>
                  )}

                  <button
                    disabled={(!selectedFile && !previewUrl) || isPredicting}
                    onClick={executePrediction}
                    className={`w-full py-2.5 px-4 roco-btn-success flex items-center justify-center gap-2 text-xs sm:text-sm font-black disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                      isPredicting ? 'animate-pulse' : ''
                    }`}
                  >
                    {isPredicting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>智能识别中 (Top-{topK})...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-white" />
                        <span>开始单个识别 (Top-{topK})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Right Col: Prediction Result */}
            <div className="lg:col-span-7 flex flex-col">
              <div className="rounded-3xl border-3 border-[#E6EEF8] bg-[#FDF9F3] p-5 flex flex-col justify-between shadow-xs">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b-2 border-[#E6EEF8] gap-2 flex-wrap">
                    <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                      <Compass className="w-4 h-4 text-[#95D151]" />
                      匹配结果 {candidatesList.length > 0 && `(前 ${candidatesList.length} 个候选)`}
                    </span>

                    {activeCandidate && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {currentPetAlreadyEncountered ? (
                          <span className="text-[11px] font-black px-2.5 py-0.5 rounded-lg border-2 bg-[#E1F7DB] text-[#2D6613] border-[#95D151] flex items-center gap-1">
                            <Check className="w-3 h-3 stroke-[3]" />
                            此前已遇过
                          </span>
                        ) : (
                          <span className="text-[11px] font-black px-2.5 py-0.5 rounded-lg border-2 bg-amber-100 text-amber-900 border-amber-300 flex items-center gap-1">
                            <Sparkle className="w-3 h-3 text-amber-600" />
                            未遇见 (新)
                          </span>
                        )}

                        <span
                          className={`text-[11px] font-black px-2.5 py-0.5 rounded-lg border-2 ${
                            isHighConfidence
                              ? 'bg-[#95D151] text-white border-[#76B032]'
                              : isMediumConfidence
                              ? 'bg-[#FEE061] text-[#854D0E] border-[#E5C43B]'
                              : 'bg-rose-100 text-rose-800 border-rose-300'
                          }`}
                        >
                          {isHighConfidence
                            ? '极高匹配度'
                            : isMediumConfidence
                            ? '推荐确认'
                            : '匹配度较低'}
                        </span>
                      </div>
                    )}
                  </div>

                  {isPredicting ? (
                    <div className="py-14 flex flex-col items-center justify-center text-center">
                      <div className="relative w-14 h-14 rounded-full border-4 border-slate-200 border-t-[#95D151] animate-spin mb-3" />
                      <p className="text-sm font-black text-slate-700">正在智能分析精灵特征...</p>
                      <p className="text-xs text-slate-400 mt-1">
                        正在比对【{targetMap.name}】并计算前 {topK} 个高置信度候选
                      </p>
                    </div>
                  ) : activeCandidate ? (
                    <div className="mt-3.5 space-y-3.5">
                      <div className={`p-4 bg-white rounded-2xl border-2 shadow-xs transition-all ${
                        currentPetAlreadyEncountered
                          ? 'border-[#95D151]/50 bg-gradient-to-r from-white to-[#F9FEF8]'
                          : 'border-[#BCD7F2] bg-gradient-to-r from-white to-[#FFFDF5]'
                      }`}>
                        <div className="flex items-center gap-4">
                          <div className="relative w-20 h-20 rounded-2xl bg-[#F5F9FF] border-2 border-[#E6EEF8] p-1.5 flex items-center justify-center shrink-0">
                            <img
                              src={activeCandidate.view_url || activeCandidate.matchedPet?.url}
                              alt={activeCandidate.filename}
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                if (activeCandidate.matchedPet?.url) {
                                  (e.target as HTMLImageElement).src = activeCandidate.matchedPet.url;
                                }
                              }}
                            />
                            {currentPetAlreadyEncountered ? (
                              <div className="encountered-badge-check" title="该精灵已在图鉴中标记遇见">
                                <Check className="w-3.5 h-3.5 text-white stroke-[3.5]" />
                              </div>
                            ) : (
                              <div className="absolute -top-1.5 -right-1.5 bg-amber-400 text-amber-950 font-black text-[9px] px-1.5 py-0.5 rounded-full border border-white shadow-xs flex items-center gap-0.5">
                                <Sparkles className="w-2.5 h-2.5" />
                                NEW
                              </div>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                                selectedCandidateIndex === 0
                                  ? 'bg-amber-400 text-amber-950 border border-amber-500'
                                  : 'bg-slate-100 text-slate-700 border border-slate-300'
                              }`}>
                                #{selectedCandidateIndex + 1} {selectedCandidateIndex === 0 ? '最佳推荐' : '备选候选'}
                              </span>
                              <h4 className="text-base font-black text-slate-800 truncate">
                                {formatPetName(activeCandidate.matchedPet?.name || activeCandidate.filename)}
                              </h4>
                            </div>

                            <div className="mt-2">
                              <div className="flex items-center justify-between text-xs font-black mb-1">
                                <span className="text-slate-500">匹配置信度:</span>
                                <span className={`font-mono text-sm font-black ${
                                  isHighConfidence ? 'text-[#2D6613]' : isMediumConfidence ? 'text-[#854D0E]' : 'text-rose-600'
                                }`}>
                                  {confidencePercentage}%
                                </span>
                              </div>
                              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden p-0.5">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    isHighConfidence ? 'bg-[#95D151]' : isMediumConfidence ? 'bg-[#FEE061]' : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, scoreNum * 100))}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Candidates Grid */}
                      {candidatesList.length > 1 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                              <Award className="w-3.5 h-3.5 text-amber-500" />
                              <span>Top-{candidatesList.length} 候选比对 (点击切换)</span>
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {candidatesList.map((cand, idx) => {
                              const isCandSelected = idx === selectedCandidateIndex;
                              const candEncountered = isEncountered(targetMap.id, cand.filename) ||
                                (cand.matchedPet ? isEncountered(targetMap.id, cand.matchedPet.name) : false);

                              return (
                                <div
                                  key={`${cand.filename}_${idx}`}
                                  onClick={() => {
                                    sound.playClick();
                                    setSelectedCandidateIndex(idx);
                                  }}
                                  className={`p-2 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between ${
                                    isCandSelected
                                      ? 'bg-[#F4FDF0] border-[#95D151] shadow-xs'
                                      : 'bg-white border-[#E2E8F0] hover:border-[#95D151]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className="text-[10px] font-black text-slate-600">#{idx + 1}</span>
                                    <span className="font-mono text-[11px] font-black text-slate-700">
                                      {(cand.score * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <img
                                      src={cand.view_url || cand.matchedPet?.url}
                                      alt={cand.filename}
                                      className="w-8 h-8 rounded-lg object-contain bg-[#F5F9FF] border border-[#E2E8F0] p-0.5 shrink-0"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-black text-slate-800 truncate">
                                        {formatPetName(cand.matchedPet?.name || cand.filename)}
                                      </p>
                                      <p className="text-[10px] text-slate-400 truncate">
                                        {candEncountered ? '已在图鉴' : '未遇见'}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : predictError ? (
                    <div className="py-10 text-center text-rose-600 flex flex-col items-center">
                      <AlertCircle className="w-10 h-10 mb-2 text-rose-500" />
                      <p className="text-sm font-black">{predictError}</p>
                    </div>
                  ) : (
                    <div className="py-14 text-center text-slate-400 flex flex-col items-center">
                      <div className="w-12 h-12 rounded-2xl bg-white border-2 border-[#E6EEF8] flex items-center justify-center text-slate-300 mb-2 shadow-2xs">
                        <Sparkles className="w-6 h-6 text-[#95D151]" />
                      </div>
                      <p className="text-xs font-black text-slate-600">等待上传精灵截图</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        支持截图后在任意位置 Ctrl+V 直接粘贴识别
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-5 pt-3.5 border-t-2 border-[#E6EEF8] grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    disabled={!activeCandidate}
                    onClick={() => handleConfirmEncounter()}
                    className="py-3 px-3 roco-btn-success flex items-center justify-center gap-1.5 text-xs sm:text-sm font-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {currentPetAlreadyEncountered
                        ? `【已遇过 · 更新 #${selectedCandidateIndex + 1}】`
                        : `【点亮图鉴 · 遇见 #${selectedCandidateIndex + 1}】`}
                    </span>
                  </button>

                  <button
                    onClick={handleManualSelect}
                    className="py-3 px-3 roco-btn-yellow flex items-center justify-center gap-1.5 text-xs sm:text-sm font-black cursor-pointer"
                  >
                    <HelpCircle className="w-4 h-4 text-[#854D0E]" />
                    <span>【识别不准、我自己选择】</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
