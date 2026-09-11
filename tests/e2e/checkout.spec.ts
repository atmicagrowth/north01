/**
 * **Plan §27.1c — flows 6, 7, 10 and 11.**
 *
 * ```
 *  6. Checkout with Stripe test mode
 *  7. Stripe webhook finalizes order
 * 10. Review flow
 * 11. Shop-the-look
 * ```
 *
 * Flow 12 is `mobile-navigation.spec.ts`, because `playwright.config.ts` routes exactly that
 * filename to the `mobile` project and its Pixel 7 profile. Everything here runs in `chromium`.
 *
 * ---
 *
 * ### This suite has never been executed, and that is a fact about the environment
 *
 * An end-to-end run needs a running application, and a running application here needs a database it
 * may write to. `TODO.md` §1 records that the only reachable one is **production**, and decision
 * **D-10** forbids pointing a writing harness at it. This file is the most destructive one in the
 * directory: flow 6 creates an order and opens a real Stripe Checkout Session, flow 7 inserts
 * `stripe-events` rows, flow 10 registers a customer and publishes a pending review, and flow 11
 * puts variants into a bag. So it is checked in **unrun**, written from the source of every route it
 * drives — every selector, sentence and URL below was read out of `src/`, never guessed — and the
 * first green run is owed to the first non-production database.
 *
 * ### The one place a third party is still in the loop, and the places it is not
 *
 * The plan is explicit: *"do not depend on flaky third-party production systems; use test
 * adapters/mocks where appropriate, while retaining at least one real Stripe test-mode integration
 * path for the checkout contract."*
 *
 * - **Flow 6 is that retained path.** It drives the real form to the real
 *   `stripe.checkout.sessions.create` and stops at the moment Stripe takes over the browser. It
 *   refuses to run against a **live** key, because an E2E suite that can open a live-mode session is
 *   a suite one environment variable away from charging somebody.
 * - **Flow 7 never speaks to Stripe.** A webhook signature is an HMAC over the exact bytes of the
 *   body, so a correctly signed event can be produced offline — which is what
 *   `scripts/verify-checkout.ts` section F already does with the SDK's own
 *   `generateTestHeaderString`, and what this reuses. The difference is the surface: that script
 *   asserts the signature *function*, and `scripts/verify-webhook.ts` says in as many words that it
 *   *"does not go through the HTTP route"*. **Nothing in this repository has ever driven
 *   `POST /api/stripe/webhook` end to end.** These tests are the only thing that does.
 *
 * ### What is asserted about payment, everywhere in this file
 *
 * `AGENTS.md`: *"Only a signature-verified Stripe webhook marks an order paid. Reaching the success
 * page is not payment."* So flow 6 stops at the redirect and then checks that the bag is **still
 * there**, and flow 7 checks the ways the route refuses a body it cannot trust. No test here asserts
 * that anything is paid, because no test here can legitimately make it so.
 */

import { randomUUID } from 'node:crypto'

import type { APIRequestContext, Locator, Page } from '@playwright/test'
import Stripe from 'stripe'

import { HANDLED_EVENT_TYPES } from '@/lib/checkout/rules'
import { TURNSTILE_FIELD } from '@/lib/security/turnstile'

import {
  addFirstAvailableVariantToBag,
  expect,
  LOOK_COPY,
  NAME,
  openFirstProduct,
  PRODUCT_URL,
  registerNewCustomer,
  REVIEW_COPY,
  REVIEW_SECTION_COPY,
  ROUTE,
  slot,
  test,
  uniqueEmail,
} from './fixtures'

/* =================================================================================================
 * Shared ground
 * ============================================================================================== */

/**
 * **`isStripeConfigured()`, mirrored.**
 *
 * `lib/checkout/stripe.ts` asks `integrationStatus('stripe')`, and `env.core.ts` defines that group
 * as these three keys — *all* present is `configured`, none is `unconfigured`, some is `partial`,
 * and only `configured` opens the feature. The harness cannot call that function (it is
 * `server-only`, and `env.core` is import-banned outside four files), so the rule is restated here
 * from the same three names rather than approximated by "is there a secret key".
 *
 * This reads the **harness's** environment, which is the same one only when the suite is driving a
 * server it started. Every test that depends on the *server's* answer therefore checks the page or
 * the response as well — see `checkoutUnavailable` in flow 6 and the 503 probe in flow 7.
 */
const STRIPE_ENV_KEYS = [
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const

const stripeConfigured = STRIPE_ENV_KEYS.every((key) => (process.env[key] ?? '') !== '')

/**
 * Whether the configured key is a **test-mode** key.
 *
 * `env.core.ts` accepts `sk_test_`, `sk_live_`, `rk_test_` and `rk_live_`. §27.1c says *"Stripe test
 * mode"*, and the two live prefixes are the reason this is a separate condition rather than being
 * folded into the one above: a suite that would open a live-mode Checkout Session is a suite that
 * can take money from a real card, and skipping is the only safe answer.
 */
const stripeTestMode = /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')

/** `src/app/(frontend)/api/stripe/webhook/route.ts`. The `(frontend)` group adds no path segment. */
const WEBHOOK_PATH = '/api/stripe/webhook'

/**
 * An order id that is a valid reference and cannot name a real order.
 *
 * `parseOrderReference` requires a positive safe integer, so it has to parse; `orders.id` is a
 * Postgres `integer`, so this sits one below the type's ceiling and simply finds nothing. A value
 * past `int4` would overflow inside `findByID` and be swallowed by its `.catch(() => null)` — the
 * same outcome by accident rather than on purpose, which is a worse thing for a test to rely on.
 */
const UNCLAIMED_ORDER_ID = 2_147_483_646

/* =================================================================================================
 * Flow 6 — checkout with Stripe test mode
 * ============================================================================================== */

test.describe('§27.1c flow 6 — checkout, up to the moment Stripe takes over', () => {
  test('an empty bag is sent back to the bag rather than shown a form whose submit can only fail', async ({
    page,
  }) => {
    await test.step('open checkout with no cart cookie', async () => {
      /* `checkout/page.tsx` opens with `if (!cart || cart.lines.length === 0) redirect('/cart')`.
         Each test gets a fresh context, so this really is the no-cart rendering of the route. */
      await page.goto(ROUTE.checkout)
    })

    await test.step('the redirect fired', async () => {
      await expect(page).toHaveURL(/\/cart$/)

      /* The empty branch of `cart/page.tsx` — its one control. Asserting the destination *rendered*
         rather than only that the URL changed is what stops this passing on a redirect loop. */
      await expect(page.getByRole('link', { name: NAME.startShopping })).toBeVisible()
    })
  })

  test('checkout shows a payment form or says payment is unavailable, and never both — DEV-62', async ({
    page,
  }) => {
    await openFirstProduct(page)
    await addFirstAvailableVariantToBag(page)

    await test.step('enter checkout with a real line in the bag', async () => {
      await page.goto(ROUTE.checkout)
      await expect(page).toHaveURL(/\/checkout$/)
    })

    await test.step('exactly one of the two renderings is present', async () => {
      const form = slot(page, 'checkoutForm')
      const unavailable = slot(page, 'checkoutUnavailable')

      /* Either is a legitimate state — which one depends on whether the *deployment* holds Stripe
         keys, which the harness cannot read. What is not legitimate is both, or neither. */
      await expect(form.or(unavailable).first()).toBeVisible()

      const rendered = (await form.count()) + (await unavailable.count())

      expect(
        rendered,
        'checkout/page.tsx branches on isStripeConfigured(); one branch renders, never two',
      ).toBe(1)
    })

    const form = slot(page, 'checkoutForm')

    /* Outside the step below, deliberately: `test.skip` works by throwing, and a throw inside a
       `test.step` is reported against the step as well as the test. */
    test.skip(
      (await form.count()) === 0,
      'this deployment renders the DEV-62 unavailable notice, so there is no form to inspect',
    )

    await test.step('the form collects no card details', async () => {
      /*
       * §17.1b's PCI position, asserted rather than trusted: payment happens on Stripe's own page,
       * so this form has no card surface at all. The promise is in the copy and the absence has to
       * match it — a card field appearing here would be the single most expensive regression in the
       * project, and it would pass every other test in the suite.
       */
      await expect(
        form.getByText('Payment is handled by Stripe. Card details are never sent to this site.'),
      ).toBeVisible()

      expect(await form.locator('input[autocomplete^="cc-"]').count()).toBe(0)
    })
  })

  test('the real Stripe test-mode path: the form hands off to Stripe, and the bag survives the handoff', async ({
    page,
  }) => {
    test.skip(
      !stripeConfigured,
      `Stripe is unconfigured in this environment (${STRIPE_ENV_KEYS.join(', ')}), so ` +
        'isStripeConfigured() is false and checkout renders the DEV-62 notice instead of a form.',
    )

    test.skip(
      !stripeTestMode,
      'STRIPE_SECRET_KEY is not a test-mode key. §27.1c asks for Stripe TEST mode, and this test ' +
        'creates a real Checkout Session — running it against a live key could take real money.',
    )

    await openFirstProduct(page)
    await addFirstAvailableVariantToBag(page)

    await test.step('fill in contact, address and delivery', async () => {
      await page.goto(ROUTE.checkout)

      await expect(slot(page, 'checkoutForm')).toBeVisible()

      /*
       * The labels are `checkout-form.tsx`'s own, and the address ones are spelled out here rather
       * than added to `fixtures.NAME` because that map is shared and this is the only spec that
       * fills this form.
       *
       * `exact: true` is load-bearing throughout. `getByLabel` substring-matches, the footer renders
       * on every route, and `newsletter-signup.tsx` labels its input *"Email address for the
       * newsletter"* — which a loose match would also find, and two matches is a strict-mode failure
       * rather than a useful assertion.
       */
      await page.getByLabel(NAME.email, { exact: true }).fill(uniqueEmail('checkout'))
      await page.getByLabel(NAME.firstName, { exact: true }).fill('North')
      await page.getByLabel(NAME.lastName, { exact: true }).fill('Tester')
      await page.getByLabel('Address', { exact: true }).fill('1 Test Street')
      await page.getByLabel('City', { exact: true }).fill('Portland')
      await page.getByLabel('State / county', { exact: true }).fill('OR')
      await page.getByLabel('Postcode', { exact: true }).fill('97201')

      /*
       * `US`, deliberately. `shipping/rules.ts` lists eight `SUPPORTED_COUNTRIES` and names US as
       * `DOMESTIC_COUNTRY`; an unsupported code would be refused at preflight with
       * `PREFLIGHT_COPY.addressUnsupported` and this test would fail for a reason that has nothing
       * to do with Stripe. The field is `maxLength={2}` and the server uppercases it.
       */
      await page.getByLabel('Country', { exact: true }).fill('US')
    })

    await test.step('a delivery option is offered, and one is already chosen', async () => {
      /* A `<fieldset>` with `<legend>Delivery</legend>` is a group named by that legend. */
      const rates = page.getByRole('group', { name: 'Delivery' }).getByRole('radio')

      /*
       * `checkout/page.tsx` passes `quote.rates.filter((rate) => rate.eligible)`, so an empty row
       * means the shop cannot deliver anything at all — a real defect, not a skip.
       */
      expect(
        await rates.count(),
        'checkout must offer at least one eligible delivery rate, or preflight can only refuse',
      ).toBeGreaterThan(0)

      /* `defaultChecked={index === 0}` — §13.1c's no-preselection rule is about *sizes*; a delivery
         method has a sensible default and leaving it unset would only manufacture a refusal. */
      await expect(rates.first()).toBeChecked()
    })

    await test.step('continue to payment, and Stripe takes the browser', async () => {
      await page.getByRole('button', { name: 'Continue to payment' }).click()

      /*
       * The end of this application's responsibility. `session.ts` redirects to `session.url`, which
       * is Stripe's hosted page — so this is the assertion that all eleven §17.1a preflight steps
       * passed and that `stripe.checkout.sessions.create` was accepted with a server-derived total.
       *
       * Nothing beyond this line belongs to NORTH / 01. The suite does not type a card number: the
       * payment is Stripe's contract with the customer, and the only thing that may tell this shop
       * it happened is the signed webhook in flow 7.
       */
      await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//)
    })

    await test.step('the bag is untouched, because starting a payment is not making one', async () => {
      await page.goto(ROUTE.cart)

      /*
       * `fulfil.ts` marks the cart `converted` **inside the transaction that marks the order paid**,
       * and nowhere else — `preflight.ts` only writes an order at `checkout_started`. So a bag that
       * had been emptied by reaching Stripe would mean something other than a verified webhook had
       * decided a payment happened. It is also the customer-visible half: someone who abandons
       * Stripe's page must come back to the bag they left.
       */
      await expect(slot(page, 'cartLine').first()).toBeVisible()
    })
  })

  test('the success page is a report, not a receipt — an order id that names nothing shows nothing', async ({
    page,
  }) => {
    await test.step('open the success URL directly, which §17.1g names as a case', async () => {
      /* §17.1g: *"opens the success URL directly … the order state must still come from
         webhook/payment state, not the browser."* */
      await page.goto(`${ROUTE.checkoutSuccess}?order=${UNCLAIMED_ORDER_ID}`)
    })

    await test.step('one message for not-found, not-yours and never-existed', async () => {
      /*
       * `readOrderForConfirmation` returns `null` for all three and the page renders a single
       * heading — deliberately, because distinguishing them would turn the URL into a way to
       * enumerate other people's orders. Asserting the *heading* rather than only the absence of an
       * order summary is what makes this fail loudly if that ever splits into three messages.
       */
      await expect(
        page.getByRole('heading', { name: 'We could not find that order' }),
      ).toBeVisible()

      await expect(slot(page, 'orderSummary')).toHaveCount(0)
    })

    await test.step('and with no order parameter at all', async () => {
      await page.goto(ROUTE.checkoutSuccess)

      await expect(
        page.getByRole('heading', { name: 'We could not find that order' }),
      ).toBeVisible()
    })
  })
})

/* =================================================================================================
 * Flow 7 — the Stripe webhook, signed offline
 * ============================================================================================== */

/**
 * The signer.
 *
 * A `Stripe` instance is constructed only for `webhooks.generateTestHeaderString`, which is pure
 * HMAC and makes no network call — the same arrangement `scripts/verify-checkout.ts` section F uses
 * and for the same reason: *"a payload that verifies here would verify in production, and one that
 * does not, would not."* The key below is a fixture and is never sent anywhere; the API version is
 * the one `lib/checkout/stripe.ts` pins, restated because that module is `server-only` and cannot
 * export it to a harness.
 */
const signer = new Stripe('sk_test_e2e_offline_signing_fixture', {
  apiVersion: '2026-07-29.dahlia',
})

/** A handled type, taken from the application's own list so the two cannot drift. */
const HANDLED_TYPE = 'checkout.session.completed'

/** A type the application deliberately does not act on — §17.1h's *"unknown events"*. */
const UNHANDLED_TYPE = 'customer.created'

/** A minimal event body in the shape the route reads: `event.id`, `event.type`, `data.object`. */
function eventBody(type: string, metadata?: Record<string, string>): string {
  return JSON.stringify({
    data: { object: metadata ? { metadata } : {} },
    id: `evt_e2e_${randomUUID().replace(/-/g, '')}`,
    type,
  })
}

/** POST a body to the webhook with whatever `stripe-signature` the caller wants — or none. */
async function postWebhook(
  request: APIRequestContext,
  body: string,
  signature: null | string,
): Promise<{ status: number; text: string }> {
  const response = await request.post(WEBHOOK_PATH, {
    data: body,
    /* `request.text()` is what the route reads, so the body must arrive as the exact bytes signed —
       a string payload with an explicit content type is sent verbatim rather than re-serialised. */
    headers: {
      'content-type': 'application/json',
      ...(signature === null ? {} : { 'stripe-signature': signature }),
    },
  })

  return { status: response.status(), text: await response.text() }
}

/** The signing secret, or the empty string. Every test below is skipped when it is empty. */
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''

test.describe('§27.1c flow 7 — the webhook, and the bodies it refuses', () => {
  /*
   * The harness needs the *signing secret* to produce a header the route will accept. Without it
   * these tests could only ever assert the refusals, which is half the point and would report false
   * coverage of the other half.
   */
  test.beforeEach(() => {
    test.skip(
      webhookSecret === '',
      'STRIPE_WEBHOOK_SECRET is unset in this environment, so the harness cannot sign an event the ' +
        'route would accept — and an unsigned-only run would assert the refusals while reporting ' +
        'coverage of the acceptance path it never reached.',
    )
  })

  /**
   * The route answers **503** when `isStripeConfigured()` is false, before it looks at anything else.
   * The harness holding a secret does not mean the deployment does, so every test asks the route
   * itself first rather than assuming the two environments match.
   */
  async function requireConfiguredDeployment(request: APIRequestContext): Promise<void> {
    const probe = await postWebhook(request, '{}', null)

    test.skip(
      probe.status === 503,
      'the deployment under test answers 503 — `isStripeConfigured()` is false there, so no event ' +
        'can be verified and none may be acknowledged.',
    )
  }

  test('a body with no signature is refused, because reaching this endpoint is not payment', async ({
    request,
  }) => {
    await requireConfiguredDeployment(request)

    await test.step('POST a well-formed event with no stripe-signature header', async () => {
      const { status, text } = await postWebhook(request, eventBody(HANDLED_TYPE), null)

      /*
       * 400, not 200 and not 500. The route's own reasoning: an unverified body is not evidence of
       * anything, and a retry cannot supply a signature that was never sent. This is the assertion
       * that `AGENTS.md`'s *"only a signature-verified Stripe webhook marks an order paid"* is a
       * property of the endpoint rather than of the comment above it.
       */
      expect(status).toBe(400)
      expect(text).toBe('Missing signature.')
    })
  })

  test('a body signed with the wrong secret is refused, so the signature is not ceremonial', async ({
    request,
  }) => {
    await requireConfiguredDeployment(request)

    const body = eventBody(HANDLED_TYPE, { orderId: String(UNCLAIMED_ORDER_ID) })

    await test.step('sign with a secret this deployment does not hold', async () => {
      const forged = signer.webhooks.generateTestHeaderString({
        payload: body,
        secret: 'whsec_a_secret_this_deployment_does_not_hold',
      })

      const { status, text } = await postWebhook(request, body, forged)

      /* A correctly *shaped* header over the correct bytes, under the wrong key. If this ever
         answered 200, every field in every event would be attacker-controlled. */
      expect(status).toBe(400)
      expect(text).toBe('Invalid signature.')
    })
  })

  test('a correctly signed event whose timestamp is old is refused, which is the replay window', async ({
    request,
  }) => {
    await requireConfiguredDeployment(request)

    const body = eventBody(UNHANDLED_TYPE)

    await test.step('sign the exact bytes, an hour ago', async () => {
      const stale = signer.webhooks.generateTestHeaderString({
        payload: body,
        secret: webhookSecret,
        /* Seconds, and far outside `constructEvent`'s default 300-second tolerance. The HMAC is
           perfect; only the age is wrong, which is exactly the case a captured-and-replayed body
           presents. */
        timestamp: Math.floor(Date.now() / 1000) - 3600,
      })

      const { status, text } = await postWebhook(request, body, stale)

      expect(status).toBe(400)
      expect(text).toBe('Invalid signature.')
    })
  })

  test('an unknown event type is acknowledged and recorded rather than retried forever — §17.1h', async ({
    request,
  }) => {
    await requireConfiguredDeployment(request)

    /* Keeps the constant honest: if `customer.created` were ever added to the handled list, this
       test would be asserting the wrong branch and says so here instead of failing obscurely. */
    expect(HANDLED_EVENT_TYPES as readonly string[]).not.toContain(UNHANDLED_TYPE)

    const body = eventBody(UNHANDLED_TYPE)

    await test.step('POST a genuinely signed event of a type the shop does not act on', async () => {
      const { status, text } = await postWebhook(
        request,
        body,
        signer.webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret }),
      )

      /*
       * **200 here is also the proof that the signature verified.** An unrecognised type is refused
       * *after* `constructEvent`, so a bad signature would have produced the 400 above. §17.1h:
       * *"unknown events should be safely acknowledged/logged without crashing the webhook
       * handler"* — and `Ignored.` is the route saying it saw this and did nothing on purpose.
       */
      expect(status).toBe(200)
      expect(text).toBe('Ignored.')
    })
  })

  test('the same event delivered twice is processed once — §17.1d, the first idempotency barrier', async ({
    request,
  }) => {
    await requireConfiguredDeployment(request)

    /*
     * An **unhandled** type on purpose. The barrier under test is the unique `eventId` column, which
     * fires before the route decides what an event means — so asserting it with a type that changes
     * no order keeps this test about idempotency and nothing else.
     */
    const body = eventBody(UNHANDLED_TYPE)
    const header = signer.webhooks.generateTestHeaderString({
      payload: body,
      secret: webhookSecret,
    })

    await test.step('first delivery', async () => {
      const { status, text } = await postWebhook(request, body, header)

      expect(status).toBe(200)
      expect(text).toBe('Ignored.')
    })

    await test.step('redelivery of the identical body', async () => {
      const { status, text } = await postWebhook(request, body, header)

      /*
       * Stripe retries after network failures, timeouts and deploys, so this is the ordinary case
       * rather than the exceptional one. The distinct sentence matters: `Already processed.` is the
       * route reporting that the **insert was refused by a constraint** — not a read that happened
       * to find a row, which is the version with a window between the read and the write.
       */
      expect(status).toBe(200)
      expect(text).toBe('Already processed.')
    })
  })

  test('a signed payment event for an order this shop does not hold is acknowledged, never crashed on', async ({
    request,
  }) => {
    await requireConfiguredDeployment(request)

    expect(HANDLED_EVENT_TYPES as readonly string[]).toContain(HANDLED_TYPE)

    const body = eventBody(HANDLED_TYPE, { orderId: String(UNCLAIMED_ORDER_ID) })

    await test.step('POST a signed checkout.session.completed naming an order that does not exist', async () => {
      const { status, text } = await postWebhook(
        request,
        body,
        signer.webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret }),
      )

      /*
       * `applyStripeEvent` resolves no order, returns `noOrder`, and the route records the row as
       * `ignored` and answers `OK`. §17.1h's *"invalid metadata"*: a signature proves Stripe sent
       * it, not that the order lives here — another application on the same account, an older
       * deploy, or exactly this test. A 500 would make Stripe retry it for three days.
       */
      expect(status).toBe(200)
      expect(text).toBe('OK')
    })
  })

  /*
   * **Not asserted here, and it cannot be from this seat: a webhook that actually finalises an
   * order.** That needs an order in a finalisable state, its `order-items`, and variants with stock
   * — rows only the database can supply. `scripts/verify-webhook.ts` drives `applyStripeEvent`
   * against all of it, including both idempotency barriers, the transaction and the inventory race;
   * what it says it does not do is *"go through the HTTP route"*, which is the gap the tests above
   * close from the other side. The two together cover §17.1d end to end; neither does alone.
   */
})

/* =================================================================================================
 * Flow 10 — reviews
 * ============================================================================================== */

/**
 * **A purchase is a badge here, not a gate** — and that is worth stating, because the obvious reading
 * of §27.1c's *"review flow"* is that a review needs a paid order.
 *
 * `lib/reviews/rules.ts` records the conflict and its resolution as **DEV-69**: plan §21.1a hedges
 * (*"**If** verified purchase is required"*) while feature matrix §9 lists reviewing a non-owned
 * product as abuse. `AGENTS.md` ranks the plan above the matrix, so **authentication is the only
 * gate** and `verifiedPurchase` is a badge the submitter cannot assert.
 *
 * So these tests drive the gate that exists. The badge gets a `test.skip` naming what it would take.
 */
test.describe('§27.1c flow 10 — reviews', () => {
  /** `ProductReviews` renders inside a `Section` carrying this attribute, and nothing else does. */
  const REVIEWS_SECTION = '[data-section="reviews"]'

  test('a signed-out visitor is offered a way in, not a form that would be refused — §21.1a', async ({
    page,
  }) => {
    await openFirstProduct(page)

    const reviews = page.locator(REVIEWS_SECTION)

    await test.step('the reviews block explains the gate', async () => {
      await expect(reviews).toBeVisible()

      /* The sentence comes from `REVIEW_COPY`, imported rather than retyped — copy that may change
         is not a thing to hard-code into a test. */
      await expect(reviews.getByText(REVIEW_COPY.notSignedIn)).toBeVisible()
      await expect(reviews.getByRole('link', { name: NAME.signIn })).toBeVisible()
    })

    await test.step('and renders no form at all', async () => {
      /*
       * §0.1.17, stated as an absence. `ProductReviews` renders the form **or** the reason, never
       * both — a form that collects a review and then refuses it costs the customer their words
       * before telling them anything.
       */
      await expect(
        reviews.getByRole('button', { name: REVIEW_SECTION_COPY.submitTitle }),
      ).toHaveCount(0)

      await expect(reviews.getByRole('group', { name: 'Rating' })).toHaveCount(0)
    })
  })

  test('a signed-in customer may review once, and the review is held for moderation — §21.1b, §21.1c', async ({
    page,
  }) => {
    await page.goto(ROUTE.register)

    /*
     * **§26.1a must not be active, because a harness cannot solve a challenge.**
     *
     * `TurnstileWidget` renders nothing without `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and
     * `verifyTurnstile` independently reaches the same conclusion from the *server* environment. So
     * the widget's presence in the DOM is the deployment's own answer to "is §26.1a active here",
     * which is a better question to ask than the harness's environment — and both the registration
     * form and the review form are guarded, so an active challenge stops this flow twice.
     *
     * Outside a `test.step`, deliberately: `test.skip` works by throwing, and a throw inside a step
     * is reported against the step as well as the test.
     */
    test.skip(
      (await page.locator(`[data-response-field-name="${TURNSTILE_FIELD}"]`).count()) > 0,
      'Turnstile is configured on this deployment and §26.1a guards both registration and review ' +
        'submission. A headless browser cannot solve the challenge, so this flow is not drivable ' +
        'here — see fixtures.ts, environment assumption 1.',
    )

    /* A fresh account per run. §21.1c's duplicate rule is a compound unique index on
       `(product, customer)`, so a shared account would make the second run of this file fail on a
       row the first run left behind — a harness failure wearing the costume of a real one. */
    await registerNewCustomer(page)
    await openFirstProduct(page)

    const reviews = page.locator(REVIEWS_SECTION)
    const rating = reviews.getByRole('group', { name: 'Rating' })

    await test.step('the form is offered, with no rating chosen for them', async () => {
      await expect(rating).toBeVisible()

      /* Five radios and none checked. The same instinct as §13.1c's size rule: a rating the shop
         picked is not a rating the customer gave. */
      await expect(rating.getByRole('radio')).toHaveCount(5)
      await expect(rating.getByRole('radio', { checked: true })).toHaveCount(0)
    })

    await test.step('submit a review', async () => {
      await rating.getByRole('radio', { name: '5', exact: true }).check()

      await page.getByLabel('Name to show with your review', { exact: true }).fill('North T.')

      /* `ReviewSchema` requires ten characters or more — *"what stops 'ok' being a review"*. */
      await page
        .getByLabel('Your review', { exact: true })
        .fill('Cut is clean and the weight is exactly as described.')

      await reviews.getByRole('button', { name: REVIEW_SECTION_COPY.submitTitle }).click()
    })

    await test.step('the customer is told it is pending, not that it is published', async () => {
      /*
       * §21.1b. `status` defaults to `pending` on the column and the field is staff-only on create,
       * so a review lands unapproved through *any* door. Saying so is the difference between
       * moderation and a review that appears to vanish on submit — and this sentence is the only
       * thing standing between the two.
       */
      await expect(page.getByText(REVIEW_SECTION_COPY.pending)).toBeVisible()
    })

    await test.step('and a second review of the same product is refused — §21.1c', async () => {
      await page.reload()

      /*
       * The guarantee is the compound unique index on `(product, customer)`; `reviewEligibility` is
       * the courtesy that lets the page say so instead of the customer discovering it by submitting.
       * Asserting the *courtesy* is what proves the two agree — the page could otherwise keep
       * offering a form whose only outcome is a database refusal.
       *
       * While their review is still waiting for a person, the refusal is worded as the pending
       * sentence rather than "already reviewed" (Phase 35 sweep 2) — the reload is the case that used
       * to lose it. `REVIEW_COPY.alreadyReviewed` is what they see once it has been moderated.
       */
      await expect(reviews.getByText(REVIEW_SECTION_COPY.pending)).toBeVisible()

      await expect(
        reviews.getByRole('button', { name: REVIEW_SECTION_COPY.submitTitle }),
      ).toHaveCount(0)
    })
  })

  test.skip('a verified-purchase badge appears only on a review by someone who paid', () => {
    /*
     * **Impossible from a browser, by design.** `verifiedPurchase` is written by
     * `submitReviewAction` from `hasPaidOrderFor`, and an order only reaches `paid` through
     * `finalisePaidOrder`, which only the signature-verified webhook route calls. So this test would
     * need to register, buy, complete a real Stripe test-mode payment, and have Stripe deliver an
     * event to a publicly reachable URL — three things a Playwright run cannot do without either a
     * card-entry robot or a tunnel to the machine under test.
     *
     * The badge's *rule* is asserted where it is decidable: `reviewEligibility` returns
     * `verifiedPurchase` from `hasPaidOrder`, and `pnpm verify:reviews` drives it against real rows.
     * Faking it here — seeding a paid order behind the browser's back — would assert that the test
     * can write to the database, which is not the claim §27.1c is making.
     */
  })
})

/* =================================================================================================
 * Flow 11 — shop the look
 * ============================================================================================== */

/**
 * The section on this page that carries hotspots, or `null` when the CMS holds none.
 *
 * Two surfaces render `Hotspot`: `ShopTheLookSection` (an editorial block, which also carries
 * `data-section="shop-the-look"`) and `LookbookPage`'s chapters (which do not). Both wrap them in
 * `Section`, so one filter finds either — and the marker is identified by the
 * `aria-haspopup="dialog"` that `Popover.Trigger` puts on it, which is an ARIA fact rather than a
 * class name and is present in the server-rendered HTML.
 *
 * The lookbook is tried first because that is where §22 is *meant* to live; the homepage is the
 * fallback, because a shop may run the block there and publish no lookbook at all.
 */
async function findShopTheLook(page: Page): Promise<Locator | null> {
  const sections = () =>
    page
      .locator('[data-slot="section"]')
      .filter({ has: page.locator('a[aria-haspopup="dialog"]') })
      .first()

  await page.goto(ROUTE.lookbook)

  /* Scoped to `<main>` because the header's own Lookbook link points at `/lookbook`, not into one,
     and the footer may carry either. `documentHref` maps a lookbook to `/lookbook/<slug>`. */
  const season = page.getByRole('main').locator('a[href^="/lookbook/"]').first()

  if ((await season.count()) > 0) {
    await season.click()
    await page.waitForURL(/\/lookbook\/[^/]+$/)

    if ((await sections().count()) > 0) {
      return sections()
    }
  }

  await page.goto(ROUTE.home)

  return (await sections().count()) > 0 ? sections() : null
}

/** The reason every flow-11 test gives when the CMS holds no hotspot. Content, not code. */
const NO_HOTSPOT =
  'no published lookbook chapter or shopTheLook block in this environment carries a hotspot, so ' +
  'there is nothing to open. This is CMS content, not code.'

test.describe('§27.1c flow 11 — shop the look', () => {
  test('a hotspot opens a preview and still offers the product page — §22.1c', async ({ page }) => {
    const look = await findShopTheLook(page)

    test.skip(look === null, NO_HOTSPOT)

    if (look === null) {
      return
    }

    const marker = look.locator('a[aria-haspopup="dialog"]').first()

    await test.step('the marker announces itself as a disclosure that has not fired', async () => {
      await expect(marker).toHaveAttribute('aria-expanded', 'false')
    })

    await test.step('opening it discloses rather than navigates', async () => {
      const url = page.url()

      await marker.click()

      /*
       * `Popover.Content` is `role="dialog"`, and none of the shell's three overlays is open, so
       * this is unambiguous. A failure here with a `/product/` URL means the page had not hydrated
       * — `Hotspot`'s `onClick` preventDefault is the whole of the enhancement, and the anchor
       * beneath it is a real link by design (see the no-JavaScript test below).
       */
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(page.url()).toBe(url)
    })

    await test.step('and the preview offers the product page rather than replacing it', async () => {
      /* §22.1c's fourth clause — *"allow full PDP navigation"* — which is the clause the naive
         upgrade from an anchor to a button silently breaks. */
      const viewProduct = page
        .getByRole('dialog')
        .getByRole('link', { name: LOOK_COPY.viewProduct })

      await expect(viewProduct).toBeVisible()
      await viewProduct.click()

      await page.waitForURL(PRODUCT_URL)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })
  })

  test('the preview never offers both an add and a size choice, because §22.1d step 3 forbids guessing', async ({
    page,
  }) => {
    const look = await findShopTheLook(page)

    test.skip(look === null, NO_HOTSPOT)

    if (look === null) {
      return
    }

    const dialog = page.getByRole('dialog')

    await test.step('open the first marker and wait for the live resolution', async () => {
      await look.locator('a[aria-haspopup="dialog"]').first().click()
      await expect(dialog).toBeVisible()

      /*
       * The preview is fetched on open — a page can carry thirty-two markers, and resolving every
       * one's live stock on render would be paid by everyone for the benefit of a few. Until it
       * lands, `HotspotPreview` shows the name and price the page already had plus this line, so its
       * disappearance is the only honest signal that the variant state below is real.
       */
      await expect(dialog.getByText('Checking availability…')).toBeHidden()
    })

    await test.step('exactly one of the four outcomes is offered', async () => {
      const addOne = dialog.getByRole('button', { name: /^Add / })
      const chooseSize = dialog.getByRole('link', { name: LOOK_COPY.chooseSize })
      const soldOut = dialog.getByText('Sold out.', { exact: true })
      const withdrawn = dialog.getByText('This product is no longer available.', { exact: true })

      await expect(addOne.or(chooseSize).or(soldOut).or(withdrawn).first()).toBeVisible()

      /*
       * **The assertion the phase exists for.** `resolvesToOneVariant` returns a variant only when
       * there is exactly one purchasable — one is not a choice, two is, and zero dressed up as a
       * default is the silent guess §22's prompt forbids. So the preview may add, or ask, and never
       * both.
       */
      expect(
        (await addOne.count()) + (await chooseSize.count()),
        'a preview offering both an add and a size choice would be adding a size nobody picked',
      ).toBeLessThanOrEqual(1)
    })
  })

  test('add the entire look is never silent: either the bag changes or the customer is told why not — §22.1d step 6', async ({
    page,
  }) => {
    const look = await findShopTheLook(page)

    test.skip(look === null, NO_HOTSPOT)

    if (look === null) {
      return
    }

    const addLook = look.getByRole('button', { name: LOOK_COPY.addLook })

    await test.step('the control is offered on a surface that has hotspots', async () => {
      /* `AddEntireLook` returns `null` for an empty `productIds`, so its presence is itself the
         assertion that the resolver kept at least one product on the image. */
      await expect(addLook).toBeVisible()
    })

    await test.step('pressing it produces a visible outcome', async () => {
      await addLook.click()

      /*
       * Two legitimate endings, and no third. Either something went in — `addToBagAction`
       * revalidates the layout, so the header badge is the server's word for it — or `lookNotice`
       * says which items needed a size and which were unavailable, because *"2 items skipped"* turns
       * an actionable outcome into a dead end.
       *
       * The notice is located by its `aria-live`, which is the only one inside this section: the
       * hotspot popovers' own live region is portalled to the body, and the section carries nothing
       * else that announces.
       *
       * `.first()` because a **partial** add satisfies both at once, and two matches would be a
       * strict-mode failure rather than a stricter test.
       */
      const badge = slot(page, 'cartCount')
      const notice = look.locator('[aria-live="polite"]').filter({ hasText: /\S/ })

      await expect(badge.or(notice).first()).toBeVisible()
    })
  })
})

test.describe('§27.1c flow 11 — the same markers, with JavaScript switched off', () => {
  /*
   * `Hotspot`'s docblock makes a claim that no other test in this repository can check: *"With
   * JavaScript, the click is prevented and the popover opens. **Without it, the anchor navigates to
   * the product page**"*. It is the reason `Popover.Trigger` wraps a `Link` rather than a
   * `<button>`, and it is invisible to every assertion made with a scripting browser.
   *
   * This costs one extra browser context and writes nothing.
   */
  test.use({ javaScriptEnabled: false })

  test('a hotspot is still a real link to the product, which is what the anchor is for', async ({
    page,
  }) => {
    const look = await findShopTheLook(page)

    test.skip(look === null, NO_HOTSPOT)

    if (look === null) {
      return
    }

    const marker = look.locator('a[aria-haspopup="dialog"]').first()

    await test.step('the marker carries a product href in the server-rendered HTML', async () => {
      await expect(marker).toHaveAttribute('href', PRODUCT_URL)
    })

    await test.step('and following it lands on the product page', async () => {
      await marker.click()
      await page.waitForURL(PRODUCT_URL)

      /* Phase 10's behaviour, unchanged by Phase 22's upgrade — which is the whole claim. */
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })
  })
})
