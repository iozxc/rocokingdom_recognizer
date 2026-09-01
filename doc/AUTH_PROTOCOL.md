# RocoKingdom 设备授权认证协议

> 本文档面向接入本系统的客户端 / 服务端开发者，说明授权流程、请求协议、签名规则、接口定义、使用统计与数据库结构。

---

## 1. 系统概述

本系统是一套 **机器设备云端授权认证系统**，核心目的：

- 绑定机器唯一硬件标识（`machine_code`），未授权设备无法使用业务程序。
- 通过 **HMAC-SHA256 签名** 保证请求来源可信。
- 支持 **QQ 群内自助绑定**、管理员后台新增 / 续期 / 拉黑 / 删除。
- 新增 **使用统计**：每次 App 打开记为一次流量，关闭时计算使用时长，并统计设备使用的 IP。

组成：

| 端 | 说明 |
| --- | --- |
| 服务端 | Flask + Gunicorn + Nginx + SQLite，部署在 Linux 服务器 |
| 客户端 | Windows 程序，读取硬盘序列号作为 `machine_code`，HMAC 签名调用接口 |
| 管理后台 | React + Electron 控制台（`frontend`），通过管理员密钥访问管理接口 |
| QQ 机器人 | 在 QQ 群内接收 `bind <授权码>` 完成绑定 |

---

## 2. 整体架构

```mermaid
flowchart LR
    subgraph 客户端
        A[App 启动]
        B[App 关闭]
    end
    subgraph 服务端
        S1[/api/auth/request]
        S2[/api/auth/status]
        S3[/api/auth_check/]
        S4[管理接口 /api/auth/*]
        D[(auth.db)]
    end
    subgraph 管理端
        M[React 管理后台]
    end
    subgraph QQ
        Q[QQ 群机器人]
    end

    A -->|request| S1
    A -->|status event=open| S2
    B -->|status event=close| S2
    A --> S3
    M -->|X-Admin-Secret| S4
    Q -->|bind 授权码| S4
    S1 & S2 & S3 & S4 --> D
```

---

## 3. 安全与签名规则

### 3.1 密钥

服务端 `server.py` 常量：

```python
SECRET_KEY = b"2iWBfYhvyV4FN15W8sZ_CO7uSFm8SZvyJrlzDmpDdHU"   # 客户端/服务端共用
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "...")                 # 仅管理接口
```

- `SECRET_KEY`：**客户端与服务端必须完全一致**，用于请求签名。
- `ADMIN_SECRET`：仅服务端与管理后台使用，**禁止下发客户端**。优先读环境变量 `ADMIN_SECRET`。

### 3.2 HMAC-SHA256 签名

```python
ts = str(int(time.time()))                    # 当前 Unix 秒
raw = f"{machine_code}{ts}".encode()          # 机器码 + 时间戳 直接拼接
sign = hmac.new(SECRET_KEY, raw, hashlib.sha256).hexdigest()
```

服务端校验：

1. `ts` 必须能转成整数；
2. `abs(当前时间 - ts) <= 60` 秒，否则拒绝（防重放）；
3. 用相同算法重算签名，并用 `hmac.compare_digest` 防时序攻击。

> 客户端本地时间偏差超过 60 秒会导致签名失败，需校准系统时间。

### 3.3 管理接口鉴权

管理接口在请求头携带：

```
X-Admin-Secret: <ADMIN_SECRET>
```

服务端比对 `X-Admin-Secret` 与 `ADMIN_SECRET`，不一致返回 403。

---

## 4. 客户端完整流程

### 4.1 获取机器码

客户端读取硬盘序列号（Windows）：

- 优先 `PowerShell Get-CimInstance Win32_DiskDrive | Select SerialNumber`（Win11）。
- 降级 `wmic diskdrive get serialnumber`（Win10）。

得到 `machine_code`。

> **机器码规范化**：服务端会统一去掉 `machine_code` 首尾空白、末尾的点（`.`）与 NUL 字符。
> 因此客户端发送 `XXX.` 与 `XXX` 会被识别为同一台设备，避免“管理员删了 A 变体，客户端仍走 B 变体授权”的问题。
> 服务端在启动（`init_db`）时还会自动把历史重复变体合并为一条。

### 4.2 首次启动（未授权）

```text
App 启动
  → POST /api/auth/request {machine_code, timestamp, sign}
  ← 返回 auth_code, is_authorized=false
  → 提示用户在 QQ 群 @机器人 发送： bind <auth_code>
  → 客户端轮询 POST /api/auth/status（不带 event）
  ← 直到 is_authorized=true，绑定成功，获得 expire_time
```

### 4.3 再次启动（已授权）

```text
App 启动
  → POST /api/auth/request {machine_code, timestamp, sign}
  ← 已授权，直接返回 auth_code/is_authorized=true
  → POST /api/auth/status {machine_code, auth_code, timestamp, sign, event:"open"}
  ← 记 1 次流量 + 开启使用会话
```

### 4.4 App 关闭

```text
App 退出前
  → POST /api/auth/status {machine_code, auth_code, timestamp, sign, event:"close"}
  ← 服务端关闭会话，计算使用时长
```

> 只有带 `event` 的请求才计入流量 / 时长；普通状态轮询不带 `event`，不会误计。

---

## 5. 接口清单

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| POST | `/api/auth/request` | 客户端签名 | 申请/获取授权码 |
| POST | `/api/auth/status` | 客户端签名 | 查询授权状态 + 上报 open/close 事件 |
| POST | `/api/auth_check` | 客户端签名 | 旧版单次校验（也支持 event） |
| POST | `/api/auth/add` | 管理员 | QQ 绑定 / 后台新增授权 |
| POST | `/api/auth/update` | 管理员 | 拉黑/解封/改到期/改绑定人 |
| POST | `/api/auth/delete` | 管理员 | 删除设备记录 |
| GET | `/api/auth/list` | 管理员 | 设备列表 + 今日汇总统计 |
| GET | `/api/auth/stats` | 管理员 | 某天使用统计（默认今天） |
| GET/POST | `/api/auth/settings` | 管理员 | 读写系统设置（`max_devices_per_qq`、`default_bind_days`） |
| POST | `/api/auth/refresh_code` | 管理员 / 设备签名 | 为指定设备重新生成授权码 |

---

## 6. 接口详解

### 6.1 POST `/api/auth/request`

**Body**

```json
{ "machine_code": "SER123...", "timestamp": "1750000000", "sign": "abc..." }
```

**返回**

```json
{
  "ok": true,
  "auth_code": "ROCO-XXXXX",
  "is_authorized": false,
  "expire_time": null,
  "machine_code": "SER123..."
}
```

- 新机器码：自动创建记录并生成 `auth_code`，`is_authorized=false`。
- 已存在：返回已保存的 `auth_code`；已授权则 `is_authorized=true`。
- 同机器码重复调用返回同一个 `auth_code`。

### 6.2 POST `/api/auth/status`

**Body**

```json
{
  "machine_code": "SER123...",
  "auth_code": "ROCO-XXXXX",
  "timestamp": "1750000000",
  "sign": "abc...",
  "event": "open"     // 可选：open / close / 不传
}
```

`event` 行为：

| event | 行为 |
| --- | --- |
| `open` | 记 1 次流量、开启一个会话、记录设备 IP |
| `close` | 关闭最新未关闭会话、计算并使用时长、记录设备 IP |
| `heartbeat` | 心跳（每约 3 分钟一次）：刷新 `last_active_at`；若已无开放会话则视为重新打开 |
| 不传 | 仅普通状态查询 / 轮询，不记流量（记录 IP） |

> **异常下线处理**：客户端运行期间会周期性上报 `event=heartbeat`（约每 3 分钟一次）。服务端以 `last_active_at` 记录“最近活跃时间”，超过 `online_idle_timeout`（默认 600 秒，可在系统设置调整）没有收到心跳的开放会话会在查看统计/设备列表时自动关闭（`end_time=last_active_at`）。因此崩溃、息屏、断电导致的 `close` 未上报，不会再造成“永在线 / 时长虚增”。
>
> **兼容性**：该空闲超时仅对**已上报过 `heartbeat` 的会话**生效（`usage_sessions.heartbeat_count > 0`）。旧版客户端（不带心跳）仍按“`open`→`close`”判定在线，不会被误判为离线；其历史遗留的“卡死在线”会话需在设备更新到新客户端并重新打开/重连后自然修正。

**返回（授权正常）**

```json
{
  "ok": true,
  "is_authorized": true,
  "expire_time": "2026-09-27",
  "auth_code": "ROCO-XXXXX",
  "qq_id": "openid...",
  "msg": "已绑定"
}
```

未授权时的区分（`deleted` 与 `expire_time` 共同决定）：
- 授权已过期：`is_authorized=false`，`expire_time` 有值，`msg="授权已过期"`。
- 曾被绑定后拉黑/封禁：`is_authorized=false`，`expire_time` 有值，`msg="授权已被封禁"`。
- 从未绑定 或 **已删除（视为新设备）**：`is_authorized=false`，`expire_time=null`，`msg="等待QQ群绑定授权码"`，`qq_id=null`。

### 6.3 POST `/api/auth_check`

兼容旧客户端，一次校验是否授权及是否过期。也支持 `event` 参数（同状态接口）。返回：

```json
{ "ok": true, "expire_time": "2026-09-27" }
```

### 6.4 POST `/api/auth/add`

**用法 1：QQ 群绑定**（body 提供 `auth_code` + `qq_id` + `group_openid`）

```json
{ "auth_code": "ROCO-XXXXX", "qq_id": "openid...", "group_openid": "gid..." }
```

**用法 2：后台直接新增**（body 提供 `machine_code`，可带 `expire_time`）

```json
{ "machine_code": "SER123...", "is_authorized": 1, "expire_time": "2026-09-27", "qq_id": "..." }
```

同一授权码 / 设备已被其他 QQ 绑定时，**默认新绑定的 QQ 会自动顶替**（覆盖 `qq_id`/`group_openid`，旧 QQ 失去该设备，其占用名额随之释放）。此行为由系统设置 `allow_takeover` 控制（默认开启）；关闭时返回 409 `该授权码已被其他QQ绑定`。

### 6.5 POST `/api/auth/update`

```json
{ "machine_code": "SER123...", "is_authorized": 0, "expire_time": "2026-10-01", "qq_id": "new_openid", "deleted": 0 }
```

字段均可选，至少提供一个。`is_authorized`：`1` 解封/恢复，`0` 拉黑。`deleted`：`1` 伪删除，`0` 取消删除（恢复）。

### 6.6 POST `/api/auth/delete`

```json
{ "machine_code": "SER123..." }
```

**伪删除**：将 `auth_table.deleted=1`、`is_authorized=0`、`expire_time=NULL`；**保留 `auth_code`、`qq_id`、`group_openid`**（不再清空绑定信息）；**保留授权记录与全部统计**（`usage_sessions` / `device_ip` 不清除）。

同时，删除时会**自动关闭该设备所有未关闭会话**（写入 `end_time`/`duration_seconds`），避免“设备在线时被删除后仍一直显示在线、时长持续累加”。

删除后的设备在客户端**视为未授权设备**（`expire_time` 为空），但其 `qq_id`/`group_openid`/`auth_code` 保留，便于管理员“恢复”或原 QQ 重新绑定。管理端可点“恢复”或调用 `/api/auth/update` 传 `deleted:0`（会自动给默认 30 天授权）。

> 启动时服务端会自动把 `deleted=1` 的历史旧记录规范化为“未授权 + 无到期时间”，同时**保留** `qq_id`/`group_openid`/`auth_code`（兼容旧版删除只标记 `deleted`、保留 `expire_time` 导致客户端误报“已过期”的情况）。

删除按“去点/去空白”的规范化匹配，因此 `SER123...` 与 `SER123..` 这类变体也能命中。

### 6.7 GET `/api/auth/list`

**查询参数（可选）**：`qq_id`、`machine_code`、`auth_code`。

**返回**

```json
{
  "ok": true,
  "list": [
    {
      "machine_code": "SER123...",
      "auth_code": "ROCO-XXXXX",
      "is_authorized": 1,
      "expire_time": "2026-09-27",
      "qq_id": "openid...",
      "ip": "1.2.3.4",
      "ips": ["1.2.3.4", "2.2.2.2"],
      "last_seen": "2026-08-28 12:00:00",
      "today_traffic": 3,
      "today_usage_seconds": 240,
      "today_usage_human": "4分0秒",
      "online": 1,
      "online_since": "2026-08-28 11:00:00",
      "last_use_time": "2026-08-28 11:00:00"
    }
  ],
  "stats": {
    "date": "2026-08-28",
    "traffic": 10,
    "usage_seconds": 3600,
    "usage_human": "1小时0分",
    "new_devices": 2,
    "active_devices": 4,
    "ip_devices": [
      {
        "ip": "1.2.3.4",
        "device_count": 2,
        "today_devices": 2,
        "last_seen": "2026-08-28 12:00:00",
        "machine_codes": ["MC-A", "MC-B"]
      }
    ]
  }
}
```

### 6.8 GET `/api/auth/stats`

**查询参数（可选）**：`date=YYYY-MM-DD`，默认今天。

返回与 `list` 中的 `stats` 结构一致（额外多一个 `devices` 映射，key 为机器码）。

```json
{
  "ok": true,
  "date": "2026-08-28",
  "traffic": 10,
  "usage_seconds": 3600,
  "usage_human": "1小时0分",
  "new_devices": 2,
  "active_devices": 4,
  "ip_devices": [ ... ],
  "devices": { "MC-A": { "traffic": 3, "seconds": 240 } }
}
```

### 6.9 GET `/api/auth/stats/timeline`（多维时序趋势统计）

**查询参数（可选）**：
- `granularity`: 统计粒度，支持 `year`（年）| `month`（月）| `day`（日，默认）| `hour`（小时）| `minute`（分钟）。
- `start`: 起始时间（`YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM:SS`）。
- `end`: 结束时间（`YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM:SS`）。
- `machine_code`: 指定设备机器码（可选）。

返回时间段内按粒度汇总的流量（打开/请求频次）、使用时长及活跃设备数列表。

### 6.10 GET `/api/auth/stats/patterns`（周期特征与高峰分析）

**查询参数（可选）**：`start`, `end`, `machine_code`。

返回：
- `weekdays`: 周一至周日（0-6）的累计流量与使用时长。
- `hours`: 24 小时（00:00 - 23:00）全天各时段的累计流量与使用时长。
- `matrix`: 7 × 24 矩阵 `[weekday][hour]`，用于绘制时段热力图。

### 6.11 系统设置与绑定规则

`GET/POST /api/auth/settings`（管理员）读写系统设置，目前支持：

- `max_devices_per_qq`：**单个 QQ 最多可绑定的设备数**，默认 `2`，管理员可在“连接设置”页修改。
  - 当 QQ 群 `bind` 一个设备会导致该 QQ 的已授权设备数超过此值时，绑定会被拒绝，返回 `单个QQ最多绑定 N 台设备`。
  - 同一台设备续期/重复绑定不计入新增数量，不受限制。
- `default_bind_days`：**默认授权时长（天）**，默认 `30`，管理员可在“系统设置”页修改。新绑定、续期、重新授权都使用该天数。
- `allow_takeover`：**是否允许新 QQ 顶替已绑定旧 QQ**，默认 `true`。关闭后，已被其他 QQ 绑定的设备再次绑定会返回 `该授权码已被其他QQ绑定`。

说明：QQ 绑定只对“未删除、已授权、相同 qq_id”的设备计数；伪删除的设备不占用名额。

---

### 6.10 POST `/api/auth/refresh_code`

为指定设备重新生成授权码。

```json
{ "machine_code": "SER123...", "reset_binding": false }
```

**鉴权（二选一）**：
- 管理员：请求头 `X-Admin-Secret`。
- 设备自服务：body 携带 `machine_code + timestamp + sign`（HMAC 签名），只允许刷新**自己设备**的授权码。

- `reset_binding=false`（默认）：只更换 `auth_code`，保留 qq/group/授权状态/到期时间。旧授权码立即失效，客户端下次 `/api/auth/request` 会拿到新码。
- `reset_binding=true`：更换 `auth_code` 的同时**清空 `qq_id`/`group_openid`、`is_authorized=0`、`expire_time=NULL`**（并置 `deleted=0`），相当于把设备重置为“可重新绑定”的新设备，适合换绑/转让。

返回：`{ "ok": true, "machine_code": "...", "auth_code": "ROCO-XXXX", "reset_binding": bool }`

> 管理端“设备列表 → 刷新授权码”按钮**按 `reset_binding=true` 执行**：把设备还原到“绑定前”状态（新授权码、无绑定、未授权），便于重新绑定，并让旧授权码立即失效、防止被他人使用。

---

## 7. 使用统计口径

统计基于 `usage_sessions` 和 `device_ip` 两张表：

| 指标 | 计算方式 |
| --- | --- |
| 今日流量 `traffic` | `usage_sessions` 中 `start_time` 为今天的行为数（一次打开 = 1） |
| 今日使用时长 `usage_seconds` | 已关闭会话的 `duration_seconds` 之和；未关闭会话按 `start_time → 当前时间` 估算 |
| 今日新增设备 `new_devices` | `auth_table` 中 `created_at` 为今天的去重设备数 |
| 今日活跃设备 `active_devices` | 今天有打开记录的设备数 |
| 当前在线设备 `online_devices` | 存在未关闭且**最近活跃（`last_active_at` 在空闲超时内）**的会话，且未被删除的设备数 |
| 每 IP 设备数 `device_count` | `device_ip` 中该 IP 去重设备数（历史） |
| 每 IP 今日活跃 `today_devices` | 今天从该 IP 打开过的设备数 |

> **归属规则**：一次会话归属 **开始那天**。23:59 打开、次日 00:30 关闭，时长全部计入前一天。
> **所有时间均以北京时间（`Asia/Shanghai`，UTC+8）为准**：服务端已固定使用东八区计算“今日”、会话时间与到期判断，不随服务器系统时区变化。

> 统计只依赖**客户端是否上报 `event=open/close`**，与设备是否授权无关。未授权/未绑定设备只要打开时上报 `event=open`，同样会计入流量、时长与在线统计（服务端已支持，客户端需确保在 App 打开时上报）。

> 除“今日”维度的 `stats` 外，`/api/auth/list` 与 `/api/auth/stats` 还返回**生命周期累计** `total`（`devices`/`authorized`/`deleted`/`online_devices`/`traffic`/`usage_seconds`/`usage_human`），设备列表每台设备另有 `total_traffic`、`total_usage_seconds`、`total_usage_human`。

---

## 8. 数据库结构

路径：`auth.db`（SQLite）。

### 8.1 `auth_table`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INT PK | 自增主键 |
| `qq_id` | TEXT | 绑定的 QQ OpenID |
| `group_openid` | TEXT | 绑定群 |
| `machine_code` | TEXT UNIQUE | 机器码 |
| `auth_code` | TEXT UNIQUE | 授权码 |
| `is_authorized` | INT | 0/1 |
| `expire_time` | TEXT | 到期日期 `YYYY-MM-DD` |
| `deleted` | INT | 0/1，伪删除标记（1=已删除，保留记录与统计） |
| `deleted_at` | TEXT | 伪删除时间 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

### 8.2 `usage_sessions`

> 每次 `event=open` 写入一行。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INT PK | 自增主键 |
| `machine_code` | TEXT | 机器码 |
| `start_time` | TEXT | 打开时间 |
| `end_time` | TEXT | 关闭时间，未关闭为 `NULL`（即该设备当前在线） |
| `duration_seconds` | INT | 使用时长（关闭时写入） |
| `ip` | TEXT | 本次打开所用 IP |
| `event` | TEXT | 默认 `open` |
| `created_at` | TEXT | 创建时间 |
| `last_active_at` | TEXT | 最近心跳/打开时间；空闲超时会以它为结束点关闭会话 |

### 8.3 `device_ip`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INT PK | 自增主键 |
| `machine_code` | TEXT | 机器码 |
| `ip` | TEXT | 用过的 IP |
| `first_seen` | TEXT | 首次出现 |
| `last_seen` | TEXT | 最后出现 |

唯一约束：`(machine_code, ip)`。

### 8.4 关联清理说明

`/api/auth/delete` 目前是**伪删除**，默认**不会**删除统计。除非将来改成物理删除，否则统计始终保留。若确需彻底清理某台设备的数据，可手动执行：

```sql
DELETE FROM usage_sessions WHERE machine_code = '<MC>';
DELETE FROM device_ip     WHERE machine_code = '<MC>';
DELETE FROM auth_table    WHERE machine_code = '<MC>';
```

> `machine_code` 规范化为“去掉首尾空白 + 末尾点/NUL”。若历史库存在 `XXX` 与 `XXX.` 两条，服务端启动时会自动合并为一条（保留 `is_authorized=1` 或 `updated_at` 更新的一条）。

---

## 9. 管理接口调用示例（curl）

```bash
ADMIN="mhDtRa8NBOI99YhJjUqhsozIEIPcoufpWqrlYZJ6unhQaTQ7zoqGDQ"
BASE="https://api.omisheep.cn"

# 设备列表
curl -H "X-Admin-Secret: $ADMIN" "$BASE/api/auth/list"

# 今日统计
curl -H "X-Admin-Secret: $ADMIN" "$BASE/api/auth/stats?date=2026-08-28"

# 新增授权
curl -X POST -H "X-Admin-Secret: $ADMIN" -H "Content-Type: application/json" \
  -d '{"machine_code":"SER123...","is_authorized":1,"expire_time":"2026-09-27"}' \
  "$BASE/api/auth/add"

# 拉黑
curl -X POST -H "X-Admin-Secret: $ADMIN" -H "Content-Type: application/json" \
  -d '{"machine_code":"SER123...","is_authorized":0}' "$BASE/api/auth/update"
```

---

## 10. 客户端接入示例

### 10.1 Python 参考（`client_server.py`）

```python
import time, hmac, hashlib

SECRET_KEY = b"2iWBfYhvyV4FN15W8sZ_CO7uSFm8SZvyJrlzDmpDdHU"
STATUS_URL = "http://<server>:8000/api/auth/status"

def make_sign(machine_code):
    ts = str(int(time.time()))
    raw = f"{machine_code}{ts}".encode()
    sign = hmac.new(SECRET_KEY, raw, hashlib.sha256).hexdigest()
    return ts, sign

def report_app_event(machine_code, event):
    ts, sign = make_sign(machine_code)
    payload = {"machine_code": machine_code, "event": event, "timestamp": ts, "sign": sign}
    requests.post(STATUS_URL, json=payload, timeout=10)
```

### 10.2 调用时机

```text
App 启动且校验已授权后： report_app_event(machine_code, "open")
App 退出前：            report_app_event(machine_code, "close")
```

> 不要在轮询绑定状态的循环里传 `event`（否则会把每次轮询当成一次打开）。

---

## 11. 部署要点

```bash
# 环境（conda）
conda activate rocokingdom_prod_server
pip install flask gunicorn

# 服务方式（systemd）
ExecStart=/root/miniconda3/envs/rocokingdom_prod_server/bin/gunicorn -w 2 -b 0.0.0.0:8000 server:app

# 首次上线需删除旧库让 init_db() 重建
rm -f auth.db
systemctl restart auth_server
```

- 修改 `server.py` 后 `systemctl restart auth_server`。
- 前台 Nginx 需设置：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

服务端优先读取 `X-Real-IP` 作为设备真实 IP，避免客户端伪造 `X-Forwarded-For`。

---

## 12. 常见问题

**Q：为什么设备一直“未授权”？**

A：客户端需在 QQ 群 @机器人 发送 `bind <授权码>`；服务端通过 `/api/auth/add` 的 QQ 绑定用法确认。绑定后客户端轮询 `/api/auth/status` 直到 `is_authorized=true`。

**Q：签名校验失败 / 403？**

A：检查 `SECRET_KEY` 是否与服务端完全一致，以及客户端系统时间偏差是否超过 60 秒。

**Q：统计里没有时长？**

A：说明客户端关闭时没有发 `event="close"`，或该会话尚未关闭；未关闭会话按“打开到现在”估算，关闭上报后写入精确值。

**Q：今日流量把轮询也算进去了？**

A：不会。只有显式携带 `event=open/close` 的请求才记流量，普通轮询不带 `event`。

**Q：管理员删除了授权，但客户端仍显示已授权？**

A：分两种可能：
1. 机器码变体不一致（末尾 `.` / 空格）。服务端已做规范化并自动合并历史重复变体，删除也按规范化匹配，升级后重试即可。
2. 客户端缓存了上次的授权结果，或删除发生在 App 已运行期间。请让客户端在每次打开时重新请求 `/api/auth/status`（或 `/api/auth/request`），不要仅依赖本地缓存。
3. 若删除的是**伪删除**，设备会以 `deleted=1` 显示在管理列表，客户端收到 `is_authorized=false`、`expire_time` 为空（`msg="等待QQ群绑定授权码"`）。注意：伪删除**保留 `qq_id`/`group_openid`**，不再清空绑定信息；管理端点“恢复”或调用 `/api/auth/update` 传 `deleted:0` 可回来。
