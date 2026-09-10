import type { Payload, Where } from 'payload'

/**
 * **The pieces every seed module shares** — extracted in Phase 29.
 *
 * `scripts/seed.ts` was one 1,400-line file and Phase 29 roughly doubles the content in it. Splitting
 * the *data* out and leaving the *orchestration* in place is the smaller change: the seed still reads
 * top to bottom in the order the catalogue is built, and a module that only declares products cannot
 * accidentally reorder the taxonomy it depends on.
 *
 * Nothing here decides anything. `rich` is a shape, `upsert` is a lookup-then-write, and the types
 * are the vocabulary the content modules are written in.
 */

/**
 * A minimal Lexical document. The editor stores its own JSON shape, and hand-writing paragraphs is
 * both shorter and more legible here than importing the Markdown converter and its editor config
 * for a dozen sentences of demo copy.
 */
export const rich = (...paragraphs: string[]) => ({
  root: {
    type: 'root',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: paragraphs.map((text) => ({
      type: 'paragraph',
      format: '' as const,
      indent: 0,
      version: 1,
      direction: 'ltr' as const,
      textFormat: 0,
      children: [
        {
          type: 'text',
          text,
          detail: 0,
          format: 0,
          mode: 'normal',
          style: '',
          version: 1,
        },
      ],
    })),
  },
})

export type Upsert = {
  payload: Payload
  collection: Parameters<Payload['find']>[0]['collection']
  /** The natural key — the field a human would use to say "this one". */
  where: Where
  /**
   * Payload's per-collection data types are a discriminated union keyed on `collection`, which a
   * generic helper cannot narrow. The alternative is one upsert per collection; this stays honest
   * about the trade by keeping the helper tiny and the call sites typed by their own literals.
   */
  data: Record<string, unknown>
}

/** Every primary key in this schema is `serial` — decision D-17 — so an id is a number. */
export const upsert = async ({ payload, collection, where, data }: Upsert): Promise<number> => {
  /**
   * `trash: true` means *include trashed rows*, not *delete them* — Payload's least intuitive option
   * name, and here it is load-bearing. `find` excludes soft-deleted documents by default, but the
   * UNIQUE index on `slug` and `sku` does not: a product an editor moved to the trash is invisible to
   * the lookup and still occupies its slug, so without this the second run of the seed tries to
   * *create* it and aborts on a constraint violation. Re-seeding also restores such a row rather than
   * leaving a shadow behind.
   */
  const existing = await payload.find({ collection, where, limit: 1, depth: 0, trash: true })
  const found = existing.docs[0]

  if (found) {
    const updated = await payload.update({
      collection,
      id: found.id,
      // `deletedAt: null` un-trashes anything an editor had removed, so a re-seed restores the demo
      // catalogue rather than colliding with its own ghosts.
      data: { ...data, deletedAt: null } as never,
      depth: 0,
      trash: true,
    })

    return updated.id as number
  }

  const created = await payload.create({ collection, data: data as never, depth: 0 })

  return created.id as number
}

/**
 * **One product, as the seed declares it** — hoisted in Phase 29 so a content module can be written
 * against it without reaching into `seed.ts`'s function body.
 */
export type ProductSpec = {
  slug: string
  name: string
  sku: string
  shortDescription: string
  description: string[]
  categories: string[]
  gender: 'women' | 'men' | 'unisex'
  fit: 'slim' | 'regular' | 'relaxed' | 'oversized'
  materials: string[]
  care: string[]
  tags: string[]
  /** Optional: a ONE SIZE accessory has nothing to measure. */
  sizeGuide?: number
  priceMinor: number
  compareAtPriceMinor?: number
  colors: { name: string; hex: string; family: string; stock: number[] }[]
  sizes: { size: string; sizeSortOrder: number }[]
  flags?: Partial<{
    featured: boolean
    isNew: boolean
    isBestSeller: boolean
    isLimitedEdition: boolean
  }>
  sortOrder: number
}
