import type { CollectionConfig, NumberFieldSingleValidation } from 'payload'

import { COLOR_FAMILY_OPTIONS } from '@/lib/catalog/colors'

import { isAdmin, isStaff, publishedOn } from '../access'
import { minorUnits } from '../fields/money'
import { cascadeDelete } from '../hooks/cascadeDelete'
import {
  syncProductDerivedAfterChange,
  syncProductDerivedAfterDelete,
} from '../hooks/syncProductDerived'

/**
 * The purchasable unit. Plan §2.1: *"A product is the merchandising entity. A variant is the
 * purchasable unit."* Everything a customer actually buys — a SKU, a price, a quantity of stock — is
 * a column on this table, and every cart line and order line points at a row of it.
 *
 * ---
 *
 * ### The critical rule, and why the constraint is stricter than it asks
 *
 * Plan §6.1c states one rule in a box of its own:
 *
 * > **Do not allow two active variants of the same product to share the same SKU.**
 *
 * Read literally that is a *partial, compound* unique index — `UNIQUE (product_id, sku) WHERE
 * active` — which Payload's collection `indexes` API cannot express: its type is `{ fields, unique }`
 * with no `where` (verified in `node_modules/payload/dist/collections/config/types.d.ts`). Phase 5
 * found this and left the decision here on purpose (`docs/DATABASE.md` §8, "six traps"), with three
 * spellings on the table: the partial index through the adapter's `afterSchemaInit` hook, a hand-
 * written migration, or a stricter constraint Payload *can* express.
 *
 * **This project takes the stricter constraint: `sku` is unique across the entire collection.**
 *
 * Not because the other two are hard — `afterSchemaInit` works and Drizzle's snapshot does carry a
 * partial index — but because the literal rule is a *lower bound on correctness*, not a
 * specification, and the two things it permits are both defects:
 *
 * - **The same SKU on two different products.** Nothing in the plan's wording forbids it, and it is
 *   incoherent. A stock-keeping unit that identifies two different garments cannot be picked,
 *   counted or reconciled. Every downstream system — Stripe line items, the Algolia index, a
 *   fulfilment export — assumes the opposite.
 * - **Reusing a SKU after retiring a variant.** This is the case a `WHERE active` clause exists to
 *   allow, and it is precisely the case that breaks *order history*. Order items snapshot the SKU
 *   (plan §6.1k, §18.1d); if a SKU may be reassigned, then two orders eighteen months apart can
 *   record the same SKU for two different garments and no report can tell them apart afterwards.
 *   Retired SKUs staying retired is what the snapshot requires to mean anything.
 *
 * So the constraint that exists in Postgres is `UNIQUE (sku)`, and it refuses a superset of what the
 * plan asks to be refused. It is also visible to the snapshot chain — a hand-written migration would
 * not have been, which is why that option was the worst of the three: `migrate:create` diffs the
 * config against the previous snapshot, so an index the snapshot has never heard of is an index no
 * later migration maintains.
 *
 * A second, weaker constraint enforces the *presentation* half: one `(product, color, size)`
 * combination per product. Two rows offering Black / M on the same product is not a SKU collision,
 * it is an ambiguous variant selector — plan §13.1c requires that "for every selected combination"
 * the server can *determine whether exact variant exists*, singular. Note the caveat from
 * `docs/DATABASE.md` §8: a compound unique index over a nullable column is weaker than it reads,
 * because Postgres treats NULLs as distinct. All three columns are therefore `required`, which is
 * what makes the constraint mean what it says.
 */
/**
 * Stock is a count of garments, so it is a whole number. Neither `min` nor `admin.step` makes it one:
 * `step` is an input-widget attribute, and the column is Postgres `numeric` with no precision, which
 * stores `4.5` without complaint. The `CHECK` added in `payload.config.ts` stops it going *negative*
 * and says nothing about being an integer — `0.5 >= 0` is true.
 *
 * A fractional count would survive into Phase 17's atomic decrement and into every "only 2 left"
 * message, so it is refused here.
 */
const validateStock: NumberFieldSingleValidation = (value, { req: { t }, required }) => {
  if (value === null || value === undefined) {
    return required ? t('validation:required') : true
  }

  if (!Number.isInteger(value) || value < 0) {
    return 'A whole number of units, zero or more.'
  }

  return true
}

export const ProductVariants: CollectionConfig = {
  slug: 'product-variants',

  labels: { singular: 'Variant', plural: 'Variants' },

  admin: {
    useAsTitle: 'sku',
    defaultColumns: [
      'sku',
      'product',
      'color',
      'size',
      'priceMinor',
      'inventoryQuantity',
      'active',
    ],
    group: 'Catalogue',
    description: 'One row per purchasable colour and size. Cart and order lines point here.',
  },

  /**
   * Soft delete, for the same reason as `products` and one more: an order item references a variant,
   * and a hard delete would null that reference on every historical order at once.
   */
  trash: true,

  /**
   * Generates `product_color_size_idx`, distinct from every other compound index in this schema.
   * Two things about that name are worth knowing, because neither is obvious:
   *
   * - **It carries no table prefix.** Payload derives a compound index name from the field list
   *   alone, and index names are unique per *schema* in Postgres — so two collections indexing the
   *   same field names contend for one name (`docs/DATABASE.md` §8). The adapter de-duplicates by
   *   appending a counter, which means the loser's name depends on collection order in the config.
   *   Keeping every compound field-combination in this schema distinct avoids the question.
   * - **It is built from *field* names, not column names.** The field is `color`, not `colorName`,
   *   specifically because of this: `colorName` produced a mixed-case identifier,
   *   `"product_colorName_size_idx"`, which Postgres preserves and then requires quoting forever.
   *   A single-word field name keeps the identifier lower-case like every other one here.
   */
  indexes: [{ fields: ['product', 'color', 'size'], unique: true }],

  hooks: {
    afterChange: [syncProductDerivedAfterChange],
    /**
     * `cart-items.variant` is required, so it is `NOT NULL` with `ON DELETE SET NULL` — a bag line
     * pointing at this variant makes the delete fail unless the line goes first. See
     * `hooks/cascadeDelete.ts`. `wishlist-items.variantPreference` is nullable and is deliberately
     * left to `SET NULL`: a saved product whose remembered colour has gone is still a saved product.
     */
    beforeDelete: [cascadeDelete([{ collection: 'cart-items', on: 'variant' }])],
    afterDelete: [syncProductDerivedAfterDelete],
  },

  /**
   * **A variant is public exactly when its product is**, and it says so by reading the product's
   * column rather than carrying one of its own. Payload's Postgres adapter resolves the dotted path
   * to a join, so the rule costs a join on an indexed column and cannot drift the way a duplicated
   * `status` here would.
   *
   * It matters. A variant row carries the SKU, the price and the live stock count, so leaving this
   * collection open while `products` was filtered would publish next season's line sheet to anyone
   * who asked `/api/product-variants` — the interesting half of an unreleased product, without the
   * product.
   */
  access: {
    read: publishedOn('product.status'),
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
      admin: {
        description: 'The merchandising record this variant belongs to.',
      },
    },
    {
      name: 'sku',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      maxLength: 64,
      admin: {
        description:
          'Unique across the whole catalogue, and permanent. Never reassign a retired SKU — order history records it as a snapshot.',
      },
      hooks: {
        beforeValidate: [
          ({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
        ],
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'color',
          type: 'text',
          required: true,
          index: true,
          label: 'Colour',
          admin: { width: '50%', description: 'As the customer reads it — "Bone", "Graphite".' },
        },
        {
          name: 'colorHex',
          type: 'text',
          label: 'Swatch',
          admin: {
            width: '50%',
            description: 'The swatch shown in the colour selector. Six-digit hex, with the #.',
          },
          validate: (value: unknown) =>
            value === null || value === undefined || value === ''
              ? true
              : typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
                ? true
                : 'A six-digit hex colour, such as #1C1C1A.',
        },
      ],
    },
    {
      /**
       * A *filterable* colour needs a vocabulary; a swatch name does not have one. "Bone", "Chalk"
       * and "Oyster" are three products' worth of off-white, and a facet listing all three
       * separately is a facet nobody uses. Feature matrix §5 requires a Colour filter and plan
       * §12.1a indexes Colour as a filterable attribute — this is the column those mean.
       *
       * The palette is the one the visual guide describes (§02): near-black through bone, with
       * colour as the exception rather than the rule.
       */
      name: 'colorFamily',
      type: 'select',
      required: true,
      index: true,
      /*
       * The list itself lives in `lib/catalog/colors.ts`, because Phase 11's filter panel has to
       * render these labels and a second copy of them would drift: a colour added here would be
       * missing from the shop filter, which is a field an editor fills in that changes nothing.
       */
      options: [...COLOR_FAMILY_OPTIONS],
      admin: {
        description:
          'What the colour filter groups this under. The swatch name above is what is displayed.',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'size',
          type: 'text',
          required: true,
          index: true,
          maxLength: 24,
          admin: {
            width: '50%',
            description:
              'Free text because apparel sizing is not one scale — XS…XXL, 28…38, One Size. Keep it identical across variants that mean the same size.',
          },
          hooks: {
            beforeValidate: [
              ({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
            ],
          },
        },
        {
          /**
           * Sizes do not sort. Alphabetically, L comes before M and both come before S, which is
           * how a size selector ends up reading L / M / S / XL. One integer per variant fixes it,
           * and the alternative — a fixed size enumeration — cannot hold both "M" and "32" without
           * inventing a scale per category.
           */
          name: 'sizeSortOrder',
          type: 'number',
          required: true,
          defaultValue: 0,
          admin: {
            width: '50%',
            step: 1,
            description:
              'Lower shows first in the size selector. XS=10, S=20, M=30 leaves room to insert.',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        minorUnits({
          name: 'priceMinor',
          label: 'Price',
          required: true,
          index: true,
          admin: { width: '50%' },
        }),
        minorUnits({
          name: 'compareAtPriceMinor',
          label: 'Compare-at price',
          admin: {
            width: '50%',
            description:
              'The former price, shown struck through. Leave empty when not on sale — an equal or lower value is not a sale and must not be displayed as one.',
          },
        }),
      ],
    },
    {
      /**
       * The authoritative stock number for this exact colour and size. Plan §2.1 forbids a single
       * global number when variants have independent stock, and decision **D-06** settles when it
       * moves: *inventory commits after payment, never at add-to-cart*, transactionally, inside the
       * webhook that confirms it (plan §17.1f). Nothing before Phase 17 decrements this.
       *
       * `min: 0` because negative stock is not oversell, it is a lost write. The oversell case has a
       * defined path in §17.1f (refund), and it does not run through this column going negative.
       */
      name: 'inventoryQuantity',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      index: true,
      label: 'Stock',
      validate: validateStock,
      admin: {
        step: 1,
        description:
          'Centralised online fulfilment stock. Decremented only by a confirmed payment — see decision D-06.',
      },
    },
    {
      /**
       * Plan §6.1c's "active/inactive". The merchandising switch: an inactive variant is not
       * purchasable, is excluded from the product\'s derived price and stock, and disappears from
       * the size selector. Distinct from `inventoryQuantity: 0`, which means *sold out* — a
       * temporary state the customer is told about — and from the trash, which means deleted.
       *
       * **Gap G-05**, assigned to this phase: plan §2.1 lists an "availability state" the variant
       * schema never defines and no document enumerates. It is answered by *derivation* rather than
       * by a fourth column, because a stored availability would be a fourth thing to keep in step
       * with three others and would be wrong the moment stock changed without a save:
       *
       * ```text
       * discontinued   trashed, or active === false
       * sold out       active && inventoryQuantity === 0
       * low stock      active && 0 < inventoryQuantity <= siteSettings.lowStockThreshold
       * in stock       active && inventoryQuantity > threshold
       * ```
       *
       * Those four are the card states plan §11.1b requires and the inventory messaging plan §13.1b
       * requires. Pre-order is deliberately absent: it appears only in the reference image, which is
       * not authoritative, and no document defines it (**DEV-09**).
       */
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      index: true,
      admin: {
        description: 'Uncheck to withdraw this colour and size from sale without deleting it.',
      },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description:
          'Optional — plan §6.1c. Shown when this colour is selected; the product gallery is used when empty.',
      },
    },
    {
      /**
       * Plan §6.1c's "optional weight/dimensions". Not decoration: plan §16.1a's shipping provider
       * takes a cart and returns rates, and a rate that is not a flat fee needs a weight. The demo
       * provider is static (Standard / Express / Overnight), so nothing reads these yet — they are
       * here because adding a column to a variant table later is cheap and re-weighing a catalogue
       * is not.
       *
       * Grams and millimetres. Integers, one unit, no ambiguity — the same reasoning as
       * `minorUnits`, and the same reason the unit is in the name.
       */
      type: 'collapsible',
      label: 'Shipping dimensions',
      admin: { initCollapsed: true },
      fields: [
        {
          name: 'weightGrams',
          type: 'number',
          min: 0,
          admin: { step: 1, description: 'Optional. Packed weight, in grams.' },
        },
        {
          type: 'row',
          fields: [
            {
              name: 'lengthMm',
              type: 'number',
              min: 0,
              label: 'Length (mm)',
              admin: { width: '33%', step: 1 },
            },
            {
              name: 'widthMm',
              type: 'number',
              min: 0,
              label: 'Width (mm)',
              admin: { width: '33%', step: 1 },
            },
            {
              name: 'heightMm',
              type: 'number',
              min: 0,
              label: 'Height (mm)',
              admin: { width: '33%', step: 1 },
            },
          ],
        },
      ],
    },
  ],
}
