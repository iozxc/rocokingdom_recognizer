# 火系试炼「共创图鉴」实现手册（第一版）

> 配套顶层设计见 `docs/trial-atlas-bootstrap-design.md`。本文记录已实现的骨架、如何复用、
> 以及后续要接入的识别点。

## 一、已实现的骨架

### 1. 远端开荒服务（模组化：`RocoKingdom_Server/core/api/atlas.py` + 独立库 `atlas.db`）

按 `RocoKingdom` 项目的结构，把路由以 **Flask Blueprint** 拆到 `core/api/*.py`，`server.py` 只做薄入口：

```python
# server.py 顶部（app = Flask(__name__) 之后）
from core.api import register_blueprints
register_blueprints(app)
```

开荒采集蓝图为 `core/api/atlas.py`（`bp = Blueprint("atlas", __name__)`），使用**独立 `atlas.db`**，
不污染 `auth.db`；`gunicorn server:app` 保持不变。

3 条接口 + 2 张表（公开、低频、无签名）：

| 接口 | 说明 |
| --- | --- |
| `POST /api/trials/<trial_key>/observations` | 客户端批量上报识别观测 `[{map_id, pet_id, filename?, confidence?}]` |
| `POST /api/trials/<trial_key>/atlas/feedback` | 用户纠错/投票 `type: wrong/missing/confirm/agree/disagree` |
| `GET  /api/trials/<trial_key>/atlas/candidates` | 管理后台聚合候选（按不同设备数 + 平均置信度打分排序） |

表：
- `trial_observations(trial_key, map_id, pet_id, filename, confidence, device_hash, platform, client_version, created_at)`
- `trial_atlas_feedback(id, trial_key, map_id, pet_id, filename, type, device_hash, client_version, created_at)`

> 部署：**systemd / gunicorn 命令完全不变（`gunicorn server:app`）**。把 `server.py` 与 `core/` 目录一起推到
> 阿里云（`WorkingDirectory=/root/auth_server` 下 `import core` 即可命中）；`atlas.db` 首次访问自动建表，幂等。

### 2. 部分图鉴生成子脚本（`RocoKingdom_Server/tools/build_atlas.py`）
从 `atlas.db` 聚合 `trial_observations`，按阈值过滤，导出 `map_petsN.partial.json`：
```bash
cd RocoKingdom_Server
python tools/build_atlas.py --trial fire --out ../RocoKingdom/datasets/map_pets2.partial.json \
  --min-devices 2 --min-avg-conf 0.6 --version v0.1
```
输出含 `meta`（version/partial/completeness/阈值）+ 每条 `confirmed_by / confidence / observation_count`。

### 3. 客户端采集器（`frontend/src/services/atlasCollector.ts`）
可复用的批量采集/纠错/投票服务：
- `collectAtlasObservation(trial, {map_id, pet_id, filename?, confidence?})`：入队 + 会话内去重
  （同 `(trial,map,pet)` 只报一次）+ 每 30s 或满 50 条批量 POST 到 `https://api.omisheep.cn`。
- `submitAtlasFeedback(trial, type, {map_id?, pet_id?, filename?})`：纠错/投票。
- `isAtlasContribEnabled()` / `setAtlasContribEnabled(true/false)`：贡献数据开关（默认开，可关）。
- 只在 `ATLAS_TRIALS = ['fire']` 时上报；只传识别元数据，不传原图/截图。

## 二、关键注意点（火系 vs 草系差异）

- **识别资产各试炼不同**：火系跟随识别的 `title_feature_path`（如 `features_title_db_2.pkl`）与
  `names_dic`（map_pets2 / 该试炼的 icon_names 缓存）与草系**不同**。采集器只读取「识别结果」
  （pet_id / filename / confidence / map_id），识别本身仍由各自试炼的 assets 完成，采集器**不写死草系资产**。
- **map_id 来源**：跟随识别 / 首页识别判定出的所在图 `map_id`，格式与 `map_petsN.json` 的键一致
  （如 `map1` / `map2` / `map3`）。
- **pet_id/filename**：来自识别返回的 `filename`（如 `258_乌达_极夜.png`）解析 id；`filename` 是官方数据集文件名，
  服务端/子脚本据此反查显示名。

## 三、已接入的两个识别点

采集器已接到以下两个识别**出结果**的地方（`ATLAS_TRIALS = ['fire']` 才会上报，其它试炼自动跳过）：

1. **首页识别（游戏画面识别）**：`BatchRecognizerCard.tsx` 的 `handleStartBatchScan`
   解析出 `processed` 后，对每个 `status==='matched' && score>=threshold && matchedPet?.id!=null`
   的项调用 `collectAtlasObservation(trialKey, {map_id: targetMap.id, pet_id, filename, confidence})`。
   - `trialKey` 由 App 通过 prop `trialKey={activeTrialKey}` 传入。
2. **跟随识别**：`ScannerApp.tsx` 的 `applyApiResults` 构建 `formattedSlots` 后，对每个
   `matchedPet?.id!=null && score>0.1` 的 slot 调用 `collectAtlasObservation(trialKey, {map_id: `map${targetMap}`, ...})`。
   - `ScannerApp` 自身持有 `trialKey` state：初始读 `localStorage.roco_active_trial`
     （由打开来源页在 `openFollowScanner(trialKey)` 时写入），之后可在窗口内经左上角系别 logo 按钮
     切换试炼（切换时回写 `roco_active_trial`）；桥接调用随识别带上 `trial_key`。
   - **限制**：若扫描窗口是独立打开且主窗口未先切到火系，`roco_active_trial` 可能为空（默认 `grass`，不上报）。

## 三·补：试炼 key 同步

- `App.tsx` 在 `activeTrialKey` 变化时写入 `localStorage.setItem('roco_active_trial', activeTrialKey)`；
  打开跟随识别窗口时 `openFollowScanner(trialKey)` 也会先显式写入再开窗，避免窗口内切换试炼后
  残留的脏值影响下次打开。`ScannerApp` 读取该值做初始试炼与采集判断，窗口内切换试炼时回写。
  这保证“跟随识别”的采集与识别资产始终对应当前试炼。

## 四、使用/验证

1. 服务器：`gunicorn server:app`（阿里云），确认 `/api/trials/fire/observations` 返回 `{"ok":true,"count":n}`。
2. 客户端（桌面）：在 `trial==='fire'` 且开了「贡献开荒数据」时，跟随/首页识别出结果即上报。
3. 管理后台：`GET /api/trials/fire/atlas/candidates` 看候选；跑 `tools/build_atlas.py` 出部分图鉴。

## 五、后续（可选）

- ✅ 客户端「共创图鉴」弹窗（`components/BootstrapAtlasModal.tsx`）：社区(部分)图鉴 × 我的图鉴 双视图
  （全部/社区已确认/我已点亮 Tab）+ 纠错/投票（agree/disagree/wrong）+ 内置控制条
  （刷新图鉴 / 隐藏投票 / 赞同率滑杆），接入 `FireBadgeTrial` 右下角悬浮按钮「共创图鉴」。
- ✅ 服务端 `GET /api/trials/<trial>/atlas`：返回社区(部分)图鉴（`maps` 按图分组，每条 `confirmed_by/confidence`）。
- 后端「图鉴开荒」管理页（复用现有 admin，接 `atlas/candidates`）。
- `data_updater` 拉取部分图鉴并展示完成度。

## 六、投票/点亮状态机（权威版）

「点亮 / 赞同 / 不赞同」的 1~11 条状态机、自动赞同规则、赞同率加权、同步/刷新策略、右下角悬浮按钮
与假数据生成规则，全部汇总在 **`docs/trial-atlas-vote-state-machine.md`**。开发投票相关逻辑时以该文档为准。

## 七、火系正式图鉴 map_pets2.json 生成

`datasets/map_pets2.json` 由开荒数据聚合生成，格式与 `datasets/map_pets1.json` 完全一致：
`{ "map1": { "<文件名>.png": { "id", "name", "seq" }, ... } }`。

生成脚本：`RocoKingdom_Server/tools/build_map_pets2.py`。数据来源二选一：

```bash
# 方式 A：从远端社区图鉴 API 拉取（无需本地 atlas.db）
cd RocoKingdom_Server
python tools/build_map_pets2.py --source remote --min-confirmed 3

# 方式 B：从本地 atlas.db 聚合（需先同步/导出 atlas.db）
python tools/build_map_pets2.py --source db --min-confirmed 3
```

生成逻辑：`pet_key`（如 `258_2`）通过 `datasets/roco_all_pets_info.json` 反查 `form_name`，
构造数据集文件名（`id` 3 位补零、`seq` 2 位补零），`name` 取 `form_name`。
`--min-confirmed` 用于滤掉低确认度（默认 3，去掉单人上报噪声）。

> 前端火系页面「游戏画面识别」使用 `fireMapsPets`（火系图鉴），并把 `trialKey="fire"` 传给
> `BatchRecognizerCard`，避免误用草系图鉴；「跟随识别」已通过右下角悬浮按钮进入。
