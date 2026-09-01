# Codebase Overview

*由 learn-codebase 技能于 2026-09-01 生成，基于 commit `ea40c93`。本文档为纯静态分析结果，未对任何代码做修改。*

## Summary

**RocoKingdomRecognizer（洛克王国徽章助手）** 是一款面向《洛克王国：世界》玩家的桌面端图像识别工具。《洛克王国：世界》是腾讯「洛克王国」IP 的开放世界宠物收集 RPG。本工具通过 Windows 窗口截图 + 深度学习识别，提供**两个互不相关的功能域**：

1. **徽章试炼助手**：识别「徽章试炼」（游戏内的肉鸽小游戏）中玩家所处章节与遇到的精灵，自动点亮试炼收集图鉴；
2. **地图感知**：开放世界跑图工具，根据游戏右上角小地图画面实时定位玩家在大世界地图上的位置。

二者除共用截图/模型基础设施外，数据、场景、入口完全独立，**不可混为一谈**。产品形态为 pywebview 桌面应用（内嵌 React 前端 + 本地 Flask 服务），另有一个部署在 Vercel 的纯前端网页版图鉴（<https://roco.omisheep.cn/，无识别功能）。分发渠道为> Gitee/GitHub Releases（PyInstaller 打包 + Inno Setup 安装包 + 增量自动更新）。

## 游戏背景与功能域

### 草系徽章试炼（Badge Trial）

游戏内的 **roguelike 单人挑战玩法**（2026-07-30 开放的常驻挑战）：玩家全程只带一只精灵出战，逐章推进。共 **3 个章节**（本项目称 **图1-3**，对应 `map1/map2/map3`：记忆中的索米亚草原、记忆中的巨石阵、记忆中的普拉塔草原），每章 8 个节点共 24 节点：首节点选祝福 → 随机战斗/事件（战斗节点刷出 3 只敌方精灵供选一只挑战）→ 第 6 节点章节 BOSS → 第 7 节点休息区/商人 → 第 8 节点固定守关者。火系试炼为本项目开发环境专属内容（`dev_only`）。

**本助手在试炼中的角色**：跟随识别当前处于哪一章（图1-3）、遇到哪些精灵（标题 OCR + 图标特征检索），把「已遇见」记录到对应试炼的图鉴集合（`encounteredPets`），即"点亮图鉴"。此功能只发生在试炼小游戏内，与开放世界无关。

### 地图感知（Map Awareness）

**开放世界跑图工具**，与徽章试炼完全不同：玩家在大世界探索时，根据游戏画面右上角的圆形小地图，实时推算玩家在整个世界地图（8192×8192 世界坐标）上的位置与朝向，前端绘制位置、朝向与移动轨迹。技术上与试炼识别无任何数据交互——不读试炼配置、不用试炼白名单、不写试炼图鉴。详见 `docs/minimap-localization-manual.md`（该手册 10.2 节明确记录：试炼相关的标题/OCR 逻辑已从地图观测链路中移除）。

> ⚠️ 术语注意：文档与代码中凡出现"地图识别/地图判定"，需看上下文区分——跟随识别里的"地图"指**试炼章节（图1-3）**；地图感知里的"地图"指**开放世界大地图**。


## Tech stack

- **语言：** Python 3.12+（后端/桌面/训练/工具）、TypeScript（前端）
- **框架 / 运行时：** Flask + Waitress（本机服务，仅绑 127.0.0.1 动态端口）、pywebview（桌面窗口）、React 19 + Vite 6 + Tailwind CSS 4（前端）、ONNX Runtime（推理）
- **AI 模型：** YOLOv8（`onnx/scanner.onnx`，版面检测 title/item/name 三类）、RapidOCR / PP-OCRv4（中文文字识别 det/cls/rec 三件套）、DINOv2 ViT-S/14（`onnx/dino_backbone.onnx` 特征提取 + `feature_icon_dino_full.pkl` 特征库余弦检索）；训练侧为 PyTorch + Ultralytics + timm + ArcFace 度量学习
- **数据存储：** SQLite（`datasets/datasets.db` 精灵图标库）+ JSON（`roco_user_data.json` 用户数据、`roco_user_mapdata.json` 地图足迹、各数据集 JSON）
- **外部服务：** Gitee 仓库（版本检查、数据清单、meta.bin 远程配置分发）、自建授权服务器 `api.omisheep.cn`、飞书 webhook（用户反馈）
- **构建 / 打包：** npm + Vite（前端）、PyInstaller（`app.spec`）+ Inno Setup（`setup.iss`）、`tools/pack_update.py`（全量/增量更新包）
- **Conda 环境分工（见 build.bat 与脚本 docstring 佐证）：**
  - `rocokingdom_prod` — 运行时/打包环境（`build.bat` 默认 `CONDA_ENV`，纯 CPU 推理栈，`requirements.txt` 无 torch，`app.spec` 显式 excludes torch/torchvision/scipy）
  - `rocokingdom_dev_gpu` — GPU 训练环境（`train/train_dinov2.py`、`tools/pet/rebuild_pipeline.py` 等脚本 docstring 硬编码该 env 路径并带 `--device cuda`，需 torch+cuda/timm）
  - `rocokingdom` — 通用轻量开发环境（推断：跑 tools/ 中纯 Pillow/cv2 脚本与本地调试；`tools/map/extract_map_airwall.py` 自述"无 numpy/opencv 依赖"）


## Architecture

整体为「本地桌面应用」分层架构，前端通过两条通道与后端通信：HTTP（Flask API）与 pywebview JS Bridge。

帮我把指代不明的那些相关代码（文件名、参数名、变量名）修改一下，对于徽章试炼的地图识别，现在叫“关卡判定（或者地图判定或者章节判定）”，大世界的地图识别则才叫“开放世界大地图识别”。（前端后端都改一下）

各组件边界：

- **`main.py` / `bootstrap/`**：进程引导。DPI 感知 → 唤起已有实例 → 启动画面（Tk 独立线程）→ 命名互斥体单实例 → 后台授权校验 → `create_app()` + `desktop.run(app)`。
- **`desktop/`**：桌面容器。`server.py` 用 waitress 起本机服务（动态端口、线程数 clamp(CPU×2,2,6)）；`windows.py` 管主窗（1500×1080）与「精灵识别跟随」悬浮窗（500×650 无边框可置顶）；`bridge.py` 向前端 JS 暴露桥接 API。
- **`core/api/`**：HTTP 层，9 个蓝图直接挂根路径，负责参数校验、授权门禁、编排服务层。
- **`core/services/`**：业务服务层。`_ModelRegistry` 模型懒加载单例、试炼目录与白名单过滤、用户数据原子写（tmp + os.replace + fsync）、数据热更新（md5 对比 + 异步任务）、小地图后台抓帧线程。
- **`core/vision/`（识别引擎）**：YOLO 切图、OCR、DINO 特征检索、小地图定位，不感知 HTTP/桌面。
- **`core/infra/`（基础设施）**：日志、窗口截图、工具函数、SQLite 连接、精灵文件名规范。
- **`core/auth/`（授权）**：授权状态机、授权客户端（机器码/签名）、meta.bin 加解密。
  > 注：2026-09-01 重构将原 `core/` 平铺模块归入 vision/infra/auth 三个子包（`core/tools.py` 同时更名为 `infra/capture.py`，`auth_service.py`→`auth/service.py`，`client_server.py`→`auth/client.py`），仅移动与改名，行为不变。
- **`frontend/`**：React SPA，双视图（主窗/悬浮窗）靠 URL 伪路由区分；构建产物同步到根 `static/` 由 Flask 托管。
- **`train/` / `tools/`**：离线管线（训练、地图制作、数据抓取、发布打包），不进运行时包。tools/ 已按功能分组：`map/`（地图管线）、`pet/`（图鉴数据）、`release/`（meta 配置）、`dev/`（开发辅助），`pack_update.py` 与 `inject_auth_secret.py` 保留在 tools/ 根目录。


## Key modules

| 路径                                        | 职责                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `main.py`                                 | 桌面端入口：DPI、单实例、启动画面、授权校验、装配启动                                                |
| `config.py`                               | 全局配置：环境变量读取、远程 meta.bin 解密配置、TRIALS 试炼定义、模型/数据路径                            |
| `core/__init__.py`                        | Flask 应用工厂 `create_app()`，注册 9 蓝图 + 统一 JSON 错误处理                            |
| `core/vision/crop.py`                     | `YOLOv8ORT` 版面检测（scanner.onnx），切出标题/名字/图标区域                                 |
| `core/vision/ocr.py`                      | `OCREngine` 封装 RapidOCR，rec-only 识别 + 行聚类 + 黑名单过滤                           |
| `core/vision/recognizer.py`               | `ImageRecognizer`：DINOv2 特征 + 特征库余弦检索 `match(threshold, top_k)`             |
| `core/vision/ocr_corrections.py`          | OCR 结果词/字两级纠错（`datasets/ocr_corrections.json`）                              |
| `core/vision/world_localizer.py`          | `PlayerLocalizer`/`get_world_localizer`：【地图感知】开放世界大地图识别——小地图 NCC 模板匹配 + init/track/hold 状态机（591 行），与试炼无关 |
| `core/vision/stage_classifier.py`         | `StageClassifier`：【徽章试炼】关卡判定——关卡标题图像分类器（图1-3，OCR 失败时的回退），与开放世界定位无关     |
| `core/infra/capture.py`                   | 窗口截图双模式：PrintWindow（hwnd）/ ImageGrab（grab）                                  |
| `core/auth/service.py`                    | 授权状态机（pending/authorized/banned/offline 宽限）+ 后台轮询心跳                         |
| `core/auth/client.py`                     | 机器码（SMBIOS UUID/注册表）、HMAC-SHA256 签名、授权 HTTP                                 |
| `core/auth/meta_crypto.py`                | 远程 meta.bin 加解密（备用授权服务器/webhook 地址下发）                                       |
| `core/services/recognizers.py`            | `_ModelRegistry` 模型单例注册表（懒加载）                                               |
| `core/services/user_storage.py`           | roco_user_data.json 原子读写 + 改名迁移                                             |
| `core/services/data_updater.py`           | 数据清单 md5 对比 + 异步热更新（下载→校验→原子替换→失效缓存）                                        |
| `core/services/world_observer.py`         | 【地图感知】小地图后台抓帧线程（`_MapMonitor`）+ 状态中文翻译                              |
| `core/api/predict.py`                     | `/predict` 单图识别、`/init_batch` 批量初始化                                         |
| `core/api/follow.py`                      | `/game_status` 游戏窗口检测、`/map_observation`、`/map_monitor/*`                   |
| `core/api/updater.py`                     | 程序自更新全流程（增量/整包、断点续传、update.ps1 自我替换）                                        |
| `desktop/bridge.py`                       | `AppApi`：暴露给前端的桥（窗口控制 + `capture_and_recognize`）                            |
| `desktop/windows.py`                      | `WindowManager`：主窗 + 跟随识别悬浮窗生命周期                                            |
| `frontend/src/App.tsx` / `ScannerApp.tsx` | 主页面 / 悬浮窗页面（URL 伪路由二选一）                                                     |
| `frontend/src/services/api.ts`            | axios 封装 `ApiService`（1378 行，含离线 mock 兜底）                                   |
| `frontend/src/services/storage.ts`        | 邂逅记录三层存储（localStorage + 后端轮询同步 + sendBeacon 落盘）                             |
| `train/train_dinov2.py`                   | DINOv2 + ArcFace 度量学习训练与 ONNX 导出（主力训练脚本）                                    |
| `tools/pack_update.py`                    | 生成全量/增量更新包与 data_manifest.json                                              |
| `tools/inject_auth_secret.py`             | 构建期注入授权密钥（→ `core/auth/_auth_secret.py`，gitignored）                         |

## Data & control flow

### 路径一：跟随识别——徽章试炼（核心链路，desktop/bridge.py:118-290）

1. 悬浮窗前端调 `window.pywebview.api.capture_and_recognize(title, stage_num, trial)`。
2. 桥接层用 pygetwindow 定位游戏窗口（最小化则 restore），`core/infra/capture.capture_window(bbox, hwnd)` 按 `ROCO_CAPTURE_MODE` 选 PrintWindow/ImageGrab 截图（存 `debug/capture`）。
3. `crop.crop_sections_from_pil_by_YOLOv8()`：scanner.onnx 检测 Title/Item/Name 三类框，`cv2.dnn.NMSBoxes` 去重。
4. **试炼章节判定（图1-3）**：OCR 标题 + `match_scene_unique_char` 特征字命中（如"索米亚草原"特征字）；失败回退 `StageClassifier`（`models.get_stage_classifier`）。此处的"地图"指试炼关卡，与开放世界无关。
5. 每个槽位 `_process_single_item`：OCR 识别名字（经黑名单、Y 坐标行聚类、`ocr_corrections` 纠错）+ `recognizer.match(0.25, 36)` DINO 特征检索图标；两路结果合并去重，`trial_filter` 按当前试炼白名单过滤。
6. 结果 `{code:200, stage_num, results}` 作为桥接 Promise 返回值直接回前端；前端再经 `/api/storage` 落盘用户数据。无 SSE/WebSocket 推送。

### 路径二：地图感知——开放世界大地图识别（core/vision/world_localizer.py + services/world_observer.py）

与路径一完全独立：不经过试炼配置、不做标题 OCR、不写试炼图鉴。`_MapMonitor` 后台线程按 `MAP_MONITOR_INTERVAL`(1.5s) 抓帧 → HoughCircles 定小地图圆 → 归一化 200×200 → `global_localize_topk` 在 8192²（缩 0.25）参考底图上多尺度 `cv2.matchTemplate(TM_CCOEFF_NORMED)` 粗搜 + 细搜。`PlayerLocalizer` 状态机（init-pending → confirmed → track / hold / weak-hold / switch-pending）做时序约束：相邻帧相似度 ≥0.93 判原地、位移 >150px 判跳变、首次锚定需 `INIT_CONFIRM_FRAMES=2` 帧确认且分数 ≥0.5。前端轮询 `GET /map_observation` 非阻塞读取最新结果。

### 路径三：授权（core/auth/service.py）

启动时 `start_auth_check()` 起后台线程：机器码（SMBIOS UUID → 注册表 MachineGuid 哈希，SF- 前缀）+ HMAC-SHA256(机器码+timestamp) 签名 → POST 授权服务器（主地址 `api.omisheep.cn`，失败回退 meta.bin 下发的备用地址）→ 状态机 pending/waiting/banned/expired/authorized/offline(宽限) + 周期心跳。前端 `authStore` 轮询 `/api/local/auth_status`，未授权时 `featureLock.ts` 锁定识别功能。`/predict`、`/init_batch` 服务端先过 `is_authorized()` 门禁。

### 状态与配置位置

- 运行时配置：`config.py`（环境变量 `ROCO_*` 可覆盖）+ 远程 `resources/meta.bin`（加密，进程内只抓一次）。
- 用户数据：exe 同级 `roco_user_data.json`（encounteredPets/thresholds/appSettings，版本号=毫秒时间戳）、`roco_user_mapdata.json`。
- 图鉴数据：`datasets/datasets.db`（icons 表）、`roco_all_pets_info.json`、`map_pets1/2.json`。
- 模型：`onnx/`（scanner/dino_backbone/OCR 三件套 + pkl 特征库）。

## Entry points

- **桌面应用**：`main.py` → `bootstrap/` → `core.create_app()` → `desktop.run(app)`（waitress 线程 + pywebview 事件循环）。
- **前端**：`frontend/src/main.tsx`（按 URL 分流 `App` / `ScannerApp`）。
- **训练**：`train/train_dinov2.py`（DINOv2 度量学习）、`train/yolo/train.py` + `export_onnx.py`（scanner.onnx）。
- **打包**：`build.bat`（六步流水线，见下）。
- **更新包**：`tools/pack_update.py`。

## Build, run, and test

命令均来自 `build.bat`、`package.json`、`frontend/package.json`、`app.spec`，未做猜测：

```bat
:: 安装运行时依赖（conda env: rocokingdom_prod）
pip install -r requirements.txt

:: 开发运行（开发环境判据：无 sys._MEIPASS）
python main.py

:: 前端开发 / 构建（frontend/package.json）
cd frontend
npm install
npm run dev           :: vite dev，API 指向 http://127.0.0.1:5000
npm run build         :: → dist/，postbuild 自动同步 index.html+assets 到根 static/
npm run build:web     :: --mode web → dist-web/（Vercel 纯前端版图鉴）

:: 整体打包流水线（build.bat，conda env 参数默认 rocokingdom_prod）
build.bat [conda_env]  :: npm build → 激活conda → 注入授权密钥 → 刷新manifest
                       :: → pyinstaller app.spec → pack_update → Inno Setup (setup.iss)

:: 网页版构建（build-web.bat）
build-web.bat          :: frontend build:web → robocopy 到 D:\game\RocoKingdomRecognizerWeb\dist

:: 训练（conda env: rocokingdom_dev_gpu，需 torch+cuda）
python train/train_dinov2.py --device cuda
```

**测试：本仓库无测试体系。** `test/` 目录仅 1 个 py 文件，无 pytest/unittest 配置，无 CI（无 `.github/`）。

## Conventions

- **环境判别**：以 `sys._MEIPASS` 区分打包/开发环境；资源路径一律走 `config.get_resource_path()`（包内）与 `config.get_external_path()`（exe 同级，用户数据）。
- **配置覆盖**：所有"可能会变"的值走 `_env("ROCO_*", default)`；服务器地址等机密走远程加密 meta.bin 下发。
- **模型懒加载**：重资源（YOLO/OCR/DINO）全部经 `core/services/recognizers.py` 的 `_ModelRegistry` 单例按需加载。
- **JSON 原子写**：tmp 文件 + `os.replace` + fsync（`user_storage.py`），版本号为毫秒时间戳用于前后端同步协商。
- **API 响应**：统一 `core/api/response.py` 的 `ok()/error()` 包络；识别结果结构 `(id, seq, name, score)`。
- **命名**：精灵图标文件名规范 `<id>_<seq>_<名>.png`（`core/infra/pet_path.py`）；改名通过 `pet_renames.json` 迁移兼容。
- **前端**：无路由库、无状态库；自写 store + `useSyncExternalStore`；pywebview api 经 `(window as any)` 调用（无类型声明）；请求失败有 mock 兜底（web 静态版 `IS_STATIC=true` 时隐藏识别/授权/更新功能）。
- **注释文化**：关键技术决策直接写在代码注释里（如 main.py 启动顺序、授权宽限期），新贡献者应读注释再动手。


## Risks & rough edges

**安全类（建议优先关注）：**

| 问题                                                           | 位置                                |
| ------------------------------------------------------------ | --------------------------------- |
| 授权请求 `verify=False` 关闭 TLS 校验，可中间人                           | `core/auth/client.py:210`         |
| `subprocess shell=True` 取硬件信息                                | `core/auth/client.py:102,139,146` |
| meta.bin 加密口令硬编码，作者自注"仅混淆"                                   | `core/auth/meta_crypto.py:27`     |
| 更新包仅 md5 无签名校验 + `update.ps1` 以 `-ExecutionPolicy Bypass` 执行 | `core/api/updater.py:526`         |
| chat.json 远程内容无校验直接回写本地并下发所有客户端                              | `core/api/main.py:133-152`        |
| 密钥文件平铺仓库根（虽 gitignored）                                      | `auth_secret.txt`、`build_key.txt` |
| 飞书 webhook URL 明文存于 config.py                                | `config.py:110-113`               |

**工程类：**

- 未授权放行返回 HTTP 200（`core/api/predict.py:60,152`、`follow.py:31`），语义混淆。
- `updater.py` 全局可变状态无线程锁（对比 `data_updater.py` 有 `_JOB_LOCK`）；更新目录用相对路径依赖 CWD。
- 多处强制 `os._exit(0)`（`desktop/__init__.py:78,118`、`updater.py:533`），跳过清理钩子。
- `desktop/bridge.py:91` 操作 pywebview 私有属性 `_Window__on_top`，升级易碎；`bridge.py:177` 硬编码 3 槽位。
- OCR 黑名单含单字（"夕/额/外"），宠物名含这些字会被误删（`core/vision/ocr.py:153`）；`ocr_corrections.json` 字级纠错靠人工维护。
- 新旧识别链路并存：`core/vision/processor.py`、`core/infra/utils.py`（固定坐标旧方案）与 YOLO 新链路职责重叠。
- 前端单文件膨胀（`api.ts` 1378 行、`ScannerApp.tsx` 1325 行）；`/api/recognize` 已废弃但归一化死代码留存（`api.ts:756-839`）；失败 mock 兜底在生产环境行为不透明（`checkGameStatus` 失败返回 `isRunning:true` 尤其危险）。
- 一次性/遗留脚本堆积无清理标记：`tools/pet/remap_map_pets_now.py`、`train/features/`、废弃的传统 CV 定位（`tools/map/localize_minimap.py`，自述准确率 0）；tools/ 大量硬编码绝对路径。
- 版本不同步：`setup.iss` 写死 1.4.5，`version.json`/`Output/` 安装包为 1.4.4。
- `onnx/feature_icon_dino_full.pkl.bak` 备份文件会被 app.spec 打进安装包。
- 无自动化测试、无 CI。


## Glossary / where to look next

- **《洛克王国：世界》**：腾讯「洛克王国」IP 的开放世界宠物收集 RPG。本项目是它的第三方图像识别辅助工具。
- **徽章试炼（Trial）**：游戏内 **roguelike 单人挑战小游戏**（草系 2026-07-30 开放）。3 个章节（本项目称图1-3，即 `map1/map2/map3`），每章 8 节点共 24 节点，含章节 BOSS（第6节点）与固定守关者（第8节点）；战斗节点刷 3 只敌方精灵选一只打。每章**顶部有关卡标题**——本项目的章节识别正是对该标题做 OCR + 特征字命中，失败时回退标题图像分类器 `StageClassifier`（此"关卡判定"＝试炼关卡识别，≠ 开放世界大地图识别）。本项目在试炼中负责点亮「已遇见精灵」图鉴。草系为正式内容、火系为开发专属（`config.TRIALS`，`dev_only` 标记）。定义见 `config.py:125-224`，过滤逻辑见 `core/services/trial_filter.py`。
- **地图感知（Map Awareness）**：开放世界跑图工具，与徽章试炼完全无关。根据游戏右上角小地图实时定位玩家在世界地图上的位置（NCC 模板匹配 + 状态机）。读 `docs/minimap-localization-manual.md`（工程手册）+ `core/vision/world_localizer.py`；坐标系见 `docs/map-localization-coordinate.md`；前端 `frontend/src/components/Tool/MapAwareness.tsx`。
- **跟随识别**：悬浮窗实时截图识别（徽章试炼场景）。读 `desktop/bridge.py` → `core/vision/crop.py` → `core/vision/recognizer.py` / `core/vision/ocr.py`。
- **授权协议**：`docs/AUTH_PROTOCOL.md` + `core/auth/service.py` / `core/auth/client.py`。
- **识别模型训练**：`train/train_dinov2.py`（现行 DINOv2 方案）；历史方案 `train/train_metric_gpu.py`（ResNet50）。
- **地图制作管线**：`tools/`（下载瓦片→拼接→填充→切片→空气墙提取），空气墙坐标系见 `docs/map-airwall-coordinate.md`。
- **发布**：`build.bat` → `app.spec` → `tools/pack_update.py` → `setup.iss`；版本清单 `version.json`。
- **试炼开荒图鉴（火系）**：`docs/trial-atlas-*.md` 三篇（设计/实现/投票状态机）。
