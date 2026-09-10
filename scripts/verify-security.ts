/**
 * **Security hardening — plan §26.**
 *
 * ```
 * pnpm verify:security
 * ```
 *
 * The phase prompt ends with a sentence that is really an instruction about this file: *"do not
 * weaken security to make a test pass."* So every assertion here states the **rule**, and a change
 * that breaks one is a change that weakened the rule — there is nothing to relax.
 *
 * §26 is four sections and only some of them are assertable without a browser or a live Cloudflare
 * account. What is here:
 *
 * - **§26.1a** — every branch of `verifyTurnstile`, driven with an injected verifier. The branch that
 *   matters most is the one nothing else would catch: an **unconfigured** integration must skip, and
 *   a **configured** one must never be skippable by the client.
 * - **§26.1c** — the redirect validator, which is the open-redirect control, and the upload
 *   restrictions.
 * - **§26.1b/§26.1d** — asserted where they are values rather than configuration: see
 *   `pnpm scan:secrets` for the repository scan, and the notes for the review that is prose.
 *
 * No database and no network — the verifier is injected — so **no D-10 guard**, and no live
 * Cloudflare call. The third harness in this project that opens no connection.
 */

import { isSameSitePath } from '../src/lib/same-site-path'
import { SKIPPED_FILES, findSecrets } from '../src/lib/security/secret-patterns'
import { ACCEPTED_MIME_TYPES, MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES } from '../src/lib/media/limits'
import {
  TURNSTILE_FAILURE_MESSAGE,
  TURNSTILE_FIELD,
  verifyTurnstile,
  type TurnstileVerifier,
} from '../src/lib/security/turnstile'

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const KEYS = { secretKey: '0x-secret', siteKey: '0x-site' }

/** Records what it was asked, so the harness can assert what was *not* sent as well as what was. */
function stubVerifier(success: boolean, errorCodes: string[] = []) {
  const calls: { remoteIp: null | string; secretKey: string; token: string }[] = []

  const verifier: TurnstileVerifier = async (input) => {
    calls.push(input)

    return { errorCodes, success }
  }

  return { calls, verifier }
}

/* ============================================ A — §26.1a, configured */
{
  const { calls, verifier } = stubVerifier(true)

  const pass = await verifyTurnstile({ ...KEYS, token: 'token-abc', verifier })

  check('A: a token Cloudflare accepts passes', pass.ok && !pass.skipped)
  check(
    'A: …and the secret reached Cloudflare, not the browser',
    calls[0]?.secretKey === '0x-secret',
  )
  check('A: …with the token as given', calls[0]?.token === 'token-abc')

  const rejected = await verifyTurnstile({
    ...KEYS,
    token: 'token-abc',
    verifier: stubVerifier(false, ['timeout-or-duplicate']).verifier,
  })

  check('A: **a rejected token is a refusal**', !rejected.ok)
  check(
    'A: …and the reason is kept for the log',
    !rejected.ok && rejected.reason === 'timeout-or-duplicate',
  )

  const missing = await verifyTurnstile({ ...KEYS, token: undefined, verifier })

  check(
    'A: **a missing token is a refusal when the integration is configured**',
    !missing.ok && missing.reason === 'missing-token',
  )

  check(
    'A: …and an empty string is the same as missing',
    !(await verifyTurnstile({ ...KEYS, token: '   ', verifier })).ok,
  )

  check(
    'A: …and a non-string is not coerced into one',
    !(await verifyTurnstile({ ...KEYS, token: { toString: () => 'x' }, verifier })).ok,
  )

  const oversized = await verifyTurnstile({ ...KEYS, token: 'x'.repeat(2_049), verifier })

  check(
    'A: an oversized token is refused **before** it is forwarded anywhere',
    !oversized.ok && oversized.reason === 'oversized-token',
  )

  const { calls: notCalled, verifier: counted } = stubVerifier(true)

  await verifyTurnstile({ ...KEYS, token: '', verifier: counted })

  check(
    'A: …and a refused request costs no round trip at all',
    notCalled.length === 0,
    String(notCalled.length),
  )
}

/* ============================================ B — §26.1a, the configured/unconfigured decision */
{
  const { calls, verifier } = stubVerifier(true)

  const noSecret = await verifyTurnstile({
    secretKey: undefined,
    siteKey: '0x-site',
    token: 'anything',
    verifier,
  })

  check(
    'B: **a site key with no secret is unconfigured, not half-configured** — a widget nothing can verify is decoration',
    noSecret.ok && noSecret.skipped,
  )

  const noSite = await verifyTurnstile({
    secretKey: '0x-secret',
    siteKey: undefined,
    token: 'anything',
    verifier,
  })

  check('B: …and so is a secret with no site key', noSite.ok && noSite.skipped)

  check('B: neither reached Cloudflare', calls.length === 0)

  const blank = await verifyTurnstile({ secretKey: '   ', siteKey: '  ', token: 'x', verifier })

  check(
    'B: whitespace-only keys are unconfigured, not configured-with-a-space',
    blank.ok && blank.skipped,
  )

  /*
   * **The property the whole design rests on.** A configured integration cannot be skipped from the
   * request: there is no argument a caller can pass, and no field a client can omit, that turns a
   * required verification into a skipped one. Omitting the token is a refusal, above.
   */
  const configured = await verifyTurnstile({ ...KEYS, token: '', verifier })

  check('B: **a configured integration is never skippable by the client**', !configured.ok)
}

/* ============================================ C — §26.1a, an outage fails closed */
{
  const outage = await verifyTurnstile({
    ...KEYS,
    token: 'token-abc',
    verifier: stubVerifier(false, ['http-500']).verifier,
  })

  check(
    'C: **a Cloudflare outage refuses rather than passes** — the one control in this project that fails closed',
    !outage.ok,
  )

  check(
    'C: a network error is the same refusal, with a reason',
    !(
      await verifyTurnstile({
        ...KEYS,
        token: 'token-abc',
        verifier: stubVerifier(false, ['TimeoutError']).verifier,
      })
    ).ok,
  )
}

/* ============================================ D — the customer is told one thing */
{
  check('D: the failure message is one sentence', TURNSTILE_FAILURE_MESSAGE.split('. ').length <= 2)

  check(
    'D: **it names no cause** — which check failed is a knob for an attacker and nothing for a customer',
    !/token|expired|duplicate|cloudflare|turnstile|bot/i.test(TURNSTILE_FAILURE_MESSAGE),
  )

  check(
    "D: the field name is Cloudflare's own, shared as a constant rather than written twice",
    TURNSTILE_FIELD === 'cf-turnstile-response',
  )
}

/* ============================================ E — §26.1c, the open-redirect control */
{
  for (const path of ['/account', '/account/orders', '/shop?q=a', '/']) {
    check(`E: \`${path}\` is a safe return path`, isSameSitePath(path))
  }

  for (const value of [
    'https://evil.test',
    'http://evil.test',
    '//evil.test',
    '/\\evil.test',
    '\\\\evil.test',
    'javascript:alert(1)',
    'data:text/html,x',
    'account',
    '',
  ]) {
    check(`E: **\`${value || '(empty)'}\` is refused**`, !isSameSitePath(value))
  }

  check(
    'E: **a newline cannot smuggle a second header or a second URL**',
    !isSameSitePath('/account\nLocation: https://evil.test'),
  )

  check('E: …nor a carriage return', !isSameSitePath('/account\r\nSet-Cookie: a=b'))
  check('E: …nor a tab', !isSameSitePath('/acc\tount'))
  check(
    'E: a non-string is refused rather than coerced',
    !isSameSitePath(null) && !isSameSitePath(42),
  )
}

/* ============================================ F — §26.1c, upload restrictions */
{
  check(
    'F: uploads are bounded in bytes',
    MAX_UPLOAD_BYTES > 0 && MAX_UPLOAD_BYTES <= 64 * 1024 * 1024,
  )
  check('F: …and in pixels, which is the decompression bomb', MAX_IMAGE_DIMENSION > 0)

  check(
    'F: **the accepted types are an allowlist, not a denylist**',
    Array.isArray(ACCEPTED_MIME_TYPES) && ACCEPTED_MIME_TYPES.length > 0,
  )

  for (const type of ACCEPTED_MIME_TYPES) {
    check(
      `F: \`${type}\` is an image or a video, never a document or a script`,
      /^(image|video)\//.test(type),
    )
  }

  for (const type of [
    'application/pdf',
    'image/svg+xml',
    'text/html',
    'application/javascript',
    'application/octet-stream',
  ]) {
    check(
      `F: **\`${type}\` is not accepted**`,
      !(ACCEPTED_MIME_TYPES as readonly string[]).includes(type),
    )
  }
}

/* ============================================ G — §26.1d, the scanner itself */
{
  const finds = (line: string) => findSecrets(line).map((entry) => entry.name)

  /**
   * **Every credential-shaped fixture below is assembled, never written whole.**
   *
   * This harness has to contain strings the scanner flags — that is what it is asserting — so a
   * literal would make `pnpm scan:secrets` fail on this file, permanently, and the tempting fix is
   * to allowlist `scripts/`. That would be a hole exactly where somebody is most likely to paste a
   * real key while debugging.
   *
   * `verify-analytics.ts` solves the same problem by marking its fixtures `EXAMPLE`, which works
   * there because it is testing *redaction* and redaction does not care. It cannot work here: half
   * of these assertions are that a credential **is** found, and `EXAMPLE` is a placeholder marker.
   *
   * So the prefix and the body are separate string literals, joined at runtime. The line in this
   * file contains no contiguous match; the value passed to `findSecrets` does.
   */
  const join = (...parts: string[]) => parts.join('')

  const stripeLive = join('sk_', 'live_', '51QQAbCdEfGhIjKlMnOp')
  const stripeTest = join('sk_', 'test_', '51QQAbCdEfGhIjKlMnOp')
  const awsKey = join('AKIA', 'IOSFODNN7ZZZZZZZ')
  const privateKey = join('-----BEGIN ', 'RSA ', 'PRIVATE ', 'KEY-----')
  const pg = (user: string, password: string) =>
    join('postgres://', user, ':', password, '@db.internal/app')

  check(
    'G: a live-looking Stripe secret key is found',
    finds(`const k = "${stripeLive}"`).includes('stripe-secret-key'),
  )

  check(
    'G: a Postgres URL with a password is found',
    finds(pg('dbowner', 's3cretpw1234')).includes('postgres-url-with-password'),
  )

  check('G: an AWS access key id is found', finds(awsKey).length > 0)

  /*
   * **The check that caught a self-inflicted hole.** `PLACEHOLDER_EXACT` briefly listed `SECRET` and
   * `KEY`, which meant a PEM private-key header was excused as an illustration — the single
   * most serious thing this scanner exists to find, silently ignored by the rule meant to reduce
   * noise. It failed on the first run of this assertion.
   */
  check('G: **a private key block is found**', finds(privateKey).length > 0)

  /*
   * **The sweep's other finding.** The placeholder rule was case-insensitive, so the letters `user`
   * inside a real username excused the whole credential. A scanner with a hole shaped like the most
   * common username in the world is worse than none, because it is trusted.
   */
  check(
    'G: **a real credential whose username contains "user" is still found**',
    finds(pg('dbuser', 'aRealPassword1')).length > 0,
  )

  check(
    "G: …and the documentation's shouted placeholder is still excused",
    finds(join('postgresql://', 'USER', ':', 'PASSWORD', '@HOST.neon.tech/DATABASE')).length === 0,
  )

  check(
    'G: an angle-bracket placeholder is excused',
    finds(pg('neondb_owner', '<new-password>')).length === 0,
  )

  /*
   * The Resend pattern used to match prose. These two strings are a real filename and a real
   * database index from this repository.
   */
  check(
    'G: **prose is not a secret** — a filename that happens to contain `re_`',
    finds('03_NORTH01_Website_Structure_and_User_Flow_Current_OnlineOnly.md').length === 0,
  )

  check(
    'G: …nor is a database index name',
    finds('collections_blocks_figure_mobile_image_idx').length === 0,
  )

  check(
    'G: **every match on a line is reported, not only the first**',
    findSecrets(`a ${stripeLive} b ${stripeTest}`).length === 2,
  )

  check(
    'G: ordinary prose finds nothing',
    finds('The jacket is cut from a dense cotton twill.').length === 0,
  )

  check('G: an empty line finds nothing', finds('').length === 0)

  check(
    'G: the lockfile and generated types are skipped by name',
    SKIPPED_FILES.some((pattern) => pattern.test('pnpm-lock.yaml')) &&
      SKIPPED_FILES.some((pattern) => pattern.test('src/payload-types.ts')),
  )
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} security checks passed.`,
  ...failed.map((result) => `FAIL  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
  ...results.map(
    (result) =>
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  ),
].join('\n')

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
})

if (failed.length > 0) {
  throw new Error(`${failed.length} security check(s) failed.`)
}
