/// <reference lib="webworker" />
/**
 * Offline support. The `serviceWorker` plugin in vite.config.ts compiles this into dist/sw.js and fills
 * in the files to cache and a version that changes whenever any of them changes.
 *
 * - Install: the new version downloads everything the app needs (the page, scripts, the solver worker,
 *   KaTeX and the fonts) into a fresh cache, then takes over straight away.
 * - Activate: caches from older versions are deleted.
 * - The page is fetched from the network first, so a new deploy shows up on the next visit. The cached
 *   copy is used when offline, or when the network takes more than a few seconds to answer.
 * - Every other file has a content hash in its name and never changes, so it comes from the cache.
 */
declare const __PRECACHE__: string[]
declare const __VERSION__: string

const sw = self as unknown as ServiceWorkerGlobalScope
const PREFIX = 'math-solver-'
const CACHE = PREFIX + __VERSION__
const SCOPE = sw.registration.scope
const PAGE = SCOPE // the app's only page, cached under the scope URL (…/math-solver/)
const NETWORK_TIMEOUT_MS = 4000

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(
        __PRECACHE__.map((path) => {
          const url = new URL(path, SCOPE)
          // Files without a hash in their name could be stale in the HTTP cache, so fetch them fresh.
          const hashed = /\/assets\//.test(url.pathname)
          return new Request(url, { cache: hashed ? 'default' : 'reload' })
        }),
      )
      await sw.skipWaiting()
    })(),
  )
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))
      await sw.clients.claim()
    })(),
  )
})

sw.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return
  if (request.mode === 'navigate') {
    const network = fetchPage(request)
    event.waitUntil(network.catch(() => undefined))
    event.respondWith(page(network))
  } else {
    event.respondWith(file(request))
  }
})

/** Fetches the page and keeps the newest copy of it in the cache. */
async function fetchPage(request: Request): Promise<Response> {
  const response = await fetch(request)
  if (response.ok && new URL(request.url).pathname === new URL(PAGE).pathname) {
    const cache = await caches.open(CACHE)
    await cache.put(PAGE, response.clone())
  }
  return response
}

/** Network first, falling back to the cached page when offline, on a server error, or after a timeout. */
async function page(network: Promise<Response>): Promise<Response> {
  const cached = await caches.match(PAGE, { ignoreVary: true })
  if (!cached) return network
  const timeout = new Promise<Response>((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS))
  const fresh = network.then((r) => (r.status >= 500 ? cached : r)).catch(() => cached)
  return Promise.race([fresh, timeout])
}

/** Cache first. Hashed files fetched later (such as a KaTeX font in an older format) are cached too. */
async function file(request: Request): Promise<Response> {
  // Hashed files never change, so a Vary header (some servers send Vary: Origin) mustn't stop a match.
  const cached = await caches.match(request, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok && new URL(request.url).pathname.includes('/assets/')) {
    const cache = await caches.open(CACHE)
    await cache.put(request, response.clone())
  }
  return response
}
