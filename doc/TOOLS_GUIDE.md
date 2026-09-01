# tools/ 工具脚本指南

*2026-09-01 基于 tools/ 目录重组（map/pet/release/dev 分组）后的代码整理，内容均来自各脚本 docstring 与源码，未改动任何脚本。*

tools/ 是**离线工具箱**：不进 PyInstaller 运行时包，只在开发/数据制作/发布时手工执行。运行方式均为在**项目根目录**下 `python tools/<组>/<脚本>.py`。

运行环境约定：

| 环境                    | 用途                                                   |
| --------------------- | ---------------------------------------------------- |
| `rocokingdom_prod`    | 运行时/打包环境（CPU 推理栈），多数轻量脚本可用                           |
| `rocokingdom_dev_gpu` | GPU 训练环境（torch+cuda/timm/cv2），重型脚本 docstring 中硬编码此路径 |
| `rocokingdom`         | 通用轻量开发                                               |

## 目录总览

codebase_overview

---

## 一、根目录（发布核心，build.bat 直接调用）

### pack_update.py（600 行，⭐ 核心）

一键打包自动更新包（零参数，配置自动从项目读取）。读取 dist/ 应用目录、`config.APP_VERSION`、`core/api/updater.py` 的包名，产出：内外双层 7z（LZMA2）、≤90MB 分片、相对历史版本快照的增量包（含 removed.txt + 新清单）、`manifests/<version>.json` 快照，并自动回写 `version.json` 的 auto_update/deltas 字段。

- 用法：`python tools/pack_update.py`｜`--data-manifest-only`（打包前仅刷新数据清单，build.bat 第 3 步用）
- 环境：`rocokingdom_prod`（build.bat 默认）

### inject_auth_secret.py（55 行）

构建期密钥注入：读 `auth_secret.txt`（gitignored）→ 生成 XOR 混淆的 `core/auth/_auth_secret.py` + PYZ 加密口令 `build_key.txt`。docstring 自述"只是提高逆向门槛，并非绝对安全"。

- 用法：`python tools/inject_auth_secret.py`（build.bat 在 pyinstaller 前自动执行）

---

## 二、map/ — 地图制作与小地图定位管线（21 个）

典型流水线顺序：**下载瓦片 → 拼接大图 → 填充补缺 → 缩放/切片 → 空气墙提取/导出**；定位相关脚本独立成组。

### 瓦片获取与大图拼接

| 脚本                                | 用途                                                                                                              | 环境             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| `download_17173_tiles.py`（102 行）  | 下载并拼接 17173 Terra 地图瓦片（需先从网页 Network 确认瓦片范围）                                                                    | 通用             |
| `fetch_17173_map_tiles.py`（160 行） | 下载 17173 瓦片到 `assets/mapsrc`（坐标系已按页面实测修正：x 向下、y 向右），支持矩形范围与 `--auto` 种子探测                                       | 通用             |
| `stitch_map.py`（478 行）            | 把游戏截图**增量**拼成高清大图：SIFT 特征 + estimateAffinePartial2D 对齐，去重叠、无黑缝、空缺区透明（RGBA），产物 `assets/mapsrc/my_map.png` + meta | dev_gpu        |
| `map_capture_app.py`（581 行）       | 桌面 GUI 小工具：框选游戏地图区域 → 截图 → 自动拼进大图 → 即时显示（复用 stitch_map）                                                         | dev_gpu + 桌面会话 |

### 填充与缩放切片

| 脚本                                     | 用途                                                                  | 环境      |
| -------------------------------------- | ------------------------------------------------------------------- | ------- |
| `fill_map.py`（88 行）                    | cv2.inpaint 内容感知修补大图白色/透明夹缝（多尺度 + 羽化；docstring 注明生成内容是"近似/虚构"）      | dev_gpu |
| `smooth_fill_map.py`（93 行）             | 另一种补边方案：边缘羽化渐变到底色 #F1EADF，输出 PNG+WEBP（硬编码输入输出路径）                    | dev_gpu |
| `process_super_map.py`（119 行）          | 超大图处理：透明区填充 #F1EADF + WEBP 压缩瘦身（解除 PIL 像素上限）                        | 通用      |
| `resize_to_8192.py`（41 行）              | 大图直接拉伸到 8192×8192（硬编码路径，输出 assets/mapsrc/slim/）                     | 通用      |
| `resize_to_8192_proportional.py`（54 行） | 等比缩放后居中贴到 8192×8192 画布（不变形）                                         | 通用      |
| `slice_map_tiles.py`（72 行）             | 大图缩放 8192² 后切 32×32=1024 片 256px 瓦片，命名 `{4064+x}_{4064+y}` 对齐前端世界坐标 | dev_gpu |
| `slice_8192_to_256.py`（54 行）           | 把 slim/my_map.png（8192²）切成 256px 瓦片（硬编码路径）                          | 通用      |
| `slice_my_map.py`（57 行）                | 把 mapdata_real/my_map_slim.png 切 1024px 瓦片并补底色（硬编码路径）               | 通用      |
| `convert_black_to_beige.py`（39 行）      | 把前端 `mapdata_real/aligned_tiles_256` 瓦片中的纯黑像素（≤5）替换为底色 #F1EADF      | 通用      |

### 空气墙（可通行区域边界）

| 脚本                                | 用途                                                                                                                           | 环境              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `extract_map_airwall.py`（450 行）   | 从拼接图提取空气墙闭合折线：**纯 Pillow + 标准库**（无 numpy/cv2），输出 JSON/GeoJSON/SVG，坐标系遵循标准 slippy-map 约定（文档：`docs/map-airwall-coordinate.md`） | 通用（rocokingdom） |
| `export_airwall_levels.py`（187 行） | 由 level_10 权威空气墙按 2 倍缩放导出 level 11/12/13（已交叉验证四层边界归一化后形状一致，像素级差异仅 ~0.1%）；`from extract_map_airwall import` 复用其函数             | 通用              |

### 小地图定位（实验/训练，⚠️ 与运行时方案不同）

> 运行时实际生效的是 `core/vision/map_localizer.py` 的 NCC 模板匹配状态机；以下是离线实验与 CNN 定位模型管线（`docs/map-localization-model.md`）。

| 脚本                                 | 用途                                                                                                    | 环境             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| `localize_minimap.py`（290 行）       | 传统 CV 定位：SIFT/ORB/FFT 加速 NCC（含尺度/旋转搜索）。docstring 自述颜色方案全失败、准确率 0，**已废弃但保留**                           | 通用             |
| `build_map_orb_index.py`（87 行）     | 为 ORB/phash 粗定位建网格索引（输出 train/phash/orb_index.pkl），配套上面的废弃方案                                          | 通用             |
| `annotate_pairs.py`（211 行）         | 交互式 GUI 标注：把小地图对齐到大地图生成训练对 `pairs.csv`（path,cx,cy,rw）                                                 | dev_gpu + 桌面会话 |
| `train_localizer.py`（414 行）        | 训练 CNN 定位模型：颜色不变结构特征（梯度/LBP/Laplacian）+ 合成样本增强，输出 32×32 热图 + 尺度                                       | dev_gpu        |
| `localize_minimap_model.py`（185 行） | 用 localizer.pt 推理：单次前向毫秒级 + 小范围结构 NCC 细定位（`from train_localizer import` 复用）                           | dev_gpu        |
| `debug_map_localize.py`（61 行）      | 运行时定位链路的**耗时分解调试**（capture/normalize/template/similarity/search 五段计时），直接调 `core.vision.map_localizer` | prod           |

---

## 三、pet/ — 图鉴数据管线（6 个）

流向：**BiliWiki 抓取（头像/属性）→ 命名对齐 → map_pets 重映射 → DINOv2 特征库重建**。

| 脚本                             | 用途                                                                                                                       | 环境             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `fetch_heads.py`（211 行）        | MediaWiki API 批量下载全部 `Head_*` 精灵头像 + 编号↔精灵名映射；支持断点续传、并发、按编号筛选                                                            | 通用             |
| `fetch_pet_info.py`（529 行）     | 抓取全图鉴属性生成 `datasets/roco_all_pets_info.json`：解析 image 目录形态名 → 枚举 `Category:精灵` → 解析 `{{精灵信息}}` 模板 → 匹配落库，附 review 人工核对文件 | dev_gpu（有缓存秒出） |
| `align_heads.py`（222 行）        | 把 BiliWiki 编号头像对齐到数据库 id 命名（`<id>_<seq>_<名>.png` 规范），同 id 多形态按 01/02 序号固化                                                | 通用             |
| `remap_map_pets.py`（219 行）     | map_pets1.json 旧命名 → 新库命名：override 表 > 归一化精确 > 包含匹配 > 基础形态兜底，支持 `--dry-run`                                              | 通用             |
| `remap_map_pets_now.py`（163 行） | ⚠️ **一次性脚本**（化蝶改名事件的临时对齐），规则与上面类似但针对那次 datasets.db 重建，保留未清理                                                              | 通用             |
| `rebuild_pipeline.py`（193 行）   | 一键重建 DINOv2 特征库：test 过滤占位图 → 对齐 image 形态序号并入 image_full → 重新提特征生成 `feature_icon_dino_full/_pure.pkl`（识别模型更新的标准入口）        | dev_gpu        |

---

## 四、release/ — 发布配置（1 个）

| 脚本                     | 用途                                                                                                                                 | 环境 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -- |
| `meta_config.py`（98 行） | 生成加密 `resources/meta.bin`（授权服务器/飞书 webhook 等"可能会变"的地址），与 `core/auth/meta_crypto.py` 共用口令；`--show` 查看、参数式或交互式写入，推送 Gitee 后客户端下次启动生效 | 通用 |

## 五、dev/ — 开发辅助（1 个）

| 脚本                      | 用途                                                             | 环境 |
| ----------------------- | -------------------------------------------------------------- | -- |
| `preview_hint.py`（89 行） | 预览启动/退出提示窗样式（`bootstrap/splash.py` 的 Tk 进度条），支持颜色/文案/透明度参数即时预览 | 通用 |

## 六、wiki/ — 草系试炼数据核对（一次性）

| 脚本                          | 用途                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `parse_grass_trial_data.py` | 把 biligame 的 `Module:GrassTrialData`（Lua）解析为 `grass_trial_data.json`；只写 tools/wiki 内部 |
| `compare_wiki.py`           | wiki 草系试炼清单 vs `datasets/map_pets1.json` 按名字对齐比对，产出 `wiki_vs_map_pets1_report.md`     |

---

## 备注与注意事项

- **术语区分**：本目录 map/ 组服务的是【地图感知】（开放世界大世界地图制作 + 小地图定位）；与【徽章试炼】（roguelike 小游戏，关卡称图1-3）的"关卡识别"完全是两回事。跟随识别中对试炼关卡标题的 OCR/分类（`core/vision/map_classifier.py`）不要与这里的开放世界定位混为一谈。

- **硬编码绝对路径**：`resize_to_8192*.py`、`slice_8192_to_256.py`、`slice_my_map.py`、`smooth_fill_map.py`、`convert_black_to_beige.py`、`build_map_orb_index.py` 等写死 `D:\game\RocoKingdom\...`，换机器需手改。
- **一次性/遗留脚本**：`pet/remap_map_pets_now.py`（自述一次性）、`map/localize_minimap.py` + `build_map_orb_index.py`（传统 CV 方案已废弃）保留未清理。
- **路径依赖已适配**：移入子目录的 8 个脚本其 `__file__` 相对定位已加深一层（详见 2026-09-01 重构记录），在仓库根目录直接运行即可。
- 各脚本 docstring 中的用法示例仍写 `python tools/xxx.py`（旧路径），实际应为 `python tools/<组>/xxx.py`——🔴 待人工确认是否批量更新注释。
