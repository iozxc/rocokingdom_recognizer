# 小地图玩家定位工程说明书

本文档记录「从游戏小地图中定位玩家(箭头)在大地图中的精确 XY 坐标」这一任务从
开始到当前状态的全部工程信息：背景、数据、坐标系与对齐关系、运行方式、内部实现、
常量、已验证结果以及后续扩展方向，方便之后继续对话时直接引用。

> 数据根目录：`D:\game\RocoKingdom\train\dataset`
> 核心脚本：`D:\game\RocoKingdom\train\dataset\map_reg\run_localize_test.py`

---

## 一、项目概述

目标：给定一张「真实环境」下的圆形小地图(小地图，含玩家箭头、UI 图标、金色/雪地/草地
等不同地形)，用 **零训练(0-shot / 无学习)** 的纯图像处理方式，在地图底图(大图)中找到
该箭头(玩家)的精确像素坐标，并把坐标同时表达在 `mapdata`(生产环境无UI底图) 与
`mapdata_real`(真实截图拼接底图) 之下，使两图在同一个 XY 下对应同一个世界位置。

关键前提(用户提供)：
- 小地图**一定是圆形的**，且**玩家箭头永远在圆心**。→ 玩家在小地图里的像素位置 =
  圆盘(disc)圆心，无需依赖箭头颜色检测。
- 连续时间段内坐标连续(玩家不会瞬移)；若图片帧非常相似(几秒内) → 判定玩家在同一位置；
  若从“连续”突然“断开” → 判定切换了场景。→ 可加入时序连续性约束与切换(switch)检测。
- 不同小地图分辨率可能不同(如从 19 号开始分辨率变小)，需要统一分辨率。
- 小地图颜色可能有偏差、有 UI 遮挡。

---

## 二、数据目录与文件

```
D:\game\RocoKingdom\train\dataset
|-- mapdata\                 # 生产环境无UI地图，1024 张 256x256 瓦片
|   `-- {x}_{y}.png`         # x,y ∈ [4064,4095]，共 1024 张；拼接成 8192x8192
|-- mapdata_real\            # 真实截图拼接底图
|   |-- my_map.png           # 8192x8192 RGBA，即真实瓦片 tiles_256 逐行拼接；带UI(米色边框)+黑边
|   |-- tiles_256\           # 1024 张 256x256 瓦片 tile_{r}_{c}.png
|   |-- my_map_aligned.png   # my_map.png 经 homography 对齐到 clean 坐标系后的 8192x8192
|   `-- aligned_tiles_256\   # 对齐后的 1024 张瓦片，命名与 mapdata 一致 {x}_{y}.png
|-- small_map\               # 最初的 4 张真实小地图(用于校准)
|   `-- small_map_1..4.jpg
|-- pairs.csv                # 这 4 张的近似中心坐标(clean 系)，用于验证
|-- map_reg\                 # 定位测试工作区
|   |-- run_localize_test.py # 核心测试脚本(含 --track 连续性跟踪)
|   |-- _ref_clean_8192.npy  # 已缝合的 clean 大图缓存(8192x8192)
|   |-- _ref_real_clean_8192.npy # clean 系下的真实底图缓存(空洞用clean填补)
|   |-- test\                # 你的测试小地图
|   `-- test\result\         # 输出：每张 *_result.png、overview.png、results.csv
|-- yolo_minimap\            # 全屏画面->小地图截取(替代 YOLO)
|   `-- capture_minimap.py   # capture_minimap(frame) 截取右上角圆形小地图
```

各图的用途：
- `mapdata`：无 UI、颜色偏“生产美术”，作为**展示/参考**坐标系的底图。
- `mapdata_real/my_map.png`：真实截图，与真实小地图渲染一致，用于**匹配**更准。
- `my_map_aligned.png` / `aligned_tiles_256`：把真实底图对齐到 clean 坐标系，使
  「一个 XY 在两张图上表达同一个世界位置」。

---

## 三、坐标系与对齐关系(重点)

### 3.1 clean 坐标系(基准坐标系)
- 由 `mapdata/{x}_{y}.png` 拼接，尺寸 8192x8192。
- 拼接规则：`pixel(x-4064, y-4064)` 那块 256x256 瓦片来自 `{x}_{y}.png`；
  即 **x 对应行(纵向)，y 对应列(横向)**(第 1 个参数在上/行，第 2 个参数在右/列)。
- 玩家坐标就用这个 clean 系像素坐标表示。

### 3.2 对齐：real ↔ clean
- 早期用 SIFT + RANSAC 匹配两张 8192x8192 大图(均下采样到 0.5x)得到单应阵。
- `train\dataset\_H_real_to_clean.npy`：real→clean。
  - 数值近似：`scale≈0.872, 平移≈(435, 412)`(即 `clean ≈ 0.872*real + (435,412)`)。
- `train\dataset\_H_clean_to_real.npy`：clean→real(逆)。
  - 数值近似：`scale≈1.146, 平移≈(-498, -471)`。
- 结论：两张底图**并非逐像素对齐**；真实截图(`my_map.png`)把岛屿放大约 1.146 倍。
  因此“同一个世界点”在两张图的**原始像素不同**；必须用上面的单应阵互相转换，
  或在同一条件系下用对齐后的图。

### 3.3 对齐产物
- `my_map_aligned.png`：`warpPerspective(my_map.png, H_real_to_clean, (8192,8192))`，
  此时岛屿内容与 clean 逐像素对齐；未覆盖区域 alpha=0(黑)。
- `build_real_ref()`(见下)：把对齐后的 real 按 alpha 叠加到 clean 上，得到一张
  「真实渲染 + clean 海洋兜底」的完整参考图，即匹配所用的参考底图。

### 3.4 为什么用真实底图匹配
- 小地图是真实截图，与 `mapdata_real` 同属真实渲染管线，配色/纹理一致；
  用其匹配得分显著更高(约 0.45~0.75)，比 clean(约 0.39~0.60)更稳。
- 匹配结果落在 clean 系，因此可直接画到 `mapdata` 上，满足「一个 XY 两图通用」。

---

## 四、运行方式

### 4.1 基础批量定位(默认)
```bash
cd D:\game\RocoKingdom
python train\dataset\map_reg\run_localize_test.py
```
- 默认 `--test` = `train\dataset\map_reg\test`；`--out` = `train\dataset\map_reg\test\result`。
- 处理 test 下所有 `*.png/jpg/jpeg/bmp`，逐张输出：
  - `{name}_result.png`：三联图「归一化小地图 ｜ mapdata 大图裁剪(红点=预测玩家) ｜ real 大图裁剪(白圈)」。
  - `overview.png`：整张 mapdata，标出所有预测点。
  - `results.csv`：`name, pred_x, pred_y, scale_f, score, status, sim, w, h`。

### 4.2 时序连续性定位/切换检测
```bash
python train\dataset\map_reg\run_localize_test.py --track
```
- 按文件名自然序(如 `29_1,29_2,...,29_8,30_1,...,30_8,31`)当作时间流处理。
- 每帧输出 `status`∈{`init`,`track`,`hold`,`switch`} 与 `sim`(相邻帧相似度)。
- 结尾打印「连续性总览」：列出各帧状态、以及 switch 帧的跳变距离。

### 4.3 自定义参数
```bash
python train\dataset\map_reg\run_localize_test.py --test <dir> --out <dir> [--track]
```

---

## 五、内部实现(逐函数)

统一约定：`TEMPLATE=200`(归一化小地图边长)，`VIEW_R=100`(小地图显示的世界视半径，像素)，
归一化后圆盘半径 = `TEMPLATE/2 = 100`，因此**尺度先验**：
`f_prior = VIEW_R / (TEMPLATE/2) = 100/100 = 1.0`(世界像素 / 模板像素)。

### 参考大图
- `build_clean()`：读 `mapdata` 瓦片拼成 8192x8192；缓存到 `_ref_clean_8192.npy`。
- `build_real_ref(clean)`：读 `my_map_aligned.png`(RGBA)，按 `alpha` 把真实像素叠到
  clean 上填补黑区，得到完整真实参考图；缓存到 `_ref_real_clean_8192.npy`。

### 小地图预处理
- `disc_center(img)`：灰度高斯模糊后用 `HoughCircles` 找主圆，返回 `(cx,cy,r)`；
  **玩家像素 = (cx,cy)**(箭头在圆心)。找不到则回退图像中心。
- `normalize_disc(mm)`：以 `(cx,cy)` 为中心裁一个边长 `2r` 的方块并 `resize` 到
  `TEMPLATE x TEMPLATE`。→ 实现「所有小地图统一到同一分辨率(200x200)」。
- `make_template(norm)`：在圆心 `(TEMPLATE/2)` 处用 `inpaint` 抹掉箭头(半径16)，
  转灰度；把圆盘外(半径 `0.46*TEMPLATE`)填为该圆盘均值，避免 NCC 退化。
- `disc_similarity(a,b)`：只取圆盘区做灰度 `corrcoef`，得到相邻帧相似度 `sim`。
- `frame_key(fn)`：用于自然排序，`29_1 → (29,1)`，`31 → (31,0)`。

### 定位(核心)
- `global_localize(tpl, ref_g25)`：粗搜。在 0.25x 参考灰度上，对 `f ∈ [0.8,1.3]*f_prior`
  逐档滑动模板做 `TM_CCOEFF_NORMED`(对 NaN 保护)，返回 `(score, f, pos)`，
  `pos = topleft + (TEMPLATE/2)*f`(即把圆盘中心映射回世界)。
- `refine_local(tpl, ref_g, x0,y0,f0)`：精修。在**全分辨率**参考图上、以 `(x0,y0)` 为中心的
  局部窗口内，对更细的 `f`(步长0.008)与更细偏移做局部 NCC，得到亚像素级结果。
- `constrained_localize(tpl, ref_g25, px,py)`：**受限搜索**。只在
  `max_jump + VIEW_R` 的窗口内搜索上一帧位置附近，用来实现「限制识别范围」、
  防止金色重复区把位置跳到很远的假匹配。

### 连续性跟踪(`--track`)
- 初始帧 / 切换后帧：`global_localize + refine_local`，`status=init|switch`。
- 相邻帧相似度 `sim ≥ SIM_HOLD`：(几乎相同帧)→ 保持上一位置，`status=hold`。
- 否则做 `constrained_localize`；若 `score ≥ TRACK_MIN` 且跳变 ≤ `MAX_JUMP`：
  → 在该点附近 `refine_local`，`status=track`(连续)。
- 否则(受限匹配差或跳变过大)→ 重新全局定位，`status=switch`(场景切换/新片段)。

### 常量(可调)
| 常量 | 值 | 含义 |
|---|---|---|
| `VIEW_R` | 100.0 | 小地图显示的世界视半径(px) |
| `TEMPLATE` | 200 | 归一化小地图边长 |
| `MAX_JUMP` | 70.0 | 相邻帧最大合理移动(px)，超此判为 switch |
| `TRACK_MIN` | 0.38 | 接受“连续”匹配的最小 NCC 得分 |
| `SIM_HOLD` | 0.93 | 相邻帧相似度阈值，高于则判同一位置 |
| `QUAD` | 0.46 | 圆盘半径占小地图短边比例(老口径，兼容) |

例：`f_prior ≈ 1.0`；对 177px 小地图圆盘半径约 `0.46*177≈81px`，`f≈1.03~1.1`；
对更大(如 237px)小地图 `f≈0.9~1.05`。

---

## 六、已验证结果

用最初的 4 张真实小地图 `small_map_1..4.jpg` 与 `pairs.csv` 交叉验证(clean 系像素)：

| 地图 | 本流程结果 | pairs.csv 参考 | 偏差 |
|---|---|---|---|
| small_map_1 | (4204, 4488) | (4206, 4490) | ≤3px |
| small_map_2 | (3668, 4395) | (3670, 4401) | ≤6px |
| small_map_3 | (3720, 4491) | (3718, 4500) | ≤9px |
| small_map_4 | (3710, 4558) | (3713, 4558) | ≤3px |

换算到 real 系(clean→real)：`(4326,4674)`、`(3709,4568)`、`(3769,4678)`、`(3758,4755)`。

### 金色序列连续性演示(29/30/31，均为金色难识别背景)
| 帧 | 状态 | 位置 | 说明 |
|---|---|---|---|
| 29_1…29_8 | track | 5646,2786 → 5752,2940 | 连续，每帧跳 ~26-35px |
| 29_8→30_1 | switch | 跳 445px | 场景切换 |
| 30_1…30_8 | track | 5203,2467 → 5284,2528 | 连续 |
| 30_8→31 | switch | 跳 84px | 场景切换 |

即：在金色重复背景下，连续段保持平滑跟踪，并在 29→30、30→31 处正确识别出
「从连续突然变不连续」的切换。

---

## 七、技术依赖

- Python 3.13(`python` 环境)
- `numpy`、`opencv-python`(cv2)、`Pillow`
- 无需 scipy / skimage；无深度学习模型，零训练。

---

## 八、注意事项与后续扩展

### 注意
- `pairs.csv` 只是近似真值(带 `rw` 容差，如 240px)，用于粗校验，不代表像素级真值。
- 匹配底图用真实截图(匹配更准)，但展示/坐标基准用 clean 系。
- 金色/麦色背景高度重复，部分帧(如 gold 3/4/5/6)置信度较低(≈0.42~0.60)，属匹配模糊。
- `--track` 把整文件夹所有帧当作一条时间流；若混入不相关的独立截图，会被判为多次
  switch，属符合“不同场景=断开”的预期，但会让“switch 数量”偏多。

### 可扩展点
1. 输出逐帧轨迹图(位置 vs 帧号，标 switch 点)。
2. 使用速度自适应跳变阈(如相对最近几步的中位数)，避免“快但连续”被误判为 switch。
3. 增加“top-3 候选”三联图，便于在匹配模糊时人工挑选。
4. 把归一化后的小地图另存为统一分辨率(200x200)的批量文件。
5. 用 `mapdata_real/aligned_tiles_256` 直接按瓦片索引读取，避免重复缝合。

---

## 九、全屏画面快速截取小地图(替代 YOLO)

### 9.1 需求与已知条件
- App 只能截取**全屏游戏画面**，需要从中「抠」出小地图再定位。
- 不想用 YOLO(慢)。已知：小地图**固定右上角**、**是圆形**(带深蓝描边)。

### 9.2 方法(`capture_minimap`)
1. 用**相对位置先验**取一个很小的 ROI(极大缩小搜索范围，因此极快)：
   `圆心 ≈ (0.935*W, 0.153*H)`，`半径 ≈ 0.042*W`，裁剪约 `2.7*半径` 的方形。
2. 在该 ROI 内用 `HoughCircles` 精确定位圆(输出圆心+半径)。即使先验略有偏差，
   ROI 仍覆盖圆，HoughCircles 会校正到精确位置。

### 9.3 跨分辨率实测
- 23 张 `1923x1125` + 4 张其他分辨率(`1942x1136`、`2582x1496`、`1622x956`)，共 27 张。
- 检测到的圆心分数坐标非常稳定：`x≈0.935`、`y≈0.15`；`半径≈0.042*W`
  (即约 `0.07*min(W,H)`)。
- 不同分辨率下都能正确圈中小地图，无需按分辨率硬编码像素坐标。

### 9.4 集成到定位
`run_localize_test.py` 提供端到端入口：
```python
pred, (cx, cy, r, _), crop, norm, score, m2, f2 = localize_frame(frame, clean, real_ref, ref_g, ref_g25)
# pred    : (x,y) 玩家坐标(clean 系)
# crop/norm: 截取的小地图 / 归一化后的 200x200 小地图
```
即：`frame → capture_minimap → normalize_disc → make_template → global/refine → xy`。
独立脚本：`train/yolo_minimap/capture_minimap.py`(只做截取，可 `--in/--out`)。

实测：端到端在大图上定位 4 张不同分辨率截图，得分 0.68~0.79；其中 3 张连续同场景
的玩家位置聚在同一区域(符合“连续时间内坐标连续”的约束)。

### 9.5 注意
- `ex/ey/r` 的分数是该游戏 UI 的相对布局。若换分辨率/缩放比例不同，可用参数微调
  (`capture_minimap(frame, ex_frac=.., ey_frac=.., r_frac=.., crop_scale=..)`)。
- 若游戏窗口带标题栏/边框，全屏截图与预期比例可能略有差异；建议先在一两张图上
  验证 ROI 圈中即可。

---

## 十、App 端到端集成(实时监控)与前端契约

### 10.1 后端模块
- `core/map_localizer.py`：`
  - `get_localizer()`：线程安全的全局单例 `PlayerLocalizer`。
  - `PlayerLocalizer.localize(frame, ts_ms) -> dict | None`：
    `frame → capture_minimap → normalize_disc → make_template → global/refine → (x,y)`，
    并用「时序连续性」(受限搜索 + 相似帧保持 + 场景切换检测) 做实时跟踪。
    返回 `{"x","y","heading","confidence","source","status","captured_at"}`。
  - 首帧/场景切换走全局搜索(较慢)，后续帧在上一位置附近受限搜索(很快)。

### 10.2 接入 `/map_observation`
- `core/api/follow.py` 的 `GET /map_observation` 调用 `core.map_observer.observe_map`。
- `observe_map` 在拿到窗口截图后调用 `get_localizer().localize(image, ts_ms)`：
  - 成功 → `base["position"] = {"x","y","captured_at"}`、`base["heading"]`、
    `base["localize"]={confidence,source,status}`；
  - 低于置信度阈值或不启用 → 保持 `null`(不伪造)。
- 前端每 **1.5 s** 轮询 `api.observeMap("map")` → 若有 `position` 则
  `updatePlayerPosition({x,y}, heading, captured_at)` 并画到地图、记路径、解锁迷雾。
- **已移除与「草系徽章试炼」小游戏相关的标题逻辑**：`observe_map` 不再做
  YOLO 标题裁剪(`crop_sections_from_pil_by_YOLOv8`)、OCR、`match_scene_unique_char`、
  地图分类器与 `trial` 相关处理。现在 `observe_map` 只做「窗口截图 + 小地图玩家定位」；
  `GET /map_observation` 的 `trial` 参数、响应里的 `map_name/map_num/ocr_text/wild_pets`
  已一并删除，前端 `MapObservation` 类型也已同步收缩。`confidence` 现为 `number|null`
  (局部定位置信度)。(`core/api/follow.py` 路由与前端 `types.ts`/`api.ts` 已同步。)

### 10.3 坐标契约(关键)
- 前端 `WORLD_W = WORLD_H = 8192`；玩家 `position.x/y` 在该世界坐标内。
- 前端地图 LOD-13 瓦片名 `13/{4064+r}_{4064+c}.png`，`world x = c*256`；
  即 **tile 4064 对应 world 0**。这与 `mapdata` / `static/map/level_13_*` 完全一致。
- 因此 `core/map_localizer` 输出的 `(x,y)`(在 8192x8192 mapdata 帧) **无需任何偏移**，
  直接就是前端 `position.x/y`。
- 参考底图默认 = `config.MAP_LOCALIZE_REFERENCE`
  = `static/map/level_13_4064_4095_4064_4095.png`(8192x8192, 与 mapdata 逐像素一致)。

### 10.4 实时性能
- 首帧(含参考图加载)：约 2~4 s；之后同场景跟踪：约 **0.4~0.5 s**；
- 场景切换那一帧会回退全局搜索(约 2~3 s)，随后恢复跟踪。
- 前端 1.5 s 轮询可承受；`PlayerLocalizer` 用锁保护状态，供多线程/监控调用。
- 朝向 `heading`：由最近两点的运动方向估计(度)；`init/switch` 后重置为 `None`，
  不凭空猜测 yaw。

### 10.5 配置与开关(见 `config.py`)
- `ROCO_MAP_LOCALIZE_ENABLED`：是否启用实时定位(默认 1)。
- `ROCO_MAP_LOCALIZE_REFERENCE`：参考底图路径(默认静态地图瓦片)。
- `ROCO_MAP_LOCALIZE_MIN_SCORE`：接受定位结果的最低置信度(默认 0.34)。

### 10.6 注意
- `capture_minimap` 的相对位置与半径按「游戏内容窗口」标定；若 App 截图含标题栏/边框，
  ROI 仍较宽松(Hough 会校正)，如需更稳可在 1~2 张图上确认 ROI 圈中圆。
- 定位输出为世界像素坐标(0..8192)；前端会用空气墙多边形(`isPointInPolygon`)校验，
  落在岛屿外会被丢弃，属预期好的保护。

### 10.7 调试 / 耗时分解
- 开关：`ROCO_MAP_LOCALIZE_DEBUG=1`(或 `config.MAP_LOCALIZE_DEBUG=True`)，会在日志按帧输出
  状态、置信度、位置与各步骤耗时。
- 每次 `localize` 的返回里带 `timings_ms`：
  `{capture, normalize, template, similarity, coarse_search, refine}`，
  `observe_map` 也透传到 `base["localize"]["timings_ms"]`。
- 独立调试 CLI：
  ```bash
  python tools/debug_map_localize.py <img1> <img2> ...
  python tools/debug_map_localize.py --dir <folder> --count 3
  ```
- 实测(1923x1125 / 其他分辨率截图)：`capture/normalize/template/similarity` 均为毫秒级(2~5ms)；
  **耗时在 `coarse_search`(全局搜索)**：
  - 首帧 / 场景切换(global@0.25x)：约 **1.5~1.8 s**；`refine` 仅 ~13 ms。
  - 连续跟踪(constrained@0.25x)：总计约 **24 ms**(coarse_search~4ms + refine~13ms)。
- 因此前端 1.5s 轮询在「持续跟踪」下非常轻；首/切换帧较重，但已被「后台线程」隔离，
  不再阻塞 HTTP 请求(见 10.8)。

### 10.8 实时化优化(本轮)
1. **URL 精简**：前端 `map_observation` 不再带 `?trial=map`；后端路由也不读 `trial/title`(纯
   `GET /map_observation`)。静态资源已重新构建(copy 到 `static/`)。
2. **无小地图判断**：`capture_minimap` 返回 `found`；找不到小地图(玩家在做其他事)时，
   定位器 `status=no-map`、`map_found=False`，并**保持上次位置**(原地不动)，不重新搜索。
   响应里新增 `map_found` 字段(前端 `MapObservation` 类型已同步)。
3. **后台监控线程 + 最近观测缓存**(`core/map_observer.py` 的 `_MapMonitor`)：
   截图+定位在后台线程循环执行，`/map_observation` 立即返回缓存值，识别不再阻塞请求线程，
   UI 不再一卡一卡。参考底图也在后台预热。间隔可由 `ROCO_MAP_MONITOR_INTERVAL`(默认 0.7s)控制。
4. **运行中 Debug**：`localize` 返回 `timings_ms`(capture/normalize/template/similarity/
   coarse_search/refine)；`init/switch`(慢帧) 与「慢观测(>800ms)」在日志**始终打印**耗时明细；
   `ROCO_MAP_LOCALIZE_DEBUG=1` 可打印每一帧明细。`tools/debug_map_localize.py` 仅用于离线批跑。

### 10.9 本次(排障)改动
1. **保存每次截图**到 `debug/map_capture/`(`ROCO_MAP_SAVE_CAPTURE=1` 默认开；
   `ROCO_MAP_CAPTURE_MAX=300` 控制最多保留)。每帧生成一张三联图：
   `[整帧+小地图ROI圆 | 归一化小地图 | 整张参考图+定位点]`，文件名含 `时间戳_状态`，
   便于对应日志排查「飘到很远/识别错」。
2. **防止单帧错位漂移**：`init/switch` 的定位结果现在是「**待确认**」，只有**下一帧**
   在它附近能连续跟踪上(`status=confirmed/track`) 才会**发布**(`_confirmed`)；
   若下一帧跟不住(疑似识别错) 则丢弃(`status=unconfirmed`)，保持上一已确认位置，
   前端不会跳到错误远处。日志会用 `init-pending/switch-pending/unconfirmed/confirmed`
   区分。
3. **日志更清晰**：监控线程每帧输出一行
   `[map] reason=.. found=.. status=.. conf=.. pos=.. cap=<截图文件名> took=..ms`，
   `cap` 可直接到 `debug/map_capture/` 打开对应截图。识别出错的 `status`/`pos` 一目了然。
4. **减缓 DEBUG 刷屏**：`capture_by_grab` 的 DEBUG 日志来自 `core/tools.py`。
   想少刷屏可设 `ROCO_LOG_LEVEL=INFO`(默认 DEBUG)；地图 INFO 行与截图仍会打印。
5. 置信度过滤说明：纯阈值不够(错误的 init conf 也到 0.5)。现采用「**时序确认** +
   绝对阈值 `ROCO_MAP_LOCALIZE_MIN_SCORE=0.34`」：单帧定位不直接信，需连续性确认；
   前端还会用空气墙多边形 `isPointInPolygon` 二次丢弃越界点。

### 10.10 方案B(ORB+phash)实测与最终取舍
- **已按方案B建好预处理**：`tools/build_map_orb_index.py` 把 8192x8192 底图切成
  256px/步长128px 重叠瓦片(3969 块)，每块算 64 位 phash，输出
  `train/phash/orb_index.pkl`；查询方 `train/phash/map_orb_loc.py`(phash 粗筛+ORB+仿射)。
  详见 `train/phash/README.md`。
- **实测结论：ORB 方案对这套「小地图↔底图」不适用**：
  - phash 粗筛排名不准：小地图是底图的 ~200px 子窗口，其 phash 与所在瓦片(256px)差异大
    (正确瓦片 Hamming≈34，top 瓦片≈18，正确瓦片不在 top-k)；且 phash 不抗旋转。
  - ORB 特征点太少且不重复：草地小地图仅 ~90 个关键点、与底图可重复点很少(正确瓦片仅 3 组
    匹配)，无法稳定求单应。
- **因此实际采用“模板匹配(NCC) + ROI 约束”**，它是本数据集上可行的方案(0.25x 能正确匹配，
  说明当前样本旋转不明显)。关键优化：
  - **ROI 约束**：跟踪/确认帧只在上一位置附近搜(`constrained_localize`，max_jump=70；
    场景切换先做 ±900 宽局部 `WIDE_JUMP`)，只有真丢失才全图粗搜；
  - **时序确认(pending→confirmed)**：单帧 init/switch 不发布，下一帧连续确认才发布，
    杜绝“飘到很远”；错误 init 判 `unconfirmed` 丢弃，保持上一已确认位置。
- **性能**：连续跟踪 ≈ 7~30ms；首帧/真传送才做一次全图粗搜(1.5~3s，在后台线程，不阻塞请求)。
- 若小地图确认会**明显旋转**：对 NCC 增加少量旋转搜索，或改用对“低纹理+风格化”更鲁棒
  的匹配(如 LoFTR/深度关键点)。当前样本未观察到明显旋转。
