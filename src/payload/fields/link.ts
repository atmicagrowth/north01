import type { Field, TextFieldSingleValidation } from 'payload'

/**
 * Every navigation item, call to action and editorial link in this schema is one of two things: a
 * pointer at a document this CMS owns, or a path/URL typed by hand.
 *
 * **The reference half is why this is not just a text field.** Feature matrix §1 lists "broken
 * internal route" and "unpublished collection" among the global-shell edge cases, and a `text`
 * column holding `/collections/limited` cannot notice either — it stays valid-looking after the
 * collection is renamed, unpublished or deleted. A relationship notices all three: a renamed
 * document still resolves (the href is derived from its current slug at render time, not stored), an
 * unpublished one is visible to the renderer as unpublished, and a deleted one nulls the reference
 * so the item can be dropped rather than rendered as a 404.
 *
 * **The typed half is not a fallback, it is the other real case.** `/shop`, `/about` and
 * `/account/orders` are routes, not documents — nothing in the CMS owns them — and an external link
 * to a social profile is not a document either. Forcing those through a reference would mean
 * inventing placeholder documents for pages that have none, which is exactly the "do not create
 * entities that are not actually used" trap.
 *
 * The validator accepts a site-relative path or an absolute `http(s)` URL and nothing else. A bare
 * `shop`, a `javascript:` scheme or a protocol-relative `//host` are all refused — the first is a
 * mistake, and the other two are how a CMS field becomes an open redirect or a script injection.
 */
const validateHref: TextFieldSingleValidation = (value, { req: { t }, required, siblingData }) => {
  if ((siblingData as { kind?: unknown })?.kind !== 'url') {
    return true
  }

  if (typeof value !== 'string' || value === '') {
    return required ? t('validation:required') : true
  }

  if (value.startsWith('/') && !value.startsWith('//')) {
    return true
  }

  if (/^https?:\/\/\S+$/.test(value)) {
    return true
  }

  return 'A site path beginning with / or a full https:// URL.'
}

/**
 * Where a reference may point. Deliberately the set of collections that *are* pages — the public
 * routes in structure document §2 — and not every collection that happens to exist. A link to a
 * cart or an order is not a thing.
 *
 * `categories` is included because SHOP's children are categories (structure §2) and the mega menu
 * is "driven from Payload" (feature matrix §1).
 */
export const LINKABLE_COLLECTIONS = [
  'products',
  'categories',
  'collections',
  'edits',
  'lookbooks',
  'journal',
  'campaigns',
] as const

type LinkOptions = {
  /** Nested under a named group. Omit to inline the fields into the parent. */
  name?: string
  label?: string
  /** A CTA needs its own label; a navigation item needs one too. Only a bare href does not. */
  includeLabel?: boolean
  required?: boolean
}

export const linkFields = ({
  includeLabel = true,
  required = false,
}: LinkOptions = {}): Field[] => [
  ...(includeLabel
    ? ([
        {
          name: 'label',
          type: 'text',
          required,
          admin: {
            description:
              'The words the customer reads. Kept short — the visual guide§06 is strict about this.',
          },
        },
      ] satisfies Field[])
    : []),
  {
    name: 'kind',
    type: 'radio',
    required: true,
    defaultValue: 'reference',
    options: [
      { label: 'A page in this CMS', value: 'reference' },
      { label: 'A path or external URL', value: 'url' },
    ],
    admin: { layout: 'horizontal' },
  },
  {
    name: 'reference',
    type: 'relationship',
    relationTo: [...LINKABLE_COLLECTIONS],
    required: false,
    admin: {
      condition: (_data, siblingData: { kind?: unknown }) => siblingData?.kind === 'reference',
      description:
        'The URL is derived from this document at render time, so renaming it cannot break the link.',
    },
  },
  {
    name: 'href',
    type: 'text',
    required: false,
    admin: {
      condition: (_data, siblingData: { kind?: unknown }) => siblingData?.kind === 'url',
      description: 'A site path such as /shop, or a full https:// address.',
    },
    validate: validateHref,
  },
]

/**
 * The same thing as a named group, for the many places that want exactly one link — a campaign's
 * CTA, an editorial block's "shop this" — rather than a list of them.
 *
 * Note what is *not* enforced here: that a `reference` link actually has a reference. Payload's
 * `required` cannot be conditional, and a validator that fires on the sibling field would refuse to
 * save a half-finished draft, which is a worse failure than an empty CTA that the renderer skips.
 * The renderer treats "resolves to nothing" as an ordinary state — which it must anyway, because
 * `ON DELETE SET NULL` means any reference can become nothing at any time (`docs/DATABASE.md` §8).
 */
export const linkGroup = ({ name = 'cta', label, required = false }: LinkOptions = {}): Field => ({
  name,
  type: 'group',
  ...(label ? { label } : {}),
  fields: linkFields({ required }),
})
