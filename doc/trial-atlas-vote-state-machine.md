# 火系「共创图鉴」投票/点亮状态机（权威版）

> 配套：`docs/trial-atlas-bootstrap-design.md`（方案）、`docs/trial-atlas-bootstrap-implementation.md`（实现骨架）。
> 本文档记录**唯一权威**的「点亮 / 赞同 / 不赞同」状态机与相关交互规则，开发时以本文件为准。

## 一、形态唯一键 pet_key

- 多形态（如 `258_02_乌达_极夜.png`）→ `pet_key = 258_2`（去前导零）。
- 无形态（如 `002_喵喵.png`）→ `pet_key = 2`。
- 解析函数：前端 `atlasCollector.ts#petKeyOf`；服务端 `core/api/atlas.py#_pet_key` / `_parse_key_ids`。
- 参考数据：`datasets/roco_all_pets_info.json`（字段 `id` / `seq`）。

## 二、数据结构（内存 / 本地存储）

```ts
// manualVotes（本地投票，互斥，一 pet_key 一条）
// localStorage.key = 'roco_fire_atlas_votes_v1'
Record<mapId, Record<pet_key, 'agree' | 'disagree'>>

// buildMaps() -> 已点亮集合，只传 map -> [pet_key]
Record<mapId, string[]>
```

- 点亮（观察/自动赞同）与投票（手动 agree/disagree）是**两套独立快照**，一起通过 `sync` 上报。
- `vote` 互斥：同一 `pet_key` 只能 `agree` 或 `disagree` 之一，重复设置即覆盖。

## 三、权威状态机（点击「赞同 / 不赞同」按钮，`FireBadgeTrial.handleAtlasVote`）

约定：
- **卡片**：`亮` = 已点亮进个人图鉴；`暗` = 未点亮。
- **赞同 / 不赞同**：来自 `manualVotes[mapId][pet_key]`。
- 状态简写：`【C·A·D】` = `【卡片·赞同·不赞同】`，`开/关` 表示该旗帜是否存在。

### 3.1 点击「赞同」（type = 'agree'）

| # | 点前 `【卡片·赞同·不赞同】` | 点后 `【卡片·赞同·不赞同】` | 代码分支 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `【亮·开·关】` | `【暗·关·关】` | `isLit && isAgree` | 点亮状态下再点赞同：取消点亮、同时取消赞同 |
| 2 | `【亮·关·关】` | `【亮·开·关】` | `else if isLit` | 点亮但未投票：激活赞同，保持点亮 |
| 6 | `【暗·关·关】` | `【暗·开·关】` | `else` | **未点亮点赞同：仅激活赞同，不点亮卡片** |
| 7 | `【暗·开·关】` | `【暗·关·关】` | `else if isAgree` | 未点亮但已赞同：取消赞同 |
| 8 | `【暗·关·开】` | `【暗·开·关】` | `else if isDisagree` | 未点亮但不赞同：切换为赞同 |

### 3.2 点击「不赞同」（type = 'disagree'）

| # | 点前 `【卡片·赞同·不赞同】` | 点后 `【卡片·赞同·不赞同】` | 代码分支 | 说明 |
| --- | --- | --- | --- | --- |
| 3 | `【亮·开·关】` | `【暗·关·开】` | `if isLit` | 点亮且已赞同：取消点亮、调成不赞同 |
| 4 | `【亮·关·关】` | `【暗·关·开】` | `if isLit` | 点亮未投票：取消点亮、调成不赞同 |
| 5 | `【暗·关·关】` | `【暗·关·开】` | `else` | 未点亮未投票：直接不赞同 |
| 9 | `【暗·开·关】` | `【暗·关·开】` | `else if isAgree` | 未点亮但已赞同：切换为不赞同 |
| 10 | `【暗·关·开】` | `【暗·关·关】` | `else if isDisagree` | 未点亮但已不赞同：取消不赞同 |

### 3.3 不存在的状态

- `【亮·关·开】`（点亮但不同意）：UI 不存在，忽略。原因：点亮时会自动写入 `agree`（见 §4），
  且点击「不赞同」会先取消点亮，因此「亮 + 不赞同」永远不会出现。

### 3.4 代码位置（当前实现）

```ts
// frontend/src/components/Trial/FireBadgeTrial.tsx  handleAtlasVote()
if (type === 'agree') {
  if (isLit && isAgree) { newLit = false; newVote = 'none'; }        // 1
  else if (isLit) { newVote = 'agree'; }                             // 2
  else if (isAgree) { newVote = 'none'; }                            // 7
  else if (isDisagree) { newVote = 'agree'; }                        // 8
  else { newVote = 'agree'; }                                        // 6: 未点亮点赞同 -> 仅激活赞同，不点亮卡片
} else {
  if (isLit) { newLit = false; newVote = 'disagree'; }               // 3,4
  else if (isDisagree) { newVote = 'none'; }                         // 10
  else if (isAgree) { newVote = 'disagree'; }                        // 9
  else { newVote = 'disagree'; }                                     // 5
}
if (newLit !== isLit) {
  fireStorage.toggleEncountered(mapId, encName);
  setRecords(fireStorage.getAll());
}
```

> 应用状态机后，如 `newVote === 'none'` 则删除该 `pet_key` 的投票，否则写入；随后写回
> `localStorage['roco_fire_atlas_votes_v1']`。

## 四、自动赞同规则（与状态机无关的另一入口：点击卡片点亮）

- 入口：`FireBadgeTrial.handleToggleEncounter`（首页 PetGrid 与共创图鉴弹窗卡片共用）。
- **点亮时**（`wasLit === false`）：`toggleEncountered` 后写入 `manualVotes[pet_key] = 'agree'`（点亮即默认赞同）。
- **取消点亮时**（`wasLit === true`）：只取消点亮，**保留**已有的赞同/不赞同投票不变。
- **初始化 effect**（挂载时）：把所有「已点亮」且**尚未有手动投票**的 `pet_key` 补成 `'agree'`，
  保证“点亮 → 默认赞同”，不会出现「亮·无·无」。

> 因此两种点亮来源的行为不同：卡片点亮 = 自动同意；状态机「点赞同」= 只投票不点亮（第 6 条）。

## 五、赞同率算法

### 5.1 服务端（`core/api/atlas.py` → `GET /api/trials/<trial>/atlas`）

| 字段 | 含义 | 计算 |
| --- | --- | --- |
| `confirmed_by` | 上报(点亮)设备数 | `len(report)` |
| `agree_weight` | 赞同加权票 | `Σ w(platform)` for agree |
| `total_weight` | 赞同+不赞同加权票 | `Σ w(platform)` for agree∪disagree |
| `agree_ratio` | 赞同率 | `agree_weight / total_weight`（无票为 0） |
| `voter_count` | 投票设备数 | `len(agree ∪ disagree)` |
| `my_vote` | 当前设备是否已投 | `'agree' | 'disagree' | 'none'` |

权重 `w(platform)`：客户端(桌面 App)=1，`web` 端=0.5。

> 赞同率只看「投票」，不把「点亮」自动当赞成计入比率；「点亮」只影响 `confirmed_by`。

### 5.2 本地乐观赞同率（前端 `FireBadgeTrial.communityAtlas`）

目的：投票后 UI 立即更新，不用等下一次 `GET atlas`。

```
本地 agree_ratio = (服务端 agree_weight - 本设备服务端贡献 + 本设备本地贡献)
                 / (服务端 total_weight - 本设备服务端贡献 + 本设备本地贡献)
```

- 本设备权重 `w = PLATFORM==='web' ? 0.5 : 1`。
- 若服务端 `my_vote==='agree'` 则从两侧各减去 `w`；`my_vote==='disagree'` 只从 `total` 减 `w`。
- 再叠加本地 `manualVotes` 的贡献（agree 加两侧、disagree 只加 total）。

## 六、同步 / 刷新策略

| 触发 | 行为 |
| --- | --- |
| 点击投票/点亮后 | **不**立即 sync；只改本地 + `localStorage`（避免每点一下都打接口） |
| 每 30s | `silentSync` 静默上传：`syncTrialAtlas('fire', buildMaps(), manualVotes)`（只上传自身，不拉取） |
| 手动上传 | `FireBadgeTrial.doSync()`（dev 右上角按钮） |
| 卸载/关闭火系页 | 用 `latestSyncRef` 再刷一次 |
| **刷新图鉴** | `handleRefreshAtlas()` → `fetchTrialAtlas('fire')` → `setServerAtlas`（**才是拉最新社区图鉴/赞同率**） |

> 想让赞同率变最新必须点「刷新图鉴」；30s 自动 sync 只增量上传自身，不会拉服务器。

## 七、前端交互位置（UI 归宿）

- **首页右下角悬浮按钮**（`GlobalFloatingSearch`，只在 `FireBadgeTrial` 传入 fire props 时渲染）：
  - 「共创图鉴」→ 打开 `BootstrapAtlasModal`（可被「精简按钮」`isSimplifiedFABs` 隐藏）
  - 「切换图鉴（当前 - xx 图鉴）」→ 全图鉴 / 共创图鉴 模式切换
- **共创图鉴弹窗 `BootstrapAtlasModal` 内置控制条**：
  - 「刷新图鉴」→ `handleRefreshAtlas`
  - 「隐藏投票」开关（`roco_fire_atlas_show_vote_v1`，弹窗投票 UI 同样受其门控）
  - 「赞同率 XX%」滑杆（只过滤首页 PetGrid，不过滤弹窗内容，避免藏起待投票条目）
- **dev/调试功能**（`import.meta.env.DEV` 门控，生产构建自动隐藏）：手动上传、生成社区假数据
  （`FireBadgeTrial` 右上角 `right-6 top-32`）。
- **跟随识别窗口 `ScannerApp`**（试炼感知，与首页共创图鉴同一套逻辑/数据）：
  - 左上角**系别 logo 按钮**：展示当前试炼系别图标，点击下拉切换试炼（草/火）；
    初始试炼 = 打开来源页（`openFollowScanner(trialKey)` 开窗前写 `roco_active_trial`）。
  - 桥接调用带 `trial_key`：`capture_and_recognize(title, null, trialKey)` /
    `capture_and_recognize_by_map(map, trialKey)`。
  - 火系：records 走 `fireStorage`、识别依据用全图鉴（`buildFireMapsPets`，每图全量）；
    识别槽位卡片展示赞同率 + ✓/✕ 投票（`handleAtlasVote` 复用同一套 11 态机）；
    候选排行 `CandidateCarousel.getCommunityInfo` 展示赞同率徽章。
  - 右上角「查图鉴」`ScannerMapGalleryModal` 传 `mapsConfig` / `communityAtlas` / `onAtlasVote`，
    与首页共创图鉴逻辑一致（可投票、受隐藏投票开关影响）。
  - 跨窗口一致：投票（`roco_fire_atlas_votes_v1`）与隐藏投票开关经 window `storage` 事件跟随首页；
    点亮变化反向经 `fireStorage` 的 `roco_follow_active` 轮询回流首页。
- 左下角只保留草系同款悬浮筛选栏 `FloatingFilterSwitch`。
- 弹窗滚动穿透：所有 `fixed inset-0` 弹窗容器加 `onWheel stopPropagation`，可滚动体加 `overscroll-contain`。

## 八、假数据生成（`FireBadgeTrial.handleMockCommunity`，dev）

- 120 台模拟设备（`mock-device-1..120`），限并发 8 路上报（避免 gunicorn 单 worker / SQLite 写锁）。
- 随机取 ~250 只作为模拟池；每只精灵生成 **0–100** 的投票人数，`agree` 占 50%~100%。
- 用 `GET /api/trials/fire/atlas` 回读最新聚合显示。

## 九、关键文件 / 函数索引

| 文件 | 职责 |
| --- | --- |
| `frontend/src/components/Trial/FireBadgeTrial.tsx` | 状态机 `handleAtlasVote`、点亮 `handleToggleEncounter`、`communityAtlas`、`handleMockCommunity`（dev）、`handleRefreshAtlas`、`minAgreeRatio`、`doSync`、`silentSync` |
| `frontend/src/components/GlobalFloatingSearch.tsx` | 右下角悬浮按钮组；fire props（`onOpenFireAtlas` / `atlasMode` / `onToggleAtlasMode` / `followTrialKey`）时追加「共创图鉴」与「切换图鉴」按钮 |
| `frontend/src/components/BootstrapAtlasModal.tsx` | 共创图鉴弹窗；内置控制条（刷新图鉴/隐藏投票/赞同率滑杆）；卡片点击点亮（`onToggleEncounter`）、投票按钮（`onVote`）、社区/我的双视图 |
| `frontend/src/ScannerApp.tsx` | 跟随识别窗口（试炼感知）：系别 logo 切换试炼、`buildFireMapsPets`、槽位/候选赞同率与投票、`communityAtlas`、30s `silentSync`、window `storage` 跨窗口跟随 |
| `frontend/src/components/ScannerMapGalleryModal.tsx` | 跟随识别查图鉴弹窗；`mapsConfig` 试炼地图配置、`communityAtlas`/`onAtlasVote` 共创投票 UI |
| `frontend/src/components/PetGrid.tsx` | 首页图鉴；`communityAtlas`、`minAgreeRatio`、`onAtlasVote` 过滤与投票 |
| `frontend/src/services/followScanner.ts` | `openFollowScanner(trialKey?)`：开窗前写 `roco_active_trial`，保证扫描窗口初始试炼 = 来源页 |
| `frontend/src/services/atlasCollector.ts` | `petKeyOf`、`syncTrialAtlas`、`fetchTrialAtlas`、`submitAtlasFeedback`、`deviceHash` |
| `RocoKingdom_Server/core/api/atlas.py` | `/observations`、`/atlas/feedback`、`/sync`、`/atlas`（+`/atlas/candidates`）；权重、赞同率、`pet_key` |
| `RocoKingdom_Server/tools/build_atlas.py` | 聚合 `atlas.db` 生成 `map_petsN.partial.json` |

## 十、易错点

- 投票与点亮是**两套快照**：不要用「点亮」推「赞同率」，赞同率只由 `agree/disagree` 投票决定。
- `my_vote` 只有 `agree/disagree/none` 三态；本设备投票要同时反映到服务端 `votes` 与本地 `manualVotes`。
- 取消点亮**不**取消赞同；只有显式「点赞同（第 1 条）/ 点不赞同（第 3 条）」才会改动投票。
- `pet_key` 必须带形态序号（`id_seq`），不要用裸 `id`（多形态会冲突）。
- 服务端 `sync` 是**快照替换**（每设备一票），不是累加；不要让同一设备重复累加设备数。
