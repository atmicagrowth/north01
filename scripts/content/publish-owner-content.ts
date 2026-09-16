/**
 * **Publish the owner's support and legal copy into a live shop.**
 *
 * ```
 * pnpm content:publish        # dry run — prints what would change, writes nothing
 * pnpm content:publish:write  # writes it
 * ```
 *
 * ### Why this exists
 *
 * `TODO.md` §12 asked the owner to retype ten answers, two policies, the contact address and two
 * pages of legal text into the production admin, because **the seed refuses every database but the
 * development one** (**D-10**) and production's content was entered separately. Retyping is how the
 * wording drifted in the first place — the FAQ promised same-day dispatch and named an address that
 * cannot receive mail (**DOC-01**, **DOC-02**), which Phase 36 corrected in the seed and nowhere else.
 *
 * This writes the same strings the seed writes, from the same modules (`seed/support.ts`,
 * `seed/legal.ts`), so the live shop and the repository cannot disagree about what the shop promises.
 *
 * ### What it touches, and nothing else
 *
 * - `site-settings`: `contactEmail`, `shippingPolicy`, `returnsPolicy`, `privacyPolicy`, `termsOfSale`
 * - `faqs`: the answer of each **existing** question it can match, by exact question text
 * - `size-guides`: `fitNotes`, by the guide's title
 *
 * It creates nothing. A question or guide that is not there is reported and skipped, because an
 * answer nobody wrote is not this script's to invent. Products, orders, customers, media and
 * navigation are never read or written.
 *
 * ### It is safe to run twice
 *
 * Every write is compared first and skipped when the text already matches, so a second run reports
 * *unchanged* for everything. It writes through the Local API, so the same hooks and validation an
 * admin save runs apply here.
 *
 * ### Running it against production
 *
 * Like `pnpm reindex` (docs/DEPLOYMENT.md §6), this is the one kind of script that is *meant* to be
 * pointed at production, from a shell that holds production's `DATABASE_URL` for that command only —
 * never `.env`. The target host is printed before anything is written, so the operator can stop.
 * The storefront caches settings and help content for five minutes, so a change appears within that.
 */

import config from '../../src/payload.config'

import { FAQS as EDITORIAL_FAQ_SPECS } from '../seed/editorial'
import { PRIVACY_PARAGRAPHS, TERMS_PARAGRAPHS } from '../seed/legal'
import { rich } from '../seed/shared'
import {
  CONTACT_EMAIL,
  FAQ_SPECS,
  RETURNS_POLICY_PARAGRAPHS,
  SHIPPING_POLICY_PARAGRAPHS,
  SIZE_GUIDE_FIT_NOTES,
} from '../seed/support'

/**
 * **Every FAQ the seed writes, from both modules that declare them** — the publisher's own sweep 1.
 *
 * The first version iterated `seed/support.ts` alone and silently covered six of fourteen: the eight
 * in `seed/editorial.ts` were not written, not compared and not even reported as missing, while
 * `TODO.md` §12 told the owner the command covered everything. Five of those eight are the answers
 * sweep 1 of Phase 37 corrected (S09–S11) — the evening carrier scan, the same-day refund, the
 * delivery estimate "we hold ourselves to", and the shipping answer that said *worldwide* where
 * checkout accepts eight countries.
 */
const ALL_FAQS: readonly { paragraphs: readonly string[]; question: string }[] = [
  ...FAQ_SPECS.map((spec) => ({ paragraphs: [spec.answer], question: spec.question })),
  ...EDITORIAL_FAQ_SPECS.map((spec) => ({ paragraphs: spec.answer, question: spec.question })),
]

/**
 * `write: false` reports and changes nothing. The two entry points are separate FILES rather than one
 * file with a flag, for the reason `scripts/reindex.ts` records: `payload run` forwards no arguments,
 * so a `--write` flag would be silently ignored — and the command meant to REPORT would have WRITTEN.
 */
export async function publishOwnerContent({ write }: { write: boolean }): Promise<void> {
  const { getPayload } = await import('payload')

  const payload = await getPayload({ config })

  /** The database this is about to change, named before anything is written. */
  const target = (() => {
    try {
      const url = new URL(process.env.DATABASE_URL ?? '')

      return `${url.hostname}${url.pathname}`
    } catch {
      return '(unreadable DATABASE_URL)'
    }
  })()

  type Outcome = 'changed' | 'missing' | 'unchanged'

  const results: { detail: string; outcome: Outcome; what: string; written?: boolean }[] = []

  /** False until the last step returns, so a failed run's report can say the rest is unpublished. */
  let finished = false

  const record = (what: string, outcome: Outcome, detail = '') => {
    const row = { detail, outcome, what, written: false }

    results.push(row)

    return row
  }

  /** The plain text of a Lexical document, paragraph by paragraph — what is compared. */
  function paragraphsOf(value: unknown): string[] {
    const root = (value as { root?: { children?: unknown[] } } | null)?.root

    if (!root?.children) {
      return []
    }

    return root.children.map((node) => {
      const children = (node as { children?: { text?: string }[] }).children ?? []

      return children.map((child) => child.text ?? '').join('')
    })
  }

  const sameText = (value: unknown, wanted: readonly string[]): boolean => {
    const found = paragraphsOf(value)

    return found.length === wanted.length && found.every((text, index) => text === wanted[index])
  }

  /**
   * The first paragraph that differs, old and new, trimmed to something readable.
   *
   * A count of paragraphs was the first version, and it told an operator nothing: a policy an editor
   * had corrected by hand — the free-delivery figure in the terms, say, which `TODO.md` §12 asks them
   * to check — reported `8 → 8 paragraph(s)` and would have been quietly overwritten (sweep 1).
   */
  const firstDifference = (value: unknown, wanted: readonly string[]): string => {
    const found = paragraphsOf(value)
    const index = wanted.findIndex((text, at) => found[at] !== text)
    const at = index === -1 ? found.length - 1 : index
    const clip = (text: string | undefined) =>
      text === undefined ? '(nothing)' : `“${text.slice(0, 70)}${text.length > 70 ? '…' : ''}”`

    return `paragraph ${at + 1}: ${clip(found[at])} → ${clip(wanted[at])}`
  }

  try {
    process.stdout.write(`Target database: ${target}\n${write ? 'WRITING' : 'DRY RUN'}\n\n`)

    // ------------------------------------------------------------------ settings
    const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })

    const settingsChanges: Record<string, unknown> = {}
    const settingsRows: { written?: boolean }[] = []

    if (settings.contactEmail !== CONTACT_EMAIL) {
      settingsChanges.contactEmail = CONTACT_EMAIL
      settingsRows.push(
        record(
          'site-settings.contactEmail',
          'changed',
          `${settings.contactEmail} → ${CONTACT_EMAIL}`,
        ),
      )
    } else {
      record('site-settings.contactEmail', 'unchanged')
    }

    for (const [field, paragraphs] of [
      ['shippingPolicy', SHIPPING_POLICY_PARAGRAPHS],
      ['returnsPolicy', RETURNS_POLICY_PARAGRAPHS],
      ['privacyPolicy', PRIVACY_PARAGRAPHS],
      ['termsOfSale', TERMS_PARAGRAPHS],
    ] as const) {
      if (sameText(settings[field], paragraphs)) {
        record(`site-settings.${field}`, 'unchanged')

        continue
      }

      settingsChanges[field] = rich(...paragraphs)
      settingsRows.push(
        record(`site-settings.${field}`, 'changed', firstDifference(settings[field], paragraphs)),
      )
    }

    if (write && Object.keys(settingsChanges).length > 0) {
      await payload.updateGlobal({ slug: 'site-settings', data: settingsChanges, depth: 0 })

      for (const row of settingsRows) {
        row.written = true
      }
    }

    // ---------------------------------------------------------------------- FAQs
    for (const spec of ALL_FAQS) {
      const found = await payload.find({
        collection: 'faqs',
        where: { question: { equals: spec.question } },
        limit: 1,
        depth: 0,
      })

      const existing = found.docs[0]

      if (!existing) {
        record(`faq: ${spec.question}`, 'missing', 'no question with this exact wording')

        continue
      }

      /*
       * A draft FAQ is found (the Local API overrides access) and corrected, but it is not on
       * `/help/faq`. Saying so is the difference between a corrected answer and a corrected answer
       * nobody can read; publishing it here is not this script's decision to make.
       */
      const draft = existing.status === 'published' ? '' : ' [draft — not shown on /help/faq]'

      if (sameText(existing.answer, spec.paragraphs)) {
        record(`faq: ${spec.question}`, 'unchanged', draft.trim())

        continue
      }

      const row = record(
        `faq: ${spec.question}`,
        'changed',
        `${firstDifference(existing.answer, spec.paragraphs)}${draft}`,
      )

      if (write) {
        await payload.update({
          collection: 'faqs',
          id: existing.id,
          data: { answer: rich(...spec.paragraphs) },
          depth: 0,
        })

        row.written = true
      }
    }

    // --------------------------------------------------------------- size guides
    for (const { fitNotes, slug } of SIZE_GUIDE_FIT_NOTES) {
      const found = await payload.find({
        collection: 'size-guides',
        where: { slug: { equals: slug } },
        limit: 1,
        depth: 0,
      })

      const existing = found.docs[0]

      if (!existing) {
        record(`size guide: ${slug}`, 'missing', 'no guide with this slug')

        continue
      }

      if (sameText(existing.fitNotes, [fitNotes])) {
        record(`size guide: ${slug}`, 'unchanged')

        continue
      }

      const row = record(
        `size guide: ${slug}`,
        'changed',
        firstDifference(existing.fitNotes, [fitNotes]),
      )

      if (write) {
        await payload.update({
          collection: 'size-guides',
          id: existing.id,
          data: { fitNotes: rich(fitNotes) },
          depth: 0,
        })

        row.written = true
      }
    }

    finished = true
  } finally {
    /*
     * **The report is printed on every exit path, including a throw** — sweep 1. Each write commits in
     * its own transaction, so a failure part-way leaves some of this published and the rest not: a
     * size guide an editor left with a blank measurement throws a validation error from a write that
     * named only `fitNotes`, because Payload re-validates the whole document. The first version built
     * the report as the last statement of the `try`, so exactly the operator who needed to know which
     * half had landed got a stack trace and nothing else.
     */
    const lines = results.map(
      ({ detail, outcome, what, written }) =>
        `${outcome.toUpperCase().padEnd(9)} ${what}${
          write && outcome === 'changed' && !written ? ' [NOT written]' : ''
        }${detail ? ` — ${detail}` : ''}`,
    )

    const changed = results.filter((row) => row.outcome === 'changed').length
    const applied = results.filter((row) => row.outcome === 'changed' && row.written).length
    const missing = results.filter((row) => row.outcome === 'missing').length

    /*
     * One awaited `process.stdout.write` rather than the logger, for the reason `reindex.ts` records:
     * `payload.destroy()` tears the logger's transport down, and a report nobody sees is not a report.
     */
    await new Promise<void>((resolve) => {
      process.stdout.write(
        `${lines.join('\n')}\n\n${
          write
            ? `${applied} of ${changed} change(s) written${
                finished ? '' : ' — the run failed, and the rest are NOT published'
              }`
            : `${changed} change(s) to write — re-run with \`pnpm content:publish:write\``
        }, ${missing} item(s) not found.\n` +
          'The help and legal pages show it immediately. The footer links to the legal pages take up ' +
          'to five minutes,\nand the sitemap up to an hour.\n',
        /* Resolve either way: a failed stdout write must not replace the error that got us here. */
        () => resolve(),
      )
    })

    await payload.destroy()
  }
}
