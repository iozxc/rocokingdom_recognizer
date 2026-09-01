# Web 版雪碧图优化（大幅减少图片请求）

## 一、为什么做

纯前端 web 版（`frontend` 的 `public-web`，经 `vite build --mode web` 输出到 `dist-web`）早期把
每一只精灵拆成单独 PNG 输出（377+ 张），浏览器一次要发几百个图片请求，会一口气吃光静态托管（如阿里云
ESA Pages）的每日请求配额。

本方案把**宠物图**和**18 个系别属性图**分别合并成雪碧图：几百个请求 → **个位数请求**，且单张雪碧图
已被浏览器按 URL 去重缓存。

只影响 web 构建（`public-web`）。桌面打包（`npm run build` 走 `public` + 本地 `static`、后端 `/icons`）
完全不受影响。

## 二、涉及文件

| 文件 | 作用 |
| --- | --- |
| `frontend/scripts/export_web_icons.py` | 核心导出脚本：读数据库 → 生成雪碧图 + 坐标数据 |
| `frontend/scripts/export_web_icons.mjs` | 跨平台唤起上面的 Python（Windows/Mac/Linux） |
| `frontend/src/services/spriteMeta.ts` | 前端加载 `data/sprites.json` / `data/elements.json` 并缓存 |
| `frontend/src/components/SpriteIcon.tsx` | 从雪碧图渲染单个格子（CSS background 切片，响应式缩放） |
| `frontend/src/components/PetSprite.tsx` | 精灵图标：web 用雪碧图，桌面用普通 `<img>` |
| `frontend/src/services/api.ts` | `getIcons()` 读取 `icons.json`，带出 `sprite/col/row` 并预载元信息 |

## 三、生成流程（一次 `build:web` 自动完成）

```bash
cd frontend
npm run build:web
# 内部等价于： npm run export:web:icons  &&  vite build --mode web
```

`export:web:icons` 会调用 `scripts/export_web_icons.mjs` → 执行 `scripts/export_web_icons.py`。

`export_web_icons.py` 的步骤：

1. 发现试炼：读 `config.py` 的 `TRIALS`，每个试炼用它自己的 `map_pets_json_list` 指向的
   `datasets/map_petsN.json`（如 `grass → map_pets1.json`、未来水系 `water → map_pets2.json`）。
   不同试炼的 `map1/map2/map3` 各自独立，**绝不合并**。
2. 读取 `datasets/datasets.db`（`icons` 表的 `data` BLOB）拿每只精灵图片。
3. **去重打包**：将 387 张去重后的宠物图按固定格子 128×128 拼成雪碧图，默认每张最多 100 格
   `ICONS_PER_SPRITE=100` → 当前 387 只 ≈ 4 张。
4. 将 18 个系别属性图（`frontend/public/elements/*.png`，198×198）拼成一张 `elements-sprite.png`
   （6 列 × 3 行，`ELEM_COLS=6`）。
5. 写出坐标数据到 `frontend/public-web/data/`。

## 四、输出目录（`frontend/public-web/`）

| 文件 | 说明 |
| --- | --- |
| `icons/sprite-1.png` … `sprite-N.png` | 宠物雪碧图（共 N 张，`N = ceil(去重图数 / ICONS_PER_SPRITE)`） |
| `icons/elements-sprite.png` | 18 系别属性雪碧图 |
| `data/icons.json` | 顶层按试炼 key 分组：`{ "grass": {map1,map2,map3}, "water": {...} }`；key 与 `config.TRIALS` 一致；每个 item 含 `sprite/col/row` 坐标 |
| `data/sprites.json` | `{ "sprite-1.png": {cols, rows}, ... }`，每张雪碧图的格数 |
| `data/elements.json` | `{ "光": {sprite, col, row}, ... }`，属性名 → 雪碧图坐标 |
| `elements/*.png` | 保留 18 张单属性图（桌面 / 兜底用） |

`icons.json` 中单个精灵示例：

```json
{
  "name": "喵喵.png",
  "id": 2,
  "seq": null,
  "elements": ["草"],
  "url": "/icons/002_%E5%96%B5%E5%96%B5.png",
  "sprite": "sprite-1.png",
  "col": 1,
  "row": 0
}
```

> `url` 字段保留给桌面/兜底使用；web 端优先用 `sprite/col/row`（旧的单张 `/icons/<file>.png` 不再导出，
> 因此 web 端不要在 `IS_STATIC` 下直接引用 `url`）。

`sprites.json` 示例：

```json
{
  "sprite-1.png": { "cols": 10, "rows": 10 },
  "sprite-4.png": { "cols": 10, "rows": 9 },
  "elements-sprite.png": { "cols": 6, "rows": 3 }
}
```

## 五、前端如何消费

### 5.1 雪碧图切片原理

`SpriteIcon` 用一个 `<div>` 设：

```ts
background-image: url(/icons/sprite-1.png);
background-repeat: no-repeat;
background-size: {cols * 100}% {rows * 100}%;   // 每格正好等于容器尺寸
background-position: {col/(cols-1)*100}% {row/(rows-1)*100}%;  // 定位到对应格子
```

因为背景尺寸按 `cols×rows` 放大，每格恰好填满容器，所以**任意显示尺寸都能响应式缩放**，无需像素计算。
格子必须等宽高（宠物 128×128、属性 198×198），且容器保持正方形即可完美显示。

### 5.2 精灵图标

- 组件：`PetSprite`（`<PetSprite pet={pet} className="w-full h-full object-contain" />`）。
  - web（`IS_STATIC`）且有 `pet.sprite`：用 `SpriteIcon` 渲染雪碧图切片。
  - 桌面 / 无坐标：退化为普通 `<img src={pet.url}>`（行为不变）。
- 已替换的渲染点：`PetGrid`、`GlobalFloatingSearch`、`ManualSelectModal`、`ScannerMapGalleryModal`、
  `EncounterHistoryModal`、`PetDetailModal`、`FireBadgeTrial`（复用的 `PetGrid`）。
- 识别相关组件（`BatchRecognizerCard` / `BatchInitModal` / `ImageRecognizer` /
  `SinglePetRecognizerModal` / `ScannerApp`）仅桌面使用（web 上 `IS_STATIC` 时不渲染），无需改动。

### 5.3 属性图标

`ElementBadges` 的 `ElementBadge` 在 `IS_STATIC` 下优先用 `SpriteIcon`（读取 `data/elements.json` + `data/sprites.json`），
失败时回退彩色文字徽章；桌面仍用 `getElementIconUrl` 单图。

### 5.4 元信息加载

`api.ts getIcons()`（`IS_STATIC` 分支）在读取 `icons.json` 前会 `await loadSpriteMeta()` 和
`await loadElementSprites()`，因此渲染时 `spriteMeta` / `elementMeta` 已就绪，`PetSprite` / `ElementBadge`
可同步读取，不会闪烁。

## 六、如何调整参数

在 `frontend/scripts/export_web_icons.py` 顶部：

```python
ICONS_PER_SPRITE = 100   # 每张宠物雪碧图最大格子数；387 只 → 4 张。调大则张数少、单张更大
PET_CELL = 128           # 宠物图统一边长（当前数据库里都是 128×128）
ELEM_CELL = 198          # 属性图统一边长（当前 198×198）
ELEM_COLS = 6            # 属性雪碧图列数（18 / 6 = 3 行）
```

- 想让雪碧图更少（2~3 张）：调大 `ICONS_PER_SPRITE`（如 150 / 200），单张体积增大。
- 想控制单张体积：调小 `ICONS_PER_SPRITE`（如 80），张数增多。
- 想转 WebP（进一步省体积，请求数不变）：把 `sheet.save(..., "PNG", ...)` 的格式改成 `"WEBP"`，
  并把 web 端 `getSpriteUrl()` 里 `.png` 后缀逻辑同步调整（或文件扩展名改 `.webp`）。

> 调整后重新跑 `npm run build:web` 即可。`sprites.json` 会记录新的 `cols/rows`，前端自动适配，无需改代码。

## 七、如何新增试炼（未来水系 = `map_pets2.json`）

不需要改导出脚本，只需两个约定：

1. 在 `config.py` 的 `TRIALS` 增加一个试炼（如 `water`），`pets_source: "map_pets"`、
   `map_pets_json_list` 指向 `datasets/map_pets2.json`、`dev_only` 按需。
2. 在 `datasets/` 新增 `map_pets2.json`，内含该试炼自己的 `map1/map2/map3`。
3. 跑 `npm run build:web`，`icons.json` 会多出 `water` 分组；雪碧图仍是全图鉴共享池。
4. 前端 `getIcons(trialKey)` 按试炼 key 加载（App 传入 `activeTrialKey`）。

## 八、部署

```powershell
# 重新构建 web 产物并同步到部署仓库
.\build-web.bat        # = npm run build:web + robocopy dist-web -> D:\game\RocoKingdomRecognizerWeb\dist
```

然后提交 `RocoKingdomRecognizerWeb` 到 Gitee（镜像到 GitHub），ESA Pages 自动构建部署。

## 九、注意事项

- 勿在 `IS_STATIC`（web）下引用 `/icons/<file>.png` 单张路径：脚本已不再导出单张宠物图，会 404。
- 雪碧图格子必须统一尺寸；`SpriteIcon` 依赖 `cols/rows` 元信息，缺一不可。
- 雪碧图是 CSS `background-image`，浏览器会按 URL 去重；同一张雪碧图上多个参照只会发 1 个请求。
- 若将来宠物图尺寸不再统一（出现不同边长），需为每类图单独维护 `PET_CELL`，或改用坐标（sx/sy/sw/sh）方案。
