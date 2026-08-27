import type { Field, GroupField } from 'payload'

/**
 * Per-document SEO overrides. Plan §6.1b, §6.1e, §6.1f, §6.1i all list "SEO" as a field of the
 * document, and plan §24.1a says every indexable page needs a title, a description, a canonical URL
 * and Open Graph metadata.
 *
 * **These are overrides, not the metadata itself.** The rendered `<title>` for a product is derived
 * in Phase 24 from the product's own name and the defaults in `site-settings`; this group exists so
 * an editor can *override* that derivation for a page where the derived version reads badly. Every
 * field is therefore optional, and empty means "use the derived value" rather than "publish an empty
 * tag". A required SEO title would be a worse outcome: it guarantees a value, not a good one, and
 * guarantees it drifts from the product name the day someone renames the product.
 *
 * **No `noIndex` here.** Plan §24.1c and §24.1d decide indexability by *route* — cart, checkout,
 * account and admin are excluded, everything published is included — and a per-document opt-out
 * would be a second, quieter mechanism for the same decision. The `status` field already answers
 * "should the public see this": a draft is not routable at all, which is a stronger exclusion than
 * a meta tag asking politely. If a genuine "published but unlisted" requirement appears, it belongs
 * to the phase that raises it.
 *
 * The `image` is the Open Graph / social card image, which is a genuinely different asset from a
 * hero: it is cropped for a 1.91:1 card and often carries text. Falling back to the page's hero when
 * unset is Phase 24's job.
 */
export const seoField = (): GroupField => ({
  name: 'seo',
  type: 'group',
  label: 'SEO',
  admin: {
    description:
      'Overrides only. Anything left empty falls back to the value derived from this document and the defaults in Site Settings.',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      maxLength: 120,
      admin: {
        description: 'Around 60 characters renders in full. Longer is truncated by the engine.',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      maxLength: 320,
      admin: {
        description: 'Around 155 characters renders in full.',
      },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description: 'Social share card. Landscape, roughly 1200 × 630.',
      },
    },
  ],
})

/**
 * Publishing state, shared by every collection an editor takes on and off the public site.
 *
 * **Why a status column and not Payload's `versions: { drafts: true }`.** Drafts are a versioning
 * subsystem: each collection gains a parallel `_v` table, and so does every array and block table
 * beneath it — which for the eleven editorial collections here is a large multiple of the tables the
 * data model actually needs, in every migration, forever. What the corpus asks for is narrower than
 * that. Plan §6.1e says "Publish state", §6.1g says "Publish status", and no document anywhere asks
 * to see a previous revision, restore one, or edit one while another is live. Buying a version
 * history to answer a boolean is the wrong trade, and it is reversible in the other direction: a
 * later phase that genuinely needs revisions can turn drafts on beside this field.
 *
 * `publishedAt` is not decoration either. Feature matrix §12 lists "scheduled/past campaign" as an
 * edge case, and this is what makes it answerable — a published document whose date is in the future
 * is scheduled, and the query that renders a listing filters on both columns. Journal articles order
 * by it. Plan §6.1i lists it outright.
 *
 * Neither field enforces anything on its own. Nothing here hides a draft from an unauthenticated
 * reader — Payload's default access already refuses everyone without a session, and Phase 7 owns the
 * public read rules that will replace that default with "published only". This is the column those
 * rules will be written against.
 */
export const PUBLISH_STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' },
] as const

export const publishingFields = (): Field[] => [
  {
    name: 'status',
    type: 'select',
    required: true,
    defaultValue: 'draft',
    index: true,
    options: [...PUBLISH_STATUS_OPTIONS],
    admin: {
      position: 'sidebar',
      description: 'Drafts are never rendered on the public site.',
    },
  },
  {
    name: 'publishedAt',
    type: 'date',
    index: true,
    admin: {
      position: 'sidebar',
      date: { pickerAppearance: 'dayAndTime' },
      description: 'A future date schedules the page. Set automatically when first published.',
    },
    hooks: {
      /**
       * Stamped on the transition to `published` and never touched again, so re-publishing after
       * an edit does not reorder a journal index. An explicitly entered date always wins — that is
       * how a campaign is scheduled, and how a backdated article keeps its real date.
       */
      beforeChange: [
        ({ siblingData, value }) => {
          if (value) {
            return value
          }

          return (siblingData as { status?: unknown })?.status === 'published'
            ? new Date().toISOString()
            : value
        },
      ],
    },
  },
]
