# dsh-dream-incubator

English | [中文](README.zh.md)

A dream incubator for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The plugin watches your session's event stream through the Cordis firehose, and in the background — while you keep working — it *dreams*: it distills the day's conversation material into stylized Chinese dream reports, one per session per cooldown period, and surfaces them in an immersive web page at `/dreams`.

The design follows four cognitive-psychology mechanisms:

- **Activation–Synthesis** — each dream begins with an emotion scan of the material window (PAD model: valence / arousal / dominance), then synthesizes a narrative in one of six styles: 黑色悬疑 (noir), 赛博朋克 (cyberpunk), 超现实 (surreal), 奇幻 (fantasy), 寓言 (fable), 恐怖 (horror). The style matrix rotates every `styleRotationDays` so favorites drift.
- **Threat Simulation** — failed turns, tool errors, and aborted requests are weighted into the material and the mood hints. Stressful days dream differently from quiet ones.
- **Memory Reorganization** — the engine recombines a trailing window of real session events through per-style noise seeds, so each dream is a fresh reinterpretation of what actually happened, never a replay.
- **Incubation Effect** — a cooldown and a daily cap keep the engine from dreaming too eagerly; the gap is the incubation.

## Install

```sh
dsh plugin --profile web add dsh-dream-incubator
```

The patch bundle registers one row (`dream-incubator`). Headless profiles get the engine and the commands; web profiles additionally mount the UI.

## Configuration

All keys are optional; the defaults below are supplied by the harness patch (this package ships no hardcoded defaults — a missing key fails loud at load time).

| Key | Default | Meaning |
|---|---|---|
| `cooldownMs` | `3600000` | Minimum quiet interval between two dreams for one session |
| `minMaterialEvents` | `4` | Minimum material events since the last dream before the engine may dream |
| `maxDailyDreams` | `8` | Hard daily ceiling per session (resets at midnight) |
| `styleRotationDays` | `4` | Rotate the six-style library every N days |
| `noiseIntensity` | `medium` | Activation–Synthesis noise strength: `low` \| `medium` \| `high` |
| `maxOutputTokens` | `500` | Output-token cap for both the scan and the dream model calls |
| `timeoutMs` | `120000` | End-to-end deadline for one dream cycle |
| `privacyMode` | `false` | When true, the scan prompt receives message counts and tool names but no user text |
| `provider` / `model` | `null` | Optional explicit model route (must appear together). When absent, the engine reuses the session's latest logged `request/header` route |
| `storePath` | `~/.dsh/dream-incubator/dreams.json` | JSON dream ledger location |
| `serveUi` | `true` | Serve the immersive page at `/dreams` (web profiles only) |

Invalid values (unknown keys, non-integer limits, `provider` without `model`, …) throw at load time — the harness surfaces the exact message.

## Commands

| Command | What it does |
|---|---|
| `/dream` | Force a dream right now, bypassing the cooldown and material gates |
| `/dreams` | List the 8 most recent dreams with their style, mood, and material span; mark each as *collected* (收录) or *forgotten* (遗忘) |
| `/dreamsettings` | Show the live engine settings: model route, noise, gates, privacy, UI |

## Web UI

With `serveUi: true`, open `http://<host>:<port>/dreams`. The page is a late-night gallery: violet-blue nebula light and drifting clouds behind everything, a large PAD glyph (valence × arousal × dominance) and drifting noise motes on the hero, then a collage of floating fragment cards — each an irregular quadrilateral/pentagon (the shape is derived from the dream's id, stable across visits), gently bobbing, tilting in 3D with the mouse, with light and shadow hugging the fragment outline and one low-saturation per-style accent. Click a card to dissolve into the full dream detail; filter by style / emotion / time, and the stats line tells you what you dream about most. Click the footer moon 7 times to open the read-only stardial console. New dreams arrive live over SSE.

Routes:

| Route | Purpose |
|---|---|
| `GET /dreams` | The page |
| `GET /dreams/assets/*` | Static assets (fonts, CSS, JS) |
| `GET /dreams/api/dreams` | The ledger as JSON (newest first) |
| `POST /dreams/api/dreams` | Mutate a record (`collect` / `forget`) |
| `GET /dreams/api/settings` | Live engine settings (read-only; stardial data source) |
| `GET /dreams/api/stream` | Server-sent events; pushes every new dream |

## Architecture

```
src/
  index.ts            plugin entry: config validation, cadence gates, commands
  engine/
    material.ts       observation layer: session events → material lines + stats
    styles.ts         the six-style matrix, rotation, mood hints, scan coercion
    noise.ts          seeded LCG + per-style noise drawing (activation–synthesis)
    prompts.ts        scan and dream prompt assembly (privacy-aware)
    dreamer.ts        the dream cycle: route → window → scan → dream → record
  store.ts            versioned JSON ledger (atomic writes, cap 300 records)
  webui/server.ts     /dreams page, JSON API, settings route, SSE push
  invariant.ts        DSH invariant companion (no-op; reserved)
static/
  index.html          page skeleton: gallery, detail overlay, stardial, ambience
  dreams.css          design system: violet-blue nebula, fragment cards, per-style accents
  dreams.js           fragment collage, mouse tilt, filters + stats, detail, stardial, SSE client
```

The engine never touches session data outside its window: each dream cites the exact `materialSeqs` it was built from, and `privacyMode` keeps user text out of the model prompt entirely.

## Development

```sh
pnpm install
pnpm build    # tsdown → lib/ (index + invariant + webui assets)
pnpm test     # vitest — 86 unit + integration + route tests
```

## Publishing

`dsh-dream-incubator` targets the `dsh-plugin` npm tag:

```sh
npm publish --tag dsh-plugin
```

The published tarball ships `lib/` (engine, invariant companion, and the `lib/webui/` static assets resolved relative to the bundle), plus the `cordis.patch.yml` consumed by `dsh plugin add`.
