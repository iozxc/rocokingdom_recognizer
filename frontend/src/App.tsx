import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { SubHeaderToolbar } from './components/SubHeaderToolbar';
import { StatsBanner } from './components/StatsBanner';
import { BatchRecognizerCard } from './components/BatchRecognizerCard';
import { SinglePetRecognizerModal } from './components/SinglePetRecognizerModal';
import { PetGrid } from './components/PetGrid';
import { PetDetailModal } from './components/PetDetailModal';
import { ManualSelectModal } from './components/ManualSelectModal';
import { BatchInitModal } from './components/BatchInitModal';
import { GlobalFloatingSearch } from './components/GlobalFloatingSearch';
import { FloatingFilterSwitch } from './components/FloatingFilterSwitch';
import { FeedbackContactModal } from './components/FeedbackContactModal';
import { UpdateModal } from './components/UpdateModal';
import { DataUpdateModal } from './components/DataUpdateModal';
import { AppSettingsModal } from './components/AppSettingsModal';
import { AssistantHub } from './components/AssistantHub';
import { SyncPopNotification, SyncPopType } from './components/SyncPopNotification';
import { AuthBadge } from './components/AuthBadge';
import { useFeatureLock } from './services/auth';
import { showFeatureLockNotice } from './services/featureLock';
import { FireBadgeTrial } from './components/Trial/FireBadgeTrial';
import { MapAwareness } from './components/Tool/MapAwareness';
import { MAP_CONFIGS } from './data/mockPets';
import { resolveTrialMaps } from './data/trials';
import { api } from './services/api';
import { storage } from './services/storage';
import { getFireTrialPetsCached, invalidateFireTrialData } from './services/fireTrialData';
import { sound } from './services/sound';
import { updateStore } from './services/updateStore';
import { fireEncounterConfetti, fireUnencounterEffect } from './services/effect';
import { MapConfig, PetItem, PredictResult, EncounterRecord, EffectLevel, FloatingButtonsMode, Trial, AdvancedFilterState } from './types';
import { isPetEncounteredInRecords } from './utils/petHelper';

export default function App() {
  const [activeMapNum, setActiveMapNum] = useState<number>(1);
  const [mapsData, setMapsData] = useState<Record<string, { count: number; items: PetItem[] }>>({});
  const [records, setRecords] = useState<Record<string, EncounterRecord>>({});
  const [filterMode, setFilterMode] = useState<'all' | 'encountered' | 'unencountered'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>({
    elements: [],
    specialTypes: [],
  });
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isSoundMuted', sound.getMuted());
  });
  const [isFeedbackOpen, setIsFeedbackOpen] = useState<boolean>(false);
  const [detailPet, setDetailPet] = useState<PetItem | null>(null);
  const [feedbackInitialType, setFeedbackInitialType] = useState<string>('');
  const [isUpdateOpen, setIsUpdateOpen] = useState<boolean>(false);
  const [isDataUpdateOpen, setIsDataUpdateOpen] = useState<boolean>(false);
  const [dataUpdateAvailable, setDataUpdateAvailable] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [view, setView] = useState<'assistant' | 'hub'>('assistant');
  const [trials, setTrials] = useState<Trial[]>([
    { key: 'grass', title: '草系徽章试炼', element: 'grass', collection_key: 'encounteredPets', dev_only: false },
  ]);
  const [activeTrialKey, setActiveTrialKey] = useState<'grass' | 'fire' | 'map'>('grass');
  const activeTrialMaps = useMemo(() => resolveTrialMaps(trials, activeTrialKey), [trials, activeTrialKey]);

  const [effectLevel, setEffectLevel] = useState<EffectLevel>(() => {
    return storage.getSetting<EffectLevel>('effectLevel', 0);
  });
  const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
    return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
  });

  // Modal States
  const [isSingleRecognizerOpen, setIsSingleRecognizerOpen] = useState<boolean>(false);
  const [isBatchInitOpen, setIsBatchInitOpen] = useState<boolean>(false);
  const [isManualSelectOpen, setIsManualSelectOpen] = useState<boolean>(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState<boolean>(false);
  const [predictResultForManual, setPredictResultForManual] = useState<PredictResult | null>(null);
  const [recognizerKey, setRecognizerKey] = useState<number>(0);
  const [activeEffectLevel, setActiveEffectLevel] = useState<EffectLevel>(0);
  const [syncPopState, setSyncPopState] = useState<{
    isVisible: boolean;
    message: string;
    subMessage?: string;
    type: SyncPopType;
  }>({
    isVisible: false,
    message: '图鉴已同步',
    type: 'encounter',
  });
  const syncPopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 未授权时锁定“识别”相关功能：点击弹“请授权，解锁更多功能”，不执行。
  const { locked } = useFeatureLock();
  const guardRecognition = useCallback((action: () => void) => {
    if (locked) {
      showFeatureLockNotice();
      return;
    }
    action();
  }, [locked]);

  // Trigger celebration confetti & sleek pop notification
  const triggerScanSyncEffect = useCallback(
      (
          type: SyncPopType = 'encounter',
          customLevel?: EffectLevel,
          customMessage?: string,
          customSub?: string
      ) => {
        const levelToUse =
            typeof customLevel === 'number'
                ? customLevel
                : storage.getSetting<EffectLevel>('effectLevel', 0);
        setActiveEffectLevel(levelToUse);

        if (type === 'encounter') {
          fireEncounterConfetti(levelToUse);
        } else if (type === 'unencounter') {
          fireUnencounterEffect(levelToUse);
        }

        // Pop brief feedback badge
        setSyncPopState({
          isVisible: true,
          type,
          message:
              customMessage ||
              (type === 'encounter' ? '已记录为已遇见' : '已恢复为未遇见'),
          subMessage: customSub,
        });

        if (syncPopTimerRef.current) {
          clearTimeout(syncPopTimerRef.current);
        }
        syncPopTimerRef.current = setTimeout(() => {
          setSyncPopState((prev) => ({ ...prev, isVisible: false }));
          syncPopTimerRef.current = null;
        }, 2200);
      },
      []
  );

  // Load encounter records from local/backend storage
  const refreshRecords = useCallback(() => {
    setRecords(storage.getAll());
  }, []);

  // Fetch pet icons silently
  const fetchIconsData = useCallback(async () => {
    const iconsRes = await api.getIcons();
    setMapsData(iconsRes.data);
  }, []);

  useEffect(() => {
    refreshRecords();
    fetchIconsData();
    updateStore.init();

    // 拉取后端可见的试炼列表（火系仅开发环境返回）
    api.getTrials().then((res) => {
      if (Array.isArray(res.trials)) {
        setTrials(res.trials);
      }
    });
    // 预热火系全图鉴，进入火系试炼时不闪加载页
    getFireTrialPetsCached().catch(() => {});
    // 启动时异步检测图鉴数据是否需要更新（不阻塞界面）
    api.checkDataUpdates()
        .then((res) => setDataUpdateAvailable(res.has_update))
        .catch(() => {});

    // 订阅 storage 变更（当从 Flask 后端加载完成时自动更新 UI）
    const unsubscribeRecords = storage.subscribe((newRecords) => {
      setRecords(newRecords);
    });

    const unsubscribeSettings = storage.subscribeSettings((newSettings) => {
      if (typeof newSettings.isSoundMuted === 'boolean') {
        setIsSoundMuted(newSettings.isSoundMuted);
      }
      if (typeof newSettings.effectLevel === 'number') {
        setEffectLevel(newSettings.effectLevel);
      }
      if (newSettings.floatingButtonsMode) {
        setFloatingMode(newSettings.floatingButtonsMode);
      }
      if (typeof newSettings.activeMapNum === 'number' && [1, 2, 3].includes(newSettings.activeMapNum)) {
        setActiveMapNum(newSettings.activeMapNum);
        // activeMapNum 变化不再触发特效，避免扫描识别后弹出特效
      }
    });

    // 监听跨窗口/标签页的通信（BroadcastChannel, window.message, window.storage）
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SWITCH_MAP' && event.data?.mapNum) {
        const num = Number(event.data.mapNum);
        if ([1, 2, 3].includes(num)) {
          setActiveMapNum(num);
          // SWITCH_MAP 不再触发特效，避免扫描识别后弹出特效
        }
      }
      if (event.data?.type === 'SCAN_TRIGGERED') {
        // 立即识别不再触发特效，特效已移至点亮图鉴按钮
      }
    };
    window.addEventListener('message', handleMessage);

    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key === 'roco_active_map_num' && event.newValue) {
        const num = Number(event.newValue);
        if ([1, 2, 3].includes(num)) {
          setActiveMapNum(num);
          // SWITCH_MAP 不再触发特效，避免扫描识别后弹出特效
        }
      }
      if (event.key === 'roco_scan_trigger') {
        // 立即识别不再触发特效，特效已移至点亮图鉴按钮
      }
    };
    window.addEventListener('storage', handleStorageEvent);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('roco_channel');
      bc.onmessage = (event) => {
        if (event.data?.type === 'SWITCH_MAP' && event.data?.mapNum) {
          const num = Number(event.data.mapNum);
          if ([1, 2, 3].includes(num)) {
            setActiveMapNum(num);
            // SWITCH_MAP 不再触发特效，避免扫描识别后弹出特效
          }
        }
        if (event.data?.type === 'SCAN_TRIGGERED') {
          // 立即识别不再触发特效，特效已移至点亮图鉴按钮
        }
      };
    }

    return () => {
      unsubscribeRecords();
      unsubscribeSettings();
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorageEvent);
      if (bc) {
        bc.close();
      }
    };
  }, [refreshRecords, fetchIconsData, triggerScanSyncEffect]);

  // Current Map configuration
  const currentMap: MapConfig = useMemo(() => {
    return MAP_CONFIGS.find((m) => m.num === activeMapNum) || MAP_CONFIGS[0];
  }, [activeMapNum]);

  // Current Map pets
  const currentMapPets: PetItem[] = useMemo(() => {
    const mapKey = `map${activeMapNum}`;
    return mapsData[mapKey]?.items || [];
  }, [activeMapNum, mapsData]);

  // Total count of pets across all 3 maps
  const totalAllPetsCount = useMemo(() => {
    let total = 0;
    activeTrialMaps.forEach((m) => {
      const k = m.id;
      const items = mapsData[k]?.items || [];
      total += items.length;
    });
    return total;
  }, [mapsData, activeTrialMaps]);

  // Total encountered pets count across all maps
  const totalEncounteredCount = useMemo(() => {
    let total = 0;
    activeTrialMaps.forEach((m) => {
      const k = m.id;
      const items = mapsData[k]?.items || [];
      total += items.filter((p) => isPetEncounteredInRecords(records, k, p.name)).length;
    });
    return total;
  }, [mapsData, records, activeTrialMaps]);

  // Per-map stats for 3 maps
  const allMapsStats = useMemo(() => {
    return MAP_CONFIGS.map((map) => {
      const list = mapsData[map.id]?.items || [];
      const stats = storage.getMapStats(map.id, list.length, list);
      return {
        num: map.num,
        id: map.id,
        name: map.name.replace('记忆中的', ''),
        encountered: stats.encounteredCount,
        total: list.length,
      };
    });
  }, [mapsData, records]);

  // Current map stats
  const currentMapStats = useMemo(() => {
    return storage.getMapStats(currentMap.id, currentMapPets.length, currentMapPets);
  }, [currentMap.id, currentMapPets, records]);

  // Check if a specific pet is encountered
  const isPetEncountered = useCallback(
      (mapId: string, filename: string) => {
        return isPetEncounteredInRecords(records, mapId, filename);
      },
      [records]
  );

  // Handle Encounter Success (via Image Recognition or Manual Confirmation)
  const handleEncounterSuccess = (mapId: string, filename: string, note?: string) => {
    const isAlreadyEnc = isPetEncountered(mapId, filename);
    storage.markEncountered(mapId, filename, note);
    refreshRecords();
    setRecognizerKey((prev) => prev + 1);
    if (!isAlreadyEnc) {
      sound.playEncounter();
      triggerScanSyncEffect('encounter', undefined, '图鉴已成功点亮');
    }
  };

  // Toggle Encounter (from grid click)
  const handleToggleEncounter = (mapId: string, filename: string) => {
    const isCurrentlyEncountered = isPetEncountered(mapId, filename);
    storage.toggleEncountered(mapId, filename);
    refreshRecords();
    if (!isCurrentlyEncountered) {
      sound.playEncounter();
      triggerScanSyncEffect('encounter', undefined, '已记录为已遇见');
    } else {
      sound.playToggleOff();
      triggerScanSyncEffect('unencounter', undefined, '已恢复为未遇见');
    }
  };

  // 详情弹窗内的点亮/取消（弹窗自己播放音效与动效，这里只落库刷新）
  const handleDetailToggleEncounter = (mapId: string, filename: string) => {
    storage.toggleEncountered(mapId, filename);
    refreshRecords();
  };

  // Reset Encounters for Current Map
  const handleResetCurrentMap = () => {
    storage.resetMap(currentMap.id);
    refreshRecords();
    sound.playToggleOff();
    triggerScanSyncEffect('unencounter', undefined, '已重置当前地图图鉴状态');
  };

  const handleToggleSound = () => {
    const muted = sound.toggleMute();
    setIsSoundMuted(muted);
    storage.setSetting('isSoundMuted', muted);
  };

  const handleOpenManualSelect = (predictRes: PredictResult | null) => {
    setPredictResultForManual(predictRes);
    setIsManualSelectOpen(true);
  };

  // Handle Batch Encounter Success
  const handleBatchEncounterSuccess = (
      items: Array<{ mapId: string; filename: string; note?: string }>
  ) => {
    storage.batchMarkEncountered(items);
    refreshRecords();
    sound.playEncounter();
    triggerScanSyncEffect('encounter', undefined, `已批量点亮 ${items.length} 只精灵`);
  };

  // Handle Global Search Navigate & Scroll to pet
  const handleNavigateToPet = (mapNum: number, petName: string) => {
    setActiveMapNum(mapNum);
    setIsGlobalSearchOpen(false);

    // Allow DOM update after switching active map, then scroll and highlight
    setTimeout(() => {
      const targetMap = MAP_CONFIGS.find((m) => m.num === mapNum);
      if (!targetMap) return;
      const elementId = `pet-card-${targetMap.id}-${petName.replace('.', '-')}`;
      const el = document.getElementById(elementId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-pet-target');
        setTimeout(() => {
          el.classList.remove('highlight-pet-target');
        }, 2500);
      }
    }, 150);
  };

  const fireTrialAvailable = trials.some((t) => t.key === 'fire');
  const mapTrialAvailable = trials.some((t) => t.key === 'map');

  if (view === 'assistant' && activeTrialKey === 'fire' && fireTrialAvailable) {
    return (
        <FireBadgeTrial
            maps={activeTrialMaps}
            onBack={() => {
              setActiveTrialKey('grass');
              setView('hub');
            }}
        />
    );
  }

  if (view === 'assistant' && activeTrialKey === 'map' && mapTrialAvailable) {
    return (
        <>
          <MapAwareness
              maps={activeTrialMaps}
              isSoundMuted={isSoundMuted}
              onToggleSound={handleToggleSound}
              onOpenFeedback={() => setIsFeedbackOpen(true)}
              onOpenUpdate={() => {
                updateStore.clearDot();
                setIsUpdateOpen(true);
              }}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onBack={() => {
                setActiveTrialKey('grass');
                setView('hub');
              }}
          />
          <AppSettingsModal
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              onTestEffect={(level, type) => triggerScanSyncEffect(type, level)}
              onOpenDataUpdate={() => setIsDataUpdateOpen(true)}
          />
          <FeedbackContactModal
              isOpen={isFeedbackOpen}
              onClose={() => setIsFeedbackOpen(false)}
              initialType={feedbackInitialType}
          />
          <UpdateModal
              isOpen={isUpdateOpen}
              onClose={() => setIsUpdateOpen(false)}
          />
          <DataUpdateModal
              isOpen={isDataUpdateOpen}
              onClose={() => setIsDataUpdateOpen(false)}
              onUpdated={() => {
                setDataUpdateAvailable(false);
                fetchIconsData();
                invalidateFireTrialData();
              }}
          />
        </>
    );
  }

  return (
      <div className="min-h-screen flex flex-col selection:bg-sky-200 selection:text-sky-900 pb-12 relative">
        {/* Sleek Commercial Feedback Pop Notification & Confetti */}
        <SyncPopNotification
            isVisible={syncPopState.isVisible}
            message={syncPopState.message}
            subMessage={syncPopState.subMessage}
            level={activeEffectLevel}
            type={syncPopState.type}
        />

        {/* Top Header with Settings Button */}
        <Header
            activeMapNum={activeMapNum}
            onSelectMap={(num) => setActiveMapNum(num)}
            mapsStats={allMapsStats}
            totalEncountered={totalEncounteredCount}
            totalPetsCount={totalAllPetsCount}
            isSoundMuted={isSoundMuted}
            onToggleSound={handleToggleSound}
            onOpenFeedback={() => setIsFeedbackOpen(true)}
            onOpenUpdate={() => {
              updateStore.clearDot();
              setIsUpdateOpen(true);
            }}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenHub={() => {
              // 先归零滚动，避免切换后内容高度变化导致浏览器夹回滚动位置产生跳动
              window.scrollTo(0, 0);
              setView((v) => (v === 'hub' ? 'assistant' : 'hub'));
            }}
            showMapNav={view === 'assistant'}
            mapsConfig={activeTrialMaps}
            rightStatus={<AuthBadge />}
        />

        {/* Sub-Header Toolbar: Displayed only when floating buttons are in 'hidden' mode */}
        {view === 'assistant' && floatingMode === 'hidden' && (
            <SubHeaderToolbar
                filterMode={filterMode}
                onFilterChange={(mode) => setFilterMode(mode)}
                encounteredCount={currentMapStats.encounteredCount}
                totalCount={currentMapPets.length}
                onOpenSingleRecognizer={() => guardRecognition(() => setIsSingleRecognizerOpen(true))}
                onOpenBatchInit={() => guardRecognition(() => setIsBatchInitOpen(true))}
                onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
            />
        )}

        {/* Main Content Area */}
        <main className="flex-1 w-full mx-auto px-3 sm:px-8 lg:px-16 pt-4 sm:pt-6">
          {view === 'hub' ? (
              <AssistantHub
                  trials={trials}
                  onSelectAssistant={(trialKey) => {
                    window.scrollTo(0, 0);
                    setActiveTrialKey(trialKey === 'fire' || trialKey === 'map' ? trialKey : 'grass');
                    setView('assistant');
                  }}
              />
          ) : (
              <>
                {/* Map Banner & Stats */}
                <StatsBanner
                    currentMap={currentMap}
                    encounteredCount={currentMapStats.encounteredCount}
                    totalMapPets={currentMapPets.length}
                    percentage={currentMapStats.percentage}
                    filterMode={filterMode}
                    onFilterChange={(mode) => setFilterMode(mode)}
                    searchQuery={searchQuery}
                    onSearchChange={(q) => setSearchQuery(q)}
                    onResetEncounters={handleResetCurrentMap}
                    onOpenDataUpdate={() => setIsDataUpdateOpen(true)}
                    dataUpdateAvailable={dataUpdateAvailable}
                    advancedFilters={advancedFilters}
                    onAdvancedFilterChange={(filters) => setAdvancedFilters(filters)}
                />

                {/* Pet Image Recognition Module (BatchRecognizerCard: 3 columns layout + ? help button) */}
                <BatchRecognizerCard
                    key={`${currentMap.id}_${recognizerKey}`}
                    currentMap={currentMap}
                    allMapsPets={mapsData}
                    records={records}
                    isEncountered={isPetEncountered}
                    onBatchEncounterSuccess={handleBatchEncounterSuccess}
                    onSelectMap={(num) => setActiveMapNum(num)}
                />

                {/* Map Pets Grid */}
                <PetGrid
                    currentMap={currentMap}
                    pets={currentMapPets}
                    records={records}
                    onToggleEncounter={handleToggleEncounter}
                    filterMode={filterMode}
                    onFilterChange={(mode) => setFilterMode(mode)}
                    searchQuery={searchQuery}
                    onOpenPetDetail={(pet) => setDetailPet(pet)}
                    onOpenFeedback={(type) => {
                      setFeedbackInitialType(type);
                      setIsFeedbackOpen(true);
                    }}
                    advancedFilters={advancedFilters}
                />
              </>
          )}
        </main>

        {/* Footer */}
        <footer className="mt-12 text-center text-xs text-slate-400">
          <p>洛克王国徽章试炼 · 精灵图鉴识别 · 支持本地离线存储</p>
        </footer>

        {/* Modals */}
        {/* 1. Single Pet Recognizer Modal */}
        <SinglePetRecognizerModal
            isOpen={isSingleRecognizerOpen}
            onClose={() => setIsSingleRecognizerOpen(false)}
            currentMap={currentMap}
            allMapsPets={mapsData}
            records={records}
            onEncounterSuccess={handleEncounterSuccess}
            onOpenManualSelect={handleOpenManualSelect}
            isEncountered={isPetEncountered}
        />

        {/* 2. Batch Recognition Modal */}
        <BatchInitModal
            isOpen={isBatchInitOpen}
            onClose={() => setIsBatchInitOpen(false)}
            currentMap={currentMap}
            allMapsPets={mapsData}
            records={records}
            isEncountered={isPetEncountered}
            onBatchEncounterSuccess={handleBatchEncounterSuccess}
        />

        {/* 3. Manual Pet Selection Modal */}
        <ManualSelectModal
            isOpen={isManualSelectOpen}
            onClose={() => setIsManualSelectOpen(false)}
            currentMap={currentMap}
            pets={currentMapPets}
            predictResult={predictResultForManual}
            records={records}
            isEncountered={isPetEncountered}
            onConfirmSelection={handleEncounterSuccess}
        />

        {/* 4. App Settings Modal (Effect Levels & Floating Buttons Mode) */}
        <AppSettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onTestEffect={(level, type) => triggerScanSyncEffect(type, level)}
            onOpenDataUpdate={() => setIsDataUpdateOpen(true)}
        />


        {/* Floating Filter Switch on the bottom left */}
        {view === 'assistant' && (
            <FloatingFilterSwitch
                currentMap={currentMap}
                pets={currentMapPets}
                records={records}
                filterMode={filterMode}
                onFilterChange={(mode) => setFilterMode(mode)}
                onCycleMap={() => {
                  setActiveMapNum((prev) => (prev % MAP_CONFIGS.length) + 1);
                }}
                mapsConfig={activeTrialMaps}
            />
        )}

        {/* Global Floating Actions Component on the bottom right (4 buttons: 跟随识别, 单个精灵图鉴智能识别, 批量识别, 全域图鉴搜索) */}
        {view === 'assistant' && (
            <GlobalFloatingSearch
                isOpen={isGlobalSearchOpen}
                onOpenChange={(open) => setIsGlobalSearchOpen(open)}
                allMapsPets={mapsData}
                records={records}
                onNavigateToPet={handleNavigateToPet}
                onToggleEncounter={handleToggleEncounter}
                onOpenSingleRecognizer={() => guardRecognition(() => setIsSingleRecognizerOpen(true))}
                onOpenBatchInit={() => guardRecognition(() => setIsBatchInitOpen(true))}
                mapsConfig={activeTrialMaps}
            />
        )}

        {/* Feedback and Contact QQ Group Modal */}
        <FeedbackContactModal
            isOpen={isFeedbackOpen}
            onClose={() => setIsFeedbackOpen(false)}
            initialType={feedbackInitialType}
        />

        {/* 精灵详情弹窗（右键菜单进入） */}
        <PetDetailModal
            isOpen={detailPet !== null}
            onClose={() => setDetailPet(null)}
            pet={detailPet}
            currentMap={currentMap}
            record={detailPet ? storage.getRecord(currentMap.id, detailPet.name) : undefined}
            onToggleEncounter={handleDetailToggleEncounter}
        />

        {/* Check Update Modal */}
        <UpdateModal
            isOpen={isUpdateOpen}
            onClose={() => setIsUpdateOpen(false)}
        />

        {/* 图鉴数据更新弹窗 */}
        <DataUpdateModal
            isOpen={isDataUpdateOpen}
            onClose={() => setIsDataUpdateOpen(false)}
            onUpdated={() => {
              setDataUpdateAvailable(false);
              // 重新拉取图鉴数据，让新下载的数据立即生效
              fetchIconsData();
              invalidateFireTrialData();
            }}
        />
      </div>
  );
}
