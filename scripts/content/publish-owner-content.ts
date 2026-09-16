/**
 * **Publish the owner's support and legal copy into a live shop.**
 *
 * ```
 * pnpm content:publish          # dry run — prints what would change, writes nothing
 * pnpm content:publish --write  # writes it
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

  const results: { detail: string; outcome: Outcome; what: string }[] = []

  const record = (what: string, outcome: Outcome, detail = '') => {
    results.push({ detail, outcome, what })
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

  try {
    process.stdout.write(`Target database: ${target}\n${write ? 'WRITING' : 'DRY RUN'}\n\n`)

    // ------------------------------------------------------------------ settings
    const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })

    const settingsChanges: Record<string, unknown> = {}

    if (settings.contactEmail !== CONTACT_EMAIL) {
      settingsChanges.contactEmail = CONTACT_EMAIL
      record('site-settings.contactEmail', 'changed', `${settings.contactEmail} → ${CONTACT_EMAIL}`)
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
      record(
        `site-settings.${field}`,
        'changed',
        `${paragraphsOf(settings[field]).length} → ${paragraphs.length} paragraph(s)`,
      )
    }

    if (write && Object.keys(settingsChanges).length > 0) {
      await payload.updateGlobal({ slug: 'site-settings', data: settingsChanges, depth: 0 })
    }

    // ---------------------------------------------------------------------- FAQs
    for (const spec of FAQ_SPECS) {
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

      if (sameText(existing.answer, [spec.answer])) {
        record(`faq: ${spec.question}`, 'unchanged')

        continue
      }

      record(
        `faq: ${spec.question}`,
        'changed',
        paragraphsOf(existing.answer)[0]?.slice(0, 70) ?? '',
      )

      if (write) {
        await payload.update({
          collection: 'faqs',
          id: existing.id,
          data: { answer: rich(spec.answer) },
          depth: 0,
        })
      }
    }

    // --------------------------------------------------------------- size guides
    for (const [title, notes] of Object.entries(SIZE_GUIDE_FIT_NOTES)) {
      const found = await payload.find({
        collection: 'size-guides',
        where: { title: { equals: title } },
        limit: 1,
        depth: 0,
      })

      const existing = found.docs[0]

      if (!existing) {
        record(`size guide: ${title}`, 'missing', 'no guide with this title')

        continue
      }

      if (sameText(existing.fitNotes, [notes])) {
        record(`size guide: ${title}`, 'unchanged')

        continue
      }

      record(
        `size guide: ${title}`,
        'changed',
        paragraphsOf(existing.fitNotes)[0]?.slice(0, 70) ?? '',
      )

      if (write) {
        await payload.update({
          collection: 'size-guides',
          id: existing.id,
          data: { fitNotes: rich(notes) },
          depth: 0,
        })
      }
    }

    // ------------------------------------------------------------------- verdict
    const lines = results.map(
      ({ detail, outcome, what }) =>
        `${outcome.toUpperCase().padEnd(9)} ${what}${detail ? ` — ${detail}` : ''}`,
    )

    const changed = results.filter((row) => row.outcome === 'changed').length
    const missing = results.filter((row) => row.outcome === 'missing').length

    /*
     * One awaited `process.stdout.write` rather than the logger, for the reason `reindex.ts` records:
     * `payload.destroy()` tears the logger's transport down, and a report nobody sees is not a report.
     */
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(
        `${lines.join('\n')}\n\n${
          write
            ? `${changed} change(s) written`
            : `${changed} change(s) to write — re-run with \`pnpm content:publish:write\``
        }, ${missing} item(s) not found.\nThe storefront caches this content for five minutes.\n`,
        (error) => (error ? reject(error) : resolve()),
      )
    })
  } finally {
    await payload.destroy()
  }
}
