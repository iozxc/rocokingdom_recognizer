import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { StatsBanner } from './components/StatsBanner';
import { BatchRecognizerCard } from './components/BatchRecognizerCard';
import { SinglePetRecognizerModal } from './components/SinglePetRecognizerModal';
import { PetGrid } from './components/PetGrid';
import { ManualSelectModal } from './components/ManualSelectModal';
import { BatchInitModal } from './components/BatchInitModal';
import { GlobalFloatingSearch } from './components/GlobalFloatingSearch';
import { FloatingFilterSwitch } from './components/FloatingFilterSwitch';
import { FeedbackContactModal } from './components/FeedbackContactModal';
import { UpdateModal } from './components/UpdateModal';
import { MAP_CONFIGS, FALLBACK_MAPS_DATA } from './data/mockPets';
import { api } from './services/api';
import { storage } from './services/storage';
import { sound } from './services/sound';
import { MapConfig, PetItem, PredictResult, EncounterRecord } from './types';

export default function App() {
  const [activeMapNum, setActiveMapNum] = useState<number>(1);
  const [mapsData, setMapsData] = useState<Record<string, { count: number; items: PetItem[] }>>(FALLBACK_MAPS_DATA);
  const [records, setRecords] = useState<Record<string, EncounterRecord>>({});
  const [filterMode, setFilterMode] = useState<'all' | 'encountered' | 'unencountered'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isSoundMuted', sound.getMuted());
  });
  const [isFeedbackOpen, setIsFeedbackOpen] = useState<boolean>(false);
  const [isUpdateOpen, setIsUpdateOpen] = useState<boolean>(false);

  // Modal States
  const [isSingleRecognizerOpen, setIsSingleRecognizerOpen] = useState<boolean>(false);
  const [isBatchInitOpen, setIsBatchInitOpen] = useState<boolean>(false);
  const [isManualSelectOpen, setIsManualSelectOpen] = useState<boolean>(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState<boolean>(false);
  const [predictResultForManual, setPredictResultForManual] = useState<PredictResult | null>(null);
  const [recognizerKey, setRecognizerKey] = useState<number>(0);

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

    // 订阅 storage 变更（当从 Flask 后端加载完成时自动更新 UI）
    const unsubscribeRecords = storage.subscribe((newRecords) => {
      setRecords(newRecords);
    });

    const unsubscribeSettings = storage.subscribeSettings((newSettings) => {
      if (typeof newSettings.isSoundMuted === 'boolean') {
        setIsSoundMuted(newSettings.isSoundMuted);
      }
    });

    return () => {
      unsubscribeRecords();
      unsubscribeSettings();
    };
  }, [refreshRecords, fetchIconsData]);

  // Current Map configuration
  const currentMap: MapConfig = useMemo(() => {
    return MAP_CONFIGS.find((m) => m.num === activeMapNum) || MAP_CONFIGS[0];
  }, [activeMapNum]);

  // Current Map pets
  const currentMapPets: PetItem[] = useMemo(() => {
    const mapKey = `map${activeMapNum}`;
    return mapsData[mapKey]?.items || FALLBACK_MAPS_DATA[mapKey]?.items || [];
  }, [activeMapNum, mapsData]);

  // Total count of pets across all 3 maps
  const totalAllPetsCount = useMemo(() => {
    let total = 0;
    ['map1', 'map2', 'map3'].forEach((k) => {
      const items = mapsData[k]?.items || FALLBACK_MAPS_DATA[k]?.items || [];
      total += items.length;
    });
    return total || 24;
  }, [mapsData]);

  // Total encountered pets count across all maps
  const totalEncounteredCount = useMemo(() => {
    return (Object.values(records) as EncounterRecord[]).filter((r) => r.encountered).length;
  }, [records]);

  // Per-map stats for 3 maps
  const allMapsStats = useMemo(() => {
    return MAP_CONFIGS.map((map) => {
      const list = mapsData[map.id]?.items || FALLBACK_MAPS_DATA[map.id]?.items || [];
      const stats = storage.getMapStats(map.id, list.length);
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
    return storage.getMapStats(currentMap.id, currentMapPets.length);
  }, [currentMap.id, currentMapPets.length, records]);

  // Check if a specific pet is encountered
  const isPetEncountered = useCallback(
    (mapId: string, filename: string) => {
      const key = `${mapId}_${filename}`;
      return !!records[key]?.encountered;
    },
    [records]
  );

  // Handle Encounter Success (via Image Recognition or Manual Confirmation)
  const handleEncounterSuccess = (mapId: string, filename: string, note?: string) => {
    storage.markEncountered(mapId, filename, note);
    refreshRecords();
    setRecognizerKey((prev) => prev + 1);
  };

  // Toggle Encounter (from grid click)
  const handleToggleEncounter = (mapId: string, filename: string) => {
    storage.toggleEncountered(mapId, filename);
    refreshRecords();
  };

  // Reset Encounters for Current Map
  const handleResetCurrentMap = () => {
    storage.resetMap(currentMap.id);
    refreshRecords();
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

  return (
    <div className="min-h-screen flex flex-col selection:bg-sky-200 selection:text-sky-900 pb-12">
      {/*<ScannerApp/>*/}

      {/* Top Header */}
      <Header
        activeMapNum={activeMapNum}
        onSelectMap={(num) => setActiveMapNum(num)}
        mapsStats={allMapsStats}
        totalEncountered={totalEncounteredCount}
        totalPetsCount={totalAllPetsCount}
        isSoundMuted={isSoundMuted}
        onToggleSound={handleToggleSound}
        onOpenFeedback={() => setIsFeedbackOpen(true)}
        onOpenUpdate={() => setIsUpdateOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6">
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
        />
      </main>

      {/* Footer */}
      <footer className="mt-12 text-center text-xs text-slate-400">
        <p>洛克王国草系徽章试炼 · 精灵图鉴识别 · 支持本地离线存储</p>
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

      {/* Floating Filter Switch on the bottom left */}
      <FloatingFilterSwitch
        currentMap={currentMap}
        pets={currentMapPets}
        records={records}
        filterMode={filterMode}
        onFilterChange={(mode) => setFilterMode(mode)}
        onCycleMap={() => {
          setActiveMapNum((prev) => (prev % MAP_CONFIGS.length) + 1);
        }}
      />

      {/* Global Floating Actions Component on the bottom right (4 buttons: 跟随识别, 单个精灵图鉴智能识别, 批量识别, 全域图鉴搜索) */}
      <GlobalFloatingSearch
        isOpen={isGlobalSearchOpen}
        onOpenChange={(open) => setIsGlobalSearchOpen(open)}
        allMapsPets={mapsData}
        records={records}
        onNavigateToPet={handleNavigateToPet}
        onToggleEncounter={handleToggleEncounter}
        onOpenSingleRecognizer={() => setIsSingleRecognizerOpen(true)}
        onOpenBatchInit={() => setIsBatchInitOpen(true)}
      />

      {/* Feedback and Contact QQ Group Modal */}
      <FeedbackContactModal
          isOpen={isFeedbackOpen}
          onClose={() => setIsFeedbackOpen(false)}
      />

      {/* Check Update Modal */}
      <UpdateModal
          isOpen={isUpdateOpen}
          onClose={() => setIsUpdateOpen(false)}
      />

    </div>
  );
}
