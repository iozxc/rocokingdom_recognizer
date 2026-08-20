import React from 'react';
import {Volume2, VolumeX, CheckCircle2, MessageCircle, ArrowDownCircle, Settings} from 'lucide-react';
import { MAP_CONFIGS } from '../data/mockPets';
import { sound } from '../services/sound';

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
                                              }) => {
    return (
        <header className="bg-[#7ABCF4] border-b-4 border-[#5DA8E8] sticky top-0 z-30 shadow-md text-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
                <div className="flex flex-col lg:flex-row items-center justify-between gap-3">
                    {/* Logo & Kingdom Branding */}
                    <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-start">
                        <div className="flex items-center gap-3">
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
                                        <span className="text-[#FEE061]">草系徽章试炼助手</span>

                                    </h1>
                                </div>
                                <p className="text-xs text-white/80 font-medium">
                                    精灵图鉴识别 · 地图筛选 · 本地已遇见记录
                                </p>
                            </div>
                        </div>

                        {/* Mobile Actions: Feedback, Update, Sound & Settings */}
                        <div className="lg:hidden flex items-center gap-1.5">
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
                                <button
                                    id="update-toggle-btn-mobile"
                                    onClick={() => {
                                        sound.playClick();
                                        onOpenUpdate();
                                    }}
                                    title="查看是否有最新版"
                                    className="p-2 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1 text-xs font-black"
                                >
                                    <ArrowDownCircle className="w-4 h-4 text-[#FEE061]" />
                                </button>
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

                    {/* Map Nav Buttons with Individual Counts */}
                    <div className="flex items-center gap-1.5 p-1 bg-white/20 backdrop-blur-xs rounded-2xl border border-white/30 overflow-x-auto max-w-full">
                        {MAP_CONFIGS.map((map) => {
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
                                    <span>{map.num}、{map.name.replace('记忆中的', '')}</span>

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
                    </div>

                    {/* Right Action: Feedback, Check Update, Sound Toggle & Settings */}
                    <div className="hidden lg:flex items-center gap-2">
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
                            <button
                                id="check-update-btn"
                                onClick={() => {
                                    sound.playClick();
                                    onOpenUpdate();
                                }}
                                title="查看是否有最新版本"
                                className="px-3 py-1.5 rounded-2xl border border-white/40 bg-white/20 hover:bg-white/30 text-white transition-colors shadow-2xs backdrop-blur-xs cursor-pointer flex items-center gap-1.5 text-xs font-black"
                            >
                                <ArrowDownCircle className="w-4 h-4 text-[#FEE061]" />
                                <span>检查更新</span>
                            </button>
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
