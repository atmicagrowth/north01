import type { CollectionConfig } from 'payload'

import { STAFF_ROLE_OPTIONS, isAdmin, isAdminField, staffUser } from '../access'

/**
 * The admin/staff authentication collection.
 *
 * Phase 2 scope only: Payload requires exactly one auth-enabled collection to own the
 * admin panel, so this is foundation, not a feature. Roles and access rules arrive in
 * Phase 7; customer-facing accounts are a separate concern defined in Phases 6 and 7.
 *
 * **Phase 6 settled the "separate concern" half**: shoppers are the `customers` collection, a second
 * auth collection this one has nothing to do with. `admin.user` in the Payload config points here
 * and only here, which is what makes plan §7.1b's *"customers may NOT access Payload Admin"* a
 * property of the topology rather than of an access function — Payload answers `canAccessAdmin:
 * false` for any user whose collection is not `admin.user`, before any rule here is consulted. See
 * `Customers.ts` and decision **D-21**.
 *
 * **Phase 7 adds the roles.** §7.1a names three — Customer, Editor, Admin — and two of them live in
 * this table. The third is the other table. See `access/index.ts` for why that asymmetry is the
 * point rather than an inconsistency.
 */
export const Users: CollectionConfig = {
  slug: 'users',

  /**
   * Deliberately still Payload's defaults, restated in Phase 7 as a decision rather than left as an
   * accident: a two-hour token, five attempts, ten minutes locked. Staff sessions are short because
   * the thing behind them is the CMS; a shopper's session is not, and `customers` sets its own.
   *
   * `cookies.secure` is the one default that is wrong. Payload ships `false`, which lets the session
   * cookie travel over plain HTTP; every deployed environment here is HTTPS. Set from `appEnv` in
   * `payload.config.ts`, where both collections read the same resolution.
   */
  auth: true,

  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'role', 'updatedAt'],
    group: 'System',
    description:
      'Staff accounts for this admin panel. Shoppers are Customers, and cannot sign in here.',

    /**
     * Hidden from the sidebar for editors, because §7.1c withholds "user credential access" from
     * them and a list they may not read is a list that should not advertise itself. This is
     * presentation only — the `access` block below is what actually refuses the request, and an
     * editor who types the URL still gets nothing. Their own account stays reachable at
     * `/admin/account`, which is how they change their own password.
     *
     * The test is written out rather than delegated to `staffUser`, because this callback is handed
     * a `ClientUser` — the sanitised shape the panel holds — rather than the generated `User`.
     */
    hidden: ({ user }) => user?.collection !== 'users' || user.role !== 'admin',
  },

  access: {
    /**
     * Who may load the admin panel at all. Every row in this collection is staff, so this is
     * `Boolean(user)` by another name today — stated explicitly because it is the hook a future
     * "staff account suspended" state would need, and because leaving it implicit means the next
     * reader has to go and find Payload's default to know what it is.
     */
    admin: ({ req: { user } }) => staffUser(user) !== null,

    /**
     * An editor may read exactly one user: themselves. Not a narrower field selection of everybody —
     * the whole row, and only their own. That is the difference between "editors see a redacted
     * staff directory" and §7.1c's "editors do not get user credential access", and the second is
     * what the plan says.
     */
    read: ({ req: { user } }) => {
      const staff = staffUser(user)

      if (!staff) {
        return false
      }

      return staff.role === 'admin' ? true : { id: { equals: staff.id } }
    },

    /**
     * Only an admin creates staff. The bootstrap case is not an exception to this: Payload's
     * `registerFirstUser` runs with `overrideAccess: true` and refuses outright once any user
     * exists, so `/admin/create-first-user` still works on an empty database and is a dead end on
     * every other one.
     */
    create: isAdmin,

    /** Admins manage everyone; an editor may update their own account and nobody else's. */
    update: ({ req: { user } }) => {
      const staff = staffUser(user)

      if (!staff) {
        return false
      }

      return staff.role === 'admin' ? true : { id: { equals: staff.id } }
    },

    /**
     * Deleting staff is an admin action, and an admin may not delete themselves. The self-delete
     * guard is not politeness: this collection owns the admin panel, and an admin who removes their
     * own account while they are the only one has locked everybody out of the CMS with no path back
     * that does not involve a database client.
     *
     * Expressed as a `Where` rather than an `id` comparison so it also holds for a *bulk* delete,
     * where `id` is undefined and a boolean rule would have to answer for the whole selection.
     */
    delete: ({ req: { user } }) => {
      const staff = staffUser(user)

      if (staff?.role !== 'admin') {
        return false
      }

      return { id: { not_equals: staff.id } }
    },

    /** Clearing a lockout is an administrative act, not something an editor does for themselves. */
    unlock: isAdmin,
  },

  fields: [
    // `email` and `password` are added implicitly by `auth: true`.
    {
      /**
       * **The role column, and the escalation boundary.**
       *
       * Field access is what stops an editor promoting themselves. They can already update their own
       * row — that is how a password gets changed — and without this, `PATCH /api/users/<own id>`
       * with `{"role":"admin"}` is a one-line privilege escalation. Payload enforces field access by
       * *deleting* the key from the incoming data and falling back to the stored value, so the
       * request succeeds and the role simply does not move.
       *
       * `defaultValue: 'editor'` is the least-privilege default: a staff account created without a
       * deliberate choice is the one that cannot administer anything. The single exception is the
       * first account on an empty database, which has to be an admin or the CMS has no administrator
       * at all — see the hook below.
       */
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      index: true,
      options: [...STAFF_ROLE_OPTIONS],
      access: {
        create: isAdminField,
        update: isAdminField,
      },
      admin: {
        position: 'sidebar',
        description:
          'Editors manage catalogue and content. Admins additionally manage staff, orders, promotions and deletions.',
      },
    },
  ],

  hooks: {
    /**
     * **The first staff account is an admin.**
     *
     * `create-first-user` posts whatever the form collected, which does not include a role, so
     * without this the founding account would take the least-privilege default and nobody could ever
     * grant anybody anything: `create` and the `role` field both require an admin that does not
     * exist. A chicken-and-egg lockout on a fresh database.
     *
     * Collection `beforeValidate` runs *after* field-level access — Payload evaluates field access
     * inside the field `beforeValidate` pass — so this assignment lands last and is not stripped.
     * The count is cheap and runs only on create.
     */
    beforeValidate: [
      async ({ data, operation, req }) => {
        if (operation !== 'create' || !data) {
          return data
        }

        const { totalDocs } = await req.payload.count({ collection: 'users', req })

        return totalDocs === 0 ? { ...data, role: 'admin' } : data
      },
    ],
  },
}
