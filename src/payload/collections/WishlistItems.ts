import type { CollectionConfig } from 'payload'

/**
 * A saved product. Plan §6.1m gives four fields — customer, product, optional variant preference,
 * created date — and one rule:
 *
 * > "Enforce uniqueness so the same product is not saved twice by the same user."
 *
 * That is `indexes` below, and it is a *real* constraint here rather than an approximate one. Both
 * columns are `required`, which matters more than it looks: a compound unique index over a nullable
 * column does not prevent duplicates, because Postgres treats NULLs as distinct from one another
 * (`docs/DATABASE.md` §8, proved in Phase 5). Requiring both is what makes the index mean what plan
 * §6.1m says.
 *
 * It also makes plan §20.1b's merge rule enforceable rather than aspirational —
 * *"existing customer wishlist wins duplicates"* — because the second insert is refused by the
 * database rather than by whichever code path happened to run.
 *
 * **The variant is a preference, not a selection.** A customer hearts a jacket, and may have been
 * looking at the Bone one; that is worth remembering so the wishlist shows the right image, and it
 * is *not* a commitment to a size. It is deliberately outside the unique constraint: saving the same
 * jacket twice for two colours would be two rows for one intention, which is the duplication the
 * rule exists to stop. Plan §20.1a's "move to cart" therefore still has to ask for a size — plan
 * §22.1d's *"do not guess sizes silently"* is the same principle one page over.
 *
 * **There is no guest wishlist table.** Feature matrix §16 and structure §17 both keep a guest's
 * wishlist on the guest's own device, merging into the account on sign-in; plan §20.1c says the same
 * about recently-viewed. Giving anonymous visitors server rows would mean storing behaviour about
 * people who have not asked for an account, for a feature whose whole point is that it survives
 * *because* there is one.
 *
 * `createdAt` comes from `timestamps`, which Payload enables by default and this project states
 * deliberately (`docs/DATABASE.md` §8). Plan §20.1b's *"preserve order where useful"* reads from it.
 */
export const WishlistItems: CollectionConfig = {
  slug: 'wishlist-items',

  labels: { singular: 'Wishlist item', plural: 'Wishlist' },

  admin: {
    useAsTitle: 'id',
    defaultColumns: ['customer', 'product', 'variantPreference', 'createdAt'],
    group: 'Customers',
    description: 'Saved products. Guests keep their list on their own device until they sign in.',
  },

  /**
   * The index name generated from these columns is `customer_product_idx`, which is distinct from
   * every other compound index in this schema — `product_color_name_size_idx` and `cart_variant_idx`.
   * Payload derives index names from the column list with no table prefix and they must be unique
   * per Postgres schema, so keeping the combinations distinct is a rule this project follows
   * deliberately (`docs/DATABASE.md` §8, and notes §1.10.9's list of what Phase 6 owed).
   */
  indexes: [{ fields: ['customer', 'product'], unique: true }],

  fields: [
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
    },
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      index: true,
    },
    {
      name: 'variantPreference',
      type: 'relationship',
      relationTo: 'product-variants',
      admin: {
        description:
          'Optional. The colour they were looking at — remembered for the image, never treated as a chosen size.',
      },
    },
  ],
}
