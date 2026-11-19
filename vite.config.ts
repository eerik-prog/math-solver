import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Plugin, type ResolvedConfig, defineConfig, transformWithOxc } from 'vite'

/** Fonts used above the fold, preloaded so text doesn't change font (and shift) after the first paint. */
const PRELOAD_FONTS = [
  /^assets\/geist-latin-wght-normal-.*\.woff2$/,
  /^assets\/instrument-serif-latin-400-normal-.*\.woff2$/,
]

/** Built files the app never needs offline: source maps, and fonts in formats every browser we support skips. */
const NOT_CACHED = [/\.map$/, /\.(woff|ttf)$/, /^og-image\.png$/, /^robots\.txt$/, /^sitemap\.xml$/]

function preloadFonts(): Plugin {
  return {
    name: 'math-solver:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {})
        return PRELOAD_FONTS.map((pattern) => {
          const href = files.find((f) => pattern.test(f))
          if (!href) throw new Error(`No font matches ${pattern}`)
          return {
            tag: 'link',
            attrs: { rel: 'preload', href: `./${href}`, as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head' as const,
          }
        })
      },
    },
  }
}

/** Writes dist/sw.js (from src/worker/service-worker.ts) with the list of files to cache for offline use. */
function serviceWorker(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'math-solver:service-worker',
    apply: 'build',
    configResolved(c) {
      config = c
    },
    async writeBundle(_options, bundle) {
      const hash = createHash('sha256')
      const files: string[] = []
      const add = (name: string, content: string | Uint8Array) => {
        if (NOT_CACHED.some((p) => p.test(name))) return
        files.push(name === 'index.html' ? './' : name)
        hash.update(name).update(content)
      }
      for (const [name, out] of Object.entries(bundle)) add(name, out.type === 'chunk' ? out.code : out.source)
      if (config.publicDir)
        for (const name of readdirSync(config.publicDir)) add(name, readFileSync(join(config.publicDir, name)))
      const source = readFileSync(join(config.root, 'src/worker/service-worker.ts'), 'utf8')
      hash.update(source)
      const { code } = await transformWithOxc(source, 'service-worker.ts', { lang: 'ts' })
      const sw = code
        .replace('__PRECACHE__', JSON.stringify(files.sort()))
        .replace('__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)))
      writeFileSync(join(config.build.outDir, 'sw.js'), sw)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [react(), preloadFonts(), serviceWorker()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
