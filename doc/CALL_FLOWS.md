# 调用链全景（Call Flows）

_2026-09-01 依据当前代码逐行核实整理。每个流程给出：用户操作 → 前端事件 → 通信通道 → 后端处理 → 结果回显/落盘，全部可对照文件与函数名验证。_

## 目录

1. [应用启动链路](#1-应用启动链路)
2. [跟随识别：悬浮窗「截图识别」按钮（徽章试炼）](#2-跟随识别悬浮窗截图识别按钮徽章试炼)
3. [首页单个识别：上传图片（POST /predict）](#3-首页单个识别上传图片post-predict)
4. [批量初始化：冒险日志截图（POST /init_batch）](#4-批量初始化冒险日志截图post-init_batch)
5. [地图感知：开启/关闭实时监控（开放世界大地图识别）](#5-地图感知开启关闭实时监控开放世界大地图识别)

> 术语：流程 2-4 属于【徽章试炼】关卡判定与精灵识别；流程 5 属于【地图感知】开放世界大地图识别。两者互不相干。

---

## 1. 应用启动链路

双击 `RocoKingdomRecognizer.exe`（开发环境 `python main.py`）。

```mermaid
sequenceDiagram
    participant U as 用户
    participant M as main.py
    participant B as bootstrap/
    participant A as core/auth/service.py
    participant F as Flask(create_app)
    participant D as desktop/(waitress+pywebview)
    participant W as 前端 React

    U->>M: 双击 exe
    M->>M: DPI 感知 (_enable_dpi_awareness)
    M->>B: single_instance.activate_existing_if_visible()
    B-->>M: 已有实例→唤起并退出；否则继续
    M->>B: splash.show_hint()（首启/设置开启时）
    M->>B: single_instance.acquire()（命名互斥体）
    M->>A: start_auth_check()（后台授权轮询线程）
    M->>F: create_app()（注册 9 蓝图，40 路由）
    M->>D: run(app)
    D->>D: server.pick_free_port() + waitress 线程（仅 127.0.0.1）
    D->>D: windows.WindowManager 创建主窗 1500x1080
    D->>W: pywebview 加载 http://127.0.0.1:<port>/
    W->>W: AgreementGate（用户协议）→ AuthGate（授权门）
    W->>F: 轮询 GET /api/local/auth_status（1s/5s/10s 三档）
```

关键点：
- `main.py` 的打印分隔符必须最先输出，因为 `desktop` 包导入会触发模型/用户数据加载（`core/infra/capture.py` 模块级 `user_storage.load()`）。
- 授权失败不阻塞 UI，前端 `featureLock.ts` 锁定识别功能。

---

## 2. 跟随识别：悬浮窗「截图识别」按钮（徽章试炼）

**触发**：用户在「精灵识别跟随」悬浮窗（`ScannerApp.tsx`，`/?view=scanner`）点击识别按钮。

```mermaid
sequenceDiagram
    participant U as 用户
    participant S as ScannerApp.tsx
    participant BR as desktop/bridge.py AppApi
    participant CAP as core/infra/capture.py
    participant V as core/vision/
    participant SV as core/services/
    participant G as 游戏窗口

    U->>S: 点击「截图识别」
    S->>S: executeSingleRecognition()：雷达动画 + 音效<br/>BroadcastChannel/localStorage/opener 通知主窗联动特效
    S->>BR: window.pywebview.api.capture_and_recognize("洛克王国：世界"[, stage_num])
    BR->>G: pygetwindow 定位窗口（最小化则 restore）
    BR->>CAP: capture_window(bbox, hwnd)（PrintWindow/ImageGrab）
    CAP-->>BR: PIL 截图（存 debug/capture/）
    BR->>V: crop.crop_sections_from_pil_by_YOLOv8()<br/>切出 Title/Item/Name 三区
    Note over BR,V: 关卡判定（图1-3）：OCR 标题 → match_scene_unique_char 特征字<br/>失败回退 StageClassifier（models.get_stage_classifier）
    loop 3 个槽位
        BR->>V: _process_single_item：<br/>ocr() 识别名单（黑名单/行聚类/纠错）<br/>+ recognizer.match(0.25, 36) DINO 特征检索
    end
    BR->>SV: trial_filter 按试炼白名单过滤
    BR-->>S: {code:200, stage_num, results}（bridge Promise 直返）
    S->>S: 渲染结果卡片/候选翻页，主窗同步点亮
    S->>SV: POST /api/storage 落盘 encounteredPets
```

要点：
- 结果**不经过 HTTP**，由 pywebview bridge 的 Promise 直接返回前端；落盘走 `POST /api/storage`（版本号协商，毫秒时间戳）。
- 「重新识别（指定关卡）」走 `capture_and_recognize_by_map(stage_num)`，跳过关卡判定直接按钉住关卡识别（`ScannerApp.tsx:740-747`）。
- 悬浮窗的打开：主页按钮 → `followScanner.ts` → `pyApi.open_scanner_to_app()`（bridge）→ `WindowManager` 创建/显示 500×650 无边框置顶窗。

---

## 3. 首页单个识别：上传图片（POST /predict）

**触发**：主页「单个精灵识别」弹窗（`SinglePetRecognizerModal`）上传截图/图片。

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as 前端 api.ts
    participant P as core/api/predict.py
    participant A as core/auth/service.py
    participant V as core/vision/
    participant SV as core/services/

    U->>W: 选择图片并确认识别
    W->>P: POST /predict（form: image, stage_num, top_k, trial）
    P->>A: is_authorized()（未授权返回 error）
    P->>P: 存临时文件
    par 两路识别
        P->>V: ocr_top_k_match()：OCR 名字 → get_top_k_matches 模糊匹配
        P->>SV: models.get_icon_recognizer() → recognizer.match 特征检索
    end
    P->>SV: trial_filter(map_name=f"map{stage_num}") 白名单过滤
    P-->>W: success({results})
    W->>W: 展示候选，用户确认后点亮图鉴 → POST /api/storage
```

## 4. 批量初始化：冒险日志截图（POST /init_batch）

**触发**：主页「批量初始化」弹窗（`BatchInitModal`）上传冒险日志整页截图。

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as 前端 api.ts
    participant P as core/api/predict.py
    participant V as core/vision/

    U->>W: 上传整页截图（行数不限）
    W->>P: POST /init_batch（form: image, stage_num, trial）
    P->>P: is_authorized()
    P->>V: processor.segment_icons() 投影法切出每行图标+名字区
    loop 每一行
        P->>V: recognizer.match 特征检索 + OCR 名单模糊匹配
    end
    P->>P: 合并去重 + 白名单过滤
    P-->>W: success({results})
    W->>W: 批量点亮 → POST /api/storage
```

> 注：流程 3/4 失败时前端有离线 mock 兜底（`api.ts` 内 `predictPet`/`initBatch` 的 catch 分支，见「风险」一节）；生产环境注意甄别。

---

## 5. 地图感知：开启/关闭实时监控（开放世界大地图识别）

**触发**：主页「地图感知」工具（`MapAwareness.tsx`）打开实时监控开关。

```mermaid
sequenceDiagram
    participant U as 用户
    participant W as MapAwareness.tsx
    participant F as core/api/follow.py
    participant O as services/world_observer.py
    participant L as vision/world_localizer.py
    participant G as 游戏窗口

    U->>W: 打开「实时监控」开关
    W->>F: GET /map_monitor/start（api.startMapMonitor）
    F->>O: observe_map() 启动 _MapMonitor 后台线程
    loop 每 1.5s（MAP_MONITOR_INTERVAL）
        O->>G: capture_window 抓帧（不 restore、不置前）
        O->>L: capture_minimap → HoughCircles 定圆 → normalize_disc 200x200
        O->>L: get_world_localizer().localize()：NCC 模板匹配 + 状态机
        L-->>O: {x, y, heading, confidence, status}
        O->>O: 缓存最近一次观测（无小地图→保持原位 map_found=False）
    end
    loop 前端每 1.5s 轮询
        W->>F: GET /map_observation（api.observeMap）
        F-->>W: 返回缓存观测（非阻塞）
        W->>W: updatePlayerPosition：画位置/朝向/轨迹，解锁迷雾
    end
    U->>W: 关闭开关
    W->>F: GET /map_monitor/stop（api.stopMapMonitor）
    F->>O: stop_map_monitor() 停线程
    W->>W: 关闭前 sendBeacon → POST /api/map_storage 落盘足迹
```

要点：
- 全程**与试炼无关**：不读 `config.TRIALS`、不做标题 OCR、不写 `encounteredPets`；足迹写入独立的 `roco_user_mapdata.json`（`/api/map_storage`）。
- 识别在后台线程进行，HTTP 请求只读缓存，因此 1.5s 轮询不会卡顿。

---

## 附：两条通信通道速查

| 通道 | 用途 | 方向 |
| --- | --- | --- |
| pywebview bridge（`window.pywebview.api.*`） | 窗口控制、跟随识别截图（流程 2） | 前端 ↔ `desktop/bridge.py AppApi`，Promise 直返 |
| HTTP REST（axios，动态端口仅 127.0.0.1） | 单图/批量识别、存储、地图感知、授权、更新（流程 3-5） | 前端 ↔ `core/api/` 9 蓝图 |
