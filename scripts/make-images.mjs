// Draws the app icons and the social preview image into public/, in black and white.
// Run with `node scripts/make-images.mjs` after changing the logo or the tagline; the PNGs are committed.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public')
const file = (p) => pathToFileURL(join(root, 'node_modules', p)).href
mkdirSync(out, { recursive: true })

const INK = '#0a0a0a'
const PAPER = '#fafafa'
const MUTED = '#626262'
// The sigma from favicon.svg, drawn in a 64-unit box.
const SIGMA = 'M20 16h24v6H29l10 10-10 10h15v6H20v-5l11-11-11-11z'

/** A square icon. `bleed` fills the whole square (maskable, Apple); otherwise the corners are rounded. */
const icon = (size, { bleed, scale = 1 }) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="${bleed ? 0 : 14}" fill="${INK}"/>
    <path d="${SIGMA}" fill="${PAPER}" transform="translate(32 32) scale(${scale}) translate(-32 -32)"/>
  </svg>`

const ICONS = [
  { name: 'icon-192.png', size: 192, bleed: false },
  { name: 'icon-512.png', size: 512, bleed: false },
  // Maskable icons get cropped to a circle or squircle: keep the sign inside the middle 80%.
  { name: 'icon-maskable-512.png', size: 512, bleed: true, scale: 0.8 },
  { name: 'apple-touch-icon.png', size: 180, bleed: true, scale: 0.9 },
]

const fonts = `
  @font-face { font-family: 'Instrument Serif'; font-style: normal; src: url(${file('@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2')}); }
  @font-face { font-family: 'Instrument Serif'; font-style: italic; src: url(${file('@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2')}); }
  @font-face { font-family: 'Geist'; font-weight: 100 900; src: url(${file('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')}); }
  @font-face { font-family: 'Geist Mono'; font-weight: 100 900; src: url(${file('@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2')}); }`

const social = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="${file('katex/dist/katex.min.css')}">
<script src="${file('katex/dist/katex.min.js')}"></script>
<style>
  ${fonts}
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: ${PAPER}; color: ${INK}; font-family: Geist, sans-serif; position: relative; }
  body::before { content: ''; position: absolute; inset: 0;
    background-image: linear-gradient(rgba(10,10,10,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(10,10,10,.06) 1px, transparent 1px);
    background-size: 36px 36px; background-position: -1px -1px;
    mask-image: radial-gradient(ellipse 85% 85% at 30% 0%, #000 30%, transparent 100%); }
  .wrap { position: relative; height: 100%; padding: 64px 72px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .logo { width: 56px; height: 56px; border-radius: 14px; background: ${INK}; display: grid; place-items: center; }
  .wordmark { font-family: 'Instrument Serif'; font-size: 44px; line-height: 1; }
  h1 { font-family: 'Instrument Serif'; font-weight: 400; font-size: 92px; line-height: 1.02; letter-spacing: -0.02em; margin: 64px 0 0; }
  h1 em { display: block; color: ${MUTED}; }
  .card { position: absolute; right: 72px; top: 176px; width: 400px; background: #fff; border: 2px solid ${INK}; border-radius: 22px; padding: 26px 26px 22px; box-shadow: 0 30px 60px -30px rgba(10,10,10,.35); }
  .problem { font-size: 30px; }
  .label { font-family: 'Geist Mono'; font-size: 15px; letter-spacing: .12em; text-transform: uppercase; color: ${MUTED}; margin: 18px 0 10px; }
  .answer { background: ${INK}; color: ${PAPER}; border-radius: 14px; padding: 12px 20px; font-size: 26px; margin-top: 10px; }
  .foot { margin-top: auto; font-family: 'Geist Mono'; font-size: 22px; color: ${MUTED}; }
  .katex { font-size: 1em; }
</style></head>
<body><div class="wrap">
  <div class="brand"><div class="logo">${icon(40, { bleed: true, scale: 1.25 }).replace(`fill="${INK}"/>`, `fill="none"/>`)}</div><span class="wordmark">Math Solver</span></div>
  <h1>Type a problem.<em>See every step.</em></h1>
  <div class="foot">Free · Exact answers · Plain-language steps · Graphs</div>
  <div class="card">
    <div class="problem" data-tex="x^{2} - 5x + 6 = 0"></div>
    <div class="label">Answers</div>
    <div class="answer" data-tex="x = 2"></div>
    <div class="answer" data-tex="x = 3"></div>
  </div>
</div>
<script>
  for (const el of document.querySelectorAll('[data-tex]')) katex.render(el.dataset.tex, el)
</script>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

for (const { name, size, bleed, scale } of ICONS) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${icon(size, { bleed, scale })}`,
  )
  await page.screenshot({ path: join(out, name), omitBackground: !bleed })
  console.log(`public/${name}`)
}

// Opened from a file so that it can load the fonts and KaTeX from node_modules.
const tmp = mkdtempSync(join(tmpdir(), 'math-solver-'))
writeFileSync(join(tmp, 'social.html'), social)
await page.setViewportSize({ width: 1200, height: 630 })
await page.goto(pathToFileURL(join(tmp, 'social.html')).href, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: join(out, 'og-image.png') })
console.log('public/og-image.png')
rmSync(tmp, { recursive: true, force: true })

await browser.close()
