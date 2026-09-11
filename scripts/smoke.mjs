/**
 * **The post-deployment smoke test** — plan §32: *"a post-deployment smoke test covering homepage,
 * search, product, cart, checkout test mode where applicable, Payload admin, and critical
 * API/webhook routes."*
 *
 * ```
 * pnpm smoke https://north01apparel.vercel.app
 * pnpm smoke http://localhost:3000
 * ```
 *
 * **Read-only, and safe to point at production.** Every request is a GET except one: an unsigned POST
 * to the Stripe webhook, which must be refused — that refusal is the check. Nothing is created, no bag
 * is written (a GET never creates a cart; `resolveCart` only creates on a mutation), and no one is
 * signed in.
 *
 * `FAIL` is a broken deployment and exits non-zero. `WARN` is a deployment that works but is
 * configured in a way the owner should know about — search not switched on, a canonical host that is
 * not the host being tested (audit R3-09). No dependencies: Node's own `fetch`.
 */

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
)
const origin = new URL(base).origin
const results = []

const record = (status, name, detail) => results.push({ detail, name, status })

async function get(path, init = {}) {
  const started = Date.now()
  const response = await fetch(`${base}${path}`, { redirect: 'manual', ...init })
  const body = response.status === 204 ? '' : await response.text()

  return { body, ms: Date.now() - started, response }
}

async function check(name, run) {
  try {
    await run()
  } catch (error) {
    record('FAIL', name, `threw: ${String(error?.message ?? error).slice(0, 160)}`)
  }
}

let productPath = null
let productName = null

await check('home', async () => {
  const { body, ms, response } = await get('/')
  if (response.status !== 200) return record('FAIL', 'home', `HTTP ${response.status}`)
  if (!/<h1[\s>]/.test(body)) return record('FAIL', 'home', 'no <h1> in the page')

  const canonical = body.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null

  if (canonical && new URL(canonical).origin !== origin) {
    return record(
      'WARN',
      'home',
      `canonical names ${new URL(canonical).origin}, not ${origin} — check SITE_URL`,
    )
  }

  record('PASS', 'home', `200 in ${ms}ms`)
})

await check('shop', async () => {
  const { body, ms, response } = await get('/shop')
  if (response.status !== 200) return record('FAIL', 'shop', `HTTP ${response.status}`)

  const links = [...body.matchAll(/href="(\/product\/[a-z0-9-]+)"/g)].map((m) => m[1])
  if (links.length === 0)
    return record('FAIL', 'shop', 'no product links — is the catalogue published?')

  productPath = links[0]
  record('PASS', 'shop', `${new Set(links).size} product link(s) in ${ms}ms`)
})

await check('product', async () => {
  if (!productPath) return record('FAIL', 'product', 'no product to open (shop failed)')

  const { body, ms, response } = await get(productPath)
  if (response.status !== 200)
    return record('FAIL', 'product', `${productPath} HTTP ${response.status}`)
  if (!/"@type":"Product"/.test(body))
    return record('FAIL', 'product', `${productPath} has no Product JSON-LD`)

  productName = body.match(/<h1[^>]*>([^<]+)</)?.[1]?.trim() ?? null
  record('PASS', 'product', `${productPath} in ${ms}ms`)
})

await check('search', async () => {
  const term = (productName ?? 'shirt').split(/\s+/)[0].toLowerCase()
  const { body, response } = await get(`/search?q=${encodeURIComponent(term)}`)
  if (response.status !== 200) return record('FAIL', 'search', `HTTP ${response.status}`)
  if (/isn’t available|isn&#x27;t available|isn't available/.test(body)) {
    return record(
      'WARN',
      'search',
      'search is not available — Algolia keys and a production index (docs/DEPLOYMENT.md §6)',
    )
  }

  record('PASS', 'search', `"${term}" returned a results page`)
})

await check('cart', async () => {
  const { response } = await get('/cart')
  record(response.status === 200 ? 'PASS' : 'FAIL', 'cart', `HTTP ${response.status}`)
})

await check('checkout', async () => {
  const { response } = await get('/checkout')
  const location = response.headers.get('location') ?? ''

  if ((response.status === 307 || response.status === 308) && location.includes('/cart')) {
    return record('PASS', 'checkout', 'an empty bag is sent back to the bag')
  }

  record(
    'FAIL',
    'checkout',
    `expected a redirect to /cart for an empty bag, got HTTP ${response.status}`,
  )
})

await check('admin', async () => {
  const { response } = await get('/admin')
  const ok = response.status === 200 || (response.status >= 300 && response.status < 400)
  record(ok ? 'PASS' : 'FAIL', 'admin', `HTTP ${response.status}`)
})

await check('stripe webhook refuses an unsigned request', async () => {
  const { response } = await get('/api/stripe/webhook', {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  if (response.status >= 200 && response.status < 300) {
    return record(
      'FAIL',
      'stripe webhook refuses an unsigned request',
      `ACCEPTED with HTTP ${response.status}`,
    )
  }

  record('PASS', 'stripe webhook refuses an unsigned request', `HTTP ${response.status}`)
})

await check('robots.txt', async () => {
  const { body, response } = await get('/robots.txt')
  if (response.status !== 200 || !/Sitemap:/i.test(body))
    return record('FAIL', 'robots.txt', `HTTP ${response.status}`)
  record('PASS', 'robots.txt', 'names a sitemap')
})

await check('sitemap.xml', async () => {
  const { body, response } = await get('/sitemap.xml')
  const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  if (response.status !== 200 || locs.length === 0)
    return record('FAIL', 'sitemap.xml', `HTTP ${response.status}, ${locs.length} URL(s)`)

  const foreign = locs.filter((loc) => new URL(loc).origin !== origin)
  if (foreign.length > 0)
    return record(
      'WARN',
      'sitemap.xml',
      `${foreign.length} of ${locs.length} URLs name ${new URL(foreign[0]).origin} — check SITE_URL`,
    )

  record('PASS', 'sitemap.xml', `${locs.length} URL(s)`)
})

await check('not-found', async () => {
  const { response } = await get('/product/smoke-test-no-such-product')
  record(response.status === 404 ? 'PASS' : 'FAIL', 'not-found', `HTTP ${response.status}`)
})

await check('reset link is never reported to analytics', async () => {
  const { body, response } = await get('/reset-password?token=smoke-test')
  if (response.status !== 200)
    return record('FAIL', 'reset link is never reported to analytics', `HTTP ${response.status}`)
  if (/googletagmanager\.com|posthog/i.test(body)) {
    return record(
      'FAIL',
      'reset link is never reported to analytics',
      'an analytics script is on /reset-password (Phase 31 hotfix)',
    )
  }

  record('PASS', 'reset link is never reported to analytics', 'no analytics script on the page')
})

const width = Math.max(...results.map((r) => r.name.length))
process.stdout.write(`\nSmoke test — ${base}\n\n`)
for (const r of results)
  process.stdout.write(`${r.status.padEnd(5)} ${r.name.padEnd(width)}  ${r.detail}\n`)

const failed = results.filter((r) => r.status === 'FAIL').length
const warned = results.filter((r) => r.status === 'WARN').length
process.stdout.write(
  `\n${results.length - failed - warned} passed, ${warned} warning(s), ${failed} failed.\n`,
)
process.exit(failed > 0 ? 1 : 0)
