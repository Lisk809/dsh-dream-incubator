/**
 * 本地预览 /dreams：不经完整 harness，直接以桩 httpServer 服务运行
 * 插件真实的 webui 路由（lib/ 构建产物），并种入一批示例梦境。
 *
 * 用法：node scripts/dev-server.mjs [port]   （默认 4173）
 */

import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { registerDreamWebUi } from '../lib/types/webui/server.js'
import { DreamStore } from '../lib/types/store.js'

const port = Number(process.argv[2] ?? 4173)

/** 桩 httpServer 服务：实现 harness 的 register 缝（exact / prefix 匹配）。 */
function stubHttpServer() {
  const routes = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const exact = routes.find((route) => route.kind === 'exact' && route.path === url.pathname)
    if (exact) return exact.handler(req, res)
    const prefix = routes.find((route) => route.kind === 'prefix' && url.pathname.startsWith(route.path))
    if (prefix) return prefix.handler(req, res)
    res.writeHead(404).end('not found')
  })
  return {
    server,
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  }
}

/** 一场示例梦。 */
function dream(overrides) {
  return {
    id: overrides.id,
    sessionId: 'demo-session',
    createdAt: overrides.createdAt,
    style: overrides.style,
    title: overrides.title,
    text: overrides.text,
    mood: overrides.mood,
    moodLabel: overrides.moodLabel,
    themes: overrides.themes ?? [],
    noiseSeeds: overrides.noiseSeeds ?? [],
    materialSeqs: overrides.materialSeqs ?? [1, 2, 3],
    collected: overrides.collected ?? false,
    forgotten: false,
  }
}

const DAY = 86_400_000
const now = Date.now()

/** 九场跨六种风格、跨情绪与时段的示例梦（新的在前）。 */
const seeds = [
  dream({
    id: 'd1', createdAt: now - 2 * 3_600_000, style: 'noir',
    title: '走廊尽头的窗', mood: { valence: -0.4, arousal: 0.3, dominance: -0.2 }, moodLabel: '焦虑里带一点警觉',
    themes: ['调试', '未解之谜'], noiseSeeds: ['倒放的时钟', '半页未写完的信'],
    text: '走廊尽头的窗开着，雨从外面倒着落回天上。\n\n我数了数自己的脚步，发现它们在我身后留下了一串别人的脚印。那扇窗里没有我。',
  }),
  dream({
    id: 'd2', createdAt: now - 8 * 3_600_000, style: 'cyberpunk',
    title: '数据洪流', mood: { valence: -0.2, arousal: 0.6, dominance: 0.4 }, moodLabel: '疲惫但停不下来',
    themes: ['构建', '性能'], noiseSeeds: ['霓虹雨夜', '电子鱼群'],
    text: '霓虹把雨滴染成蓝色，落在我机械义肢的关节缝里。服务器塔在远处呼吸，每一次吸气都有数据鱼群从排气口涌出来，鳞片上是没写完的测试。',
  }),
  dream({
    id: 'd3', createdAt: now - DAY, style: 'fantasy',
    title: '蜂蜜色的星星', mood: { valence: 0.7, arousal: 0.2, dominance: 0.5 }, moodLabel: '愉悦而松弛',
    themes: ['新点子', '协作'], noiseSeeds: ['会说话的动物', '漂浮的灯塔'],
    text: '森林里有一只狐狸，它把项目的里程碑一颗一颗挂在树上，像蜂蜜色的星星。灯塔在我们头顶漂过，说：今晚的合并请求都会通过。',
  }),
  dream({
    id: 'd4', createdAt: now - 2 * DAY, style: 'surreal',
    title: '会唱歌的代码', mood: { valence: 0.1, arousal: -0.3, dominance: 0.1 }, moodLabel: '平静里有点出神',
    themes: ['重构'], noiseSeeds: ['融化的键盘', '重力反转'],
    text: '键盘在桌上慢慢融化，字母流进抽屉，抽屉里是一片星空。我踩着天花板走回工位，代码在耳边轻轻哼着歌，每个函数都是一句调子。',
  }),
  dream({
    id: 'd5', createdAt: now - 3 * DAY, style: 'fable',
    title: '说谎的兔子', mood: { valence: 0.3, arousal: -0.1, dominance: -0.3 }, moodLabel: '困惑但有趣',
    themes: ['学习', '文档'], noiseSeeds: ['镜中世界', '不肯合上的书'],
    text: '兔子说它没有吃掉需求文档，可它的耳朵里夹着两页。镜子里的我指给我看：书其实没有合上，答案就写在最后一页的背面，用胡萝卜汁写的。',
  }),
  dream({
    id: 'd6', createdAt: now - 5 * DAY, style: 'horror',
    title: '无尽循环', mood: { valence: -0.6, arousal: 0.7, dominance: -0.5 }, moodLabel: '紧绷得快要断裂',
    themes: ['报错', '循环'], noiseSeeds: ['重复的脚步声', '墙缝里的灯'],
    text: '同一个报错，我修了它十七次，它第十七次在凌晨三点准时出现。墙缝里有灯在眨眼，脚步声从楼下追上来，我跑进电梯，电梯的按钮上写着我自己的名字。',
  }),
  dream({
    id: 'd7', createdAt: now - 9 * DAY, style: 'fantasy',
    title: '魔法圣杯', mood: { valence: 0.5, arousal: 0.4, dominance: 0.3 }, moodLabel: '轻快且期待',
    themes: ['上线', '庆祝'], noiseSeeds: ['魔法圣杯'],
    text: '圣杯被放在发布页的中央，斟满了月光。我们围着它唱歌，歌词是 changelog，每唱完一段，杯子里就多一颗星星。',
    collected: true,
  }),
  dream({
    id: 'd8', createdAt: now - 14 * DAY, style: 'cyberpunk',
    title: '发锈的服务器塔', mood: { valence: -0.1, arousal: 0.2, dominance: 0.2 }, moodLabel: '不咸不淡',
    themes: ['迁移'], noiseSeeds: ['发锈的服务器塔'],
    text: '旧服务器塔站在雾里，锈迹像年轮。我把最后一个服务从它身上拆下来，它轻轻叹了口气，雾就散了一半。',
  }),
  dream({
    id: 'd9', createdAt: now - 21 * DAY, style: 'noir',
    title: '雨巷里的猫', mood: { valence: -0.2, arousal: 0.0, dominance: -0.1 }, moodLabel: '心事很轻',
    themes: ['回顾'], noiseSeeds: ['雨巷里的猫'],
    text: '猫在雨巷的尽头等我，尾巴上挂着一小串水珠。它说它看见我把最重要的东西落在了上个月——我没信，醒来发现项目里少了一个分号。',
    collected: true,
  }),
]

const dir = mkdtempSync(join(tmpdir(), 'dream-dev-'))
const storePath = join(dir, 'dreams.json')
const store = DreamStore.open(storePath)
for (const seed of [...seeds].reverse()) store.append(seed)

const ctx = new Context()
const { server, register } = stubHttpServer()
ctx.reflect.provide('httpServer', { register })

const config = Object.freeze({
  cooldownMs: 3_600_000,
  minMaterialEvents: 4,
  maxDailyDreams: 8,
  styleRotationDays: 4,
  noiseIntensity: 'medium',
  maxOutputTokens: 500,
  timeoutMs: 120_000,
  privacyMode: false,
  provider: 'deepseek',
  model: 'deepseek-chat',
  storePath,
  serveUi: true,
})

registerDreamWebUi(ctx, store, config)

server.listen(port, '127.0.0.1', () => {
  console.log(`梦境预览已启动 → http://127.0.0.1:${port}/dreams`)
  console.log(`台账（临时）：${storePath}`)
})
