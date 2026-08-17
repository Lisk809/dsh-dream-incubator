/**
 * Dream Incubator 深夜美术馆 — 渲染与推送。
 * 无框架；从 /dreams/api/dreams 拉取账本，通过 SSE 收新梦。
 * 所有数据都以 textContent 落 DOM，不做 HTML 拼接。
 *
 * 画廊是悬浮的碎片拼贴：每张卡片的多边形轮廓、尺寸档、浮动相位
 * 都由梦 id 的哈希派生，每次打开都稳定；卡片随鼠标 3D 倾斜。
 */

'use strict'

/** 六个风格的展示名（与引擎风格矩阵一致，仅用于界面）。 */
const STYLE_NAMES = {
  cyberpunk: '赛博朋克 / 废土',
  fantasy: '奇幻冒险',
  noir: '黑色悬疑',
  surreal: '超现实主义',
  fable: '童话寓言',
  horror: '恐怖怪诞',
}

/** 六个风格的色光（与 CSS 矩阵一致，用于弹层的 --accent）。 */
const STYLE_ACCENTS = {
  cyberpunk: '#6e9ac4',
  fantasy: '#c9a961',
  noir: '#9a9aa3',
  surreal: '#6fa6a0',
  fable: '#b98c8c',
  horror: '#8a5e5e',
}

/** 用户自定义风格的展示名（星盘拉取 settings 后填充，id → nameZh）。 */
let customStyleNames = {}

/** 风格展示名：server 提供的自定义名 → 内置名表 → 原始 id。 */
function styleNameOf(style) {
  return customStyleNames[style] || STYLE_NAMES[style] || style
}

/** 情绪筛选分桶：按 valence 符号位切三档。 */
const MOOD_BUCKETS = [
  { key: 'bright', label: '明亮', test: (mood) => mood.valence > 0.15 },
  { key: 'calm', label: '平静', test: (mood) => Math.abs(mood.valence) <= 0.15 },
  { key: 'heavy', label: '沉重', test: (mood) => mood.valence < -0.15 },
]

/** 时间筛选分桶：本地日历天 / 近 7 天 / 更早。 */
const TIME_BUCKETS = [
  { key: 'today', label: '今天', test: (createdAt) => sameLocalDay(createdAt, Date.now()) },
  { key: 'week', label: '本周', test: (createdAt) => Date.now() - createdAt <= 7 * 86_400_000 },
  { key: 'earlier', label: '更早', test: (createdAt) => Date.now() - createdAt > 7 * 86_400_000 },
]

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches

const $ = (selector) => document.querySelector(selector)

const state = {
  records: [],
  stream: 'connecting',
  filters: { style: null, mood: null, time: null },
}

const el = {
  hero: $('#hero'),
  heroSkeleton: $('#hero-skeleton'),
  collage: $('#collage'),
  shelfList: $('#shelf-list'),
  count: $('[data-role="count"]'),
  statusDot: $('.status-dot'),
  streamLabel: $('[data-role="stream-label"]'),
  ledgerStatus: $('[data-role="status"]'),
  engine: $('[data-role="engine"]'),
  galleryStats: $('[data-role="gallery-stats"]'),
  filterBar: $('[data-role="filters"]'),
  nebula: $('#nebula'),
  overlay: $('#overlay'),
  overlayPanel: $('#overlay-panel'),
  stardial: $('#stardial'),
  stardialBody: $('[data-role="stardial-body"]'),
  stardialClose: $('.stardial-close'),
  moonBtn: $('#moon-btn'),
}

/** 由 id 派生一个稳定哈希，让每个梦的碎片形状与浮动相位固定。 */
function hashId(id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // FNV 对短/连续 id 会聚簇（"d1"…"d9" 全落在 0.52–0.57），
  // 追加 murmur3 雪崩使任意 id 空间均匀分布。
  h ^= h >>> 16
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = Math.imul(h, 3266489909)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

/** 构造一个带类名与文本的元素。 */
function make(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined && text !== null) node.textContent = text
  return node
}

/**
 * 由 id 派生稳定的碎片多边形：4 个顶点落在四角附近（各向内切
 * 2–5/6%），偶尔在一条边中点再切一刀形成五边形。正文是顶对齐的，
 * 所以形状必须保住四边、只削角（角切 ≤ 内边距 1.375rem 附近，
 * 保证眉题/标题/按钮不被裁）。
 */
function polygonFor(id) {
  const h = hashId(id)
  const rng = (i) => ((h * 97 + i * 53) % 1000) / 1000
  const verts = [
    [2 + rng(1) * 3, 2 + rng(2) * 3],                 // 左上
    [98 - rng(3) * 3, 2 + rng(4) * 3],                // 右上
    [98 - rng(5) * 4, 98 - rng(6) * 4],               // 右下
    [2 + rng(7) * 4, 98 - rng(8) * 4],                // 左下
  ]
  if (Math.floor(h * 13) % 2 === 1) {
    // 五边形：随机一条边的中点朝卡中心轻推，切出更不规则的缺口
    const e = Math.floor(rng(9) * 4)
    const a = verts[e]
    const b = verts[(e + 1) % 4]
    const nudge = 2 + rng(10) * 4
    const mx = (a[0] + b[0]) / 2 + (50 - (a[0] + b[0]) / 2) * (nudge / 100)
    const my = (a[1] + b[1]) / 2 + (50 - (a[1] + b[1]) / 2) * (nudge / 100)
    verts.splice(e + 1, 0, [mx, my])
  }
  return `polygon(${verts.map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(1)}%`).join(', ')})`
}

/** 由 id 派生尺寸档：tall / wide / big / 普通。 */
function cardSpan(id) {
  const h = hashId(id)
  if (h < 0.34) return 'card-tall'
  if (h < 0.52) return 'card-wide'
  if (h < 0.60) return 'card-big'
  return ''
}

/** 同一场梦在两段时间戳里是否落在同一个本地日历天。 */
function sameLocalDay(a, b) {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

/** 素材序号区间展示：min–max，或没有素材时 —。 */
function seqSpan(record) {
  return record.materialSeqs && record.materialSeqs.length > 0
    ? `${Math.min(...record.materialSeqs)}–${Math.max(...record.materialSeqs)}`
    : '—'
}

/** 一场梦的情绪三角：valence 横轴、arousal 纵轴、dominance 为圆点大小。 */
function padGlyph(record) {
  const mood = record.mood || { valence: 0, arousal: 0, dominance: 0 }
  const x = 50 + Math.max(-1, Math.min(1, mood.valence)) * 38
  const y = 50 - Math.max(-1, Math.min(1, mood.arousal)) * 38
  const r = 5 + Math.max(-1, Math.min(1, mood.dominance)) * 4
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('class', 'pad-glyph')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `情绪向量：愉悦 ${mood.valence.toFixed(2)}，唤醒 ${mood.arousal.toFixed(2)}，支配 ${mood.dominance.toFixed(2)}`)

  const triangle = document.createElementNS(svgNS, 'polygon')
  triangle.setAttribute('points', '6,94 94,94 50,6')
  triangle.setAttribute('fill', 'none')
  triangle.setAttribute('stroke', 'currentColor')
  triangle.setAttribute('stroke-opacity', '0.28')
  triangle.setAttribute('stroke-width', '1.5')
  svg.appendChild(triangle)

  const crossA = document.createElementNS(svgNS, 'line')
  crossA.setAttribute('x1', '6')
  crossA.setAttribute('y1', '50')
  crossA.setAttribute('x2', '94')
  crossA.setAttribute('y2', '50')
  crossA.setAttribute('stroke', 'currentColor')
  crossA.setAttribute('stroke-opacity', '0.12')
  crossA.setAttribute('stroke-width', '1')
  svg.appendChild(crossA)

  const dot = document.createElementNS(svgNS, 'circle')
  dot.setAttribute('cx', String(x))
  dot.setAttribute('cy', String(y))
  dot.setAttribute('r', String(r))
  dot.setAttribute('fill', 'currentColor')
  svg.appendChild(dot)

  const caption = make('p', 'hero-meta')
  caption.textContent = `P ${mood.valence.toFixed(2)} · A ${mood.arousal.toFixed(2)} · D ${mood.dominance.toFixed(2)}`
  caption.style.color = 'var(--muted)'
  caption.style.marginTop = '0.75rem'

  const wrap = document.createElement('div')
  wrap.appendChild(svg)
  wrap.appendChild(caption)
  return wrap
}

/** 把噪声种子画成漂浮颗粒：激活-合成的可视化，位置由 id 哈希决定。 */
function buildMotes(record, count) {
  const motes = make('div', 'motes')
  const limit = Math.min(count, 8)
  const seed = hashId(record.id)
  for (let i = 0; i < limit; i += 1) {
    const mote = make('span', 'mote')
    mote.style.left = `${(seed * 97 + i * 41) % 92 + 3}%`
    mote.style.top = `${(seed * 53 + i * 67) % 88 + 6}%`
    mote.style.setProperty('--dx', `${((seed * 31 + i * 23) % 100 - 50) * 0.14}rem`)
    mote.style.setProperty('--dy', `${((seed * 17 + i * 13) % 100 - 50) * 0.12}rem`)
    mote.style.setProperty('--dur', `${40 + ((seed * 7 + i * 5) % 30)}s`)
    mote.style.setProperty('--del', `${-i * 4.3}s`)
    motes.appendChild(mote)
  }
  return motes
}

/** 最新一场梦作为 hero：左栏情绪与身份，右栏梦本身。 */
function renderHero() {
  const record = state.records[0]
  el.heroSkeleton.remove()
  el.hero.textContent = ''

  if (!record) {
    const empty = make('section', 'hero-empty')
    empty.appendChild(make('h1', 'hero-empty-title', '今夜还没有梦。'))
    empty.appendChild(make('p', 'hero-empty-note',
      '让 agent 多聊一会儿，梦会自己来。也可以在任何会话里输入 /dream，亲手孵化一场。'))
    el.hero.appendChild(empty)
    return
  }

  el.hero.dataset.style = record.style || 'surreal'
  const styleName = styleNameOf(record.style)
  const fromOldest = state.records.length

  const left = make('div', 'hero-left')
  const eyebrow = make('p', 'hero-eyebrow')
  eyebrow.appendChild(make('span', 'dream-index', `第 ${fromOldest} 场梦`))
  eyebrow.appendChild(make('span', '', styleName))
  left.appendChild(eyebrow)
  left.appendChild(make('h1', 'hero-title', record.title || '无题之梦'))

  const meta = make('p', 'hero-meta')
  meta.appendChild(make('span', 'hero-mood', record.moodLabel || '心绪不明'))
  const at = new Date(record.createdAt).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  meta.appendChild(make('span', '', at))
  meta.appendChild(make('span', '', `seq ${seqSpan(record)}`))
  left.appendChild(meta)
  left.appendChild(padGlyph(record))
  el.hero.appendChild(left)

  const right = make('div', 'hero-right')
  const noiseSeeds = record.noiseSeeds && record.noiseSeeds.length > 0 ? record.noiseSeeds : []
  right.appendChild(buildMotes(record, noiseSeeds.length))
  right.appendChild(make('p', 'hero-prose', record.text || ''))
  if (noiseSeeds.length > 0) {
    const noise = make('div', 'hero-noise')
    noise.appendChild(make('span', 'noise-chip-label', '噪声种子'))
    for (const seed of noiseSeeds) {
      noise.appendChild(make('span', 'noise-chip', seed))
    }
    right.appendChild(noise)
  }
  el.hero.appendChild(right)
}

/**
 * 鼠标跟随倾斜：指针进入时缓存 rect（移动中不读布局），rAF 节流
 * 只写 --rx/--ry；触屏与 reduced-motion 下整体跳过。
 */
function attachTilt(tilt, card) {
  if (REDUCED_MOTION || COARSE_POINTER) return
  let rect = null
  let raf = 0
  let pending = null

  card.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return
    rect = card.getBoundingClientRect()
    tilt.classList.add('is-tilting')
  })

  card.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || rect === null) return
    pending = { x: event.clientX, y: event.clientY }
    if (raf !== 0) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (rect === null || pending === null) return
      const px = (pending.x - rect.left) / rect.width
      const py = (pending.y - rect.top) / rect.height
      pending = null
      tilt.style.setProperty('--rx', `${((0.5 - py) * 10).toFixed(2)}deg`)
      tilt.style.setProperty('--ry', `${((px - 0.5) * 10).toFixed(2)}deg`)
    })
  })

  card.addEventListener('pointerleave', () => {
    rect = null
    pending = null
    tilt.classList.remove('is-tilting')
    tilt.style.setProperty('--rx', '0deg')
    tilt.style.setProperty('--ry', '0deg')
  })
}

/** 一张碎片卡：li 入场 → float 悬浮 → tilt 倾斜 → clip 裁剪光影。 */
function buildCard(record, i) {
  const number = state.records.length - state.records.indexOf(record)
  const styleName = styleNameOf(record.style)
  const span = cardSpan(record.id)

  const card = document.createElement('li')
  card.className = `card${span ? ` ${span}` : ''}`
  card.dataset.id = record.id
  card.dataset.style = record.style || 'surreal'
  card.setAttribute('role', 'listitem')
  card.setAttribute('tabindex', '0')
  card.setAttribute('aria-label', `第 ${number} 场梦：${record.title || '无题之梦'}（${styleName}）`)
  card.style.setProperty('--i', String(Math.min(i, 8)))
  card.style.setProperty('--dur', `${(5 + hashId(`${record.id}:dur`) * 4).toFixed(1)}s`)
  card.style.setProperty('--del', `${(-(i % 6) * 0.6).toFixed(1)}s`)

  const float = make('div', 'card-float')
  const tilt = make('div', 'card-tilt')
  const clip = make('div', 'card-clip')
  clip.style.clipPath = polygonFor(record.id)

  const eyebrow = make('p', 'card-eyebrow')
  eyebrow.appendChild(make('span', 'dream-index', `第 ${String(number).padStart(2, '0')} 场梦`))
  eyebrow.appendChild(make('span', '', styleName))
  clip.appendChild(eyebrow)

  clip.appendChild(make('p', 'card-title', record.title || '无题之梦'))
  clip.appendChild(make('p', 'card-excerpt', (record.text || '').replace(/\s+/gu, ' ').slice(0, 120)))

  const meta = make('p', 'card-meta')
  if (record.moodLabel) meta.appendChild(make('span', '', record.moodLabel))
  meta.appendChild(make('span', '', new Date(record.createdAt).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })))
  meta.appendChild(make('span', '', `seq ${seqSpan(record)}`))
  clip.appendChild(meta)

  const actions = make('div', 'card-actions')
  const collect = make('button', `btn btn-collect${record.collected ? ' is-active' : ''}`, record.collected ? '已收录' : '收录')
  collect.type = 'button'
  collect.setAttribute('aria-pressed', String(record.collected))
  collect.addEventListener('click', (event) => {
    event.stopPropagation()
    void mutate(record.id, 'collect')
  })
  actions.appendChild(collect)

  const forget = make('button', 'btn btn-forget', record.forgotten ? '已遗忘' : '遗忘')
  forget.type = 'button'
  forget.setAttribute('aria-pressed', String(record.forgotten))
  forget.addEventListener('click', (event) => {
    event.stopPropagation()
    void mutate(record.id, 'forget')
  })
  actions.appendChild(forget)
  clip.appendChild(actions)

  tilt.appendChild(clip)
  float.appendChild(tilt)
  card.appendChild(float)

  card.addEventListener('click', () => openDetail(record))
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openDetail(record)
    }
  })
  attachTilt(tilt, card)
  return card
}

/** 拼贴画廊：DOM 顺序即时间顺序（新在前），dense 网格回填洞眼。 */
function renderCollage(animate = true) {
  el.collage.textContent = ''
  el.collage.classList.toggle('is-filtered', !animate)
  const visible = visibleRecords()
  if (visible.length === 0) {
    const note = state.records.length === 0
      ? '夜色里还没有梦。'
      : '没有梦符合当前的筛选。'
    el.collage.appendChild(make('li', 'empty-note', note))
    return
  }
  const fragment = document.createDocumentFragment()
  for (let i = 0; i < visible.length; i += 1) {
    fragment.appendChild(buildCard(visible[i], i))
  }
  el.collage.appendChild(fragment)
}

/** 收藏架：只放被收录的梦。 */
function renderShelf() {
  el.shelfList.textContent = ''
  const collected = state.records.filter((record) => record.collected)
  if (collected.length === 0) {
    el.shelfList.appendChild(make('li', 'empty-note', '还没有收藏的梦。'))
    return
  }
  for (const record of collected) {
    const item = make('li', 'shelf-item')
    item.appendChild(make('p', 'shelf-title', record.title || '无题之梦'))
    item.appendChild(make('p', 'shelf-meta', `${STYLE_NAMES[record.style] || record.style} · ${new Date(record.createdAt).toLocaleString('zh-CN', { dateStyle: 'short' })}`))
    el.shelfList.appendChild(item)
  }
}

/** 顶部状态与页脚引擎行。 */
function renderHeader() {
  el.count.textContent = state.records.length > 0 ? `共 ${state.records.length} 场梦` : '还没有梦'
  el.statusDot.dataset.status = state.stream
  if (state.stream === 'connected') el.streamLabel.textContent = '梦境在线'
  else if (state.stream === 'lost') el.streamLabel.textContent = '梦境掉线，重连中'
  else el.streamLabel.textContent = '连接梦境'
  const latest = state.records[0]
  if (latest) {
    el.engine.textContent = `引擎 · 激活-合成 · ${latest.style ? STYLE_NAMES[latest.style] || latest.style : ''} · ${(latest.noiseSeeds || []).length} 粒噪声种子`
  }
}

/* ---------- 筛选与统计 ---------- */

function visibleRecords() {
  return state.records.filter((record) => {
    if (state.filters.style && record.style !== state.filters.style) return false
    if (state.filters.mood) {
      const bucket = MOOD_BUCKETS.find((candidate) => candidate.key === state.filters.mood)
      if (bucket && !bucket.test(record.mood || { valence: 0 })) return false
    }
    if (state.filters.time) {
      const bucket = TIME_BUCKETS.find((candidate) => candidate.key === state.filters.time)
      if (bucket && !bucket.test(record.createdAt)) return false
    }
    return true
  })
}

/** 一组筛选 chips：单选，点当前项即取消；重建后把焦点还给同组同键。 */
function buildFilterChips(label, entries, activeKey, onPick, groupIndex) {
  const group = make('div', 'filter-group')
  group.appendChild(make('span', 'filter-label', label))
  for (const [key, text] of entries) {
    const chip = make('button', 'filter-chip', text)
    chip.type = 'button'
    chip.dataset.key = key
    const active = key === activeKey()
    if (active) chip.classList.add('is-active')
    chip.setAttribute('aria-pressed', String(active))
    chip.addEventListener('click', () => {
      onPick(key)
      buildFilterBar()
      renderCollage(false)
      renderStats()
      const groupEls = el.filterBar.querySelectorAll('.filter-group')
      const target = groupEls[groupIndex]?.querySelector(`.filter-chip[data-key="${key}"]`)
      if (target) target.focus()
    })
    group.appendChild(chip)
  }
  return group
}

function buildFilterBar() {
  el.filterBar.textContent = ''
  el.filterBar.appendChild(buildFilterChips(
    '风格',
    [['all', '全部'], ...Object.entries(STYLE_NAMES)],
    () => state.filters.style || 'all',
    (key) => { state.filters.style = key === 'all' ? null : key },
    0,
  ))
  el.filterBar.appendChild(buildFilterChips(
    '情绪',
    [['all', '全部'], ...MOOD_BUCKETS.map((bucket) => [bucket.key, bucket.label])],
    () => state.filters.mood || 'all',
    (key) => { state.filters.mood = key === 'all' ? null : key },
    1,
  ))
  el.filterBar.appendChild(buildFilterChips(
    '时间',
    [['all', '全部'], ...TIME_BUCKETS.map((bucket) => [bucket.key, bucket.label])],
    () => state.filters.time || 'all',
    (key) => { state.filters.time = key === 'all' ? null : key },
    2,
  ))
}

/** 统计：总场数、最常梦见的风格、近 5 场偏爱、按情绪分桶的固定短句。 */
function computeStats() {
  const records = state.records
  const modeOf = (list) => {
    const counts = new Map()
    for (const record of list) counts.set(record.style, (counts.get(record.style) || 0) + 1)
    let best = null
    let bestCount = 0
    for (const [style, count] of counts) {
      if (count > bestCount) {
        best = style
        bestCount = count
      }
    }
    return best
  }
  let note = ''
  if (records.length > 0) {
    const sum = (axis) => records.reduce((total, record) => total + ((record.mood && record.mood[axis]) || 0), 0)
    const valence = sum('valence') / records.length
    const arousal = sum('arousal') / records.length
    if (valence < -0.2) note = '这几天情绪像雾一样浓，梦也学会穿雨衣了。'
    else if (arousal > 0.2) note = '梦里都在狂奔——你的潜意识需要一杯温牛奶。'
    else if (valence > 0.2) note = '梦里有光，醒来嘴角还挂着笑。'
    else note = '情绪平稳，梦都在打盹。'
  }
  return {
    total: records.length,
    modeStyle: modeOf(records),
    recentStyle: modeOf(records.slice(0, 5)),
    note,
  }
}

function renderStats() {
  const { total, modeStyle, recentStyle, note } = computeStats()
  el.galleryStats.textContent = ''
  if (total === 0) return
  const modeName = STYLE_NAMES[modeStyle] || modeStyle
  const recentName = STYLE_NAMES[recentStyle] || recentStyle
  el.galleryStats.appendChild(document.createTextNode(
    `你已做过 ${total} 场梦，最常梦见「${modeName}」，最近偏爱「${recentName}」。${note}`,
  ))
  const visible = visibleRecords().length
  if (visible !== total) {
    el.galleryStats.appendChild(make('span', 'stats-filtered', `（显示 ${visible} / ${total} 场）`))
  }
}

/* ---------- 梦境详情弹层 ---------- */

let overlayCloseEl = null
let detailOrigin = null

function buildDetail(record) {
  const panel = el.overlayPanel
  panel.textContent = ''
  panel.style.setProperty('--accent', STYLE_ACCENTS[record.style] || '#c9a961')

  overlayCloseEl = make('button', 'btn overlay-close', '关闭')
  overlayCloseEl.type = 'button'
  overlayCloseEl.addEventListener('click', closeDetail)
  panel.appendChild(overlayCloseEl)

  panel.appendChild(make('p', 'overlay-style', STYLE_NAMES[record.style] || record.style))
  panel.appendChild(make('h2', 'overlay-title', record.title || '无题之梦'))

  const meta = make('p', 'overlay-meta')
  if (record.moodLabel) meta.appendChild(make('span', '', record.moodLabel))
  meta.appendChild(make('span', '', new Date(record.createdAt).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })))
  meta.appendChild(make('span', '', `seq ${seqSpan(record)}`))
  panel.appendChild(meta)

  panel.appendChild(make('div', 'overlay-text', record.text || ''))

  const glyph = make('div', 'overlay-glyph')
  glyph.appendChild(padGlyph(record))
  panel.appendChild(glyph)

  if (record.themes && record.themes.length > 0) {
    const themes = make('div', 'overlay-chips')
    themes.appendChild(make('span', 'chip-label', '主题'))
    for (const theme of record.themes) themes.appendChild(make('span', 'chip', theme))
    panel.appendChild(themes)
  }

  if (record.noiseSeeds && record.noiseSeeds.length > 0) {
    const seeds = make('div', 'overlay-chips')
    seeds.appendChild(make('span', 'chip-label', '噪声种子'))
    for (const seed of record.noiseSeeds) seeds.appendChild(make('span', 'chip', seed))
    panel.appendChild(seeds)
  }
}

function openDetail(record) {
  detailOrigin = document.activeElement
  buildDetail(record)
  el.overlay.hidden = false
  requestAnimationFrame(() => el.overlay.classList.add('is-open'))
  if (overlayCloseEl) overlayCloseEl.focus()
}

function closeDetail() {
  el.overlay.classList.remove('is-open')
  window.setTimeout(() => {
    if (!el.overlay.classList.contains('is-open')) el.overlay.hidden = true
  }, 450)
  if (detailOrigin instanceof HTMLElement) detailOrigin.focus()
  detailOrigin = null
}

/* ---------- 梦境星盘：月牙 7 连击开启的只读控制台 ---------- */

const STARDIAL_CLICKS = 7
const STARDIAL_WINDOW_MS = 2000
let moonClicks = 0
let moonTimer = 0

function initStardial() {
  el.moonBtn.addEventListener('click', () => {
    moonClicks += 1
    window.clearTimeout(moonTimer)
    moonTimer = window.setTimeout(() => { moonClicks = 0 }, STARDIAL_WINDOW_MS)
    if (moonClicks >= STARDIAL_CLICKS) {
      moonClicks = 0
      window.clearTimeout(moonTimer)
      openStardial()
    }
  })
  el.stardialClose.addEventListener('click', closeStardial)
  el.stardial.addEventListener('click', (event) => {
    if (event.target === el.stardial) closeStardial()
  })
}

async function openStardial() {
  el.stardial.hidden = false
  requestAnimationFrame(() => el.stardial.classList.add('is-open'))
  const body = el.stardialBody
  body.textContent = ''
  body.appendChild(make('p', 'empty-note', '正在读取星盘……'))
  try {
    const response = await fetch('/dreams/api/settings')
    if (!response.ok) throw new Error(`http ${response.status}`)
    const data = await response.json()
    const settings = data.settings || null
    if (settings && Array.isArray(settings.styles)) {
      customStyleNames = {}
      for (const def of settings.styles) {
        if (def && typeof def.id === 'string') customStyleNames[def.id] = def.nameZh || def.id
      }
    }
    buildStardial(settings)
  } catch {
    body.textContent = ''
    body.appendChild(make('p', 'empty-note', '星盘读数失败——引擎没有回应。'))
  }
}

function closeStardial() {
  el.stardial.classList.remove('is-open')
  window.setTimeout(() => {
    if (!el.stardial.classList.contains('is-open')) el.stardial.hidden = true
  }, 450)
  el.moonBtn.focus()
}

/** 把设置铺成星盘：9 颗星均匀落在同一环（40° 间隔），中心是「梦」
 *  与模型路由。单环布局对任意窗口尺寸都不会互相重叠。 */
function buildStardial(settings) {
  const body = el.stardialBody
  body.textContent = ''
  if (!settings) return
  const values = {
    冷却: `${settings.cooldownMs / 1000}s`,
    最少素材: `${settings.minMaterialEvents} 条`,
    每日上限: `${settings.maxDailyDreams} 场`,
    风格轮换: `${settings.styleRotationDays} 天`,
    噪声强度: settings.noiseIntensity === 'low' ? '低' : settings.noiseIntensity === 'high' ? '高' : '中',
    输出上限: `${settings.maxOutputTokens} tokens`,
    超时: `${settings.timeoutMs / 1000}s`,
    隐私模式: settings.privacyMode ? '开' : '关',
    模型路由: settings.route || '跟随会话',
  }

  const astrolabe = make('div', 'astrolabe')
  astrolabe.appendChild(make('div', 'orbit orbit-1'))
  astrolabe.appendChild(make('div', 'orbit orbit-2'))

  const entries = Object.entries(values)
  for (let i = 0; i < entries.length; i += 1) {
    const [label, value] = entries[i]
    const angle = (i / entries.length) * Math.PI * 2 - Math.PI / 2
    const item = make('div', 'star-item')
    item.style.left = `${(50 + 40 * Math.cos(angle)).toFixed(1)}%`
    item.style.top = `${(50 + 40 * Math.sin(angle)).toFixed(1)}%`
    item.appendChild(make('p', 'star-label', label))
    item.appendChild(make('p', 'star-value', value))
    astrolabe.appendChild(item)
  }

  const core = make('div', 'astrolabe-core')
  core.appendChild(make('em', '', '梦'))
  core.appendChild(make('p', 'core-route', settings.route || '跟随会话'))
  astrolabe.appendChild(core)

  body.appendChild(astrolabe)
}

/* ---------- 氛围层：星云、云朵、视差 ---------- */

function buildAmbient() {
  if (REDUCED_MOTION) return
  for (let i = 0; i < 3; i += 1) el.nebula.appendChild(make('span', 'nebula-layer'))
  for (let i = 0; i < 4; i += 1) el.nebula.appendChild(make('span', 'cloud'))
}

function setupParallax() {
  if (REDUCED_MOTION) return
  let raf = 0
  let pending = { x: 0.5, y: 0.5 }
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return
    pending = { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight }
    if (raf !== 0) return
    raf = requestAnimationFrame(() => {
      raf = 0
      document.documentElement.style.setProperty('--px', pending.x.toFixed(4))
      document.documentElement.style.setProperty('--py', pending.y.toFixed(4))
    })
  })
}

/* ---------- 渲染编排 ---------- */

function renderAll(animate = true) {
  renderHero()
  renderCollage(animate)
  renderShelf()
  renderHeader()
  renderStats()
}

/** 记录簿顶部的内联状态行，几秒后自动消失。 */
let statusTimer = 0
function setStatus(text) {
  el.ledgerStatus.textContent = text
  window.clearTimeout(statusTimer)
  if (text) {
    statusTimer = window.setTimeout(() => {
      el.ledgerStatus.textContent = ''
    }, 4000)
  }
}

/** 收录 / 遗忘一场梦。 */
async function mutate(id, action) {
  try {
    const response = await fetch('/dreams/api/dreams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    if (!response.ok) throw new Error(`http ${response.status}`)
    const body = await response.json()
    const record = state.records.find((candidate) => candidate.id === id)
    if (record) Object.assign(record, body.record)
    renderCollage(false)
    renderShelf()
    setStatus(action === 'collect' ? '已收录这场梦。' : '它被遗忘了。')
  } catch {
    setStatus('梦没送到。稍后再试一次。')
  }
}

/** 拉取账本并渲染。 */
async function load() {
  try {
    const response = await fetch('/dreams/api/dreams')
    if (!response.ok) throw new Error(`http ${response.status}`)
    const body = await response.json()
    state.records = body.records || []
  } catch {
    el.heroSkeleton.remove()
    const empty = make('section', 'hero-empty')
    empty.appendChild(make('h1', 'hero-empty-title', '梦没送到。'))
    empty.appendChild(make('p', 'hero-empty-note', '梦境账本暂时读不到。刷新试试，或让 agent 再说两句话。'))
    const retry = make('button', 'btn btn-collect', '重试')
    retry.type = 'button'
    retry.style.marginTop = '1.5rem'
    retry.addEventListener('click', () => {
      el.hero.textContent = ''
      el.hero.appendChild(el.heroSkeleton)
      void load()
    })
    empty.appendChild(retry)
    el.hero.appendChild(empty)
    return
  }
  renderAll(true)
}

/** SSE：新梦一到，立刻排到最前；筛选状态保持，不匹配的新梦安静藏起。 */
function openStream() {
  const stream = new EventSource('/dreams/api/stream')
  stream.onopen = () => {
    state.stream = 'connected'
    renderHeader()
  }
  stream.onerror = () => {
    state.stream = 'lost'
    renderHeader()
  }
  stream.onmessage = (message) => {
    let record
    try {
      record = JSON.parse(message.data)
    } catch {
      return
    }
    if (record && record.id && !state.records.some((candidate) => candidate.id === record.id)) {
      state.records.unshift(record)
      if (state.records.length > 100) state.records.length = 100
      renderAll(false)
    }
  }
}

/* ---------- 启动 ---------- */

buildAmbient()
buildFilterBar()
initStardial()
setupParallax()
void load()
openStream()
