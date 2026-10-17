# 「AI全能设计」小程序版 · 设计与实施规划

> 对应网页版：`/image-gen`（已定稿）。本文只讲**小程序怎么落地**，包含页面清单、功能模块与交互、入口与跳转、视觉排版、信息层级、技术要点与分期。
> 目标：**不自建一套新逻辑** —— 配置、计费、模型、资产全部复用现有服务端接口与 KV，小程序只做交互层。

---

## 0. 结论先行（可行性核实）

| 关键问题 | 核实结果 | 依据 |
|---|---|---|
| 小程序能不能直接调生图接口？ | **能**。小程序登录签发的是标准用户会话 JWT（`client: 'miniapp'`），`/api/image-gen` 的 `requireUser` 直接认 | `server/index.mjs:2721` `createMiniappSession` |
| 模型/价格/档位要不要重新配？ | **不用**。`GET /api/image-gen/config` 免登录可读，已下发模型 × 档位点数 | 现有接口 |
| 加入资产库走哪条路？ | `saveRuntimeAsset()` → `POST /api/miniapp/v1/assets` → 服务端**转手写 `/api/data/assets`**，与网页同一份存储 | `server/miniapp-runtime.mjs:365` |
| 参考图（图生图）能做吗？ | **能**，但受三处限制：小程序单请求 10MB、服务端 `IMAGE_REF_BODY_LIMIT=12MB`、单张 ≤2MB ⇒ 必须压缩后再传 | 现有常量 |
| 有没有现成门禁？ | 有，且**顺序固定**：`ensurePhoneBound` → `ensureVipAccess` → `ensureEnoughPoints` | `utils/*-gate.ts` |

⚠️ **一个必须先改的技术前提**：`services/api.ts` 的 `apiRequest` 把超时写死成 **15s**，而单张生图实测 20~47s（4K）/ 带参考图更久。生图请求必须单独给 **200s** 超时（服务端上游超时是 180s，客户端要比它长，否则会出现「服务端还在生成、客户端先断开」→ 用户以为失败但已经扣点）。

---

## 1. 页面清单与各页核心内容

### 1.1 页面总表

| # | 页面 | 路由 | 新建/复用 | 核心内容 | 优先级 |
|---|---|---|---|---|---|
| P1 | AI全能设计（创作页） | `/pages/image-gen/index` | **新建** | 模型/清晰度/比例选择 + 提示词 + 参考图 + 生成 + 结果卡 | P0 |
| P2 | 我的作品（作品墙） | `/pages/image-gen/history` | **新建** | 生成记录网格、按模型筛选、再次生成、保存/加入资产/删除 | P0（先只读）|
| P3 | 作品详情 | `/pages/image-gen/detail` | **新建** | 大图 + 完整参数 + 全部操作 | P1 |
| P4 | 我的资产 | `/pages/assets/index` | 复用 | 加入后的图片在「图片」Tab 里 | — |
| P5 | 算力明细 | `/pages/compute/index` | 复用 | 查看扣点流水（"消耗 30 点"点进去） | — |
| P6 | 充值 | `/pages/recharge/index` | 复用 | 算力不足引导 | — |
| P7 | 绑定账号 | `/pages/bind/index` | 复用 | 手机号门禁 | — |
| P8 | 首页 | `/pages/home/index` | 复用 | 工具卡入口（后台配置，零代码） | P0 |
| P9 | 我的 | `/pages/profile/index` | 复用 | 功能列表加一行「AI全能设计」 | P0 |

> P3 单独成页的理由：微信里大图需要 `previewImage` 级体验 + 长按菜单，塞在列表里体验差。但 **P0 不做**，先用列表卡右侧「⋯」浮动菜单覆盖 90% 操作。

### 1.2 各页核心内容

**P1 创作页**（页面第二屏就是结果，不跳页）
- 顶部：标题 `AI全能设计` + 右侧算力胶囊 `⚡ 1,280 点`
- 选择区：① 模型（横向 chips，>1 个才显示）② 清晰度（分段控件，每段带点数）③ 画面比例（5 个胶囊：方形/横版/竖版/横版/竖版）
- 输入区：提示词 textarea（上限 2000 字，右下角 `0/2000`）
- 参考图区：3 宫格 + 加号块（当前模型 `supportsRefs=false` 时**整块隐藏**）
- 底部固定 CTA：`开始生成 · 30 点`
- 结果卡：大图 + 参数行（档位/比例/体积/消耗点数/余额）+ 三个操作

**P2 我的作品**
- 顶部：标题 + 右「全部 / 按模型」筛选 chips
- 主体：**两列瀑布网格**（图片按原比例，`mode="widthFix"`）
- 卡片：图 + 底部一行「档位 · 相对时间」，右上角「⋯」浮层（保存到相册 / 加入资产库 / 再次生成 / 删除）
- 空态：`还没有作品，去生成第一张`
- 下拉刷新 + 触底加载（每页 20）

**P3 作品详情**（P1 期）
- 顶部大图（占屏 60%，双指缩放）
- 参数区：模型 / 档位 / 比例 / 体积 / 提示词全文（可复制）/ 生成时间 / 消耗点数
- 底部操作条：保存到相册（主）/ 加入资产库 / 再次生成 / 删除

---

## 2. 功能模块与交互逻辑

### 2.1 模块拆解（P1 创作页）

| 模块 | 数据来源 | 交互 | 边界与异常 |
|---|---|---|---|
| 算力胶囊 | `user.points` | 点击 → P5 算力明细 | 未登录显示「登录」 |
| 模型 chips | `/api/image-gen/config` → `models[]` | 单选；切模型时若当前档位不支持 → 自动落到该模型第一档；切到 `supportsRefs=false` → **清空已选参考图** | 只有一个模型时整行隐藏 |
| 清晰度 | `models[].resolutions[{value,points}]` | 单选，按钮上直接标 `{points} 点` | 不写死任何点数（后台改 KV 即时生效） |
| 比例 | `aspectRatios` | 单选胶囊 | 默认取后台 `aspectRatio` |
| 提示词 | 本地 state | textarea，实时字数，`maxlength=2000` | 空 → 禁用 CTA 并 toast「请先描述画面」 |
| 参考图 | `Taro.chooseMedia` | 最多 3 张；选择后压缩；点图预览、角标删除 | 超 3 张 / 超 2MB / 非图片格式 → 就地提示 |
| 生成 CTA | — | 见 2.2 流程 | 生成中不可重复点，显示 `已等待 Ns` |
| 结果卡 | `POST /api/image-gen` 响应 | 见 2.3 | 按错误码分别处理 |

### 2.2 生成主流程（含门禁顺序）

```
点「开始生成」
 ├─ 未登录            → 触发登录（微信一键登录），回来保留输入
 ├─ ensurePhoneBound  → 未绑手机号 → 弹出绑定引导 → P7
 ├─ ensureVipAccess   → VIP 门禁未过 → 提示升级
 ├─ ensureEnoughPoints→ 不足 → 弹充值 → P6
 ├─ 组装 { prompt, model, resolution, aspectRatio, images[], requestId }
 ├─ POST /api/image-gen（超时 200s，带 Bearer token）
 │    ├─ 200 → 渲染结果卡，刷新算力，scrollIntoView 到结果
 │    ├─ 401 → 重新登录后重试一次
 │    ├─ 402 / POINTS_INSUFFICIENT → 弹充值（服务端未扣费）
 │    ├─ 400 IMAGE_REF_UNSUPPORTED → 提示「该模型不支持参考图」并清空参考图
 │    ├─ 503 IMAGE_MODEL_UNAVAILABLE → 「该模型暂时不可用，换一个模型」
 │    └─ 超时/网络 → 「网络超时，若已扣点会自动退回」（服务端失败必退款）
 └─ 生成中：按钮态 + 已等待秒数 + 骨架占位（无真实进度，禁止假进度条）
```

**关键设计**：`requestId` 由前端生成（`img_<时间戳>_<随机>`），服务端用它做**扣费幂等 + 失败退款标记**，所以**一次点击只能生成一个 requestId，重试要换新的**，不能沿用旧值（否则会把上次的退款标记撞掉）。

### 2.3 结果卡交互（三按钮 + 三态）

| 操作 | 行为 | 反馈 |
|---|---|---|
| **加入资产库**（主按钮，实心） | `saveRuntimeAsset({ type:'image', sourceType:'imageGen', name:提示词前24字, content:提示词, images:[绝对URL] })` | 按钮 `实心 → 转圈 → 绿色「已加入」并禁用`；toast「已加入「图片」资产库」+ 一行「去资产库查看」 |
| **保存到相册**（次按钮，描边） | `downloadFile` → `saveImageToPhotosAlbum` | 首次弹权限；拒绝 → 引导去设置；成功 toast「已保存到相册」 |
| **再生成一张** | 沿用当前 prompt/参数，换新 `requestId` 重新请求 | 与主流程一致 |

> 「加入资产库」的默认落点固定是**图片库**（`type:'image'`），与网页版保持一致；不去做「图文/图片」的自动推断，避免同一功能两端行为不一致。

### 2.4 P2 作品墙交互
- 数据：`GET /api/miniapp/v1/assets?page=n&pageSize=20`（读的就是资产表，只要 `type==='image'`）
- 点图 → `Taro.previewImage`（可左右滑当前页全部图）
- 长按 / 「⋯」→ 操作浮层（保存 / 加入资产库 / 再次生成 / 删除）
- 「再次生成」→ 回填 prompt + 参数后 `navigateBack` 到 P1，**不自动提交**（避免误扣点）

---

## 3. 入口与页面跳转关系

### 3.1 入口分布（四处，覆盖不同场景）

| 位置 | 形态 | 实现方式 | 备注 |
|---|---|---|---|
| **首页 · 实用AI工具区** | 工具卡（可配底图 + 标题 + 副标题） | 后台「小程序设计」→ 布局块 `tool-cards` → 卡片链接选「页面」→ `/pages/image-gen/index` | **零代码**，`utils/link.ts` 的 `kind:'page'` 已支持任意 `/pages/*` |
| **底部导航 · 资产** | 不新增 tab | — | 小程序 tab 只有 5 个（首页/智能体/工作流/资产/我的），塞第 6 个会挤压玻璃胶囊；生图是「工具」，不是一级信息架构 |
| **我的 · 功能列表** | 列表项「AI全能设计」 | `pages/profile` 加一行，`navigateTo` | 老用户找不到首页卡时的兜底入口 |
| **分享 / 转发** | 分享卡片（可选） | `useShareAppMessage` 返回 `path: /pages/image-gen/index` | P2 期做，先保证页面可转发 |

### 3.2 跳转关系图

```
首页(tool-card) ─┐
我的(列表项)   ─┼─→ P1 创作页 ──生成成功──→ 结果卡
分享卡片       ─┘                 │
                                  ├─「加入资产库」→ P4 资产库(图片 Tab)
                                  ├─「保存到相册」→ 系统相册
                                  └─「再生成一张」→ 留在 P1（新 requestId）

P1 顶部「作品」入口 ──→ P2 我的作品 ──点图──→ 大图预览(previewImage)
                                  ├─「再次生成」→ 回 P1（回填参数，不自动提交）
                                  └─「⋯」→ 操作浮层

P1 算力胶囊 ──→ P5 算力明细
P1 算力不足 ──→ P6 充值 ──成功──→ 回 P1（保留输入）
P1 未绑手机号 → P7 绑定 ──成功──→ 回 P1（自动续跑生成）
```

导航规范：
- P1/P2 用 `navigateTo`（可返回）
- 底部 5 个一级页（首页/智能体/工作流/资产/我的）必须走 `reLaunch`（`utils/link.ts` 已封装 `RELAUNCH_PAGES`）
- 从 P1 返回时**不清空**已填内容（页面栈天然保留）

---

## 4. 视觉排版与信息层级

### 4.1 全局视觉基调

沿用现有小程序设计系统，**不引入新色板**，全部走语义变量（自动兼容深色模式）：

| 用途 | token | 值 |
|---|---|---|
| 页面底色 | `--mini-page` | `#f4f7fb` |
| 卡片表面 | `--mini-surface` | `#ffffff` |
| 主色 / 选中态 | `--mini-primary` / `--mini-primary-soft` | `#2864ea` / `#e7efff` |
| 主文字 / 次文字 / 弱化 | `--mini-ink` / `--mini-text-2` / `--mini-subtle` | `#101f38` / `#455670` / `#71829a` |
| 分隔线 | `--mini-line` | `#e1eaf7` |
| 卡片阴影 | `--mini-shadow-sm` | `0 8px 24px rgba(17,42,88,.05)` |

排版基准：页面内边距 `24rpx`；卡片圆角 `24rpx`、内 `28rpx`；分区之间 `32rpx`；所有字号用**偶数 rpx**。

### 4.2 字号与层级（P1 创作页）

| 层级 | 元素 | 字号/字重/颜色 |
|---|---|---|
| L0 页面标题 | `AI全能设计` | 36rpx / 600 / `--mini-ink` |
| L1 分区标题 | `模型` `清晰度` `画面比例` `画面描述` `参考图` | 28rpx / 600 / `--mini-text-2` |
| L2 主内容 | 提示词正文、chips 文案 | 28rpx / 400 / `--mini-ink` |
| L3 辅助 | 点数、字数、参数行 | 24rpx / 400 / `--mini-subtle` |
| CTA | 生成按钮 | 30rpx / 600 / 白字压主色 |

**层级原则**：一屏之内只允许出现**一个实心主色按钮**（生成 CTA 或结果卡的「加入资产库」），其余一律描边/文字按钮 —— 避免用户在选择阶段就被"抢注意力"。

### 4.3 三页版式骨架

**P1 创作页**
```
┌───────────────────────────┐
│  AI全能设计        ⚡1280点 │  ← 标题行（算力胶囊右对齐）
├───────────────────────────┤
│  模型                     │
│  [Nano-banana] [GPT-flare]│  ← 横向 chips，选中=浅蓝底+主色描边
│  清晰度                   │
│  [1K 30点][2K 120点][4K 180点] │ ← 分段控件
│  画面比例                 │
│  [方形][横版][竖版][4:3][3:4] │
├───────────────────────────┤
│  画面描述                 │
│  ┌─────────────────────┐  │
│  │ 例如：…              │  │  ← 圆角输入框，120rpx 高
│  └─────────────────────┘  │
│                    0/2000 │
│  参考图（可选，最多3张）   │
│  [＋][图1][图2]           │  ← 三宫格，删除角标在右上
├───────────────────────────┤
│  生成结果                 │
│  ┌─────────────────────┐  │
│  │        大图          │  │  ← 点击全屏预览
│  └─────────────────────┘  │
│  1K · 1:1 · 1.35MB · 30点 │
│  [  加入资产库  ] [保存相册]│
│  ✓ 已加入「图片」资产库     │
└───────────────────────────┘
   ┃ 底部固定区（含安全区 34rpx 占位）
   ┃ [   开始生成 · 30 点   ]
```

**P2 作品墙**
```
[ 我的作品 ]                    ← 标题 36rpx
[全部] [nano-banana] [flare]    ← 模型筛选 chips（横向滚动）
┌────────┐  ┌────────┐
│  图 A  │  │  图 B  │          ← 两列瀑布，8rpx 间距
│ 1K·3分前│  │ 2K·1时前│         ← L3 辅助信息
└────────┘  └────────┘
     ↓ 触底加载
```

**P3 详情页**（P1 期）
```
┌──────────────────────┐
│       大图（60% 屏高）      │
├──────────────────────┤
│ 模型 · Nano-banana-2.1     │
│ 1K 1:1 · 1.35MB · 30 点    │
│ 提示词：一只戴帽子的橘猫…   │ ← 可复制
│ 生成于 2026-10-17 19:22    │
├──────────────────────┤
│ [保存相册] [加入资产库]     │
│ [再次生成]        [删除]   │
└──────────────────────┘
```

---

## 5. 技术实现要点（落地清单）

### 5.1 必须新增的代码

| 文件 | 改动 |
|---|---|
| `src/services/api.ts` | `apiRequest` 支持 `timeout` 选项；新增 `getImageGenConfig()` / `generateImage(payload)`（**超时 200s**） |
| `src/services/imageGen.ts`（新） | 参考图压缩管线、绝对 URL 拼接（`API_BASE + /api/blob/serve?...`）、保存相册封装 |
| `src/pages/image-gen/index.tsx`（新） | 创作页 |
| `src/pages/image-gen/history.tsx`（新） | 作品墙 |
| `src/app.config.ts` | 注册两个新页面 |
| `src/pages/profile/index.tsx` | 功能列表加一行入口 |
| `src/app.scss` | 生图页局部样式（`.gen-*` 前缀，避免污染） |

### 5.2 三个坑（踩过的都在这）

1. **相对 URL 不通**：服务端返回 `/api/blob/serve?key=…`，网页同源可直接用，**小程序必须拼成 `https://…` 绝对地址**后才能给 `<Image src>` 和 `downloadFile`。
2. **参考图压缩要真做**：`chooseMedia` 的 `compressed` 只压到 1280~1600px，单张仍可能 500KB+；需要 `getImageInfo` 判最长边 → `compressImage({ quality: 80 })` → `FileSystemManager.readFile({ encoding: 'base64' })` 转 base64。目标：单张 ≤400KB、3 张合计 ≤1.5MB（base64 后 ~2MB，远低于 10MB 上限）。
3. **超时顺序**：客户端 200s > 服务端 180s > 上游实测 47s。客户端**不能比服务端短**，否则会"用户看到失败、实际已扣点"。

### 5.3 不用做的事（避免过度设计）

- 不做生图专属 tab（底部 5 个够用）
- 不做轮询/进度条（上游无进度接口，只能显示已等待秒数）
- 不做小程序端另建计费/配置（全部复用 `/api/image-gen` 与 KV）
- 不做「收藏」等新概念，作品墙按生成记录即用

---

## 6. 分期与验收

| 阶段 | 范围 | 验收标准 |
|---|---|---|
| **P0（建议先做）** | P1 创作页（文生图）+ 结果卡 + 加入资产库 + 保存相册 + 首页工具卡入口 + 我的入口 | 真机生成 1 张 → 扣点正确 → 加入资产库后能在网页端「我的资产 → 图片」看到（**跨端打通是硬指标**） |
| **P1** | 参考图（图生图，最多 3 张）+ 作品墙 + 再次生成 | 3 张参考图上传不超时、不被 413；换到 `gpt-image-*` 模型时参考图区自动隐藏 |
| **P2** | 作品详情页 + 批量管理 + 转发卡片 | 分享卡带图、落地到 P1 且不丢失参数 |

**P0 完成即满足"网页已定稿 → 小程序可用"的最小闭环**；P1/P2 是体验增强，不影响上线。

---

## 7. P0 实施记录（2026-10-17）

已按 P0 范围落地（**未发版、未上传小程序**）：

| 文件 | 改动 |
|---|---|
| `miniapp/src/pages/image-gen/index.tsx` | 新建：创作页（模型 / 清晰度 / 比例 / 提示词 / 生成 / 结果卡 / 加入资产库 / 保存相册） |
| `miniapp/src/pages/image-gen/index.config.ts` | 新建：导航标题「AI全能设计」 |
| `miniapp/src/app.config.ts` | 注册 `pages/image-gen/index` |
| `miniapp/src/services/api.ts` | `RequestOptions` 加 `timeout`；错误体兼容**平铺形态**；新增 `apiRequestFlat` / `getImageGenConfig` / `generateImage` / `IMAGE_GEN_TIMEOUT=200s` |
| `miniapp/src/services/imageGen.ts` | 新建：requestId、绝对地址、体积/点数格式化、默认档位选择、保存相册、资产记录组装 |
| `miniapp/src/types.ts` | 新增 `ImageGenModel` / `ImageGenConfig` / `ImageGenResult` |
| `miniapp/src/pages/profile/index.tsx` | 「我的」新增一张 AI 创作入口卡（不是第 6 个 tab） |
| `miniapp/src/app.scss` | 新增 `.gen-*` 与 `.mini-design-entry` 样式（全部走语义 token） |
| `miniapp/src/utils/asset-format.ts` | `SOURCE_TYPE_NAMES` 补 `imageGen: 'AI 全能设计'`（与网页端同名表一致） |
| `server/miniapp-layout.mjs` | `MINIAPP_INTERNAL_PAGES` 补 `/pages/image-gen/index`（后台「点击链接 → 小程序页面」下拉才能选到） |
| `frontend/src/miniapp-preview/index.jsx` | `PAGE_LABELS` 补该页中文名（后台画布上显示「AI全能设计」而不是裸路径） |

### 与规划的两处**有意偏差**

1. **P0 不加手机号 / VIP 门禁**，只保留算力门禁。
   核实结果：`/api/image-gen` 服务端只有 `requireUser` + 扣费，**没有** `PHONE_BIND_REQUIRED` / `VIP_REQUIRED`
   （那两道只在充值下单、对话、工作流三处）。网页端 `/image-gen` 也**没有任何**客户端门禁。
   若小程序单方面加手机号门禁，会出现「同一账号在网页能生成、在小程序被拦」的两端不一致。
   所以这里只做 `ensureEnoughPoints`（fail-open）+ `handlePointsInsufficient`（402 弹充值）。
2. **P0 不含参考图区块**（规划里也是 P1）：避免把「真压缩 + 10MB 单请求上限」一起拖进首版。

### 额外加固（规划里没写）

- **连点防重**：`busyRef` 同步锁 + 预检后再抢一次锁。`busy` 是 state，快速双击会在同一帧都读到 `false`
  → 两条请求 = 扣两次点（网页端同一处风险，小程序这边直接堵死）。
- **错误原因透传**：服务端 `POST /api/image-gen` 的错误体是 `{ ok:false, error:'一句人话', code:'XXX' }`
  （**平铺**，不是信封），`rawRequest` 以前只认 `error.code`，会把原因压成「网络请求失败」；
  现在两种形状都认，`IMAGE_MODEL_UNAVAILABLE` / `POINTS_INSUFFICIENT` 才能分流。

---

## 8. P1 实施记录（2026-10-17）

| 改动 | 内容 |
|---|---|
| `miniapp/src/pages/image-gen/index.tsx` | 加「参考图」区块（3 宫格 + 加号块 + 删除角标 + 点击预览）、顶部「我的作品 ›」入口、`effectiveResolution` 归一化、`useDidShow` 接「再次生成」回填 |
| `miniapp/src/pages/image-gen/history.tsx`（新） | 我的作品：两列瀑布 + 模型筛选（服务端 `keyword` 筛）+ 下拉刷新 + 触底加载 + 点图预览 + 「⋯」动作表（保存 / 再次生成 / 删除） |
| `miniapp/src/pages/image-gen/history.config.ts`（新） | 标题「我的作品」+ 下拉刷新 |
| `miniapp/src/services/imageGen.ts` | `compressRefImage`（最长边 1024 + 质量 80，失败退原图）/ `pickReferenceImages` / `toApiRefImages` / `stashRegenerate` / `takeRegenerate` / `wallTime` / `firstImageOf` |
| `miniapp/src/services/api.ts` | `generateImage` 的 `images` 改为 `{mimeType,data}[]`（**服务端只认对象**）；新增 `deleteRuntimeAsset` |
| `miniapp/src/app.scss` | `.gen-ref-*`（参考图三宫格）+ `.gen-work-*`（作品墙） |

### 三个关键实现口径

1. **参考图必须发对象**：`prepareReferenceImages` 只接受 `{mimeType, data}`，
   `mimeType` 必须在 `image/jpeg|png|webp` 内，`data` 可以是纯 base64 或 data URL（服务端会剥前缀）。
   P0 里 `images?: string[]` 的类型是错的，已一并改正。
2. **必须真压，不能只压质量**：上限三条并存 —— 3 张 / 单张 ≤2MB / 整包 ≤12MB（微信单请求 10MB）。
   `compressImage` 同时传 `compressedWidth/compressHeight` 才是「缩尺寸」，只传 quality 时
   4000px 原图仍可能 500KB+。压缩失败**不抛错**，退回原图由体积校验兜底。
3. **「再次生成」不自动提交**：生成要扣点，只回填提示词/模型/档位/比例，由用户再点一次 CTA。
   参数走 `setStorageSync` 交接（提示词最长 2000 字，塞 URL 会超长），创作页 `useDidShow` 取一次即删。

### 顺带修掉的一个隐患

`resolution` 可能来自「再次生成」回填，而那个模型/档位可能已下架 → 会出现「没有任何选中态 + CTA 显示 0 点或被禁用」。
现在统一归一化成 `effectiveResolution`（不可用就落到当前模型第一档），渲染与请求都用它。

### 构建与验证

- `tsc --noEmit` 干净；`npm run build:miniapp:production` → `0.1.9 (3fefefadabcd)`。
- `verify-miniapp-dist` **12/12 PASS**（20 页，转发/朋友圈 20/20 全开，manifest 与 HEAD 一致）。
- 产物解码断言：参考图提示、作品墙四个动作、`.gen-ref-grid` / `.gen-work-cols` 全部命中；postbuild 的 `markdownProps` 仍在。

### 仍未做（P2）

作品详情页（大图 + 参数全文）、批量管理、转发卡片。删除在 P1 已按单条实现（走 `/api/data/assets/delete`）。

---

## 9. P2 实施记录（2026-10-17）

### 配置项顺序调整（主人本轮指定）

创作页从「描述 → 参数 → 参考图」改为 **参考图 → 画面描述 → 模型/清晰度/画面比例**。
理由：参考图是「给模型看的东西」，属于输入的一部分，放在描述之前更符合「先给素材、再提要求、最后选档位」的顺序；
把参数区压到最后，也让用户在决定「花多少点」之前已经把要说的话说完。

`refsSupported=false` 的模型（`gpt-image-*`）参考图整块隐藏，此时页面自然回到「描述在前」。

### 新增/改动

| 改动 | 内容 |
|---|---|
| `miniapp/src/pages/image-gen/detail.tsx`（新） | 作品详情：大图（点击全屏）+ 参数表（模型/清晰度/比例/体积/算力/时间）+ 可复制的提示词 + 保存到相册 / 再次生成 / 删除 |
| `miniapp/src/pages/image-gen/detail.config.ts`（新） | 标题「作品详情」 |
| `miniapp/src/pages/image-gen/history.tsx` | 加「管理 / 完成」：多选 + 全选 + 批量删除；点卡片进详情；分享卡带作品图；`useDidShow` 消费脏标记 |
| `miniapp/src/utils/share.ts` | `ShareTarget` 新增 `imageUrl`（覆盖后台配图）与 `path`（覆盖落地页，**仅转发给朋友**，朋友圈固定当前页） |
| `miniapp/src/services/imageGen.ts` | `stashDetailAsset` / `takeDetailAsset` / `shareThumbUrl` / `markWorksDirty` / `takeWorksDirty`；`buildImageAsset` 补 `size`、`mimeType` |
| `miniapp/src/app.config.ts` | 注册 `pages/image-gen/detail` |
| `miniapp/src/app.scss` | `.gen-detail-*`、`.gen-history-*`、`.gen-work-check*`、`.gen-manage-*` |

### 四个关键实现口径

1. **详情页数据 = 快照 + 列表兜底**。服务端**没有**「按 id 取单条资产」的接口，资产是「一用户一个 JSON 数组」。
   所以列表页点卡片时先把整条记录写进 `setStorageSync`（提示词可能 2000 字，塞不进 URL），
   详情页 `takeDetailAsset(id)` 取用（**只在 id 对得上时采用**，防止拿到别的作品）；
   没有快照才回退到 `GET /api/data/assets?category=image&pageSize=100` 里按 id 找。
   **代价**：不在第一页 100 条内的老作品，从分享/直连进入时找不到 → 老实提示「可能已经被删除了」，不编假数据。
2. **批量删除必须串行**。资产是整把读改写，并发删除会互相覆盖（后写的把先写的复活）。
   代码里是 `for…of await` 逐条到底，注释写明了原因，别改成 `Promise.all`。
3. **转发卡片落创作页，不落详情页**。好友看不到别人的资产，落详情页只会看到「作品不存在」。
   配图用图床变体 `?format=webp&w=450&h=360`（5:4，微信分享卡推荐比例），非本站图床的 URL 原样返回。
4. **返回刷新用一次性脏标记**。详情页删除成功 → `markWorksDirty()`；作品墙 `useDidShow` 里
   `takeWorksDirty()` 为真才重拉。**不能无条件 onShow 重拉**：会把滚动位置和已加载的分页全清掉。

### 构建与验证

- `tsc --noEmit` 干净；`npm run build:miniapp:production` → `0.1.10 (deeee5a2227c)`（postbuild 六步全跑完）。
- `verify-miniapp-dist` **12/12 PASS**（21 页 = 原 18 + 生图 3 页；转发/朋友圈 21/21 全开；manifest 与 HEAD 一致）。
- 产物解码断言 15/15：详情页标题、删除入口、保存相册、再次生成、提示词复制、消耗算力、
  批量删除、全选、完成、跳详情路径命中 `detail.js` / `history.js` / `detail.json`；
  分享缩略图 `format=webp&w=450&h=360`、`usunai_image_detail_v1`、`usunai_image_works_dirty_v1`
  命中共享 chunk `common.js`（**断言要按 chunk 找，页面包里没有服务层代码**）。
- 类名自查：P2 新增 24 个类名中 23 个在 `app.scss` 有定义；`gen-detail-page` 是有意留空
  （纯标记类，详情页没有固定 CTA，不需要底部留白）。

### 真机待验收（P2 三条）

1. 详情页：从作品墙点卡片进入 → 图能全屏、提示词能复制、「再次生成」回创作页且**参数已回填但没自动提交**。
2. 批量管理：点「管理」→ 多选 / 全选 → 删除 → 列表真的少了这些（串行删除是否全成功）。
3. 转发卡片：右上角转发 → 卡片带作品缩略图 → 好友点开落在**创作页**而不是「作品不存在」。

---

## 10. 「我的」入口移除 与 P3–P9 复核（2026-10-17）

### 10.1 先澄清编号口径（重要）

本文档里 **P1–P9 是「页面编号」**（见 §1.1 页面总表），**不是阶段编号**。
阶段只有 §6 里的 **P0 / P1 / P2** 三个阶段，且三个阶段均已完成。

所以不存在「P3 规划任务」这一待办：P3 就是「作品详情页」，该页已在 P2 轮次里实现并构建验证。
同理 P4–P9 也不是新任务，而是「**复用既有页面**」的验收项 —— 本轮逐条核实并给出证据。

### 10.2 移除「我的」页入口

| 改动 | 内容 |
|---|---|
| `miniapp/src/pages/profile/index.tsx` | 删掉「模块①½ AI 创作入口」整块（`.mini-design-entry` 结构 + 说明注释） |
| `miniapp/src/app.scss` | 同步删掉 6 条 `.mini-design-entry*` 规则（含分组注释） |

**残留引用排查（逐项结论）**：

| 引用位置 | 处理 | 原因 |
|---|---|---|
| `app.config.ts` 的 3 条页面路由 | **保留** | 页面本身还在，删路由 = 白屏 / 分享链接失效 |
| 创作页顶部「我的作品 ›」 | **保留** | 是生图链路内部跳转，与「我的」页无关 |
| 首页 `tool-cards` 工具卡 | **保留（且线上已配）** | 见 10.3，这是移除「我的」入口后**唯一**的常驻入口 |
| `server/miniapp-layout.mjs` 白名单 `/pages/image-gen/index` | **保留** | 后台「点击链接→小程序页面」下拉 + 保存校验（`INTERNAL_PAGE_PATHS.has`）的唯一事实源，删了后台就配不出这个链接 |
| `frontend/src/miniapp-preview/index.jsx` 的 `PAGE_LABELS` | **保留** | 后台预览面板的页面名，纯展示 |
| `frontend` 的 `/image-gen`、`/admin/image-gen` | **保留** | 网页版功能与后台配置页，不是小程序入口 |

全仓库 `grep mini-design-entry` 已 **0 命中**（样式与结构一起清干净，不留孤儿 CSS）。

### 10.3 移除后还有入口吗（线上实证）

查线上 `GET /api/miniapp/v1/layout?page=home` 的 `tool-cards` 块，实际配置了 4 张卡：

```
抖音视频文案（workflow 1785124403937）
小红书图文笔记（workflow 1785331404519）
AI全能设计（page /pages/image-gen/index）   ← 入口在这里
抖音视频下载（workflow 1791899449580）
```

**结论**：首页工具卡仍在，页面可达。另有两个入口天然存在：分享卡片（落创作页）与后台配的任意链接。

### 10.4 P3–P9 逐条复核

| 编号 | 页面 | 状态 | 证据 / 结论 |
|---|---|---|---|
| **P3** | 作品详情 | ✅ 已完成 | `pages/image-gen/detail.tsx` + `.config.ts` 已建、已注册、已进产物；`verify-miniapp-dist` 21 页全 PASS |
| **P4** | 我的资产 | ✅ 已满足 | 复用 `/pages/assets/index`（6 个分类 tab 含「图片」）；创作页结果卡有「已加入『图片』资产库，去我的资产查看 ›」跳转 |
| **P5** | 算力明细 | ✅ 已满足（本轮补一处） | 创作页顶部算力胶囊可点进 `/pages/compute/index`；本轮把**详情页「消耗算力」这一行**也做成可点（`gen-detail-value-link`，仅当有扣点时显示 `›`） |
| **P6** | 充值 | ✅ 已满足 | `utils/points-gate.ts` 的 `promptRecharge` → `navigateTo('/pages/recharge/index')`，`navigateTo` 失败（栈满）退 `redirectTo`；创作页 `handlePointsInsufficient` 已接 |
| **P7** | 绑定账号 | ⚠️ 不适用（有意不做） | 服务端 `/api/image-gen` 只有 `requireUser`，**没有** `PHONE_BIND_REQUIRED` / `VIP_REQUIRED`；网页端 `/image-gen` 也无客户端门禁。小程序端若单独加会**两端不一致**，因此不接 |
| **P8** | 首页 | ✅ 已完成（零代码） | 见 10.3，线上工具卡已配 `kind:'page'` |
| **P9** | 我的 | ↩️ 已按指令回退 | 原「P0 加一行入口」的改动本轮移除（10.2） |

> P3 与文档 §1.2 的一处**有意差异**：原设计底部有「加入资产库」按钮。实际实现里生成成功时资产**已经直接写进资产库**
> （`buildImageAsset` + `saveRuntimeAsset`），所以详情页不需要这个按钮 —— 保留会让用户以为「还没存」。

### 10.5 构建与验证

- `tsc --noEmit` 干净；正式档 → `0.1.11`（21 页，12/12 PASS）。
- 产物断言：「AI全能设计」入口块已不在 `profile` 产物里；`gen-detail-value-link` 在 `detail` 产物里；
  `pages/compute/index` 出现在 `detail.js`。


