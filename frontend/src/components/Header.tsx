import React from 'react';
import {Volume2, VolumeX, CheckCircle2, MessageCircle, ArrowUpCircle, Settings, BookOpen, History} from 'lucide-react';
import { MAP_CONFIGS } from '../data/mockPets';
import { MapConfig } from '../types';
import { sound } from '../services/sound';
import { useUpdateStore } from '../services/useUpdateStore';

export interface HeaderMapStat {
    num: number;
    id: string;
    name: string;
    encountered: number;
    total: number;
}

interface HeaderProps {
    activeMapNum: number;
    onSelectMap: (num: number) => void;
    mapsStats?: HeaderMapStat[];
    totalEncountered: number;
    totalPetsCount: number;
    isSoundMuted: boolean;
    onToggleSound: () => void;
    onOpenHistory?: () => void;
    onOpenManual?: () => void;
    onOpenFeedback?: () => void;
    onOpenUpdate?: () => void;
    onOpenSettings?: () => void;
    onOpenHub?: () => void;
    showMapNav?: boolean;
    mapsConfig?: MapConfig[];
    devBadge?: boolean;
    rightStatus?: React.ReactNode;
    centerStatus?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({
                                                  activeMapNum,
                                                  onSelectMap,
                                                  mapsStats = [],
                                                  totalEncountered,
                                                  totalPetsCount,
                                                  isSoundMuted,
                                                  onToggleSound,
                                                  onOpenHistory,
                                                  onOpenManual,
                                                  onOpenFeedback,
                                                  onOpenUpdate,
                                                  onOpenSettings,
                                                  onOpenHub,
                                                  showMapNav = true,
                                                  mapsConfig,
                                                  devBadge,
                                                  rightStatus,
                                                  centerStatus,
                                              }) => {
    const updateState = useUpdateStore();
    const isBusyDownloading =
        updateState.downloadStatus === 'downloading' ||
        updateState.downloadStatus.startsWith('verifying') ||
        updateState.downloadStatus === 'merging';
    const updatePercent =
        updateState.downloadStatus === 'ready'
            ? 100
            : isBusyDownloading && updateState.totalBytes
                ? Math.min(100, Math.round((updateState.progress / updateState.totalBytes) * 100))
                : 0;
    const showUpdateFill = updatePercent > 0;

    return (
        <header className="bg-[#7ABCF4] border-b-4 border-[#5DA8E8] sticky top-0 z-30 shadow-md text-white select-none">
            <div className="mx-auto px-2 sm:px-4 lg:px-8 py-1.5 sm:py-2">
                <div className="relative flex items-center justify-between gap-1.5 sm:gap-3">
                    {/* Logo & Kingdom Branding */}
                    <div className="flex items-center gap-2 min-w-0 shrink-0">
                        <div
                            role="button"
                            tabIndex={onOpenHub ? 0 : undefined}
                            onClick={() => {
                                if (onOpenHub) {
                                    sound.playClick();
                                    onOpenHub();
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && onOpenHub) {
                                    sound.playClick();
                                    onOpenHub();
                                }
                            }}
                            title={onOpenHub ? '打开助手选择' : undefined}
                            className={`flex items-center gap-2 rounded-2xl p-1 -m-1 transition-all duration-200 min-w-0 ${
                                onOpenHub
                                    ? 'cursor-pointer hover:bg-white/25 hover:shadow-sm active:scale-[0.98]'
                                    : ''
                            }`}
                        >
                            <div className="relative flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 lg:w-10 lg:h-10 rounded-xl bg-white shadow-sm border-2 border-white overflow-hidden p-0.5 shrink-0">
                                <img
                                    src="./icon.jpg"
                                    alt="洛克王国"
                                    className="w-full h-full object-cover rounded-lg"
                                    referrerPolicy="no-referrer"
                                />
                            </div>
                            <div className="min-w-0 flex flex-col justify-center">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <h1 className="text-sm sm:text-base lg:text-lg font-black tracking-tight text-white flex items-center gap-1 drop-shadow-xs whitespace-nowrap">
                                        <span className="hidden min-[380px]:inline">洛克王国</span>
                                        <span className="text-[#FEE061]">徽章助手</span>
                                    </h1>
                                    {devBadge && (
                                        <span className="text-[9px] font-black text-orange-100 bg-orange-500/50 border border-white/30 px-1.5 py-0.2 rounded-full shrink-0">
                                            DEV
                                        </span>
                                    )}
                                </div>
                                <div className="hidden min-[840px]:flex items-center gap-1.5 text-[10px] text-white/80 font-medium whitespace-nowrap min-w-0">
                                    <span>图鉴识别 · 本地记录</span>
                                    <span className="text-[9px] font-mono text-white/40 tracking-wider">
                                        v{updateState.updateData?.current_version || '1.0.0'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Map Nav Buttons with Individual Counts (Silky progressive shrinkage) */}
                    {showMapNav && (
                        <div className="hidden min-[870px]:flex items-center gap-1 p-1 bg-white/20 backdrop-blur-xs rounded-2xl border border-white/30 shrink min-w-0 overflow-hidden">
                            {(mapsConfig && mapsConfig.length > 0 ? mapsConfig : MAP_CONFIGS).map((map) => {
                                const isActive = activeMapNum === map.num;
                                const mapStat = mapsStats.find((s) => s.num === map.num);
                                const mapEnc = mapStat?.encountered ?? 0;
                                const mapTot = mapStat?.total ?? 8;

                                // 提取精炼地图简称（如 "记忆中的草系徽章试炼" -> "草系"）
                                const cleanName = map.name.replace('记忆中的', '').replace('火系徽章试炼', '').replace('草系徽章试炼', '').replace('徽章试炼', '');
                                const shortName = cleanName.length > 0 ? cleanName : `${map.num}区`;

                                return (
                                    <button
                                        key={map.id}
                                        id={`map-nav-btn-${map.num}`}
                                        onClick={() => {
                                            sound.playClick();
                                            onSelectMap(map.num);
                                        }}
                                        className={`px-2 lg:px-2.5 py-1 rounded-xl text-xs font-black whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 cursor-pointer shrink min-w-0 ${
                                            isActive
                                                ? 'bg-white text-[#2B78C4] shadow-sm scale-[1.02]'
                                                : 'text-white/90 hover:text-white hover:bg-white/20'
                                        }`}
                                        title={`${map.name} (${mapEnc}/${mapTot})`}
                                    >
                                        <span
                                            className={`w-2 h-2 rounded-full border border-white/60 shrink-0 ${
                                                map.num === 1
                                                    ? 'bg-[#95D151]'
                                                    : map.num === 2
                                                        ? 'bg-[#FEE061]'
                                                        : 'bg-[#60A5FA]'
                                            }`}
                                        />
                                        {/* >= 1200px: 完整名称 */}
                                        <span className="hidden min-[1200px]:inline truncate">
                                            {map.num}、{map.name.replace('记忆中的', '').replace('火系徽章试炼', '')}
                                        </span>
                                        {/* 960px ~ 1199px: 精炼简称 (如 1、草系) */}
                                        <span className="hidden min-[960px]:inline min-[1200px]:hidden truncate">
                                            {map.num}、{shortName}
                                        </span>
                                        {/* 720px ~ 959px: 极简纯序号 (如 图1) */}
                                        <span className="inline min-[960px]:hidden">
                                            图{map.num}
                                        </span>

                                        <span
                                            className={`text-[10px] font-mono font-black px-1 rounded-md shrink-0 ${
                                                isActive
                                                    ? 'bg-[#EBF4FE] text-[#2B78C4] border border-[#BCD7F2]'
                                                    : 'bg-white/25 text-white'
                                            }`}
                                        >
                                            {mapEnc}/{mapTot}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Right Action: Auth, History, Feedback, Check Update, Sound & Settings */}
                    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                        {rightStatus}

                        {onOpenHistory && (
                            <button
                                id="history-toggle-btn"
                                onClick={() => {
                                    sound.playClick();
                                    onOpenHistory();
                                }}
                                title="查看图鉴遇见与操作历史"
                                className="px-2 sm:px-2.5 py-1.5 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-all shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1 text-xs font-black shrink-0 active:scale-95"
                            >
                                <History className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FEE061] shrink-0" />
                                <span className="hidden min-[1100px]:inline">遇见历史</span>
                                <span className="hidden min-[480px]:inline min-[1100px]:hidden">历史</span>
                            </button>
                        )}

                        {onOpenFeedback && (
                            <button
                                id="feedback-toggle-btn"
                                onClick={() => {
                                    sound.playClick();
                                    onOpenFeedback();
                                }}
                                title="加入官方交流群 / 反馈异常"
                                className="px-2 sm:px-2.5 py-1.5 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-all shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1 text-xs font-black shrink-0 active:scale-95"
                            >
                                <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FEE061] shrink-0" />
                                <span className="hidden min-[1100px]:inline">群聊反馈</span>
                                <span className="hidden min-[480px]:inline min-[1100px]:hidden">反馈</span>
                            </button>
                        )}

                        {/* Check Update Button */}
                        {onOpenUpdate && (
                            <span className="relative inline-flex shrink-0">
                                <button
                                    id="check-update-btn"
                                    onClick={() => {
                                        sound.playClick();
                                        onOpenUpdate();
                                    }}
                                    title="查看是否有最新版本"
                                    className="relative overflow-hidden px-2 sm:px-2.5 py-1.5 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-all shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1 text-xs font-black active:scale-95"
                                >
                                    {showUpdateFill && (
                                        <span
                                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/50 to-yellow-300/50 transition-all duration-500"
                                            style={{ width: `${updatePercent}%` }}
                                        />
                                    )}
                                    <ArrowUpCircle className="relative w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FEE061] shrink-0" />
                                    <span className="relative hidden min-[1100px]:inline">检查更新</span>
                                    <span className="relative hidden min-[540px]:inline min-[1100px]:hidden">更新</span>
                                </button>
                                {updateState.dotVisible && (
                                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                                )}
                            </span>
                        )}

                        <button
                            id="sound-toggle-btn"
                            onClick={() => {
                                sound.playClick();
                                onToggleSound();
                            }}
                            title={isSoundMuted ? '点击开启声音特效' : '点击静音'}
                            className="p-1.5 sm:p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-all shadow-2xs backdrop-blur-xs cursor-pointer shrink-0 active:scale-95"
                        >
                            {isSoundMuted ? (
                                <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white/70" />
                            ) : (
                                <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#FEE061]" />
                            )}
                        </button>

                        {onOpenSettings && (
                            <button
                                id="settings-toggle-btn"
                                onClick={() => {
                                    sound.playClick();
                                    onOpenSettings();
                                }}
                                title="系统设置 (特效等级/悬浮按钮)"
                                className="p-1.5 sm:p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-all shadow-2xs backdrop-blur-xs cursor-pointer shrink-0 active:scale-95"
                            >
                                <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white hover:rotate-45 transition-transform duration-300" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
};

