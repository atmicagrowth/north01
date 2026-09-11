import type { CollectionConfig } from 'payload'
import { AuthenticationError, Forbidden, ValidationError } from 'payload'

import { checkPassword } from '../../lib/password-policy'
import {
  ACCOUNT_STATUS_OPTIONS,
  activeCustomer,
  isAdmin,
  isAdminUser,
  isStaffField,
  staffUser,
  verifiedPublicWrite,
} from '../access'
import { resetPasswordEmail } from '../email/resetPasswordEmail'
import { normaliseEmail } from '../fields/slug'
import { cascadeDelete } from '../hooks/cascadeDelete'
import { RESET_TOKEN_LIFETIME_MS } from '../../lib/auth/reset-cooldown'

/**
 * The shopper's account — and a **separate auth collection from `users`**, which is staff.
 *
 * Plan §2.2 lists "User / customer" as one conceptual entity and plan §7.1a lists Customer, Editor
 * and Admin as roles, which reads like one table with a `role` column. It is two, for a reason plan
 * §7.1b states as a hard boundary: customers *"may NOT access Payload Admin"*. With one collection
 * that boundary is a conditional inside an access function — one that has to be right on every
 * operation, forever, and that is one inverted comparison away from letting a shopper into the CMS.
 * With two, the admin panel is bound to `users` by `admin.user` in the Payload config and a customer
 * has nowhere to log in *to*. A structural guarantee beats a well-tested one.
 *
 * The existing `users` collection already anticipated this split in Phase 2: *"customer-facing
 * accounts are a separate concern defined in Phases 6 and 7"*. Phase 6 built the entity; **Phase 7
 * is the half that opens it**, and everything in this file below the fields is Phase 7's.
 *
 * **Email verification is still deliberately off.** Payload's `auth.verify` would make every
 * registration depend on an email being delivered, and there is no email infrastructure until
 * **Phase 19**. Turning it on now would mean either accounts that can never be activated or a
 * verification mail nobody sends — plan §0.1.17's fake functionality, in the account system. §7.1e
 * says *"email verification **if enabled**"*, which is permission to decide, and the decision is
 * unchanged: Phase 19, once Resend exists. Password reset is a different case and is built here —
 * see `email/resetPasswordEmail.ts` for why the two separate.
 */
export const Customers: CollectionConfig = {
  slug: 'customers',

  auth: {
    /**
     * `useAPIKey` is off: an API key is a machine credential and a shopper is not a machine.
     */
    useAPIKey: false,

    /**
     * **Seven days, against Payload's two hours.** §7.1e asks for session handling and lists
     * "expired session" as an edge case; the question a number answers is how often a returning
     * shopper is thrown back to a login form. Two hours is a *CMS* session length — it is right for
     * `users`, which keeps the default — and applying it to a storefront means a customer who
     * browses on Saturday and returns on Sunday signs in again to look at their own order history.
     *
     * Seven days is bounded rather than indefinite, and it is not the only thing standing between a
     * stolen cookie and an account: `useSessions` is on (Payload's default), so the token carries a
     * session id that is checked against the row on every request, and signing out — or being
     * disabled — invalidates it immediately rather than at expiry. See `afterChange` below.
     */
    tokenExpiration: 60 * 60 * 24 * 7,

    /**
     * Payload's defaults, restated because they are the §7.1e brute-force answer and a reader should
     * not have to go and find them: five failed attempts locks the account for ten minutes. The
     * lockout is per-account, which is the half that protects a *known* email; rate limiting per IP
     * is bot protection and belongs to **Phase 26** with Turnstile.
     */
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,

    forgotPassword: {
      /**
       * One hour — Payload's default, stated because §7.1e requires an *expired reset link* to be a
       * defined behaviour rather than an accident of a library default. The token is single-use as
       * well as time-limited: `resetPassword` clears `resetPasswordToken` when it succeeds, so the
       * second use of a link fails the same way the twenty-fifth hour does.
       */
      expiration: RESET_TOKEN_LIFETIME_MS,

      /**
       * Without this override the link in the mail points at `/admin/reset/<token>` — Payload builds
       * it from `config.routes.admin`, because for most installations the only auth collection *is*
       * the staff one. Sending a shopper to the CMS to choose a new password would be absurd and,
       * given `canAccessAdmin` is false for them, a dead end.
       */
      generateEmailHTML: resetPasswordEmail.html,
      generateEmailSubject: resetPasswordEmail.subject,
    },
  },

  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'firstName', 'lastName', 'accountStatus', 'createdAt'],
    /**
     * **Phase 28.** Without this the search box queries `useAsTitle` and nothing else, so the only
     * way to find an account is to already know the email address. That is not how support works:
     * the person on the phone gives a name, and *"I can't find you"* is the wrong answer to a
     * customer who is plainly in the database.
     *
     * `email` is repeated deliberately — declaring the list replaces the `useAsTitle` default
     * outright (`getTextFieldsToBeSearched` returns only the named fields), so omitting it would
     * *remove* the search that works today.
     *
     * `firstName` and `lastName` are unindexed, and indexing them would not help: the search builder
     * emits `ILIKE '%term%'`, and a leading wildcard cannot use a btree however well indexed the
     * column is — the same measurement `Orders.ts` records beside its own five fields. The answer if
     * this table ever grows past a sequential scan is a `pg_trgm` index, which is a migration and an
     * extension; nothing here is owed one yet.
     */
    listSearchableFields: ['email', 'firstName', 'lastName'],
    group: 'Customers',
    description:
      'Shopper accounts. Separate from staff Users — a customer cannot sign in to this admin panel.',
  },

  /**
   * `docs/DATABASE.md` §8 names customers as one of the two collections where a delete must be
   * recoverable. Beyond the mis-click, erasure here is a legal question rather than a UI one: an
   * account is attached to orders that must survive it, and a hard delete would null the customer
   * on every one of them at once (`ON DELETE SET NULL`). The order stays readable either way,
   * because it snapshots the email and the addresses — see `Orders.ts`.
   */
  trash: true,

  /**
   * **§7.1b, as a table.**
   *
   * | Operation | Who |
   * |---|---|
   * | read | the account itself; any staff member |
   * | create | anyone — this is registration |
   * | update | the account itself; any staff member |
   * | delete | admin only |
   *
   * `create: anyone` is the one that looks alarming and is not. Registration has to be reachable
   * without a session, and the alternative — closing it and registering through a server action with
   * the Local API's `overrideAccess: true` — would mean the storefront and the REST API are governed
   * by two different rules, one of which is a function nobody can audit from this file. Everything
   * privileged on the row is closed at the *field* level instead: `accountStatus` is staff-only, so
   * a self-registration cannot arrive pre-disabled or pre-enabled, and there is no role column here
   * to escalate. What remains open is exactly what a registration form posts.
   *
   * What it does not yet have is a rate limit. Payload 3 removed the built-in one, and bot
   * protection is **Phase 26** (Turnstile, §26.1b) — recorded as owed rather than improvised here.
   */
  access: {
    read: ({ req: { user } }) => {
      if (staffUser(user)) {
        return true
      }

      const customer = activeCustomer(user)

      return customer ? { id: { equals: customer.id } } : false
    },

    /**
     * **Verified, or staff — Phase 26's second sweep.**
     *
     * This was `() => true`, which made `POST /api/customers` an unauthenticated account-creation
     * endpoint with no challenge in front of it — so Phase 26's Turnstile on the registration *form*
     * protected the door a bot does not use. See `verifiedPublicWrite` for why the fix is a stricter
     * rule rather than `overrideAccess: true`, and for why the storefront still holds no privilege
     * the REST API lacks.
     */
    create: verifiedPublicWrite,

    update: ({ req: { user } }) => {
      if (staffUser(user)) {
        return true
      }

      const customer = activeCustomer(user)

      return customer ? { id: { equals: customer.id } } : false
    },

    /**
     * Not the customer's own. A self-service "delete my account" is a data-erasure flow with legal
     * shape — it has to decide what happens to the orders that must outlive it — and no document in
     * the corpus specifies one. An admin doing it deliberately, with `trash: true` underneath so it
     * is recoverable, is the honest state until a phase owns the flow.
     */
    delete: isAdmin,

    /** Clearing a lockout early is a support action. */
    unlock: ({ req: { user } }) => staffUser(user) !== null,
  },

  fields: [
    // `email` and `password` are added implicitly by `auth`.
    {
      type: 'row',
      fields: [
        {
          name: 'firstName',
          type: 'text',
          required: true,
          admin: { width: '50%' },
        },
        {
          name: 'lastName',
          type: 'text',
          required: true,
          admin: { width: '50%' },
        },
      ],
    },
    {
      name: 'phone',
      type: 'text',
      admin: { description: 'Optional. Offered to carriers as a delivery contact.' },
    },
    {
      /**
       * **The §7.1e "account is disabled" edge case, as a column.**
       *
       * Payload has no built-in disabled state — an account is either present or deleted — and
       * deleting is the wrong tool: the orders have to stay attributable, and a suspension is
       * usually reversible. So this is the switch, and it is enforced in three places, because one
       * would leave a window:
       *
       * 1. `beforeLogin` refuses a new session (below).
       * 2. `afterChange` revokes the existing ones the moment the switch is thrown, so a disabled
       *    customer does not keep browsing on a live cookie for the rest of the week.
       * 3. `activeCustomer` in `access/index.ts` returns `null` for anything but `active`, so every
       *    ownership rule in the project fails closed even if a token somehow survives.
       *
       * Staff-only at the field level. A customer may update their own row; without this they could
       * re-enable themselves with one extra key in the request body.
       */
      name: 'accountStatus',
      type: 'select',
      required: true,
      defaultValue: 'active',
      index: true,
      options: [...ACCOUNT_STATUS_OPTIONS],
      access: {
        create: isStaffField,
        update: isStaffField,
      },
      admin: {
        position: 'sidebar',
        description:
          'Disabling signs the customer out immediately and refuses further sign-ins. Orders are unaffected.',
      },
    },
    {
      /**
       * The mapping the tech stack §3 assigns to this side of the boundary: *"Customer identity —
       * source of truth: Payload Auth + PostgreSQL; derived/external: Stripe customer ID mapping."*
       * Stripe owns the customer object; this column is our end of the pointer, so a returning
       * shopper reaches the same Stripe customer and their saved payment methods rather than a new
       * one on every order.
       *
       * Written by **Phase 17**, on the first checkout, through the Local API and therefore past
       * access control. Read-only through the API for everyone, including admins: it is Stripe's
       * identifier, and typing one in by hand is how an order gets attached to somebody else's
       * payment methods. Unique for the same reason.
       */
      name: 'stripeCustomerId',
      type: 'text',
      unique: true,
      index: true,
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Set by Stripe at first checkout (Phase 17). Never edited by hand.',
      },
    },
    {
      name: 'addresses',
      type: 'join',
      collection: 'addresses',
      on: 'customer',
      admin: {
        description: "The customer's saved address book, editable by them at /account/addresses.",
      },
    },
    {
      name: 'orders',
      type: 'join',
      collection: 'orders',
      on: 'customer',
      defaultSort: '-createdAt',
      admin: { description: 'Every order placed by this account.' },
    },
  ],

  hooks: {
    /**
     * **Payload's REST auth endpoints are closed to shoppers** — plan §34, audit R1-15.
     *
     * The storefront signs customers in, sends reset links and resets passwords through Server
     * Actions that call the Local API, and those actions carry the controls: Turnstile, the password
     * policy (which `resetPassword` bypasses, since it writes through `payload.db`), and the reset
     * cooldown. Payload's own `/api/customers/login`, `/forgot-password` and `/reset-password` sat
     * beside them with none of it — measured by the audit: a reset through REST accepted the password
     * `abc` and signed the customer in, and forgot-password re-issued a token on every request.
     *
     * Nothing in this application calls those endpoints; the admin panel authenticates `users`, not
     * customers. So they refuse anything that is not the Local API. `logout`, `me` and `refresh`
     * stay open — they carry no credential worth guessing and the session needs them.
     */
    beforeOperation: [
      ({ args, operation, req }) => {
        if (
          (operation === 'login' ||
            operation === 'forgotPassword' ||
            operation === 'resetPassword') &&
          req.payloadAPI !== 'local'
        ) {
          throw new Forbidden(req.t)
        }

        /*
         * **A password is changed through the reset flow, or by an admin** — plan §34.1d. `update`
         * lets a customer edit their own row and an editor edit anyone's, and neither rule knew
         * about credentials: a signed-in customer could `PATCH` a new password onto their account
         * with no current password (so a stolen cookie became a permanent takeover — the account
         * page deliberately offers no such change), and an editor could set any customer's. The
         * admin panel only sends `password` when someone chooses to change it.
         */
        if (
          operation === 'update' &&
          req.payloadAPI !== 'local' &&
          !isAdminUser(req.user) &&
          typeof args.data === 'object' &&
          args.data !== null &&
          'password' in args.data &&
          Boolean((args.data as { password?: unknown }).password)
        ) {
          throw new Forbidden(req.t)
        }
      },
    ],

    /**
     * **The sign-in address is changed by an admin only** — the same rule as the password above,
     * for the same two reasons. The admin form sends the email unchanged on every save, so this
     * compares against the stored value rather than refusing the key.
     */
    beforeChange: [
      ({ data, operation, originalDoc, req }) => {
        if (
          operation === 'update' &&
          req.payloadAPI !== 'local' &&
          !isAdminUser(req.user) &&
          typeof data?.email === 'string' &&
          typeof originalDoc?.email === 'string' &&
          data.email.trim().toLowerCase() !== originalDoc.email.trim().toLowerCase()
        ) {
          throw new Forbidden(req.t)
        }

        return data
      },

      /**
       * **A new password ends every existing session** — Phase 36, audit R1-13.
       *
       * The case is an admin setting a customer's password, usually because the account was taken
       * over. Without this, whoever held the old cookie kept a seven-day session under the new
       * password. Emptying `sessions` is what the JWT strategy checks on every request (see the
       * `afterChange` below), so the old cookie stops working at once.
       *
       * **Here rather than in `afterChange`**, because this is the last hook that can see the
       * password: Payload's update deletes `data.password` after this hook runs and before the write
       * (`updateDocument`, "Handle potential password update"), so an `afterChange` would never know
       * one was set. Writing `sessions` in the same row update also means no second write and no
       * shared `context` flag — the latch the disable hook below records a bulk edit tripping over.
       *
       * The reset flow does not reach this hook (`resetPassword` writes through `payload.db`);
       * `lib/auth/actions.ts` clears the sessions itself after a successful reset.
       */
      ({ data, operation }) => {
        if (
          operation === 'update' &&
          data &&
          typeof data.password === 'string' &&
          data.password.length > 0
        ) {
          return { ...data, sessions: [] }
        }

        return data
      },
    ],

    /**
     * Three dependants carry a **required** customer reference, which Postgres stores as `NOT NULL`
     * with `ON DELETE SET NULL` — so a permanent delete fails unless they go first. See
     * `hooks/cascadeDelete.ts`.
     *
     * Note what this does *not* remove. `orders.customer` and `carts.customer` are nullable and stay
     * that way: an order must outlive the account that placed it — it keeps its own email and
     * address snapshots — and an orphaned bag simply expires. That is the right shape for an erasure
     * request too: the person's identity, addresses, saved items and reviews go, and the financial
     * record remains without them.
     */
    beforeDelete: [
      cascadeDelete([
        { collection: 'addresses', on: 'customer' },
        { collection: 'wishlist-items', on: 'customer' },
        { collection: 'reviews', on: 'customer' },
      ]),
    ],

    beforeValidate: [
      /**
       * Payload lowercases the email it authenticates with, but a value arriving through the Local
       * API or a seed script skips that path. Normalising here means the unique index compares the
       * same string the login flow will.
       */
      ({ data }) => {
        if (data && typeof data.email === 'string') {
          return { ...data, email: normaliseEmail({ value: data.email }) as string }
        }

        return data
      },

      /**
       * **The password policy, applied to every path into this table.**
       *
       * Payload's built-in check is `minLength: 3`, and it lives inside `generatePasswordSaltHash`
       * where nothing can configure it. Putting the real rule in a hook rather than only in the
       * registration form is what makes it a property of the *data*: the REST endpoint, the admin
       * panel's "change password", a seed script and the reset flow all pass through here, and a
       * rule that only the form enforces is a rule the form is the only thing obeying.
       *
       * `data.password` is present only when a password is actually being set — Payload strips it
       * before storage and keeps the salt and hash — so an ordinary profile edit skips this entirely.
       *
       * The reset flow is the one exception, and it is Payload's rather than ours:
       * `resetPassword` writes through `payload.db.updateOne` and never reaches a collection hook.
       * `lib/auth/actions.ts` therefore validates before calling it, using this same function.
       */
      ({ data, req }) => {
        if (!data || typeof data.password !== 'string') {
          return data
        }

        const problem = checkPassword(
          data.password,
          typeof data.email === 'string' ? data.email : null,
        )

        if (problem) {
          throw new ValidationError({
            collection: 'customers',
            errors: [{ message: problem, path: 'password' }],
            req,
          })
        }

        return data
      },
    ],

    /**
     * **A disabled account cannot start a session.** §7.1e's edge case, refused at the point it is
     * attempted rather than left to the access rules to absorb afterwards.
     *
     * `AuthenticationError` and not a bespoke message: the response is the same one a wrong password
     * gets. Telling an anonymous caller *"this account exists but is disabled"* is an account
     * enumeration oracle, and it tells the person at the keyboard nothing they can act on either —
     * a disabled account is reinstated by support, not by trying harder. The customer-facing
     * explanation is support's to give.
     */
    beforeLogin: [
      ({ req, user }) => {
        if (user.accountStatus !== 'active') {
          throw new AuthenticationError(req.t)
        }

        return user
      },
    ],

    /**
     * **Disabling revokes every live session, now.**
     *
     * Without this, `accountStatus: 'disabled'` would only stop the *next* login, and a customer
     * already holding a seven-day cookie would keep it. `activeCustomer` would refuse their data
     * access, so nothing would leak — but they would sit in a signed-in shell that answered nothing,
     * which is a worse failure than being signed out.
     *
     * Emptying `sessions` is what the JWT strategy checks: it looks the token's `sid` up in this
     * array on every request and returns no user when it is absent. So the cookie stops
     * authenticating on the very next request, in every tab and on every device.
     *
     * **The recursion terminates on the condition, not on a `context` flag.** The nested update
     * writes only `sessions`, so when this hook re-enters, `previousDoc.accountStatus` is already
     * `disabled` and the transition test is false. A `context` marker was the first version and was
     * removed: the Phase 6 audit established that `context` is merged onto the *shared* request
     * object rather than scoped to the call, so a bulk disable of three customers would have latched
     * the flag on the first row and silently skipped revocation for the other two. The transition
     * test has no such memory.
     */
    afterChange: [
      async ({ doc, previousDoc, req }) => {
        const justDisabled =
          doc.accountStatus !== 'active' && previousDoc?.accountStatus === 'active'

        if (!justDisabled) {
          return doc
        }

        await req.payload.update({
          collection: 'customers',
          id: doc.id,
          data: { sessions: [] },
          overrideAccess: true,
          req,
        })

        return doc
      },
    ],
  },
}
