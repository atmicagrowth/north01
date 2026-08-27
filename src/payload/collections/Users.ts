import type { CollectionConfig } from 'payload'

/**
 * The admin/staff authentication collection.
 *
 * Phase 2 scope only: Payload requires exactly one auth-enabled collection to own the
 * admin panel, so this is foundation, not a feature. Roles and access rules arrive in
 * Phase 7; customer-facing accounts are a separate concern defined in Phases 6 and 7.
 * Do not grow this file in the meantime.
 *
 * **Phase 6 settled the "separate concern" half**: shoppers are the `customers` collection, a second
 * auth collection this one has nothing to do with. `admin.user` in the Payload config points here
 * and only here, which is what makes plan §7.1b's *"customers may NOT access Payload Admin"* a
 * property of the topology rather than of an access function. See `Customers.ts`.
 *
 * The `group` below is the only line Phase 6 added, and it is presentation: with twenty-two
 * collections in the sidebar, an ungrouped one renders under a bare "Collections" heading of its
 * own. It changes no column.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'updatedAt'],
    group: 'System',
    description:
      'Staff accounts for this admin panel. Shoppers are Customers, and cannot sign in here.',
  },
  fields: [
    // `email` and `password` are added implicitly by `auth: true`.
  ],
}
