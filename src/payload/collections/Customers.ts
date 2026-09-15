import { sql } from '@payloadcms/db-postgres'
import type { AccessResult, CollectionConfig, PayloadRequest, Where } from 'payload'
import {
  AuthenticationError,
  combineQueries,
  executeAccess,
  Forbidden,
  validateQueryPaths,
  ValidationError,
} from 'payload'

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
import {
  bypassesAccessControl,
  CUSTOMER_REVISION_KEY_PREFIX,
  type RevisionSnapshot,
  signInOvertaken,
} from '../../lib/auth/customer-revision'
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
       * well as time-limited: `resetPassword` finds the account by the token *and* an expiry still in
       * the future, and when it succeeds it sets `resetPasswordExpiration` to that moment. It leaves
       * the token itself in place, so a second use of the link fails on the expiry, the same way the
       * twenty-fifth hour does. Two uses at the same moment are the reset lock's job, in
       * `beforeOperation` below.
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
     * policy (which the hook below cannot apply to a password `resetPassword` sets), and the reset
     * cooldown. Payload's own `/api/customers/login`, `/forgot-password` and `/reset-password` sat
     * beside them with none of it — measured by the audit: a reset through REST accepted the password
     * `abc` and signed the customer in, and forgot-password re-issued a token on every request.
     *
     * **`/refresh-token` is closed too** — sweep 1, finding S02. It carries no credential worth
     * guessing, but it did two things nothing here wants. Each call pushed the session's expiry a
     * further seven days out, so a stolen token that kept refreshing never expired and the
     * seven-day bound above was not a bound. And it rewrites the whole customer row — `sessions`,
     * `hash`, `accountStatus` — from a read taken before its write, so a refresh that straddled a
     * password reset or a disable put back what that change had just removed. The storefront never
     * refreshes: a session is read from its cookie, and seven days needs no rolling renewal.
     *
     * Nothing in this application calls those endpoints; the admin panel authenticates `users`, not
     * customers. So they refuse anything that is not the Local API. Of the auth routes a shopper can
     * use, only `logout` and `me` stay open — signing out has to work from anywhere, and `me` only
     * reads. (`unlock` is open to staff alone, by its access rule.)
     */
    beforeOperation: [
      ({ args, operation, req }) => {
        if (
          (operation === 'login' ||
            operation === 'forgotPassword' ||
            operation === 'resetPassword' ||
            operation === 'refresh') &&
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

      /**
       * **A write to a customer row reads that row only once it holds the row's lock** — sweep 1,
       * finding S02.
       *
       * Payload's writes are read-modify-write: `update` reads the stored document, merges the
       * incoming fields into *all* of it, and writes every column back — including `sessions`,
       * `hash` and `accountStatus`, which the caller never mentioned. Postgres locks the row only at
       * that final `UPDATE`. So a write whose read came before a revocation committed, and whose
       * `UPDATE` came after, restored what the revocation removed. Measured, on this collection,
       * before this hook existed: an admin disabled an account while that customer's own profile
       * `PATCH` was in flight, and the result was `accountStatus: active` with the session back. A
       * stolen cookie can send that `PATCH` in a loop, so the window did not need to be hit by luck.
       *
       * Taking `SELECT … FOR UPDATE` here — after Payload has opened the operation's transaction and
       * before it reads anything — moves the lock in front of the read. A second writer now waits
       * for the first to commit and then reads what it wrote. The same statement guards the other
       * operations that rewrite or remove the row: `delete`, `resetPassword` below, and logout in
       * `afterLogout`. Each of them also stamps the row's **revision marker** as it takes the lock
       * (`lockCustomerRowsWhere`). Sign-in is the one writer that cannot be locked first; it
       * snapshots that marker here, before it reads the account, and `beforeLogin` checks it.
       *
       * **Which rows: the ones the operation's own access rule will permit.** This hook runs before
       * the operation checks access, so it must not act on the request as sent. Unless the call is
       * the Local API with `overrideAccess: true`, the collection's `update` (or `delete`) rule is
       * evaluated here first, exactly as the operation will evaluate it; a caller's `where` goes
       * through the same `validateQueryPaths` the operation applies; and only the rows the rule
       * allows are locked, by id. An anonymous caller locks nothing, and a customer at most their own
       * row. Before the sweep-1 recheck, a missing `overrideAccess` — which is every REST request —
       * counted as trusted server code, so an anonymous `PATCH /api/customers?where[id][exists]=true`
       * locked the whole table, through a `where` nobody had validated, before `update` refused it.
       *
       * `orderTransitions.ts` locks orders the same way for the same reason, and like it this is a
       * no-op when there is no transaction to hold the lock in — which on this adapter does not
       * happen.
       */
      async ({ args, operation, req }) => {
        if (operation === 'update' || operation === 'delete') {
          await lockCustomerRows(
            req,
            await rowsThisWriteMayTouch(operation, args as WriteArgs, req),
          )
        }

        if (operation === 'login') {
          signInsInProgress.set(req, {
            before: await revisionBeforeSignIn(req, args as { data?: { email?: unknown } }),
            operation: 'login',
          })
        }

        if (operation === 'resetPassword') {
          signInsInProgress.set(req, { operation: 'resetPassword' })

          /*
           * Locked by the token, since that is all the operation knows. This is also what makes a
           * link single-use under concurrency. `resetPassword` finds the account by the token and an
           * unexpired `resetPasswordExpiration`, and spends the link by setting that expiry to now.
           * Two resets with one token could both read it before either wrote; now the second waits
           * here until the first commits, then reads the spent expiry and finds no account.
           */
          const token = (args as { data?: { token?: unknown } }).data?.token

          if (typeof token === 'string' && token.length > 0) {
            await lockCustomerRowsWhere(req, sql`"reset_password_token" = ${token}`)
          }
        }
      },
    ],

    /**
     * **Signing out removes one session by rewriting all of them** — from a read, like `update`
     * above, so it takes the same lock (and stamps the same revision marker) first. `afterLogout` is
     * the hook that runs inside the operation's transaction and before its read.
     */
    afterLogout: [
      async ({ req }) => {
        const user = req.user as { collection?: string; id?: unknown } | null

        if (user?.collection === 'customers') {
          await lockCustomerRows(req, [Number(user.id)])
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
       * The reset flow does not reach this hook (`resetPassword` writes through `payload.db`); it
       * clears the sessions in `beforeLogin` below, inside the reset's own transaction.
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
       * The reset flow is the one exception, and it is Payload's rather than ours. `resetPassword`
       * does run `beforeValidate`, but it passes the stored account — salt and hash already
       * replaced — rather than the new password, so there is no `data.password` here to check.
       * `lib/auth/actions.ts` therefore validates before calling it, using this same function. (The
       * reset does run this collection's `beforeOperation` and `beforeLogin` hooks, which is where
       * its lock and its session wipe live.)
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

      /**
       * **Payload runs `beforeLogin` for two operations, and each needs one more thing here** —
       * sweep 1, finding S02. Both run inside the operation's transaction, after its write and
       * before its commit, which is what makes either of them sound.
       *
       * **A reset ends every session in the same commit as the new password.** Phase 36 (audit
       * R1-13) cleared them from the Server Action *after* `resetPassword` returned: a second
       * transaction, and until it committed the old cookie still worked under the new password. If
       * that second write failed, it never stopped working. Here the new hash and the empty session
       * list are one commit or neither. The session the operation creates for its own token is
       * cleared too — the action never sets that token as a cookie, so nobody holds it.
       *
       * **A sign-in that was overtaken is refused.** `login` reads the account before verifying the
       * password and before opening its transaction, so no lock can be taken ahead of that read the
       * way `beforeOperation` does for everything else. Its session write then puts back every
       * column it read: a sign-in with the *old* password whose read preceded a reset, and whose
       * write followed it, restored the old hash — the old password worked again and the new one
       * did not. The same shape restored an account a disable had just switched off, and sessions a
       * sign-out had just ended; and because that write is an upsert, it would re-insert a row a
       * delete had just removed.
       *
       * So the check happens after the fact, at the one point where it cannot be raced: the
       * operation's own write holds the row lock, so no locking writer can commit until this
       * transaction ends. Every locking writer stamps the row's revision marker as it takes the
       * lock. The sign-in took a snapshot of that marker in `beforeOperation`, before it read the
       * account, and reads it again here. If it moved, something committed after the snapshot — so
       * possibly between the read and the write — and the sign-in throws the ordinary
       * wrong-password error, the transaction rolls back, and whatever that writer did stands. A
       * customer who hits this by coincidence — signing in on a phone in the instant they sign out
       * on a laptop — sees the usual message and succeeds on the next try.
       *
       * **Why a marker in another table, read on this connection.** Inside this transaction the row
       * shows the sign-in's own write, and the one column that write leaves alone, `updated_at`, is
       * overwritten a moment later by Payload's `resetLoginAttempts` whenever the account had a
       * failed attempt. The first version of this check therefore read the committed row on a
       * *second* pool connection while this one held the lock, so every successful sign-in needed
       * two connections at once, and ten concurrent sign-ins could exhaust a pool of ten
       * (`payload.config.ts`) and wait out `connectionTimeoutMillis`. The marker lives in
       * `payload_kv`, which the sign-in's write never touches, so it is read on the connection the
       * transaction already holds. `pnpm verify:access` signs in with one free connection to prove it.
       */
      async ({ req, user }) => {
        const inProgress = signInsInProgress.get(req)

        if (inProgress?.operation === 'resetPassword') {
          await req.payload.db.updateOne({
            collection: 'customers',
            data: { sessions: [] },
            id: user.id,
            req,
            returning: false,
          })
        }

        if (
          inProgress?.operation === 'login' &&
          signInOvertaken(inProgress.before, user.id, await currentRevision(req, user.id))
        ) {
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

/* -------------------------------------------------------------------------------------------------
 * Row locks and revision markers — sweep 1, finding S02, and its recheck
 * ---------------------------------------------------------------------------------------------- */

type SqlHandle = { execute: (query: unknown) => Promise<{ rows?: unknown[] }> }

type WriteArgs = {
  data?: unknown
  id?: unknown
  overrideAccess?: boolean
  trash?: boolean
  where?: Where
}

type SignInInProgress =
  { before: RevisionSnapshot; operation: 'login' } | { operation: 'resetPassword' }

/**
 * Which sign-in operation a request is running, set in `beforeOperation` and read in `beforeLogin`,
 * which Payload calls from both `login` and `resetPassword` without saying which. For `login` it also
 * carries the revision snapshot taken before the account was read.
 *
 * A `WeakMap` keyed by the request object rather than `req.context`: the Phase 6 audit found
 * `context` merged onto a *shared* request, so a flag there could leak into a nested operation. The
 * request object is the one both hooks are handed, and nothing else can read or set this.
 */
const signInsInProgress = new WeakMap<object, SignInInProgress>()

async function transactionOf(req: PayloadRequest): Promise<SqlHandle | null> {
  const transactionID =
    req.transactionID instanceof Promise ? await req.transactionID : req.transactionID

  if (transactionID === undefined || transactionID === null) {
    return null
  }

  return (
    (req.payload.db as unknown as { sessions?: Record<string, { db: SqlHandle }> }).sessions?.[
      String(transactionID)
    ]?.db ?? null
  )
}

/**
 * The operation's own transaction when it has one; otherwise the pool. With no transaction there is
 * no lock held, so taking a pool connection here cannot be what starves the pool.
 */
async function connectionFor(req: PayloadRequest): Promise<SqlHandle> {
  return (await transactionOf(req)) ?? (req.payload.db.drizzle as unknown as SqlHandle)
}

/** `SELECT … FOR UPDATE` on these rows, in id order so two writers of several rows cannot deadlock. */
async function lockCustomerRows(req: PayloadRequest, ids: number[]): Promise<void> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))].sort((a, b) => a - b)

  if (unique.length === 0) {
    return
  }

  await lockCustomerRowsWhere(
    req,
    sql`"id" IN (${sql.join(
      unique.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  )
}

/**
 * Lock the matching customer rows in id order **and stamp each one's revision marker**, in one
 * statement inside the operation's transaction.
 *
 * The marker is `customer-revision:<id>` in Payload's `payload_kv` table, set to this transaction's
 * id (`lib/auth/customer-revision.ts` says why it lives outside the row). It commits or rolls back
 * with the write it belongs to. Its own row lock is taken only after the customer row's, and in the
 * same id order, so it adds no deadlock the customer locks did not already rule out. A marker is
 * never deleted, including when its customer is: a sign-in that read the account before the delete
 * must still see the marker move. That is one small row per customer who has ever been written.
 *
 * A no-op when there is no transaction to hold the lock in — which on this adapter does not happen.
 */
async function lockCustomerRowsWhere(
  req: PayloadRequest,
  condition: ReturnType<typeof sql>,
): Promise<void> {
  const transaction = await transactionOf(req)

  if (!transaction) {
    return
  }

  await transaction.execute(
    sql`WITH "locked" AS (
          SELECT "id" FROM "customers" WHERE ${condition} ORDER BY "id" FOR UPDATE
        )
        INSERT INTO "payload_kv" ("key", "data")
        SELECT ${CUSTOMER_REVISION_KEY_PREFIX}::text || "locked"."id"::text,
               to_jsonb(pg_current_xact_id()::text)
        FROM "locked"
        ORDER BY "locked"."id"
        ON CONFLICT ("key") DO UPDATE SET "data" = EXCLUDED."data"`,
  )
}

/**
 * **The rows an `update` or `delete` will actually be allowed to write**, so the lock covers those
 * and nothing else — decided before the operation decides, but by the same rule.
 *
 * - **The Local API with `overrideAccess: true`** is server code: it locks the id it names, or the
 *   rows its own `where` matches.
 * - **Everyone else** — every REST request, and Local API calls that ask for access control — has
 *   the collection's access rule evaluated here, as the operation will evaluate it. A refusal locks
 *   nothing and leaves the operation to refuse. A `Where` result (a customer's own row) is combined
 *   with the request, so the lock covers only the rows both allow. A caller's `where` is checked by
 *   `validateQueryPaths` before it is used, so a predicate on a hidden column such as `hash` is
 *   refused here with the same `QueryError` the operation would raise, before any row is read.
 *
 * The rows are resolved to ids first, and only ids reach the `FOR UPDATE`.
 *
 * **One lock-order inversion is accepted.** Checkout and payment take the customer row last, as a
 * foreign-key share lock (orders, then carts, then the email row); a permanent customer `delete` takes
 * it first and then clears `orders`, `carts` and `email_messages` through `ON DELETE SET NULL`. A hard
 * delete that coincides with that same customer's checkout or payment can therefore meet a deadlock,
 * which Postgres detects and aborts one side of — as it already could before this lock. Everything
 * else keeps the project's order: the per-cart advisory lock first, orders before carts, customers last.
 */
async function rowsThisWriteMayTouch(
  operation: 'delete' | 'update',
  args: WriteArgs,
  req: PayloadRequest,
): Promise<number[]> {
  const collectionConfig = req.payload.collections.customers.config
  const trusted = bypassesAccessControl({
    overrideAccess: args.overrideAccess,
    payloadAPI: req.payloadAPI,
  })
  const hasId = args.id !== undefined && args.id !== null
  const id = hasId ? Number(args.id) : null

  if (hasId && !Number.isInteger(id)) {
    return []
  }

  let access: AccessResult = true

  if (!trusted) {
    access = await executeAccess(
      { data: args.data, disableErrors: true, id: id ?? undefined, req },
      operation === 'update' ? collectionConfig.access.update : collectionConfig.access.delete,
    )

    /*
     * An `update` that sets `deletedAt` is a move to the trash, and Payload holds it to the `delete`
     * rule as well.
     */
    const trashing =
      operation === 'update' &&
      typeof args.data === 'object' &&
      args.data !== null &&
      (args.data as { deletedAt?: unknown }).deletedAt != null

    if (access && trashing) {
      const deleteAccess = await executeAccess(
        { data: args.data, disableErrors: true, id: id ?? undefined, req },
        collectionConfig.access.delete,
      )

      access = !deleteAccess
        ? false
        : access === true
          ? deleteAccess
          : combineQueries(access, deleteAccess)
    }

    if (!access) {
      return []
    }
  }

  let where: Where

  if (id !== null) {
    if (access === true) {
      return [id]
    }

    where = combineQueries({ id: { equals: id } }, access)
  } else {
    if (!args.where) {
      return []
    }

    if (!trusted) {
      await validateQueryPaths({ collectionConfig, overrideAccess: false, req, where: args.where })
    }

    where = combineQueries(args.where, access)
  }

  const { docs } = await req.payload.db.find({
    collection: 'customers',
    limit: 0,
    pagination: false,
    req,
    select: { id: true },
    where: args.trash ? where : { and: [where, { deletedAt: { exists: false } }] },
  })

  return docs.map((doc) => Number(doc.id))
}

/**
 * **The sign-in's snapshot**: the account it is about to read, and that account's revision marker,
 * taken before Payload's `login` reads it.
 *
 * The address is normalised the way `login` normalises it, and trashed rows are excluded as `login`
 * excludes them, so this finds the row the operation will find. No transaction or lock is held yet at
 * this point, so the pool connection it may use is taken and returned before the sign-in holds any.
 * An address that matches nothing gives `null`, and a sign-in that nonetheless succeeds is refused.
 */
async function revisionBeforeSignIn(
  req: PayloadRequest,
  args: { data?: { email?: unknown } },
): Promise<RevisionSnapshot> {
  const email = args.data?.email

  if (typeof email !== 'string') {
    return null
  }

  const { rows } = await (
    await connectionFor(req)
  ).execute(
    sql`SELECT c."id", kv."data"::text AS "revision"
        FROM "customers" c
        LEFT JOIN "payload_kv" kv ON kv."key" = ${CUSTOMER_REVISION_KEY_PREFIX}::text || c."id"::text
        WHERE c."email" = ${email.toLowerCase().trim()} AND c."deleted_at" IS NULL
        LIMIT 1`,
  )

  const row = rows?.[0] as { id: number | string; revision: null | string } | undefined

  return row ? { id: Number(row.id), revision: row.revision ?? null } : null
}

/**
 * The account's revision marker as this transaction sees it — read on the transaction's own
 * connection, after the sign-in's write took the row lock, so every locking writer that finished
 * first has committed its marker and none can commit another until this transaction ends.
 */
async function currentRevision(req: PayloadRequest, id: number | string): Promise<null | string> {
  const { rows } = await (
    await connectionFor(req)
  ).execute(
    sql`SELECT "data"::text AS "revision" FROM "payload_kv"
        WHERE "key" = ${`${CUSTOMER_REVISION_KEY_PREFIX}${Number(id)}`}`,
  )

  return (rows?.[0] as { revision: null | string } | undefined)?.revision ?? null
}
