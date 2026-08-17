/**
 * Copy the immersive WebUI static assets into lib/webui so the built package
 * serves one tree. The browser script and stylesheet are authored as plain
 * ES modules — they never enter the node half's module graph.
 */
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'static')
const target = resolve(root, 'lib/webui')

mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
console.log(`copied ${source} -> ${target}`)
