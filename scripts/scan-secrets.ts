/**
 * **Plan §26.1d — the repository secret scan.**
 *
 * ```
 * pnpm scan:secrets
 * ```
 *
 * > *"Search the repository for accidental secret strings before production deployment."*
 *
 * A one-off `grep` satisfies that sentence once. A committed script satisfies it every time, which is
 * the difference between a check that was done and a check that holds — and it is the same argument
 * every `verify:*` harness in this project makes.
 *
 * ### It scans what git tracks, and nothing else
 *
 * `git ls-files` is the list, which is exactly right for this question: a secret that is not tracked
 * cannot be pushed, and `.env` is git-ignored. It also means the scan cannot be fooled by a
 * `node_modules` full of vendor test fixtures — a scan that reports two hundred findings gets
 * ignored, and an ignored scan is worse than none.
 *
 * ### Patterns are high-confidence, and the loose one was removed after it fired
 *
 * The first version matched `re_[A-Za-z0-9_-]{16,}` for Resend keys. It hit
 * `Structu`**`re_Current_OnlineOnly`**`.md` and `figu`**`re_mobile_image_idx`** — a filename and a
 * database index. A pattern that matches English is a pattern that trains people to skim the output.
 *
 * So every pattern below either carries a vendor prefix that is meaningless in prose, or requires a
 * structure prose does not have. Resend is covered by requiring the key body to look like a key
 * rather than like words.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

type Finding = { file: string; line: number; pattern: string; sample: string }

/**
 * What a real credential looks like, per vendor this project actually integrates.
 *
 * `PLACEHOLDER` catches the shapes that are *supposed* to be in the repository — `.env.example`'s
 * empty assignments, the documentation's `<new-password>` — so they can be excluded by shape rather
 * than by file, which is the version that keeps working when somebody adds a new doc.
 */
const PATTERNS: readonly { name: string; regex: RegExp }[] = [
  { name: 'stripe-secret-key', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'stripe-webhook-secret', regex: /\bwhsec_[A-Za-z0-9]{16,}/g },
  { name: 'stripe-publishable-key', regex: /\bpk_(?:live|test)_[A-Za-z0-9]{16,}/g },
  /* Resend: `re_` then a key body — mixed case or digits, and no further word breaks. */
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
 * A placeholder is not a secret.
 *
 * `.env.example` exists to show the shape, and `docs/DATABASE.md` shows a connection string with the
 * password spelled `PASSWORD`. Both are correct, and both would otherwise be findings forever.
 */
const PLACEHOLDER = /(?:PASSWORD|USER|HOST|DATABASE|<[^>]+>|xxx+|XXX+|example|your[-_]?|\.{3}|…)/i

/** Generated or vendored, and enormous. Nothing here is hand-authored. */
const SKIPPED = [/^pnpm-lock\.yaml$/, /^src\/payload-types\.ts$/, /^brand-media\//]

const BINARY = /\.(avif|gif|ico|jpe?g|mp4|pdf|png|svg|ttf|webm|webp|woff2?)$/i

/** Nothing this project writes is anywhere near this long on one line except generated data. */
const MAX_LINE = 4_000

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((file) => file.length > 0)
}

const findings: Finding[] = []

let scanned = 0

for (const file of trackedFiles()) {
  if (SKIPPED.some((pattern) => pattern.test(file)) || BINARY.test(file)) {
    continue
  }

  let contents: string

  try {
    if (statSync(file).size > 8 * 1024 * 1024) {
      continue
    }

    contents = readFileSync(file, 'utf8')
  } catch {
    /* Unreadable, or removed since `ls-files`. Not a finding. */
    continue
  }

  scanned += 1

  const lines = contents.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    if (line.length > MAX_LINE) {
      continue
    }

    for (const { name, regex } of PATTERNS) {
      /* `g` regexes carry `lastIndex` between calls; reset before each line. */
      regex.lastIndex = 0

      const match = regex.exec(line)

      if (!match || PLACEHOLDER.test(match[0])) {
        continue
      }

      findings.push({
        file,
        line: index + 1,
        pattern: name,
        /*
         * A prefix and a length, never the value. A scan report that quotes the credential it found
         * is a second copy of it, in CI logs, forever.
         */
        sample: `${match[0].slice(0, 8)}… (${match[0].length} chars)`,
      })
    }
  }
}

const report = [
  findings.length === 0
    ? `No secrets found in ${scanned} tracked files.`
    : `${findings.length} possible secret(s) in ${scanned} tracked files.`,
  ...findings.map(
    (finding) => `  ${finding.file}:${finding.line}  ${finding.pattern}  ${finding.sample}`,
  ),
].join('\n')

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
})

if (findings.length > 0) {
  throw new Error(`${findings.length} possible secret(s) found. See above.`)
}
