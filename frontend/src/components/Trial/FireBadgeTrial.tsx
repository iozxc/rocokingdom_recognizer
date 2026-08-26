import React, { useEffect, useMemo, useState } from 'react';
import { MapConfig, PetItem, EncounterRecord, FirePokedexEntry, FloatingButtonsMode } from '../../types';
import { fireStorage } from '../../services/fireStorage';
import { getCachedFirePets, getFireTrialPetsCached } from '../../services/fireTrialData';
import { storage } from '../../services/storage';
import { sound } from '../../services/sound';
import { Header } from '../Header';
import { StatsBanner } from '../StatsBanner';
import { PetGrid } from '../PetGrid';
import { PetDetailModal } from '../PetDetailModal';
import { FloatingFilterSwitch } from '../FloatingFilterSwitch';
import { GlobalFloatingSearch } from '../GlobalFloatingSearch';
import { SubHeaderToolbar } from '../SubHeaderToolbar';
import { FeedbackContactModal } from '../FeedbackContactModal';
import { UpdateModal } from '../UpdateModal';
import { AppSettingsModal } from '../AppSettingsModal';
import { createSvgPetAvatar } from '../../data/mockPets';
import { isPetEncounteredInRecords } from '../../utils/petHelper';
import { updateStore } from '../../services/updateStore';

interface FireBadgeTrialProps {
  maps: MapConfig[];
  onBack: () => void;
}

export const FireBadgeTrial: React.FC<FireBadgeTrialProps> = ({ maps, onBack }) => {
  const initialPets = getCachedFirePets();
  const [activeMapNum, setActiveMapNum] = useState<number>(1);
  const [pokedex, setPokedex] = useState<FirePokedexEntry[]>(initialPets ?? []);
  const [records, setRecords] = useState<Record<string, EncounterRecord>>(() => fireStorage.getAll());
  const [filterMode, setFilterMode] = useState<'all' | 'encountered' | 'unencountered'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loaded, setLoaded] = useState<boolean>(initialPets !== null);
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => {
    return storage.getSetting<boolean>('isSoundMuted', sound.getMuted());
  });
  const [isFeedbackOpen, setIsFeedbackOpen] = useState<boolean>(false);
  const [detailPet, setDetailPet] = useState<PetItem | null>(null);
  const [feedbackInitialType, setFeedbackInitialType] = useState<string>('');
  const [isUpdateOpen, setIsUpdateOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState<boolean>(false);
  const [floatingMode, setFloatingMode] = useState<FloatingButtonsMode>(() => {
    return storage.getSetting<FloatingButtonsMode>('floatingButtonsMode', 'normal');
  });

  useEffect(() => {
    const unsubscribe = fireStorage.subscribe((newRecords) => setRecords(newRecords));
    getFireTrialPetsCached().then((pets) => {
      setPokedex(pets);
      setLoaded(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = storage.subscribeSettings((newSettings) => {
      if (typeof newSettings.isSoundMuted === 'boolean') {
        setIsSoundMuted(newSettings.isSoundMuted);
      }
      if (newSettings.floatingButtonsMode) {
        setFloatingMode(newSettings.floatingButtonsMode);
      }
    });
    return unsubscribe;
  }, []);

  // 三张地图都展示全图鉴精灵，宠物名带 .png 后缀以保持与草系相同的记录 key（map1_火花.png）
  const fireMapsPets: Record<string, { count: number; items: PetItem[] }> = useMemo(() => {
    const items: PetItem[] = pokedex.map((pet) => ({
      name: `${pet.name}.png`,
      id: pet.id,
      seq: pet.seq,
      elements: pet.elements ?? [],
      rarity: 'common',
      url: pet.url || createSvgPetAvatar(pet.name, '火', (pet.id * 47) % 360, '#ef4444', '🔥'),
    }));
    const base = { count: items.length, items };
    return { map1: base, map2: base, map3: base };
  }, [pokedex]);

  const currentMap: MapConfig = useMemo(() => {
    return maps.find((m) => m.num === activeMapNum) || maps[0];
  }, [activeMapNum, maps]);

  const currentMapPets: PetItem[] = useMemo(() => {
    return fireMapsPets[`map${activeMapNum}`]?.items || [];
  }, [activeMapNum, fireMapsPets]);

  const allMapsStats = useMemo(() => {
    return maps.map((map) => {
      const list = fireMapsPets[map.id]?.items || [];
      const encountered = list.filter((p) =>
          isPetEncounteredInRecords(records, map.id, p.name)
      ).length;
      return {
        num: map.num,
        id: map.id,
        name: map.name,
        encountered,
        total: list.length,
      };
    });
  }, [fireMapsPets, records, maps]);

  const totalPetsCount = useMemo(() => {
    return maps.reduce((sum, map) => {
      return sum + (fireMapsPets[map.id]?.items.length || 0);
    }, 0);
  }, [fireMapsPets, maps]);

  const totalEncounteredCount = useMemo(() => {
    return allMapsStats.reduce((sum, s) => sum + s.encountered, 0);
  }, [allMapsStats]);

  const currentMapStats = useMemo(() => {
    const encountered = currentMapPets.filter((p) =>
        isPetEncounteredInRecords(records, currentMap.id, p.name)
    ).length;
    const total = currentMapPets.length;
    return {
      encounteredCount: encountered,
      totalMapPets: total,
      percentage: total > 0 ? Math.round((encountered / total) * 100) : 0,
    };
  }, [currentMapPets, records, currentMap.id]);

  const handleToggleEncounter = (mapId: string, filename: string) => {
    const wasEncountered = fireStorage.isEncountered(mapId, filename);
    fireStorage.toggleEncountered(mapId, filename);
    if (!wasEncountered) {
      sound.playEncounter();
    } else {
      sound.playToggleOff();
    }
  };

  const handleToggleSound = () => {
    const muted = sound.toggleMute();
    setIsSoundMuted(muted);
    storage.setSetting('isSoundMuted', muted);
  };

  const handleResetCurrentMap = () => {
    fireStorage.resetMap(currentMap.id);
    sound.playToggleOff();
  };

  const handleNavigateToPet = (mapNum: number, petName: string) => {
    setActiveMapNum(mapNum);
    setTimeout(() => {
      const targetMap = maps.find((m) => m.num === mapNum);
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

  // 全图鉴加载完成后再渲染整页（含 header 的地图计数），
  // 避免地图切换区先显示 0/0、加载后突然变成真实计数导致缩放跳动。
  if (!loaded) {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center selection:bg-orange-200 selection:text-orange-900 bg-gradient-to-b from-[#7ABCF4]/10 to-white">
          <div className="text-center text-slate-500 text-sm font-medium">正在加载火系全图鉴...</div>
        </div>
    );
  }

  return (
      <div className="min-h-screen flex flex-col selection:bg-orange-200 selection:text-orange-900 pb-12 relative">
        {/* 顶部：复用草系一致的 Header（三张火系地图切换 + 声音开关） */}
        <Header
            activeMapNum={activeMapNum}
            onSelectMap={(num) => setActiveMapNum(num)}
            mapsStats={allMapsStats}
            totalEncountered={totalEncounteredCount}
            totalPetsCount={totalPetsCount}
            isSoundMuted={isSoundMuted}
            onToggleSound={handleToggleSound}
            onOpenFeedback={() => setIsFeedbackOpen(true)}
            onOpenUpdate={() => {
              updateStore.clearDot();
              setIsUpdateOpen(true);
            }}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onOpenHub={onBack}
            mapsConfig={maps}
            devBadge
        />

        {/* 移至顶栏：显示与草系一致的顶栏工具栏（筛选 + 全域搜索） */}
        {floatingMode === 'hidden' && (
            <SubHeaderToolbar
                filterMode={filterMode}
                onFilterChange={(mode) => setFilterMode(mode)}
                encounteredCount={currentMapStats.encounteredCount}
                totalCount={currentMapPets.length}
                showFollow={false}
                onOpenGlobalSearch={() => setIsGlobalSearchOpen(true)}
            />
        )}

        <main className="flex-1 w-full mx-auto px-8 sm:px-16 pt-6">
          <StatsBanner
              currentMap={currentMap}
              encounteredCount={currentMapStats.encounteredCount}
              totalMapPets={currentMapStats.totalMapPets}
              percentage={currentMapStats.percentage}
              filterMode={filterMode}
              onFilterChange={(mode) => setFilterMode(mode)}
              searchQuery={searchQuery}
              onSearchChange={(q) => setSearchQuery(q)}
              onResetEncounters={handleResetCurrentMap}
          />

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
          />
        </main>

        <footer className="mt-12 text-center text-xs text-slate-400">
          <p>火系徽章试炼 · 全图鉴自选 · 支持本地离线存储（开发环境专属）</p>
        </footer>

        {/* 左下角：与草系一致的悬浮筛选栏 */}
        <FloatingFilterSwitch
            currentMap={currentMap}
            pets={currentMapPets}
            records={records}
            filterMode={filterMode}
            onFilterChange={(mode) => setFilterMode(mode)}
            onCycleMap={() => {
              setActiveMapNum((prev) => (prev % maps.length) + 1);
            }}
            mapsConfig={maps}
        />

        {/* 右下角：复用通用全域搜索（仅搜索模式） */}
        <GlobalFloatingSearch
            mapsConfig={maps}
            searchOnly
            allMapsPets={fireMapsPets}
            records={records}
            onNavigateToPet={handleNavigateToPet}
            onToggleEncounter={handleToggleEncounter}
            isOpen={isGlobalSearchOpen}
            onOpenChange={setIsGlobalSearchOpen}
        />

        {/* 反馈 / 更新 / 设置弹窗（与草系一致） */}
        <FeedbackContactModal
            isOpen={isFeedbackOpen}
            onClose={() => setIsFeedbackOpen(false)}
            initialType={feedbackInitialType}
        />
        <UpdateModal
            isOpen={isUpdateOpen}
            onClose={() => setIsUpdateOpen(false)}
        />
        <AppSettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onTestEffect={() => {}}
        />

        {/* 精灵详情弹窗（右键菜单进入） */}
        <PetDetailModal
            isOpen={detailPet !== null}
            onClose={() => setDetailPet(null)}
            pet={detailPet}
            currentMap={currentMap}
            record={detailPet ? records[`${currentMap.id}_${detailPet.name}`] : undefined}
            onToggleEncounter={(mapId, filename) => {
              fireStorage.toggleEncountered(mapId, filename);
            }}
        />
      </div>
  );
};
