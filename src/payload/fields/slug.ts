import type { TextField, TextFieldSingleValidation } from 'payload'

/**
 * A URL segment. Every public route in the structure document is `/<namespace>/<slug>`, so a slug
 * is a *human-authored external key* — the exact shape `SchemaProbes.reference` was built in Phase 5
 * to rehearse, and the exact shape that gets typed in twice.
 *
 * Three things follow, and all three are database-level rather than form-level:
 *
 * 1. **Unique, per collection.** `unique: true` compiles to a Postgres UNIQUE index, which a REST
 *    client cannot skip and a race between two admins cannot slip through. Uniqueness is scoped to
 *    the collection because the namespace is: `/collections/essentials` and `/edit/essentials` are
 *    different pages, and nothing in the corpus asks for a global slug space.
 * 2. **Indexed.** Implied by `unique`, and needed regardless: every one of those routes is a lookup
 *    by slug, which is a sequential scan without it.
 * 3. **Normalised before it is validated.** Trailing whitespace and stray capitals are how two
 *    "different" slugs end up rendering the same URL. `beforeValidate` lowercases and trims, so the
 *    unique index compares the value that will actually appear in a URL rather than whatever was
 *    pasted.
 *
 * The pattern is deliberately strict — lowercase, digits, single hyphens, no leading or trailing
 * hyphen. It is not URL-encoding: a slug that needs encoding is a slug that reads badly, and this is
 * a premium storefront whose URLs are part of the presentation. Plan §29 ("Clean URLs").
 *
 * **Not auto-generated from the title.** Auto-slugging is convenient right up to the first rename,
 * when it silently breaks a live URL, and the corpus never asks for it. An editor types the slug
 * once, deliberately, and it stays put.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const validateSlug: TextFieldSingleValidation = (value, { req: { t }, required }) => {
  if (value === null || value === undefined || value === '') {
    // Let Payload's own required-field message handle emptiness, in the user's language.
    return required ? t('validation:required') : true
  }

  if (!SLUG_PATTERN.test(value)) {
    return 'Lowercase letters, numbers and single hyphens only — for example `field-jacket`.'
  }

  return true
}

/**
 * `TextField` is a union over `hasMany`, and `Partial` of a union keeps `hasMany?: boolean`, which
 * matches neither branch. Narrowing to the single-value half is also the correct restriction: a
 * `hasMany` slug is not a URL segment.
 */
type SlugOverrides = Partial<
  Omit<TextField, 'hasMany' | 'maxRows' | 'minRows' | 'type' | 'validate'>
> & {
  validate?: TextFieldSingleValidation
}

export const slugField = (overrides: SlugOverrides = {}): TextField => ({
  name: 'slug',
  type: 'text',
  required: true,
  unique: true,
  index: true,
  maxLength: 96,
  validate: validateSlug,

  ...overrides,

  admin: {
    position: 'sidebar',
    description: 'The URL segment for this page. Lowercase, hyphenated, and permanent once shared.',
    ...overrides.admin,
  },

  hooks: {
    ...overrides.hooks,
    beforeValidate: [
      ({ value }: { value?: unknown }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value,
      ...(overrides.hooks?.beforeValidate ?? []),
    ],
  },
})

/**
 * The same normalisation, for values that are typed by a *customer* rather than an editor and
 * compared by a unique index — promotion codes and email addresses.
 *
 * Plan §15.1c lists "case sensitivity" and "whitespace" among the discount-code edge cases, and both
 * are only edge cases if the stored value can differ from the compared one. Normalising on the way
 * in removes the question instead of answering it at every call site.
 */
export const normaliseCode = ({ value }: { value?: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value

export const normaliseEmail = ({ value }: { value?: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value
