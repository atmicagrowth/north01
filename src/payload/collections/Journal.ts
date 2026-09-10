import type { CollectionConfig } from 'payload'

import { isAdmin, isStaff, publishedOnly } from '../access'
import { publishingFields, seoField } from '../fields/seo'
import { slugField } from '../fields/slug'

/**
 * Long-form editorial. Plan §6.1i lists the fields; plan §23.1c gives the one rule that shapes them:
 *
 * > "Journal content should support links to products and collections. Avoid creating an editorial
 * > dead end."
 *
 * `relatedProducts` and `relatedCollections` are that rule as columns, and `relatedArticles` is the
 * third exit (feature matrix §15, "related stories").
 *
 * **Journal is not in the primary navigation.** Structure document §2 lists it in the site map and
 * the same document's Simplicity rule keeps it out of the top navigation; the more specific
 * statement wins, so it is a real route reached from the footer and from editorial surfaces
 * (**C-07**). A site map is not a navigation bar.
 *
 * **`category` is a select, not a relationship.** The `categories` collection is the *product*
 * taxonomy — Clothing, Tops, Accessories — and pointing an article at it would mean either polluting
 * shop navigation with editorial topics or building a second taxonomy collection for a demo whose
 * journal has a handful of articles. Plan §6.1d's rule applies directly: *"Avoid creating categories
 * that are not actually used in navigation or filters."* A small enumeration says what it is,
 * indexes cleanly, and needs no rows.
 *
 * **`author` is text, not a relationship to `users`.** A byline is a published fact about an article;
 * a `users` row is a staff account. Tying them together means the byline changes when someone's
 * account is renamed, breaks when the account is deleted (`ON DELETE SET NULL`), and cannot express
 * a guest contributor who has no account at all. The corpus never asks for author pages.
 *
 * `publishedAt` — supplied by `publishingFields` — is the sort key for the index, and it is why a
 * backdated article can be added without appearing at the top.
 */
export const Journal: CollectionConfig = {
  slug: 'journal',

  labels: { singular: 'Article', plural: 'Journal' },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'author', 'status', 'publishedAt'],
    group: 'Editorial',

    /**
     * `publishedAt` does more here than anywhere else — it is the index's sort key — and less than
     * `fields/seo.ts` claims: `getJournalIndex` sorts on `-publishedAt` and adds no date clause, so
     * an article dated next Tuesday is published *now*, at the top of `/journal`. Backdating works
     * as expected and is the reason the field is writable; forward-dating is the trap, and this is
     * the sentence that closes it.
     */
    description:
      'Articles at /journal/… Reached from the footer and from editorial surfaces. The date sets the order of the index — backdate to file an article below the others, but a future date publishes it now and pins it to the top.',

    /**
     * `author` is deliberately not searched: it carries no index, so a `LIKE` over it is a
     * sequential scan, and it is already a `defaultColumn` that Payload's own filter panel can
     * filter exactly. `slug` is the one an editor cannot otherwise reach — see `Collections.admin`.
     */
    listSearchableFields: ['title', 'slug'],
  },

  defaultSort: '-publishedAt',

  /**
   * Published documents are public; everything else is staff. See `access/index.ts` — `publishedOnly`
   * returns a `Where` rather than `false` for an anonymous reader, so a draft is *absent* rather than
   * forbidden, which is the right answer for a storefront route that has to decide between rendering
   * and a 404.
   *
   * Deletion is admin-only across every collection in this project: §7.1c withholds it from editors,
   * and an editor who no longer wants a document sets it back to draft.
   */
  access: {
    read: publishedOnly,
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Article',
          fields: [
            { name: 'title', type: 'text', required: true },
            {
              name: 'excerpt',
              type: 'textarea',
              maxLength: 320,
              admin: {
                description:
                  'The standfirst on the index, and the SEO description fallback. Two sentences at most.',
              },
            },
            {
              name: 'heroImage',
              type: 'upload',
              relationTo: 'media',
              admin: { description: 'The index card image and the article opener.' },
            },
            {
              name: 'body',
              type: 'richText',
              admin: { description: 'The article.' },
            },
          ],
        },
        {
          label: 'Connections',
          fields: [
            /*
             * All three of these are unfiltered on purpose. `relatedArticles` carries the only
             * `filterOptions` that is safe on this collection — excluding the article itself — and
             * the reasoning against restricting the other two to published documents is on
             * `Collections.products`: Payload re-validates `filterOptions` on save, so the filter
             * would block writes to fields the editor never touched. Each description below says
             * what actually happens instead, which is that an unpublished reference renders as
             * nothing at all.
             */
            {
              name: 'relatedProducts',
              type: 'relationship',
              relationTo: 'products',
              hasMany: true,
              admin: {
                description:
                  'The way out of the article and into the shop — plan §23.1c. An article with none is an editorial dead end. Drafts and out-of-stock products are dropped from the rendered article, so check the count here against the page before publishing.',
              },
            },
            {
              name: 'relatedCollections',
              type: 'relationship',
              relationTo: 'collections',
              hasMany: true,
              admin: {
                description:
                  'The second exit — plan §23.1c. Point at the collection the article is really about, not at everything it mentions. A draft collection renders as nothing.',
              },
            },
            {
              name: 'relatedArticles',
              type: 'relationship',
              relationTo: 'journal',
              hasMany: true,
              admin: {
                description:
                  'Feature matrix §15 — "related stories". A draft article renders as nothing, so two articles written together need both published before either shows the other.',
              },
              filterOptions: ({ id }) => (id ? { id: { not_equals: id } } : true),
            },
          ],
        },
        {
          label: 'SEO',
          fields: [seoField()],
        },
      ],
    },

    slugField(),
    {
      name: 'category',
      type: 'select',
      index: true,
      options: [
        { label: 'Craft', value: 'craft' },
        { label: 'Design', value: 'design' },
        { label: 'People', value: 'people' },
        { label: 'Places', value: 'places' },
        { label: 'Style', value: 'style' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'The editorial topic. Deliberately a short fixed list, not the product taxonomy.',
      },
    },
    {
      name: 'author',
      type: 'text',
      admin: {
        position: 'sidebar',
        description:
          'The byline as printed. Not linked to a staff account — see the note at the top of this file.',
      },
    },
    ...publishingFields(),
  ],
}
