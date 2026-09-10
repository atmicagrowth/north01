/**
 * **What `pnpm scan:secrets` looks for** — plan §26.1d, as data rather than as a script.
 *
 * Extracted from `scripts/scan-secrets.ts` during Phase 26's first sweep, for the reason every pure
 * module in this project exists: a scanner that cannot be driven by a harness is a scanner nobody
 * finds out has stopped matching. Both defects below were found by writing the assertions.
 */

/**
 * High-confidence credential shapes, per vendor this project actually integrates.
 *
 * Each pattern either carries a vendor prefix that is meaningless in prose, or requires a structure
 * prose does not have. That constraint is not aesthetic: the first version matched
 * `re_[A-Za-z0-9_-]{16,}` for Resend and hit `Structu`**`re_Current_OnlineOnly`**`.md` and
 * `figu`**`re_mobile_image_idx`**. A scan that reports noise is a scan people learn to skim.
 */
export const SECRET_PATTERNS: readonly { name: string; regex: RegExp }[] = [
  { name: 'stripe-secret-key', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'stripe-webhook-secret', regex: /\bwhsec_[A-Za-z0-9]{16,}/g },
  { name: 'stripe-publishable-key', regex: /\bpk_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'resend-api-key', regex: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/g },
  { name: 'postgres-url-with-password', regex: /\bpostgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`@]+@/gi },
  { name: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'private-key-block', regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  {
    name: 'json-web-token',
    regex: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/g,
  },
  { name: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'algolia-admin-key', regex: /\bALGOLIA_WRITE_API_KEY\s*=\s*[A-Za-z0-9]{16,}/g },
  { name: 'payload-secret', regex: /\bPAYLOAD_SECRET\s*=\s*\S{16,}/g },
]

/**
 * **Documentation placeholders, matched case-sensitively — and this is the sweep's finding.**
 *
 * `docs/DATABASE.md` writes a connection string as `postgresql://USER:PASSWORD@HOST…`, and those
 * shouted words are what makes it obviously an illustration. The first version matched them
 * case-**insensitively**, which quietly excused every real credential whose username contained the
 * letters `user`: `postgres://dbuser:<a real password>@…` was classified as a placeholder and never
 * reported.
 *
 * A scanner with a hole shaped like the most common username in the world is worse than no scanner,
 * because it is trusted. Shouted placeholders are matched exactly; only the genuinely
 * case-insensitive markers stay in `PLACEHOLDER_LOOSE`.
 *
 * **`SECRET` and `KEY` are deliberately not in this list**, and they were, for about a minute.
 * `verify:security` caught it on the first run: a PEM private-key header contains the word `KEY`, so
 * the placeholder rule excused a private key block — the single most serious thing this scanner
 * exists to find, silently ignored by the rule meant to reduce noise. A placeholder word has to be
 * one that appears *only* in an illustration, and `KEY` appears in real credentials.
 */
export const PLACEHOLDER_EXACT = /\b(?:PASSWORD|USERNAME|USER|HOST|HOSTNAME|DATABASE)\b/

/** Markers that are placeholders whatever their case. */
export const PLACEHOLDER_LOOSE = /(?:<[^>]+>|x{3,}|example|your[-_]?|\.{3}|…)/i

export function isPlaceholder(match: string): boolean {
  return PLACEHOLDER_EXACT.test(match) || PLACEHOLDER_LOOSE.test(match)
}

/** Generated or vendored, and enormous. Nothing in these is hand-authored. */
export const SKIPPED_FILES = [/^pnpm-lock\.yaml$/, /^src\/payload-types\.ts$/, /^brand-media\//]

export const BINARY_FILES = /\.(avif|gif|ico|jpe?g|mp4|pdf|png|svg|ttf|webm|webp|woff2?)$/i

/**
 * **Every match on a line, not the first.**
 *
 * `regex.exec` once per line reports one finding per pattern, so a `.env` pasted into a document
 * would surface a single line and hide the rest. The whole point of a report is that somebody can
 * clean up everything it names in one pass.
 */
export function findSecrets(line: string): { match: string; name: string }[] {
  const found: { match: string; name: string }[] = []

  for (const { name, regex } of SECRET_PATTERNS) {
    /* `g` regexes carry `lastIndex` between calls; reset before each line. */
    regex.lastIndex = 0

    for (const match of line.matchAll(regex)) {
      if (!isPlaceholder(match[0])) {
        found.push({ match: match[0], name })
      }
    }
  }

  return found
}
