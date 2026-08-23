import type { CollectionConfig } from 'payload'

/**
 * The admin/staff authentication collection.
 *
 * Phase 2 scope only: Payload requires exactly one auth-enabled collection to own the
 * admin panel, so this is foundation, not a feature. Roles and access rules arrive in
 * Phase 7; customer-facing accounts are a separate concern defined in Phases 6 and 7.
 * Do not grow this file in the meantime.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'updatedAt'],
  },
  fields: [
    // `email` and `password` are added implicitly by `auth: true`.
  ],
}
