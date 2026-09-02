import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Camera,
  Layers,
  Search,
  Crosshair,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  Flame,
  MousePointerClick,
  Compass,
  FileCheck,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { sound } from '../services/sound';

interface UserManualModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'quickstart' | 'recognition' | 'batch' | 'map' | 'features' | 'faq';

export const UserManualModal: React.FC<UserManualModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('quickstart');

  if (!isOpen) return null;

  const tabs: { id: TabKey; label: string; icon: React.ReactNode }[] = [
    { id: 'quickstart', label: '新手快速入门', icon: <Zap className="w-4 h-4" /> },
    { id: 'recognition', label: '截图与识别', icon: <Camera className="w-4 h-4" /> },
    { id: 'batch', label: '批量初始化', icon: <Layers className="w-4 h-4" /> },
    { id: 'features', label: '图鉴检索与快捷操作', icon: <Search className="w-4 h-4" /> },
    { id: 'faq', label: '常见问题与答疑', icon: <HelpCircle className="w-4 h-4" /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl border-4 border-[#5DA8E8] dark:border-slate-700 shadow-2xl max-w-4xl w-full h-[88vh] max-h-[820px] overflow-hidden flex flex-col transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#7ABCF4] dark:bg-slate-800 px-5 py-3.5 text-white flex items-center justify-between border-b-2 border-[#5DA8E8] dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-white/20 border border-white/40 flex items-center justify-center shadow-xs">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight">洛克王国徽章助手 · 使用手册</h3>
                <span className="text-[10px] font-bold bg-white/20 border border-white/40 px-2 py-0.5 rounded-full">
                  图文指南
                </span>
              </div>
              <p className="text-[11px] text-white/85 dark:text-slate-300 font-medium">
                详细操作说明、AI 识别指引、快捷键与常见疑问全解答
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer"
            title="关闭手册"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="bg-[#F0F6FC] dark:bg-slate-800/80 px-3 py-2 border-b border-[#D5E3F0] dark:border-slate-700 flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  sound.playClick();
                  setActiveTab(tab.id);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-[#2B78C4] dark:bg-sky-500 text-white shadow-sm scale-[1.02]'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-700 hover:text-[#2B78C4] dark:hover:text-white'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 text-slate-700 dark:text-slate-200 leading-relaxed text-sm">
          {/* TAB 1: QUICKSTART */}
          {activeTab === 'quickstart' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Introduction Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-50 to-blue-50 dark:from-slate-800 dark:to-slate-800/60 border-2 border-sky-100 dark:border-slate-700 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <div className="p-3 bg-[#7ABCF4] text-white rounded-2xl shadow-sm shrink-0">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-black text-base text-[#1E5F9E]">
                    欢迎使用《洛克王国》徽章试炼小助手！
                  </h4>
                  <p className="text-xs text-slate-600">
                    本工具专为徽章试炼活动打造，通过本地离线 AI 深度学习与特征检测，自动识别精灵、记录点亮图鉴、地图定位与寻路，完全不修改游戏内存，安全绿色。
                  </p>
                </div>
              </div>

              {/* Step By Step Guide */}
              <div className="space-y-3">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <span className="w-2 h-4 bg-[#5DA8E8] rounded-full inline-block" />
                  3 步快速上手
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  {/* Step 1 */}
                  <div className="p-4 rounded-2xl border-2 border-[#D5E3F0] bg-white shadow-xs flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="w-6 h-6 rounded-lg bg-sky-100 text-[#2B78C4] font-black text-xs flex items-center justify-center">
                          1
                        </span>
                        <Layers className="w-4 h-4 text-sky-400" />
                      </div>
                      <h5 className="font-black text-slate-800 text-sm">批量初筛（推荐）</h5>
                      <p className="text-xs text-slate-500">
                        首次打开时，在游戏内打开“冒险日志”，直接截图粘贴，一次性点亮所有已遇精灵！
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-[#2B78C4] font-semibold flex items-center gap-1">
                      <span>节省 90% 录入时间</span>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="p-4 rounded-2xl border-2 border-[#D5E3F0] bg-white shadow-xs flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-600 font-black text-xs flex items-center justify-center">
                          2
                        </span>
                        <Camera className="w-4 h-4 text-emerald-400" />
                      </div>
                      <h5 className="font-black text-slate-800 text-sm">单精灵截屏比对</h5>
                      <p className="text-xs text-slate-500">
                        日常探索时，使用快捷键截图精灵头像或野怪画面，本地神经网络 0.1 秒高精度精准识别。
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                      <span>支持剪贴板快速粘贴</span>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="p-4 rounded-2xl border-2 border-[#D5E3F0] bg-white shadow-xs flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-600 font-black text-xs flex items-center justify-center">
                          3
                        </span>
                        <Compass className="w-4 h-4 text-amber-400" />
                      </div>
                      <h5 className="font-black text-slate-800 text-sm">实时跟随与定位</h5>
                      <p className="text-xs text-slate-500">
                        开启实时跟随小窗，游戏内移动时智能追踪当前试炼关卡点位、刷新位置与目标野怪。
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-amber-600 font-semibold flex items-center gap-1">
                      <span>悬浮窗透明置顶</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Illustrated Interface Breakdown */}
              <div className="p-4 rounded-2xl bg-[#F0F6FC] border-2 border-[#D5E3F0] space-y-3">
                <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <MousePointerClick className="w-4 h-4 text-[#2B78C4]" />
                  核心界面区域说明
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-xl border border-[#D5E3F0] space-y-1">
                    <span className="font-black text-[#2B78C4]">① 顶部导航栏：</span>
                    <p className="text-slate-600">
                      切换各个徽章试炼关卡，查看当前关卡点亮进度（如 24/24）、音频开关、群聊反馈及更新。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-[#D5E3F0] space-y-1">
                    <span className="font-black text-[#2B78C4]">② 识别工作区：</span>
                    <p className="text-slate-600">
                      支持将图片拖拽、粘贴或直接截屏至识别框，AI 将输出 Top1 ~ Top5 预测概率结果。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-[#D5E3F0] space-y-1">
                    <span className="font-black text-[#2B78C4]">③ 精灵图鉴网格：</span>
                    <p className="text-slate-600">
                      直观展示该地图所有精灵卡片，高亮代表已遇，灰度代表未遇。左键点击切换点亮状态。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-[#D5E3F0] space-y-1">
                    <span className="font-black text-[#2B78C4]">④ 全局浮动搜索：</span>
                    <p className="text-slate-600">
                      右下角支持快捷搜索精灵名称、系别筛选、遇怪状态筛选（已点亮/未点亮）。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: RECOGNITION */}
          {activeTab === 'recognition' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="space-y-2">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[#2B78C4]" />
                  单精灵识别流程与技巧
                </h4>
                <p className="text-xs text-slate-500">
                  基于 YOLOv8 版面定位与特征比对模型，支持模糊、背景干扰及不同分辨率的游戏截图。
                </p>
              </div>

              {/* Image demonstration visual card */}
              <div className="rounded-2xl border-2 border-[#D5E3F0] overflow-hidden bg-slate-900 shadow-sm text-white">
                <div className="p-3 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between text-xs font-bold text-slate-300">
                  <span>📸 识别效果演示</span>
                  <span className="text-emerald-400 font-mono">DINOv2 + YOLO Feature Matching</span>
                </div>
                <div className="p-4 flex flex-col sm:flex-row items-center justify-around gap-4 bg-gradient-to-b from-slate-900 to-slate-950">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-32 h-24 rounded-xl border-2 border-sky-400/50 bg-sky-950/40 flex items-center justify-center p-1 relative overflow-hidden">
                      <img
                        src="https://omisheep-img.oss-cn-guangzhou.aliyuncs.com/pic/image-20260819035235016.png"
                        alt="截屏识别"
                        className="max-h-full max-w-full object-contain rounded"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <div className="absolute bottom-1 right-1 text-[9px] bg-black/60 px-1 rounded text-sky-200">
                        游戏原截图
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-300">1. 截取游戏界面</span>
                  </div>

                  <ChevronRight className="w-6 h-6 text-sky-400 shrink-0 hidden sm:block" />

                  <div className="flex flex-col items-center gap-2">
                    <div className="w-32 h-24 rounded-xl border-2 border-emerald-400/50 bg-emerald-950/40 flex items-center justify-center p-2 relative">
                      <div className="text-center space-y-1">
                        <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
                        <p className="text-[11px] font-black text-emerald-300">Top 1: 99.8%</p>
                        <p className="text-[10px] text-slate-300">自动标记点亮</p>
                      </div>
                    </div>
                    <span className="text-[11px] text-emerald-300">2. 本地 AI 实时分析</span>
                  </div>
                </div>
              </div>

              {/* Tips Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-4 rounded-2xl bg-amber-50/70 border-2 border-amber-200/80 space-y-2">
                  <h5 className="font-black text-amber-900 text-xs flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-600" />
                    截屏技巧
                  </h5>
                  <ul className="text-xs text-amber-950/80 space-y-1.5 list-disc list-inside">
                    <li>使用微信/QQ/系统截图工具截取精灵头像或对战野怪。</li>
                    <li>截图中尽量包含精灵主体特征，即使带有游戏背景也可正常提取。</li>
                    <li>截完图后直接在助手主窗口按下 <kbd className="px-1.5 py-0.5 bg-white border border-amber-300 rounded font-mono text-[11px]">Ctrl + V</kbd> 即可立即识别。</li>
                  </ul>
                </div>

                <div className="p-4 rounded-2xl bg-blue-50/70 border-2 border-blue-200/80 space-y-2">
                  <h5 className="font-black text-blue-900 text-xs flex items-center gap-1.5">
                    <HelpCircle className="w-4 h-4 text-blue-600" />
                    置信度与手动纠错
                  </h5>
                  <ul className="text-xs text-blue-950/80 space-y-1.5 list-disc list-inside">
                    <li>当置信度低于 70% 或候选相似度接近时，卡片会提示手动确认。</li>
                    <li>点击识别卡片上的“手动纠错 / 手动选择”可快速搜索并更正。</li>
                    <li>可在系统设置中调节“自动确认识别门槛”。</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: BATCH */}
          {activeTab === 'batch' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="space-y-2">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#2B78C4]" />
                  批量初始化（冒险日志全量录入）
                </h4>
                <p className="text-xs text-slate-500">
                  一键导入您在游戏中已经点亮的数十只精灵，无需逐一点击。
                </p>
              </div>

              {/* Visual Demonstration */}
              <div className="p-4 rounded-2xl bg-gradient-to-b from-sky-50 to-white border-2 border-[#D5E3F0] space-y-4">
                <div className="flex flex-col md:flex-row items-center gap-4">
                  <div className="w-full md:w-1/2 rounded-xl overflow-hidden border-2 border-sky-200 shadow-xs bg-slate-900">
                    <img
                      src="https://omisheep-img.oss-cn-guangzhou.aliyuncs.com/pic/image-20260819035347119.png"
                      alt="批量初始化界面"
                      className="w-full h-auto object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="w-full md:w-1/2 space-y-3">
                    <h5 className="font-black text-slate-800 text-xs sm:text-sm">
                      标准操作流程：
                    </h5>
                    <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside">
                      <li>在游戏界面中点击右上角的 <strong>“冒险日志 / 徽章图鉴”</strong>。</li>
                      <li>截取整页精灵头像列表（无需裁切单个头像，整屏直接截取）。</li>
                      <li>点击助手界面中的 <strong>“批量初始化”</strong> 按钮，按下 <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[10px]">Ctrl+V</kbd> 粘贴。</li>
                      <li>AI 自动进行网格切分并对每个头像独立推理，预览无误后点击“一键应用”。</li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-emerald-50 border-2 border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-start gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">智能判重保护：</span>
                  已点亮的精灵不会被重复覆盖或误清空；对于识别有歧义的头像，系统会标黄提示，您可以直接点击该格子手动挑选正确精灵。
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: FEATURES & SHORTCUTS */}
          {activeTab === 'features' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="space-y-2">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Search className="w-4 h-4 text-[#2B78C4]" />
                  图鉴检索、属性筛选与快捷键
                </h4>
                <p className="text-xs text-slate-500">
                  支持多维度复合筛选、全键盘快捷操作与右键详细档案查看。
                </p>
              </div>

              {/* Feature Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                <div className="p-3.5 rounded-2xl border-2 border-[#D5E3F0] bg-white space-y-1.5">
                  <div className="flex items-center gap-2 font-black text-slate-800">
                    <MousePointerClick className="w-4 h-4 text-sky-500" />
                    <span>卡片交互操作</span>
                  </div>
                  <ul className="text-slate-600 space-y-1 list-disc list-inside text-[11px]">
                    <li><strong>左键单击：</strong> 切换当前精灵点亮 / 未遇状态。</li>
                    <li><strong>右键菜单：</strong> 查看精灵大图、属性系别、获取方式及纠错提交。</li>
                  </ul>
                </div>

                <div className="p-3.5 rounded-2xl border-2 border-[#D5E3F0] bg-white space-y-1.5">
                  <div className="flex items-center gap-2 font-black text-slate-800">
                    <Search className="w-4 h-4 text-emerald-500" />
                    <span>全局检索与高级过滤</span>
                  </div>
                  <ul className="text-slate-600 space-y-1 list-disc list-inside text-[11px]">
                    <li>支持输入中文名或拼音首字母模糊搜索（如“hk”搜索“火花”）。</li>
                    <li>支持按主系别（草/火/水/电/幽灵等）与遇怪状态复合筛选。</li>
                  </ul>
                </div>
              </div>

              {/* Shortcuts Table */}
              <div className="rounded-2xl border-2 border-[#D5E3F0] overflow-hidden">
                <div className="bg-[#F0F6FC] px-4 py-2 border-b border-[#D5E3F0] text-xs font-black text-slate-700">
                  ⌨️ 实用快捷键列表
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  <div className="p-2.5 px-4 flex items-center justify-between">
                    <span className="text-slate-600">粘贴截图至识别区</span>
                    <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-slate-700">Ctrl + V</kbd>
                  </div>
                  <div className="p-2.5 px-4 flex items-center justify-between">
                    <span className="text-slate-600">快速打开全局搜索</span>
                    <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-slate-700">Ctrl + F</kbd>
                  </div>
                  <div className="p-2.5 px-4 flex items-center justify-between">
                    <span className="text-slate-600">关闭当前弹窗 / 返回</span>
                    <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono font-bold text-slate-700">Esc</kbd>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: FAQ */}
          {activeTab === 'faq' && (
            <div className="space-y-4 animate-in fade-in duration-200 text-xs">
              <div className="space-y-2">
                <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-[#2B78C4]" />
                  常见疑问与解答 (FAQ)
                </h4>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl bg-white border-2 border-[#D5E3F0] space-y-1.5">
                  <h5 className="font-black text-slate-800 text-xs flex items-center gap-1.5">
                    <span className="text-[#2B78C4]">Q：</span> 软件会影响游戏账号安全吗？
                  </h5>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    <strong>A：绝对安全。</strong> 助手完全采用外置图像识别技术（YOLO + OCR），运行在本地沙盒环境中，不注入任何游戏进程、不读取或修改游戏内存数据，相当于为玩家提供一个智能记事本。
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border-2 border-[#D5E3F0] space-y-1.5">
                  <h5 className="font-black text-slate-800 text-xs flex items-center gap-1.5">
                    <span className="text-[#2B78C4]">Q：</span> 某些稀有精灵或新形态识别不准确怎么办？
                  </h5>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    <strong>A：</strong> 您可以直接在卡片上点击 <strong>手动纠错</strong>，或者在图鉴卡片上 <strong>右键点击 &gt; 反馈错误</strong>。我们的图鉴库支持热更新，后台收到纠错样本后会快速迭代模型。
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border-2 border-[#D5E3F0] space-y-1.5">
                  <h5 className="font-black text-slate-800 text-xs flex items-center gap-1.5">
                    <span className="text-[#2B78C4]">Q：</span> 换电脑或重装后，已点亮的进度会丢失吗？
                  </h5>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    <strong>A：</strong> 进度默认保存在本地 SQLite 数据库中。如果您登录了账号，数据会自动与云端双向同步，换机登录即可无缝恢复。
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-white border-2 border-[#D5E3F0] space-y-1.5">
                  <h5 className="font-black text-slate-800 text-xs flex items-center gap-1.5">
                    <span className="text-[#2B78C4]">Q：</span> 遇到 Bug 或有好的建议如何反馈？
                  </h5>
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    <strong>A：</strong> 点击右上角的 <strong>“群聊反馈”</strong> 按钮，可以直接提交在线反馈工单，也可以扫码加入我们的玩家交流 QQ 群一起交流！
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-[#F0F6FC] px-5 py-3 border-t-2 border-[#D5E3F0] flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span>使用手册可根据版本持续补充更新</span>
          </div>
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              onClose();
            }}
            className="w-full sm:w-auto px-5 py-2 rounded-xl bg-[#2B78C4] hover:bg-[#2063A5] text-white text-xs font-black transition-colors cursor-pointer shadow-xs text-center"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
};
