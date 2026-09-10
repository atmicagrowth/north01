import path from 'path'
import { fileURLToPath } from 'url'

import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { check } from '@payloadcms/db-postgres/drizzle/pg-core'
import {
  BlockquoteFeature,
  BoldFeature,
  HeadingFeature,
  InlineToolbarFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  UnorderedListFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import type { CollectionConfig } from 'payload'
import { buildConfig } from 'payload'

import { buildCourier } from './lib/email/resend'
import {
  appEnv,
  integrationStatus,
  requireIntegration,
  schemaPush,
  serverEnv,
  siteUrl,
} from './lib/env.core'
import { MAX_UPLOAD_BYTES, UPLOAD_LIMIT_MESSAGE } from './lib/media/limits'
import { Addresses } from './payload/collections/Addresses'
import { Campaigns } from './payload/collections/Campaigns'
import { CartItems } from './payload/collections/CartItems'
import { Carts } from './payload/collections/Carts'
import { Categories } from './payload/collections/Categories'
import { Collections } from './payload/collections/Collections'
import { Customers } from './payload/collections/Customers'
import { Edits } from './payload/collections/Edits'
import { Faqs } from './payload/collections/Faqs'
import { Journal } from './payload/collections/Journal'
import { Lookbooks } from './payload/collections/Lookbooks'
import { Media } from './payload/collections/Media'
import { NewsletterSubscribers } from './payload/collections/NewsletterSubscribers'
import { OrderItems } from './payload/collections/OrderItems'
import { Orders } from './payload/collections/Orders'
import { ProductVariants } from './payload/collections/ProductVariants'
import { Products } from './payload/collections/Products'
import { Promotions } from './payload/collections/Promotions'
import { EmailMessages } from './payload/collections/EmailMessages'
import { StripeEvents } from './payload/collections/StripeEvents'
import { Reviews } from './payload/collections/Reviews'
import { SizeGuides } from './payload/collections/SizeGuides'
import { Users } from './payload/collections/Users'
import { WishlistItems } from './payload/collections/WishlistItems'
import { serviceEmailAdapter } from './payload/email/serviceEmailAdapter'
import { cloudinaryStorage } from './payload/storage/cloudinary'
import { Homepage } from './payload/globals/Homepage'
import { Navigation } from './payload/globals/Navigation'
import { SiteSettings } from './payload/globals/SiteSettings'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * **Session cookies get `Secure` outside local development, and Payload does not do that for you.**
 *
 * `addDefaultsToAuthConfig` ships `{ sameSite: 'Lax', secure: false }`, so out of the box the
 * session cookie for both auth collections is transmissible over plain HTTP. Every deployed
 * environment here is HTTPS, and a cookie that carries a seven-day customer session is not something
 * to leave on a library default. `SameSite=Lax` is kept: it is what stops a cross-site form POST
 * riding the cookie, which matters because the `/api` REST surface is reachable from anywhere.
 *
 * It is applied *here*, rather than in the two collection files, for one reason: this module is the
 * only one in `src/payload/**` allowed to read the environment. `env.core` has no `server-only`
 * guard, and the ESLint rule that keeps it out of every other file is decision **D-14** — widening
 * that exemption to the collections directory to set one boolean would trade a real security
 * property for a small convenience. Both collections carry a comment pointing here.
 */
const withSecureCookies = (collection: CollectionConfig): CollectionConfig => ({
  ...collection,
  auth: {
    // `auth: true` is the shorthand `users` uses; spread it as an empty object rather than losing it.
    ...(collection.auth === true ? {} : collection.auth),
    cookies: { sameSite: 'Lax', secure: appEnv !== 'local' },
  },
})

/**
 * Importing the environment module here is what makes plan §4.1b's "fail at build time" true.
 *
 * This config is reached through four static imports of `@payload-config` in `(payload)/`, so
 * `next build` evaluates it while collecting page data - a throw inside it fails the build with
 * a non-zero exit code, before anything is deployed. Nothing else in the app has that property:
 * `instrumentation.ts` is skipped during builds, and route modules are not evaluated then either.
 *
 * The relative import is deliberate, matching `./payload/collections/Users` below. This file is
 * loaded by three different loaders - Turbopack, the Next server, and tsx for the `payload` CLI -
 * and a relative specifier needs none of them to resolve a tsconfig path alias.
 */

/**
 * Payload runs embedded inside this Next.js application - one deployable, not a separate
 * backend. See docs/ARCHITECTURE.md.
 *
 * Still deliberately absent, and added by the phase that needs them:
 *   - `sharp`             - Phase 8, with image processing. Uploads work without it; resizing,
 *                           focal points and `imageSizes` do not, which is why `media` carries
 *                           none of them yet.
 *   - storage / plugins   - Phase 8 onward (Cloudinary, per DEV-05)
 * No GraphQL API surface is exposed; see deviation DEV-04.
 *
 * `editor` arrived here in Phase 6, as this block predicted, because Phase 6 is the first phase
 * with rich-text fields.
 */
export default buildConfig({
  /**
   * **The origin this deployment calls its own.** Payload's own helpers prefer it over the request's
   * `Host` header when they need an absolute URL, which is the property that matters: a password
   * reset link built from a request header is host-header injection with a token attached. See
   * `siteUrl` in `lib/env.core.ts`, and `payload/email/resetPasswordEmail.ts`.
   *
   * It is not used for the admin panel's own data fetching — that goes through `routes.api` as a
   * relative path — so a stale value degrades one email link rather than the CMS.
   */
  serverURL: siteUrl,

  /**
   * **Phase 19's transport.** Every message this application sends — Payload's own password reset
   * included — goes through the one service in `lib/email/send.ts`, which owns the dedupe barrier,
   * the dev safeguard and the delivery record. §19.1a: *"do not call Resend directly from random
   * components"*, and an adapter with its own client would have been the first violation.
   *
   * With Resend unconfigured it keeps `logEmailAdapter`'s best property rather than falling silent:
   * the message is logged in full so a local reset flow is completable end to end, and every send in
   * a deployed environment is logged at `error` so an operator knows a customer is waiting for mail
   * that is not coming. See `payload/email/serviceEmailAdapter.ts`.
   */
  email: serviceEmailAdapter({
    /*
     * Built here because this is one of the four files ESLint permits to read `env.core`, and the
     * adapter is not. `null` when Resend is unconfigured, which the adapter treats as "log it in full
     * locally, shout about it anywhere else" — the property `logEmailAdapter` had and Phase 7's reset
     * flow still depends on.
     */
    courier: () =>
      integrationStatus('resend') === 'configured'
        ? buildCourier({
            allowlist: serverEnv.EMAIL_DEV_ALLOWLIST,
            apiKey: requireIntegration('resend').RESEND_API_KEY,
            appEnv,
            from: requireIntegration('resend').EMAIL_FROM,
          })
        : null,
    isLocal: appEnv === 'local',
  }),

  /**
   * **The file-size limit of plan §8.1b, and the flag without which it is worse than nothing.**
   *
   * This lives at the config root rather than on the `media` collection because it is a Busboy
   * setting — there is no per-collection equivalent, and it therefore caps every upload collection
   * this project will ever have.
   *
   * `abortOnLimit` is the load-bearing half. Busboy's behaviour on exceeding a limit is to *truncate
   * the stream and carry on*: the first N bytes are kept, a `truncated` flag is set, and the upload
   * completes normally — and Payload never reads that flag. So a limit on its own converts an
   * oversized upload from an honest failure into a silently corrupt asset stored with a 201.
   * `responseOnLimit` supplies the sentence the editor reads, in place of a bare status code.
   */
  upload: {
    limits: { fileSize: MAX_UPLOAD_BYTES },
    abortOnLimit: true,
    responseOnLimit: UPLOAD_LIMIT_MESSAGE,
  },

  /**
   * **Media storage — Phase 8, decision D-03 / DEV-05.**
   *
   * Registered unconditionally and switched by `enabled`, which is not the same as registering it
   * conditionally: the plugin injects a `prefix` column, and a config that only sometimes injects it
   * produces two different schemas from one committed migration. See `payload/storage/cloudinary.ts`
   * for the full reasoning and for why the folder is a constant rather than a setting.
   *
   * The credentials are read here, in the one module allowed to touch `env.core` (**D-14**), and
   * handed down. `integrationStatus` returning anything but `configured` — including the
   * half-configured case — leaves Payload on local-disk storage rather than starting an integration
   * that cannot complete a request.
   */
  plugins: [
    cloudinaryStorage({
      enabled: integrationStatus('cloudinary') === 'configured',
      cloudName: serverEnv.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '',
      apiKey: serverEnv.CLOUDINARY_API_KEY ?? '',
      apiSecret: serverEnv.CLOUDINARY_API_SECRET ?? '',
    }),
  ],

  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: '· NORTH / 01',
    },
  },

  /**
   * **Order is presentation, not precedence.** Payload lists collections in the admin sidebar in
   * config order within each `admin.group`, so this reads the way the shop is actually worked on:
   * what is sold, what is written about it, what is bought, who buys it, and the supporting content
   * and staff accounts last.
   *
   * `SchemaProbes` is gone. It was Phase 5 scaffolding whose stated purpose was to be removed here
   * (notes §1.10.9, and the comment at the top of the file itself), and its removal is this
   * project's first destructive migration - rehearsed on something worthless before the same shape
   * of migration is ever pointed at an order table.
   */
  collections: [
    // Catalogue
    Products,
    ProductVariants,
    Categories,
    SizeGuides,

    // Editorial
    Collections,
    Edits,
    Campaigns,
    Lookbooks,
    Journal,

    // Commerce
    Carts,
    CartItems,
    Orders,
    OrderItems,
    Promotions,
    StripeEvents,
    EmailMessages,

    // Customers
    withSecureCookies(Customers),
    Addresses,
    WishlistItems,
    Reviews,
    NewsletterSubscribers,

    // Content and system
    Faqs,
    Media,
    withSecureCookies(Users),
  ],

  globals: [SiteSettings, Navigation, Homepage],

  /**
   * **A restricted feature set, chosen rather than inherited.** Payload's `defaultEditorFeatures` is
   * twenty long, and includes alignment, indentation, underline, strikethrough, subscript,
   * superscript, inline code, checklists, a horizontal rule, a relationship node and an upload node.
   * (Tables are not among them; the only table export is experimental and opt-in.) Most of those are
   * *styling* controls, and visual
   * guide §11 and decision **D-11** both say the same thing: the design system is enforced by the
   * compiler, not by what an editor chose in a toolbar. An editorial paragraph that can be
   * centre-aligned and indented is an editorial paragraph that will be, and the page stops being
   * the design system's.
   *
   * What survives is the vocabulary the corpus actually asks for - paragraphs, two heading levels,
   * bold, italic, links, lists and a blockquote - which is enough for a product description
   * (§6.1b), an article body (§6.1i) and a campaign story (§6.1g), and nothing more.
   *
   * `HeadingFeature` is limited to h2 and h3 because the page owns its h1. A rich-text field that
   * can emit a second h1 breaks the document outline on every page it appears on, which is an
   * accessibility defect (plan §0.1.19, and §30's "proper headings") rather than a matter of taste.
   *
   * `LinkFeature` carries no `fields` override: the default link node stores a URL, and the
   * document-reference link that `fields/link.ts` provides for navigation and CTAs is deliberately
   * not extended into prose. Phase 23 may revisit it if editorial links to products become common
   * enough to justify the population cost on every rich-text read.
   */
  editor: lexicalEditor({
    features: () => [
      ParagraphFeature(),
      HeadingFeature({ enabledHeadingSizes: ['h2', 'h3'] }),
      BoldFeature(),
      ItalicFeature(),
      LinkFeature(),
      UnorderedListFeature(),
      OrderedListFeature(),
      BlockquoteFeature(),
      InlineToolbarFeature(),
    ],
  }),

  db: postgresAdapter({
    pool: {
      connectionString: serverEnv.DATABASE_URL,

      /**
       * Pool limits are per *process*, not per deployment. One `next dev` is one pool; a Vercel
       * deployment is one pool per warm function instance, multiplied by however many of those
       * exist. Ten is `pg`'s own default, restated here because the number only makes sense
       * alongside the endpoint choice: production connects through Neon's pooled (`-pooler`)
       * endpoint, which fronts the compute with PgBouncer, so instances multiply client
       * connections to the pooler rather than backend connections to Postgres. Local development
       * uses the direct endpoint, where ten is one process's whole appetite.
       * See docs/DATABASE.md.
       */
      max: 10,

      /**
       * Three times `pg`'s own 10s default: long enough that a connection survives the gaps in a
       * browsing session rather than being reopened between requests, and still far short of the
       * window in which Neon scales an idle compute to zero. Holding a socket across *that*
       * boundary is how you get one that looks alive and is not; reopening afterwards costs a
       * cold start, which is the failure mode that recovers by itself.
       */
      idleTimeoutMillis: 30_000,

      /**
       * **The one that matters.** `pg`'s default is `0` — wait forever. Against a suspended or
       * unreachable Neon compute that turns a dead database into a hung request: no error, no log
       * line, nothing to alert on, until the platform's own timeout ends it far from the cause.
       * Fifteen seconds is well clear of a Neon cold start and well inside Vercel's function
       * limit. Measured against a black-holed address, the failure is
       * `cannot connect to Postgres. Details: Connection terminated due to connection timeout`.
       */
      connectionTimeoutMillis: 15_000,
    },
    // Plan §5.1d: Drizzle's push workflow for the development sandbox, committed
    // migrations for every other environment.
    //
    // The condition is `schemaPush.allowed` rather than a NODE_ENV test because being in
    // development is not on its own a safe reason to rewrite a schema - the database the
    // connection string happens to point at also has to be the one push is authorised for.
    // That is decision D-10, and `resolveSchemaPush` in lib/env.core.ts is where it lives.
    //
    // Keep this an explicit boolean. The adapter's own gate is `this.push !== false`, so an
    // `undefined` here would fail open and push anyway.
    push: schemaPush.allowed,

    // The guard above governs push. This closes the other accidental DDL path the adapter has:
    // when a connection fails because the database does not exist, it issues a real CREATE
    // DATABASE and carries on. For an online-only storefront whose databases are provisioned in
    // the Neon console, that turns a typo in DATABASE_URL into a silently-created empty database
    // rather than an error. Defaults to false, so it has to be said.
    disableCreateDatabase: true,

    migrationDir: path.resolve(dirname, 'payload/migrations'),

    /**
     * **The one constraint Payload's field API cannot express, and the only one that needs to be
     * here.** Phase 5 flagged `afterSchemaInit` as the escape hatch to decide about in Phase 6
     * (`docs/DATABASE.md` §8); this is that decision, used once and deliberately.
     *
     * Stock may not go negative. `inventoryQuantity` already has `min: 0`, but that is *Payload's*
     * validation, and plan §17.1f requires the decrement at order finalisation to be atomic —
     * which means Phase 17 will issue `UPDATE ... SET inventory_quantity = inventory_quantity - $n`
     * against Postgres directly, past every field validator this config declares. A `CHECK` is the
     * only rule that statement cannot step around, and negative stock is not an oversell to reconcile
     * later: it is a lost write, and the row that records it is the last honest count anyone has.
     *
     * `drizzle-orm` is reached through `@payloadcms/db-postgres/drizzle/*`, which the adapter exports
     * for exactly this. No new direct dependency, and nothing to keep in step with the adapter's own
     * pin.
     *
     * **Note what is deliberately *not* done here.** Plan §6.1c's variant-SKU rule reads as a partial
     * unique index and could have been written the same way; it is not, because a stricter constraint
     * the field API *can* express is also the more correct one. See `ProductVariants.ts`.
     */
    afterSchemaInit: [
      ({ extendTable, schema }) => {
        extendTable({
          table: schema.tables.product_variants,
          extraConfig: () => ({
            inventoryNotNegative: check(
              'product_variants_inventory_non_negative',
              sql`inventory_quantity >= 0`,
            ),
          }),
        })

        return schema
      },
    ],
  }),

  /**
   * **Plan §26.1b's *"API depth"*, capped — Phase 26.**
   *
   * Payload's default `maxDepth` is **10**, and `/api/*` is a public REST surface: `GET
   * /api/products?depth=10` asks the database to walk relationships ten levels deep, for every
   * document in the page, on an endpoint that needs no authentication to reach published content.
   * That is an amplification primitive rather than a feature — one cheap request, an unbounded
   * amount of work — and nothing in this application asks for it.
   *
   * **Three, because the deepest read in the project is two.** `getCollectionPage`, `getEditPage`,
   * `getLookbook` and `getJournalArticle` all use `depth: 2`; `PRODUCT_DEPTH` is 2. Three leaves one
   * level of headroom rather than pinning the cap to today's exact usage, and it is far below the
   * point where the query fans out.
   *
   * `defaultDepth` is deliberately **left at Payload's 2**. Lowering it would change what the admin
   * panel receives from its own REST calls, which is a functional change to the CMS made in the name
   * of a limit that `maxDepth` already enforces. A cap on what a caller may *ask for* is the precise
   * control; a change to what everyone gets by default is not.
   */
  maxDepth: 3,

  // Payload signs and encrypts with this. Server-only; must never be exposed.
  secret: serverEnv.PAYLOAD_SECRET,

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },

  /**
   * **Keep the process alive when Postgres drops a connection** — plan §5.1's "app survives
   * database restart/reconnect", and the "database sleeps / cold starts" edge case.
   *
   * The adapter attaches an `error` listener to exactly one client: the one it takes from the
   * pool at startup to prove connectivity. Every other client is bare. When one of those dies
   * while idle — Neon suspending the compute, a `pg_terminate_backend`, a network drop —
   * `pg-pool` removes it and re-emits on the *pool*, and an `error` event with no listener is
   * the one event Node turns into a throw. Measured, not assumed: terminating the backends of
   * a running server produced `uncaughtException: terminating connection due to administrator
   * command`. `next dev` installs its own handler and survives that; a production server has no
   * such safety net, and an idle Neon compute is not an unusual event to crash on.
   *
   * A dropped idle connection is not an application failure. `pg` has already discarded the
   * client and the next request opens a fresh one, which is exactly what happened in the test
   * — both requests after the kill returned 200. So this logs and continues; the recovery is
   * the pool's, and the only thing missing was somewhere for the event to land.
   *
   * `onInit` is the earliest place with a pool to attach to: `payload.init()` calls
   * `db.connect()` before it, so `pool` exists here and does not exist before. The
   * listener-count guard is for `next dev`'s hot reload, which re-runs `onInit` against the
   * same retained pool and would otherwise stack a new listener on every edit.
   */
  onInit: (payload) => {
    // `db` above is `postgresAdapter`, so this *is* a PostgresAdapter at runtime.
    // `payload.db` is declared as the database-agnostic interface, which has no `pool`
    // and no overlap with the concrete type, so TypeScript requires the assertion to go through
    // `unknown`. The alternative — a hand-written structural type for the two methods used —
    // would compile without complaint and stop matching the adapter the moment it changed.
    const { pool } = payload.db as unknown as PostgresAdapter

    if (pool && pool.listenerCount('error') === 0) {
      pool.on('error', (err) => {
        payload.logger.error({
          err,
          msg: 'Postgres pool client error. The connection was discarded; the next query opens a new one.',
        })
      })
    }
  },
})
