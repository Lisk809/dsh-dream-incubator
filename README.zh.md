# dsh-dream-incubator

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 打造的梦境孵化器插件。插件通过 Cordis 事件流监听会话素材，在后台——你继续干活的时候——*做梦*：把一天的对话材料蒸馏成风格化的中文梦境报告，按冷却周期每会话一场，并呈现在 `/dreams` 沉浸式页面上。

设计遵循四个认知心理学机制：

- **激活-合成**（Activation–Synthesis）——每场梦先对素材窗口做情绪扫描（PAD 三维：愉悦度 valence / 唤醒度 arousal / 支配度 dominance），再按六风格矩阵合成叙事：黑色悬疑、赛博朋克、超现实、奇幻、寓言、恐怖。矩阵每 `styleRotationDays` 天轮转一次，让偏好的风格慢慢漂移。
- **威胁模拟**（Threat Simulation）——失败的回合、工具报错、中断的请求都会被加权进素材与情绪提示。压力大的日子，梦长得不一样。
- **记忆重组**（Memory Reorganization）——引擎通过按风格噪声种子重组真实会话事件的尾部窗口，每场梦都是对真实发生之事的全新演绎，而不是回放。
- **孵化效应**（Incubation Effect）——冷却与每日上限防止引擎过度做梦；这中间的间隔就是孵化。

## 安装

```sh
dsh plugin --profile web add dsh-dream-incubator
```

补丁包注册一行（`dream-incubator`）。无头 profile 得到引擎与命令；web profile 额外挂载界面。

## 配置

所有键均可选；下面的默认值由 harness 补丁提供（本包不内置硬编码默认值——缺键会在加载时报错）。

| 键 | 默认值 | 含义 |
|---|---|---|
| `cooldownMs` | `3600000` | 同一会话两次做梦之间的最小安静间隔 |
| `minMaterialEvents` | `4` | 距上一场梦之后的最小素材事件数，不足不做 |
| `maxDailyDreams` | `8` | 每会话每日硬上限（午夜重置） |
| `styleRotationDays` | `4` | 风格库（内置 + `styles` 自定义）每 N 天轮转一次 |
| `noiseIntensity` | `medium` | 激活-合成噪声强度：`low` \| `medium` \| `high` |
| `maxOutputTokens` | `500` | 扫描与做梦两次模型调用的输出 token 上限 |
| `timeoutMs` | `120000` | 单场梦周期的端到端截止时间 |
| `privacyMode` | `false` | 开启后，扫描提示词只收到消息数量与工具名，不包含用户文本 |
| `provider` / `model` | `null` | 可选显式模型路由（必须成对出现）。缺省时复用会话最新记录的 `request/header` 路由 |
| `styles` | `[]` | 自定义梦境风格，追加在内置六风格之后、一同参与轮换。每项：`id`（唯一，不得与内置重名）、`nameZh` / `nameEn`、`trigger`（`fatigue` \| `joy` \| `anxiety` \| `boredom` \| `confusion` \| `conflict`）、`imagery`（非空字符串数组）、可选 `palette`（CSS 调色板键，缺省取风格 `id`） |
| `storePath` | `~/.dsh/dream-incubator/dreams.json` | 梦境台账 JSON 位置 |
| `serveUi` | `true` | 在 `/dreams` 提供沉浸式页面（仅 web profile） |

非法值（未知键、非整数上限、`provider` 无 `model`、重复风格 id……）在加载时抛错——harness 会显示确切消息。

自定义风格示例：

```yaml
styles:
  - id: cosmic
    nameZh: 星际漂流
    nameEn: Cosmic Drift
    trigger: boredom
    imagery: [深空尘埃, 失重的茶, 土星环上的雪]
    # palette: nebula   # 可选；缺省取风格 id
```

## 命令

| 命令 | 作用 |
|---|---|
| `/dream` | 立即做一场梦，绕过冷却与素材门控 |
| `/dreams` | 列出最近 8 场梦及其风格、情绪、素材跨度；可标记 *收录* 或 *遗忘* |
| `/dreamsettings` | 查看引擎当前设置：模型路由、噪声、门控、隐私、界面 |

## Web 界面

`serveUi: true` 时打开 `http://<host>:<port>/dreams`。页面是一座深夜美术馆：紫蓝星云与漂移的云朵铺在背景里，hero 上是巨大的 PAD 三角（愉悦度 × 唤醒度 × 支配度）与漂移的噪声微尘，下方是悬浮的碎片画廊——每张卡片都是不规则的四边形/五边形碎片（形状由梦的 id 决定，每次打开都一样），缓慢漂浮、随鼠标 3D 倾斜、带着贴合轮廓的光影，按风格借一点低饱和色光。点击卡片溶解浮现完整梦境详情；按风格/情绪/时间筛选，统计行会告诉你最常梦见什么。页尾的月牙连点 7 次，会打开只读的星盘控制台。新梦通过 SSE 实时到达。

路由：

| 路由 | 用途 |
|---|---|
| `GET /dreams` | 页面本体 |
| `GET /dreams/assets/*` | 静态资源（字体、CSS、JS） |
| `GET /dreams/api/dreams` | 台账 JSON（新的在前） |
| `POST /dreams/api/dreams` | 变更记录（`collect` / `forget`） |
| `GET /dreams/api/settings` | 引擎当前设置（只读，星盘控制台数据源） |
| `GET /dreams/api/stream` | Server-Sent Events；推送每一场新梦 |

## 架构

```
src/
  index.ts            插件入口：配置校验、节奏门控、命令
  engine/
    material.ts       观测层：会话事件 → 素材行 + 统计
    styles.ts         六风格矩阵、轮转、情绪提示、扫描结果强校验
    noise.ts          种子 LCG + 按风格噪声抽取（激活-合成）
    prompts.ts        扫描与做梦提示词装配（隐私感知）
    dreamer.ts        梦境周期：路由 → 窗口 → 扫描 → 做梦 → 记录
  store.ts            带版本的 JSON 台账（原子写，上限 300 条）
  webui/server.ts     /dreams 页面、JSON API、设置接口、SSE 推送
  invariant.ts        DSH invariant 伴生包（空操作；预留）
static/
  index.html          页面骨架：画廊、详情弹层、星盘、氛围层
  dreams.css          设计系统：紫蓝星云、碎片卡片、每风格低饱和强调色
  dreams.js           碎片拼贴、鼠标倾斜、筛选统计、详情、星盘、SSE 客户端
```

引擎绝不触碰窗口之外的会话数据：每场梦都记录它取材的 `materialSeqs`，`privacyMode` 则彻底把用户文本挡在模型提示词之外。

## 开发

```sh
pnpm install
pnpm build    # tsdown → lib/（index + invariant + webui 静态资源）
pnpm test     # vitest — 86 个单元 + 集成 + 路由测试
```

## 发布

`dsh-dream-incubator` 面向 `dsh-plugin` npm tag：

```sh
npm publish --tag dsh-plugin
```

发布包携带 `lib/`（引擎、invariant 伴生包、相对 bundle 解析的 `lib/webui/` 静态资源）与 `cordis.patch.yml`（供 `dsh plugin add` 使用）。
