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
 * the difference between a check that was done and a check that holds — the same argument every
 * `verify:*` harness in this project makes.
 *
 * ### It scans what git tracks, and nothing else
 *
 * `git ls-files` is the list, which is exactly right for this question: a secret that is not tracked
 * cannot be pushed, and `.env` is git-ignored. It also means the scan cannot be drowned by a
 * `node_modules` full of vendor test fixtures — a scan that reports two hundred findings gets
 * ignored, and an ignored scan is worse than none.
 *
 * ### The matching lives in `lib/security/secret-patterns.ts`
 *
 * Moved there in this phase's first sweep, so `pnpm verify:security` can assert it. A scanner that
 * cannot be driven by a harness is a scanner nobody finds out has stopped matching — and the sweep
 * found two ways it had: a Resend pattern that matched English, and a placeholder rule that excused
 * any credential whose username contained the letters `user`. Both are documented where they were
 * fixed.
 *
 * What stays here is the walk: which files, how big, and how to report.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

import { BINARY_FILES, SKIPPED_FILES, findSecrets } from '../src/lib/security/secret-patterns'

type Finding = { file: string; line: number; pattern: string; sample: string }

/** Nothing this project writes is anywhere near this long on one line except generated data. */
const MAX_LINE = 4_000

const MAX_FILE_BYTES = 8 * 1024 * 1024

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((file) => file.length > 0)
}

const findings: Finding[] = []

let scanned = 0

for (const file of trackedFiles()) {
  if (SKIPPED_FILES.some((pattern) => pattern.test(file)) || BINARY_FILES.test(file)) {
    continue
  }

  let contents: string

  try {
    if (statSync(file).size > MAX_FILE_BYTES) {
      continue
    }

    contents = readFileSync(file, 'utf8')
  } catch {
    /* Unreadable, or removed since `ls-files`. Not a finding. */
    continue
  }

  scanned += 1

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (line.length > MAX_LINE) {
      continue
    }

    for (const { match, name } of findSecrets(line)) {
      findings.push({
        file,
        line: index + 1,
        pattern: name,
        /*
         * A prefix and a length, never the value. A scan report that quotes the credential it found
         * is a second copy of it, in CI logs, forever.
         */
        sample: `${match.slice(0, 8)}… (${match.length} chars)`,
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
