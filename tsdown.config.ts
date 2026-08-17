/**
 * Node-half build for dsh-dream-incubator: plain ESM library emitted from
 * src/index.ts and the invariant companion from src/invariant.ts. The
 * immersive WebUI assets (static/index.html, dreams.css, dreams.js) ship
 * verbatim in the package `static/` tree and are copied to lib/webui by
 * scripts/copy-static.mjs after tsc emits the node half.
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
