import React from 'react';
import {Volume2, VolumeX, CheckCircle2, MessageCircle, ArrowUpCircle, Settings} from 'lucide-react';
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
        <header className="bg-[#7ABCF4] border-b-4 border-[#5DA8E8] sticky top-0 z-30 shadow-md text-white">
            <div className="mx-auto px-8 sm:px-16 py-2.5">
                <div className="relative flex flex-col lg:flex-row items-center justify-between gap-3">
                    {/* Logo & Kingdom Branding */}
                    <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-start">
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
                            className={`flex items-center gap-3 rounded-2xl p-1.5 -m-1.5 transition-all duration-200 ${
                                onOpenHub
                                    ? 'cursor-pointer hover:bg-white/25 hover:shadow-sm active:scale-[0.98]'
                                    : ''
                            }`}
                        >
                            <div className="relative flex items-center justify-center w-11 h-11 rounded-2xl bg-white shadow-sm border-2 border-white overflow-hidden p-0.5 shrink-0">
                                <img
                                    src="./icon.jpg"
                                    alt="洛克王国"
                                    className="w-full h-full object-cover rounded-xl"
                                    referrerPolicy="no-referrer"
                                />
                                <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#95D151] rounded-full border-2 border-white" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-1.5 drop-shadow-xs">
                                        <span>洛克王国</span>
                                        <span className="text-[#FEE061] text-base sm:text-lg">徽章试炼助手</span>
                                    </h1>
                                    {devBadge && (
                                        <span className="text-[10px] font-black text-orange-100 bg-orange-500/40 border border-white/30 px-2 py-0.5 rounded-full">
                                            DEV
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <p className="text-xs text-white/80 font-medium">
                                        精灵图鉴识别 · 地图筛选 · 本地记录
                                    </p>
                                    <span className="text-[10px] font-mono text-white/40 tracking-wider select-none font-normal">
                                        v{updateState.updateData?.current_version || '1.0.0'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Mobile Actions: Feedback, Update, Sound & Settings */}
                        <div className="lg:hidden flex items-center gap-1.5">
                            {rightStatus}
                            {onOpenFeedback && (
                                <button
                                    id="feedback-toggle-btn-mobile"
                                    onClick={() => {
                                        sound.playClick();
                                        onOpenFeedback();
                                    }}
                                    title="联系群聊 / 提交反馈"
                                    className="p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1 text-xs font-black"
                                >
                                    <MessageCircle className="w-4 h-4 text-[#FEE061]" />
                                </button>
                            )}
                            {onOpenUpdate && (
                                <span className="relative inline-flex">
                                    <button
                                        id="update-toggle-btn-mobile"
                                        onClick={() => {
                                            sound.playClick();
                                            onOpenUpdate();
                                        }}
                                        title="查看是否有最新版"
                                        className="relative overflow-hidden p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1 text-xs font-black"
                                    >
                                        {showUpdateFill && (
                                            <span
                                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/50 to-yellow-300/50 transition-all duration-500"
                                                style={{ width: `${updatePercent}%` }}
                                            />
                                        )}
                                        <ArrowUpCircle className="relative w-4 h-4 text-[#FEE061]" />
                                    </button>
                                    {updateState.dotVisible && (
                                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                                    )}
                                </span>
                            )}
                            <button
                                id="sound-toggle-btn-mobile"
                                onClick={() => {
                                    sound.playClick();
                                    onToggleSound();
                                }}
                                title={isSoundMuted ? '点击开启声音特效' : '点击静音'}
                                className="p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer"
                            >
                                {isSoundMuted ? (
                                    <VolumeX className="w-4 h-4 text-white/70" />
                                ) : (
                                    <Volume2 className="w-4 h-4 text-[#FEE061]" />
                                )}
                            </button>
                            {onOpenSettings && (
                                <button
                                    id="settings-toggle-btn-mobile"
                                    onClick={() => {
                                        sound.playClick();
                                        onOpenSettings();
                                    }}
                                    title="系统设置 (特效等级/悬浮按钮)"
                                    className="p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer"
                                >
                                    <Settings className="w-4 h-4 text-white" />
                                </button>
                            )}
                        </div>
                    </div>

                    {centerStatus && (
                        <div className="lg:absolute lg:left-1/2 lg:-translate-x-1/2 z-10">
                            {centerStatus}
                        </div>
                    )}

                    {/* Map Nav Buttons with Individual Counts */}
                    {showMapNav && <div className="flex items-center gap-1.5 p-1 bg-white/20 backdrop-blur-xs rounded-2xl border border-white/30 overflow-x-auto max-w-full">
                        {(mapsConfig && mapsConfig.length > 0 ? mapsConfig : MAP_CONFIGS).map((map) => {
                            const isActive = activeMapNum === map.num;
                            const mapStat = mapsStats.find((s) => s.num === map.num);
                            const mapEnc = mapStat?.encountered ?? 0;
                            const mapTot = mapStat?.total ?? 8;

                            return (
                                <button
                                    key={map.id}
                                    id={`map-nav-btn-${map.num}`}
                                    onClick={() => {
                                        sound.playClick();
                                        onSelectMap(map.num);
                                    }}
                                    className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black whitespace-nowrap transition-all duration-150 flex items-center gap-2 cursor-pointer ${
                                        isActive
                                            ? 'bg-white text-[#2B78C4] shadow-sm scale-[1.02]'
                                            : 'text-white/90 hover:text-white hover:bg-white/20'
                                    }`}
                                >
                  <span
                      className={`w-2.5 h-2.5 rounded-full border border-white/60 shrink-0 ${
                          map.num === 1
                              ? 'bg-[#95D151]'
                              : map.num === 2
                                  ? 'bg-[#FEE061]'
                                  : 'bg-[#60A5FA]'
                      }`}
                  />
                                    <span>{map.num}、{map.name.replace('记忆中的', '').replace('火系徽章试炼', '')}</span>

                                    {/* Individual Map Count Tag inside tab */}
                                    <span
                                        className={`text-[11px] font-mono font-black px-1.5 py-0.2 rounded-md ${
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
                    </div>}

                    {/* Right Action: Feedback, Check Update, Sound Toggle & Settings */}
                    <div className="hidden lg:flex items-center gap-2">
                        {rightStatus}
                        {onOpenFeedback && (
                            <button
                                id="feedback-toggle-btn"
                                onClick={() => {
                                    sound.playClick();
                                    onOpenFeedback();
                                }}
                                title="加入官方交流群 / 反馈异常"
                                className="px-3 py-1.5 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1.5 text-xs font-black"
                            >
                                <MessageCircle className="w-4 h-4 text-[#FEE061]" />
                                <span>群聊反馈</span>
                            </button>
                        )}

                        {/* Check Update Button: Positioned between Feedback and Sound Button */}
                        {onOpenUpdate && (
                            <span className="relative inline-flex">
                                <button
                                    id="check-update-btn"
                                    onClick={() => {
                                        sound.playClick();
                                        onOpenUpdate();
                                    }}
                                    title="查看是否有最新版本"
                                    className="relative overflow-hidden px-3 py-1.5 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1.5 text-xs font-black"
                                >
                                    {showUpdateFill && (
                                        <span
                                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/50 to-yellow-300/50 transition-all duration-500"
                                            style={{ width: `${updatePercent}%` }}
                                        />
                                    )}
                                    <ArrowUpCircle className="relative w-4 h-4 text-[#FEE061]" />
                                    <span className="relative">检查更新</span>
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
                            className="p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer"
                        >
                            {isSoundMuted ? (
                                <VolumeX className="w-4 h-4 text-white/70" />
                            ) : (
                                <Volume2 className="w-4 h-4 text-[#FEE061]" />
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
                                className="p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer"
                            >
                                <Settings className="w-4 h-4 text-white hover:rotate-45 transition-transform duration-300" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
};

