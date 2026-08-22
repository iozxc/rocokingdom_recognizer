import React, { useState, useRef, useEffect } from 'react';
import {
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
import { MapConfig, PetItem, PredictResult, PredictCandidateItem } from '../types';
import { api } from '../services/api';
import { sound } from '../services/sound';
import { storage } from '../services/storage';
import { formatPetName } from '../utils/petHelper';
import { RecognitionSamplesHint } from './RecognitionSamplesHint';

interface ImageRecognizerProps {
  currentMap: MapConfig;
  availablePets: PetItem[];
  onEncounterSuccess: (mapId: string, filename: string, note?: string) => void;
  onOpenManualSelect: (predictResult: PredictResult | null) => void;
  onOpenBatchInit?: () => void;
  isEncountered: (mapId: string, filename: string) => boolean;
}

export const ImageRecognizer: React.FC<ImageRecognizerProps> = ({
                                                                  currentMap,
                                                                  availablePets,
                                                                  onEncounterSuccess,
                                                                  onOpenManualSelect,
                                                                  onOpenBatchInit,
                                                                  isEncountered,
                                                                }) => {
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

  // Clipboard paste listener
  useEffect(() => {
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
  }, [currentMap.num]);

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

  // Clear current image and prediction
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
        // Convert preview SVG or dataUrl to blob
        const res = await fetch(previewUrl);
        fileToSend = await res.blob();
      } else {
        throw new Error('未选择图片');
      }

      const { result } = await api.predictPet(fileToSend, currentMap.num, threshold, topK);

      // Enhance all candidates with local pet details if available
      if (result.candidates && result.candidates.length > 0) {
        result.candidates = result.candidates.map((cand) => {
          const localMatched = availablePets.find((p) => p.name === cand.filename);
          if (localMatched) {
            return { ...cand, matchedPet: localMatched };
          }
          return cand;
        });
      }

      // Enhance top match
      const localTop = availablePets.find((p) => p.name === result.filename);
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

  // Active candidate derived from user selection or top result
  const candidatesList: PredictCandidateItem[] = prediction?.candidates || (prediction ? [{
    filename: prediction.filename,
    score: prediction.score,
    view_url: prediction.view_url,
    match_path: prediction.match_path,
    matchedPet: prediction.matchedPet,
  }] : []);

  const activeCandidate: PredictCandidateItem | null = candidatesList[selectedCandidateIndex] || candidatesList[0] || null;

  // User confirms "遇见" for a specific candidate
  const handleConfirmEncounter = (candidateToEncounter?: PredictCandidateItem) => {
    const target = candidateToEncounter || activeCandidate;
    if (!target) return;

    sound.playEncounter();

    // 特效已移至 ScannerApp 的"点亮图鉴"按钮，此处不再触发

    onEncounterSuccess(
        currentMap.id,
        target.filename,
        `通过AI识别遇见 (置信度: ${(target.score * 100).toFixed(1)}%)`
    );

    // Reset recognizer state after confirmation
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

  // User chooses "识别不准、我自己选择"
  const handleManualSelect = () => {
    sound.playClick();
    onOpenManualSelect(prediction);
  };

  const confidencePercentage = activeCandidate ? (activeCandidate.score * 100).toFixed(1) : '0.0';
  const scoreNum = activeCandidate ? activeCandidate.score : 0;
  const isHighConfidence = scoreNum >= 0.85;
  const isMediumConfidence = scoreNum >= threshold && scoreNum < 0.85;

  const currentPetAlreadyEncountered = activeCandidate
      ? isEncountered(currentMap.id, activeCandidate.filename) ||
      (activeCandidate.matchedPet ? isEncountered(currentMap.id, activeCandidate.matchedPet.name) : false)
      : false;

  return (
      <div className="bg-white roco-card p-5 sm:p-6 mb-5">
        {/* Section Title & Toolbar */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b-2 border-[#F1F5F9] flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#7ABCF4] text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">
                  精灵图鉴智能识别
                </h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#EBF4FE] text-[#2B78C4] border border-[#BCD7F2] font-black">
                Top-{topK} 候选分析 (最多6个)
              </span>
              </div>
              <p className="text-xs text-slate-500">
                上传游戏截图或精灵截取图像，智能匹配【{currentMap.name}】中的对应精灵
              </p>
            </div>
          </div>

          {/* Action Toolbar: Top-K Selector, Batch Init & Settings */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Top-K Quick Switcher (Supports 1 to 6) */}
            <div className="flex items-center gap-1 bg-[#F5F9FF] border border-[#D5E2F0] p-1 rounded-xl">
            <span className="text-[11px] font-black text-slate-500 px-1.5 hidden sm:inline">
              候选数:
            </span>
              {[1, 2, 3, 4, 5, 6].map((k) => {
                const isSelected = topK === k;
                return (
                    <button
                        key={k}
                        type="button"
                        onClick={() => handleTopKChange(k)}
                        className={`px-2 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                            isSelected
                                ? 'bg-[#7ABCF4] text-white shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                        }`}
                        title={`识别返回前 ${k} 个最高置信度候选结果`}
                    >
                      Top-{k}
                    </button>
                );
              })}
            </div>

            {(selectedFile || previewUrl || prediction || predictError) && (
                <button
                    id="clear-recognizer-btn"
                    onClick={handleClear}
                    className="text-xs font-black text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                    title="清空当前上传图片与识别结果"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>清空</span>
                </button>
            )}

            {onOpenBatchInit && (
                <button
                    id="recognizer-batch-init-btn"
                    onClick={() => {
                      sound.playClick();
                      onOpenBatchInit();
                    }}
                    className="text-xs font-black text-[#854D0E] bg-[#FEF9E6] hover:bg-[#FEE061] border border-[#E5C43B] px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-[#854D0E]" />
                  <span>整页截图批量识别</span>
                </button>
            )}

            <button
                id="toggle-threshold-btn"
                onClick={() => {
                  sound.playClick();
                  setShowThresholdSettings(!showThresholdSettings);
                }}
                className="text-xs font-black text-[#2B78C4] hover:text-[#1D5E9E] bg-[#F5F9FF] hover:bg-[#EBF4FE] border border-[#D5E2F0] px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-[#7ABCF4]" />
              设置 (阈值 {threshold})
            </button>
          </div>
        </div>

        {/* Collapsible Settings Panel */}
        {showThresholdSettings && (
            <div className="mt-3 p-4 bg-[#F5F9FF] rounded-2xl border-2 border-[#E6EEF8] text-xs text-slate-700 space-y-3 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#7ABCF4]" />
                  <span className="font-black">置信度过滤阈值:</span>
                  <span className="font-mono font-black text-[#2B78C4] text-sm">{threshold}</span>
                  <span className="text-slate-500">(低于此置信度的匹配将被标注为低置信推荐)</span>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-48">
                  <span className="text-xs text-slate-400 font-bold">0.1</span>
                  <input
                      type="range"
                      id="threshold-slider"
                      min="0.1"
                      max="0.99"
                      step="0.05"
                      value={threshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setThreshold(val);
                        storage.setThreshold('predict_threshold', val);
                      }}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#7ABCF4]"
                  />
                  <span className="text-xs text-slate-400 font-bold">0.99</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2.5 border-t border-[#E2E8F0]">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  <span className="font-black">返回候选精灵数量 (Top-K):</span>
                  <span className="font-mono font-black text-amber-600 text-sm">最多 {topK} 个 (最高支持6个)</span>
                  <span className="text-slate-500">(每次识别输出置信度前 {topK} 名候选以供精选)</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 2, 3, 4, 5, 6].map((k) => (
                      <button
                          key={k}
                          type="button"
                          onClick={() => handleTopKChange(k)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-black cursor-pointer border ${
                              topK === k
                                  ? 'bg-amber-400 text-amber-950 border-amber-500 shadow-2xs font-bold'
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                          }`}
                      >
                        {k} 个
                      </button>
                  ))}
                </div>
              </div>
            </div>
        )}

        {/* Main Grid: Upload Area on Left (Natural Height/Sticky), Prediction Result on Right */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Upload & Input Card (5 Cols, Independent Height, Sticky on desktop) */}
          <div className="lg:col-span-5 flex flex-col gap-3 lg:sticky lg:top-4">
            <div className="rounded-3xl border-2 border-[#E6EEF8] bg-[#F8FAFC] p-4 flex flex-col gap-3 shadow-xs">
              {/* Header label for upload box */}
              <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                <UploadCloud className="w-4 h-4 text-[#7ABCF4]" />
                待识别精灵图片
              </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">
                    支持 Ctrl+V 粘贴
                  </span>
                  <RecognitionSamplesHint onLoadSample={handleFileSelected} />
                </div>
              </div>

              {/* Dropzone with controlled compact height */}
              <div
                  id="image-dropzone"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative border-3 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center min-h-[170px] ${
                      isDragOver
                          ? 'border-[#7ABCF4] bg-[#EBF4FE] scale-[1.01]'
                          : previewUrl
                              ? 'border-[#7ABCF4] bg-[#F5F9FF]'
                              : 'border-[#BCD7F2] bg-white hover:bg-[#F5F9FF] hover:border-[#7ABCF4]'
                  }`}
              >
                <input
                    type="file"
                    id="image-file-input"
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
                          id="remove-image-corner-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClear();
                          }}
                          className="absolute -top-2 -right-2 z-10 w-7 h-7 rounded-full bg-white hover:bg-rose-500 hover:text-white text-slate-500 border-2 border-slate-200 hover:border-rose-600 flex items-center justify-center transition-all shadow-md cursor-pointer"
                          title="移除当前图片"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="relative w-28 h-28 rounded-2xl overflow-hidden bg-white shadow-sm border-2 border-[#7ABCF4] p-1.5 flex items-center justify-center">
                        <img
                            src={previewUrl}
                            alt="待识别精灵"
                            className="w-full h-full object-contain"
                        />
                        {/* Scan Animation when predicting */}
                        {isPredicting && <div className="magic-scan-line" />}
                      </div>
                      <div className="text-center w-full px-2">
                        <p className="text-xs font-black text-slate-800 truncate">
                          {selectedFile ? selectedFile.name : '已载入精灵图片'}
                        </p>
                        <p className="text-[11px] text-[#7ABCF4] font-bold hover:underline mt-0.5">
                          点击重新上传或更换图片
                        </p>
                      </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-4">
                      <div className="w-12 h-12 rounded-2xl bg-[#F0F7FF] text-[#7ABCF4] flex items-center justify-center shadow-xs border border-[#E6EEF8]">
                        <UploadCloud className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm font-black text-slate-700">
                          点击或拖拽上传精灵截图
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                          PNG / JPG · 支持截图后 Ctrl+V 直接粘贴
                        </p>
                      </div>
                    </div>
                )}
              </div>

              {/* Predict & Clear Action Buttons */}
              <div className="flex items-center gap-2">
                {(selectedFile || previewUrl || prediction || predictError) && (
                    <button
                        type="button"
                        id="reset-image-btn"
                        onClick={handleClear}
                        className="py-2.5 px-3 rounded-xl border-2 border-[#CBD5E1] bg-white hover:bg-slate-50 text-slate-600 hover:text-rose-600 hover:border-rose-200 text-xs font-black transition-all flex items-center justify-center gap-1 shadow-2xs shrink-0 cursor-pointer"
                        title="清空当前图片与结果"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>清空</span>
                    </button>
                )}

                <button
                    id="start-predict-btn"
                    disabled={(!selectedFile && !previewUrl) || isPredicting}
                    onClick={executePrediction}
                    className={`w-full py-2.5 px-4 roco-btn-primary flex items-center justify-center gap-2 text-xs sm:text-sm font-black disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
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
                        <Sparkles className="w-4 h-4 text-[#FEE061]" />
                        <span>开始识别 (Top-{topK} 候选)</span>
                      </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Guidance Info Strip on the left to keep left sidebar balanced & informative */}
            <div className="p-3 bg-[#F5F9FF] rounded-2xl border border-[#D5E2F0] text-[11px] text-slate-600 space-y-1.5">
              <div className="flex items-center gap-1.5 font-black text-[#2B78C4]">
                <Info className="w-3.5 h-3.5 text-[#7ABCF4]" />
                <span>使用小技巧</span>
              </div>
              <ul className="space-y-1 text-slate-500 pl-1 list-disc list-inside">
                <li>截图后无需保存，直接在页面按 <strong className="text-slate-700">Ctrl+V</strong> 即可粘贴</li>
                <li>识别返回前 <strong className="text-slate-700">{topK} 个可能候选</strong>，点击右侧卡片可随时切换</li>
                <li>如需一键录入多只精灵，可点击上方 <strong className="text-slate-700">【整页截图批量识别】</strong></li>
              </ul>
            </div>
          </div>

          {/* Right Column: Prediction Results & Top-K Candidates Panel (7 Cols) */}
          <div className="lg:col-span-7 flex flex-col">
            <div className="rounded-3xl border-3 border-[#E6EEF8] bg-[#FDF9F3] p-5 flex flex-col justify-between shadow-xs">
              <div>
                {/* Results Pane Header */}
                <div className="flex items-center justify-between pb-3 border-b-2 border-[#E6EEF8] gap-2 flex-wrap">
                <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                  <Compass className="w-4 h-4 text-[#7ABCF4]" />
                  图鉴匹配结果 {candidatesList.length > 0 && `(共 ${candidatesList.length} 个候选)`}
                </span>

                  {activeCandidate && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Previously Encountered Status Tag */}
                        {currentPetAlreadyEncountered ? (
                            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-lg border-2 bg-[#E1F7DB] text-[#2D6613] border-[#95D151] flex items-center gap-1 shadow-2xs">
                        <Check className="w-3 h-3 stroke-[3]" />
                        此前已遇过
                      </span>
                        ) : (
                            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-lg border-2 bg-amber-100 text-amber-900 border-amber-300 flex items-center gap-1 shadow-2xs">
                        <Sparkle className="w-3 h-3 text-amber-600" />
                        未遇见 (新)
                      </span>
                        )}

                        {/* Confidence Score Tag */}
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

                {/* Status or Result Contents */}
                {isPredicting ? (
                    <div className="py-14 flex flex-col items-center justify-center text-center">
                      <div className="relative w-14 h-14 rounded-full border-4 border-slate-200 border-t-[#7ABCF4] animate-spin mb-3" />
                      <p className="text-sm font-black text-slate-700">正在智能分析精灵特征...</p>
                      <p className="text-xs text-slate-400 mt-1">
                        正在比对【{currentMap.name}】并计算前 {topK} 个高置信度候选
                      </p>
                    </div>
                ) : activeCandidate ? (
                    <div className="mt-3.5 space-y-3.5">
                      {/* Spotlight Candidate Card */}
                      <div className={`p-4 bg-white rounded-2xl border-2 shadow-xs transition-all ${
                          currentPetAlreadyEncountered
                              ? 'border-[#95D151]/50 bg-gradient-to-r from-white to-[#F9FEF8]'
                              : 'border-[#BCD7F2] bg-gradient-to-r from-white to-[#FFFDF5]'
                      }`}>
                        <div className="flex items-center gap-4">
                          {/* Pet Image with Encounter Status Badging */}
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
                            {/* Rank Badge + Name + Status Pill */}
                            <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                              selectedCandidateIndex === 0
                                  ? 'bg-amber-400 text-amber-950 border border-amber-500'
                                  : 'bg-slate-100 text-slate-700 border border-slate-300'
                          }`}>
                            #{selectedCandidateIndex + 1} {selectedCandidateIndex === 0 ? '最佳推荐' : '备选候选'}
                          </span>
                              <h4 className="text-base font-black text-slate-800 truncate" title={formatPetName(activeCandidate.matchedPet?.name || activeCandidate.filename)}>
                                {formatPetName(activeCandidate.matchedPet?.name || activeCandidate.filename)}
                              </h4>
                              {currentPetAlreadyEncountered ? (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#E1F7DB] text-[#2D6613] border border-[#95D151] flex items-center gap-1">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                              已在图鉴
                            </span>
                              ) : (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FEF9E6] text-[#854D0E] border border-[#FEE061] flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5 text-amber-600" />
                              未遇见新精灵
                            </span>
                              )}
                            </div>

                            {/* Confidence Score Bar */}
                            <div className="mt-2">
                              <div className="flex items-center justify-between text-xs font-black mb-1">
                                <span className="text-slate-500">匹配置信度:</span>
                                <span
                                    className={`font-mono text-sm font-black ${
                                        isHighConfidence
                                            ? 'text-[#629626]'
                                            : isMediumConfidence
                                                ? 'text-[#854D0E]'
                                                : 'text-rose-600'
                                    }`}
                                >
                              {confidencePercentage}%
                            </span>
                              </div>
                              <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden p-0.5">
                                <div
                                    className={`h-full rounded-full transition-all duration-500 ${
                                        isHighConfidence
                                            ? 'bg-[#95D151]'
                                            : isMediumConfidence
                                                ? 'bg-[#FEE061]'
                                                : 'bg-rose-500'
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(0, scoreNum * 100))}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Historical Encounter Status Banner */}
                        <div className={`mt-3 p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs font-bold ${
                            currentPetAlreadyEncountered
                                ? 'bg-[#F2FBF0] border-[#95D151]/60 text-[#2D6613]'
                                : 'bg-[#FFFBEB] border-amber-300 text-amber-900'
                        }`}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            {currentPetAlreadyEncountered ? (
                                <>
                                  <CheckCircle2 className="w-4 h-4 text-[#2D6613] shrink-0" />
                                  <span className="truncate">历史图鉴：该精灵此前<strong>已在当前地图遇见点亮</strong></span>
                                </>
                            ) : (
                                <>
                                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                                  <span className="truncate">历史图鉴：<strong>尚未遇过此精灵！</strong>点击下方【遇见】即可点亮</span>
                                </>
                            )}
                          </div>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border shrink-0 ${
                              currentPetAlreadyEncountered
                                  ? 'bg-white text-[#2D6613] border-[#95D151]'
                                  : 'bg-white text-amber-800 border-amber-300'
                          }`}>
                        {currentPetAlreadyEncountered ? '已收录' : '未收录'}
                      </span>
                        </div>
                      </div>

                      {/* Multi-Candidate Grid / Selector (Shown when > 1 candidates returned, cleanly supporting up to 6 items) */}
                      {candidatesList.length > 1 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                          <Award className="w-3.5 h-3.5 text-amber-500" />
                          <span>Top-{candidatesList.length} 候选比对 (点击卡片切换聚焦)</span>
                        </span>
                              <span className="text-[11px] text-slate-500 font-medium">
                          支持一键直接选择或点亮
                        </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                              {candidatesList.map((cand, idx) => {
                                const isCandSelected = idx === selectedCandidateIndex;
                                const candEncountered = isEncountered(currentMap.id, cand.filename) ||
                                    (cand.matchedPet ? isEncountered(currentMap.id, cand.matchedPet.name) : false);
                                const candPct = (cand.score * 100).toFixed(1);

                                return (
                                    <div
                                        key={`${cand.filename}_${idx}`}
                                        onClick={() => {
                                          sound.playClick();
                                          setSelectedCandidateIndex(idx);
                                        }}
                                        className={`relative p-2.5 rounded-xl border-2 transition-all cursor-pointer text-left flex flex-col justify-between ${
                                            isCandSelected
                                                ? 'bg-[#EBF4FE] border-[#7ABCF4] shadow-sm ring-2 ring-[#7ABCF4]/40'
                                                : 'bg-white border-[#E2E8F0] hover:border-[#7ABCF4] hover:bg-[#F9FBFE]'
                                        }`}
                                    >
                                      {/* Top Bar: Rank + Score */}
                                      <div className="flex items-center justify-between gap-1 mb-1">
                                <span className={`text-[10px] font-black px-1.5 py-0.2 rounded ${
                                    idx === 0
                                        ? 'bg-amber-400 text-amber-950 font-bold'
                                        : 'bg-slate-100 text-slate-600'
                                }`}>
                                  #{idx + 1}
                                </span>
                                        <span className="font-mono text-[11px] font-black text-slate-700">
                                  {candPct}%
                                </span>
                                      </div>

                                      {/* Confidence Progress Bar */}
                                      <div className="w-full h-1.5 bg-slate-200/90 rounded-full overflow-hidden mb-2 p-[1px]">
                                        <div
                                            className={`h-full rounded-full transition-all duration-300 ${
                                                cand.score >= 0.8
                                                    ? 'bg-[#95D151]'
                                                    : cand.score >= 0.5
                                                        ? 'bg-[#FEE061]'
                                                        : 'bg-rose-400'
                                            }`}
                                            style={{ width: `${Math.min(100, Math.max(0, cand.score * 100))}%` }}
                                        />
                                      </div>

                                      {/* Center: Image & Name */}
                                      <div className="flex items-center gap-2">
                                        <div className="relative w-10 h-10 rounded-lg bg-[#F5F9FF] border border-[#E2E8F0] p-0.5 flex items-center justify-center shrink-0">
                                          <img
                                              src={cand.view_url || cand.matchedPet?.url}
                                              alt={cand.filename}
                                              className="w-full h-full object-contain"
                                              onError={(e) => {
                                                if (cand.matchedPet?.url) {
                                                  (e.target as HTMLImageElement).src = cand.matchedPet.url;
                                                }
                                              }}
                                          />
                                          {candEncountered && (
                                              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#95D151] border border-white flex items-center justify-center">
                                                <Check className="w-2.5 h-2.5 text-white stroke-[3.5]" />
                                              </div>
                                          )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <p className="text-xs font-black text-slate-800 truncate" title={formatPetName(cand.matchedPet?.name || cand.filename)}>
                                            {formatPetName(cand.matchedPet?.name || cand.filename)}
                                          </p>
                                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                            {candEncountered ? '已在图鉴' : '✨ 未遇见'}
                                          </p>
                                        </div>
                                      </div>

                                      {/* Active selection dot */}
                                      {isCandSelected && (
                                          <div className="mt-1.5 pt-1 border-t border-[#BCD7F2] text-[10px] font-black text-[#2B78C4] flex items-center justify-between">
                                            <span>当前选中</span>
                                            <Check className="w-3 h-3 stroke-[3]" />
                                          </div>
                                      )}
                                    </div>
                                );
                              })}
                            </div>
                          </div>
                      )}

                      {/* Just Encountered Success Notice */}
                      {justEncountered && (
                          <div className="p-3 bg-[#F2FBF0] border-2 border-[#95D151] rounded-2xl flex items-center gap-2 text-xs font-black text-[#2D6613]">
                            <CheckCircle2 className="w-4 h-4 text-[#95D151] shrink-0" />
                            <span>太棒了！已在本地图鉴中点亮【{formatPetName(activeCandidate.matchedPet?.name || activeCandidate.filename)}】！</span>
                          </div>
                      )}
                    </div>
                ) : predictError ? (
                    <div className="py-10 text-center text-rose-600 flex flex-col items-center">
                      <AlertCircle className="w-10 h-10 mb-2 text-rose-500" />
                      <p className="text-sm font-black">{predictError}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        您可以点击下方【识别不准、我自己选择】直接在地图精灵列表中手动挑选
                      </p>
                    </div>
                ) : (
                    <div className="py-14 text-center text-slate-400 flex flex-col items-center">
                      <div className="w-12 h-12 rounded-2xl bg-white border-2 border-[#E6EEF8] flex items-center justify-center text-slate-300 mb-2 shadow-2xs">
                        <Sparkles className="w-6 h-6 text-[#7ABCF4]" />
                      </div>
                      <p className="text-xs font-black text-slate-600">等待上传并识别精灵截图</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 max-w-sm">
                        支持自选 Top-K 候选（最多6个），识别后可直接点选候选或切换【遇见】录入
                      </p>
                    </div>
                )}
              </div>

              {/* Crucial Required Action Buttons */}
              <div className="mt-5 pt-3.5 border-t-2 border-[#E6EEF8] grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Button 1: 【遇见】 */}
                <button
                    id="confirm-encounter-btn"
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
                  {activeCandidate && (
                      <span className="opacity-95 font-mono text-xs">({confidencePercentage}%)</span>
                  )}
                </button>

                {/* Button 2: 【识别不准、我自己选择】 */}
                <button
                    id="manual-select-btn"
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
  );
};
