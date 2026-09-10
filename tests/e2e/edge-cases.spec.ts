/**
 * **Plan §27.1d — the fifteen edge cases, one test each, in the order §27.1d lists them.**
 *
 * > *"Sold-out variant. Product unpublished after page load. Cart item deleted before checkout.
 * > Price changed before checkout. Expired discount. Duplicate webhook. Refresh success URL.
 * > Checkout cancellation. Guest cart merge collision. Search no results. Search service
 * > unavailable. Image failure. Empty wishlist. Empty order history. Unauthorized account route."*
 *
 * ### This suite has never been executed, and that is a fact about the environment
 *
 * An end-to-end test needs a running application, and a running application here needs a database it
 * may write to. `TODO.md` §1 records that the only reachable one is **production**, and decision
 * **D-10** forbids pointing a writing harness at it. This file writes: it registers customers, signs
 * them in and out, and fills and empties bags. So every selector, URL and sentence below was read
 * out of `src/` rather than guessed, and the file is checked in unrun — exactly as
 * `playwright.config.ts` describes for the whole E2E directory. The first green run is owed to the
 * first non-production database. `fixtures.ts` states the same thing and adds the two environment
 * assumptions a first run must check, which apply here unchanged: Turnstile must be unconfigured or
 * on Cloudflare's always-passing test keys, and `E2E_BASE_URL` must name that deployment.
 *
 * ### Four of the fifteen are skipped, and the skips are the honest part
 *
 * Each of those four needs a **server-side mutation in the middle of a test** — a product set to
 * draft, a variant price edited, a promotion's end date moved into the past, a second signed Stripe
 * delivery. None can be reached from a browser, and none can be *faked* from a browser either:
 * rewriting a server-rendered response with `page.route` would assert that this file can produce a
 * string, not that the application produces it. A test that silently proves nothing is worse than a
 * skipped one, so each carries `test.skip` naming the exact mutation it needs and the harness that
 * covers the same rule offline today. The table at the foot of this file collects them.
 *
 * The two cases that genuinely can be *simulated* from the browser are simulated, and only because
 * the thing being simulated is a **network** failure rather than a database one: `/search/suggest`
 * is made to fail, and image bytes are made not to arrive.
 *
 * ### What this file adds to `fixtures.ts` rather than restating
 *
 * The routes, slots, accessible names and the four opening sequences all come from there. What is
 * local is only what no other spec needs: the sold-out card selector (which `fixtures.ts`
 * deliberately excludes from `BUYABLE_PRODUCT_CARD` and tells a §27.1d spec to ask for explicitly),
 * the reserved-media-box selector, and the confirmation-page invariant below.
 *
 * ### Chromium only
 *
 * `playwright.config.ts` gives the `mobile` project a `testMatch` of `mobile-navigation.spec.ts`
 * alone, so this file runs once, in `chromium`.
 */

import type { Page } from '@playwright/test'

import {
  CART_COPY,
  NAME,
  PRODUCT_URL,
  ROUTE,
  SEARCH_COPY,
  SLOT,
  WISHLIST_EMPTY_COPY,
  addFirstAvailableVariantToBag,
  expect,
  openFirstProduct,
  registerNewCustomer,
  signIn,
  slot,
  test,
} from './fixtures'

/* -------------------------------------------------------------------------------------------------
 * Anchors this file needs and `fixtures.ts` deliberately does not carry
 * ---------------------------------------------------------------------------------------------- */

/**
 * **A product with nothing left to sell.**
 *
 * `fixtures.ts` excludes this state from `BUYABLE_PRODUCT_CARD` on purpose — a sold-out product
 * renders every size `aria-disabled`, so a helper that clicked one would fail on a page behaving
 * exactly as §13.1c specifies — and says a §27.1d spec should ask for it explicitly. This is that
 * ask. `data-state` is `ProductCard`'s own attribute, carrying `lib/catalog/resolve.ts`'s
 * `'available' | 'lowStock' | 'soldOut' | 'unavailable'`.
 */
const SOLD_OUT_PRODUCT_CARD = `${SLOT.productCard}[data-state="soldOut"]`

/**
 * **Every rendering of a reserved media box**, from `components/media/media-image.tsx`.
 *
 * Both slots are legitimate targets and that is the whole point of §8.1d: `MediaImage` reserves the
 * *same* rectangle for a real photograph, for a record with no Cloudinary bytes, and for no record
 * at all. `fixtures.ts` maps the placeholder alone, because no §27.1c flow cares which of the four
 * states rendered — this test is the one that cares that they are indistinguishable in geometry.
 */
const RESERVED_MEDIA_BOX = `[data-slot="media-image"], ${SLOT.mediaPlaceholder}`

/**
 * Wait for the storefront shell to have finished rendering.
 *
 * The footer is the last thing `app/(frontend)/layout.tsx` renders below `{children}`, so its
 * presence means the page's own markup is in the document.
 */
async function waitForShell(page: Page): Promise<void> {
  await expect(slot(page, 'siteFooter')).toBeVisible()
}

/**
 * Read the confirmation page and require its heading and its status row to agree.
 *
 * `checkout/success/page.tsx` has exactly three renderings, and the heading is the customer-facing
 * claim in each: **Thank you** only when `paymentStatus === 'paid'`, **Confirming your payment**
 * while the webhook has not arrived, and **We could not find that order** when there is nothing to
 * show. `[data-slot="order-status"]` is the same boolean rendered as a word, so the two can be
 * checked against each other — which is what makes this meaningful for a paid order as well as for
 * the not-found one this suite can actually reach today.
 *
 * Returns the heading, so a caller can compare two readings of the same URL.
 */
async function readHonestConfirmation(page: Page): Promise<string> {
  const text = ((await page.getByRole('heading', { level: 1 }).textContent()) ?? '').trim()

  const summary = slot(page, 'orderSummary')
  const status = slot(page, 'orderStatus')

  if (text === 'We could not find that order') {
    /* Nothing to report, so nothing is reported: no order number, no total, no status. */
    await expect(summary).toHaveCount(0)

    return text
  }

  await expect(summary).toBeVisible()

  if (text === 'Thank you') {
    /*
     * The only sentence on the site that claims money moved, and it may appear only when the order
     * row says so. `paid` drives both the heading and this word, so a disagreement here would mean
     * the page had grown a second, weaker source of truth about payment.
     */
    await expect(status).toHaveText('Paid')

    return text
  }

  expect(text, 'the confirmation heading must be one of the three §17.1g renderings').toBe(
    'Confirming your payment',
  )

  await expect(status).toHaveText('Awaiting confirmation')

  return text
}

test.describe('§27.1d — the fifteen edge cases the plan enumerates', () => {
  /* ---------------------------------------------------------------------------------------------
   * 1 — Sold-out variant
   * ------------------------------------------------------------------------------------------ */

  test('a sold-out size is disabled and still readable, because §13.1c disables impossible options rather than hiding them', async ({
    page,
  }) => {
    await test.step('load the shop', async () => {
      await page.goto(ROUTE.shop)

      /*
       * The grid arrives through a `<Suspense>` whose fallback is a *different* slot, so waiting on
       * this one waits for real cards rather than for their placeholders.
       */
      await expect(slot(page, 'productGrid')).toBeVisible()
    })

    const soldOutCards = page.locator(SOLD_OUT_PRODUCT_CARD)

    if ((await soldOutCards.count()) > 0) {
      await test.step('a wholly sold-out product cannot be bought from its own page', async () => {
        /*
         * `productCardBadge` returns `{ label: 'Sold out' }` for this state, and it is a badge
         * rather than a dimmed control: the state reaches a screen-reader user through the same
         * words a sighted customer reads.
         */
        await expect(soldOutCards.first()).toContainText('Sold out')

        await soldOutCards.first().getByRole('link').click()
        await page.waitForURL(PRODUCT_URL)

        const sizes = page.getByRole('radiogroup', { name: NAME.sizeGroup })

        if ((await sizes.count()) > 0) {
          /*
           * The point of the whole case. Every size of a sold-out product is `aria-disabled`, so
           * there is **no selectable option at all** — and yet every one of them is still in the
           * document, because removing them would destroy the one thing a shopper most wants to
           * know: whether the garment is made in their size.
           */
          await expect(sizes.locator('[role="radio"]:not([aria-disabled="true"])')).toHaveCount(0)
          await expect(sizes.locator('[role="radio"]')).not.toHaveCount(0)
        }

        /* `AddToBag`'s `blocked` is `variantId === null || maxQuantity <= 0`. Both hold here. */
        await expect(page.getByRole('button', { name: NAME.addToBag })).toBeDisabled()
      })

      return
    }

    await openFirstProduct(page)

    const disabledSize = page
      .getByRole('radiogroup', { name: NAME.sizeGroup })
      .locator('[role="radio"][aria-disabled="true"]')
      .first()

    test.skip(
      (await disabledSize.count()) === 0,
      'The catalogue currently holds no zero-stock variant: no product card reports `soldOut`, ' +
        'and no size on the first buyable product is disabled. There is nothing sold out to ' +
        'assert against, and creating one would need a database write (D-10). `buildVariantMatrix` ' +
        'is covered offline for the same rule by `pnpm verify:product`.',
    )

    await test.step('a size that is sold out in this colour refuses selection and says why', async () => {
      /*
       * `VariantSelector` puts the reason in an `sr-only` span inside the option — *"sold out in
       * this colour"* or *"not made in this colour"* — so it is part of the accessible name. That is
       * what a keyboard user hears when the arrow keys **visit** the option instead of skipping it,
       * and it is the sighted strike-through said out loud.
       */
      await expect(disabledSize).toHaveText(/sold out in this colour|not made in this colour/)

      const before = page.url()

      await disabledSize.click()

      /*
       * `RadioRow`'s handler returns early for a disabled option, so nothing is committed to the URL
       * and the purchase controls do not move. A control that looked selectable and quietly did
       * nothing would be §0.1.17's fake UI.
       */
      await expect(page).toHaveURL(before)
      await expect(page.getByRole('button', { name: NAME.addToBag })).toBeDisabled()
    })
  })

  /* ---------------------------------------------------------------------------------------------
   * 2 — Product unpublished after page load
   * ------------------------------------------------------------------------------------------ */

  test('a product unpublished after page load stops being reachable by its own URL', async () => {
    test.skip(
      true,
      'Needs a server-side mutation mid-test: `products.status` moved from `published` to `draft` ' +
        '(or `publishedAt` pushed into the future) between two loads of one PDP. ' +
        '`publishedProductWhere` is the single definition of listable and `getProduct` returns null ' +
        'past it, so the assertion is a 404 on a URL that worked a moment earlier — but only a ' +
        'Payload write produces that state, and D-10 forbids writing to the one reachable database. ' +
        'Faking it with `page.route` would assert that this file can serve a 404, not that the ' +
        'application does. The same rule is asserted offline by `pnpm verify:cart`, where a line ' +
        'whose `productPublished` is false clamps to a quantity of zero, and rendered by ' +
        '`CartLineRow`, which drops the product link and shows CART_COPY.lineUnavailable.',
    )
  })

  /* ---------------------------------------------------------------------------------------------
   * 3 — Cart item deleted before checkout
   * ------------------------------------------------------------------------------------------ */

  test('a bag emptied in another tab cannot be checked out from the stale one, because the server decides and the rendered page does not', async ({
    page,
  }) => {
    await openFirstProduct(page)

    const variantId = await addFirstAvailableVariantToBag(page)

    await test.step('the first tab renders a real Checkout control', async () => {
      await page.goto(ROUTE.cart)

      /*
       * By variant id, not by count. `CartLineRow` writes the same id `AddToBag` posted to
       * `data-variant`, so this asserts the line that was actually added rather than that some line
       * exists.
       */
      await expect(page.locator(`${SLOT.cartLine}[data-variant="${variantId}"]`)).toHaveCount(1)
      await expect(page.getByRole('link', { name: NAME.checkout })).toBeVisible()
    })

    const otherTab = await page.context().newPage()

    await test.step('delete the line in a second tab', async () => {
      /* Same browser context, so the same cart cookie. This is §14.1e's "multiple tabs", exactly. */
      await otherTab.goto(ROUTE.cart)

      /*
       * The stepper's `−`. At a quantity of one it submits `0`, which `setQuantityAction` treats as
       * a removal — `cart-lines.tsx` says so in as many words. It is addressed through the
       * `cart-stepper` slot rather than by accessible name because at a quantity of one the minus
       * button and the standalone remove button are both named `Remove <product>`, and asking for
       * that name would be a strict-mode failure rather than a choice.
       */
      await slot(otherTab, 'cartStepper').locator('button').first().click()

      await expect(otherTab.getByText(CART_COPY.empty)).toBeVisible()
    })

    await test.step('the stale tab is refused, and lands on the bag rather than on a checkout form', async () => {
      await page.getByRole('link', { name: NAME.checkout }).click()

      /*
       * `checkout/page.tsx` opens with `if (!cart || cart.lines.length === 0) redirect('/cart')`.
       * The link was honest when it was rendered; the server re-reads the bag anyway, which is this
       * project's spine — the browser is never authoritative, not even about its own markup.
       */
      await page.waitForURL(/\/cart$/)
      await expect(page.getByText(CART_COPY.empty)).toBeVisible()
    })

    await otherTab.close()
  })

  /* ---------------------------------------------------------------------------------------------
   * 4 — Price changed before checkout
   * ------------------------------------------------------------------------------------------ */

  test('a price edited between the bag and checkout is refused rather than charged at the figure the browser was shown', async () => {
    test.skip(
      true,
      'Needs a server-side mutation mid-test: `variants.priceMinor` edited while a bag holding that ' +
        'variant is open. There is nothing for a browser to do here by construction — the bag never ' +
        'sends a price, `getCart` re-reads `unitPriceMinor` from the variant on every read, and ' +
        '`orderTotalMinor` takes four numbers the server calculated with no parameter a browser ' +
        'could reach. So the change is invisible from this side and can only be made in the CMS, ' +
        'which D-10 forbids here. `runPreflight` is what refuses it: `cart.drifted` returns ' +
        '`totalMismatch`, whose customer-facing sentence is in PREFLIGHT_COPY. Covered offline by ' +
        '`pnpm verify:checkout` and `pnpm verify:cart`.',
    )
  })

  /* ---------------------------------------------------------------------------------------------
   * 5 — Expired discount
   * ------------------------------------------------------------------------------------------ */

  test('a code that expired between the bag and checkout is shown as expired rather than silently dropped', async () => {
    test.skip(
      true,
      'Needs a promotion row whose `endsAt` is in the past, which is a database write (D-10). A ' +
        'browser can only reach `unknownCode` and `inactive`: both seeded codes (WELCOME10, ' +
        'FREESHIP) are deliberately `active: false` and any other string is unrecognised, so ' +
        'submitting a code through the form can never produce PROMOTION_COPY.expired. Asserting the ' +
        '"not recognised" sentence while calling the test "expired discount" would be a mislabelled ' +
        'pass. §15.1c is covered offline by `pnpm verify:promotions`, which asserts `expired` for a ' +
        'past `endsAt`, for expiry-and-under-minimum together, and for an expiry landing exactly on ' +
        '`now`.',
    )
  })

  /* ---------------------------------------------------------------------------------------------
   * 6 — Duplicate webhook
   * ------------------------------------------------------------------------------------------ */

  test('a webhook delivered twice finalises the order once', async () => {
    test.skip(
      true,
      "Needs Stripe's webhook signing secret. The route reads the raw body and calls " +
        '`constructEvent`, so an unsigned POST is answered 400 and never reaches either idempotency ' +
        'barrier — a browser-driven "duplicate" would therefore only assert that signature ' +
        'verification works, which is a different rule. Producing two identically signed deliveries ' +
        'of one event id needs the secret and a database, and D-10 forbids the second. ' +
        '`pnpm verify:webhook` drives `applyStripeEvent` exactly as the route drives it against a ' +
        'development database, and asserts the unique `stripe-events.eventId` insert, the ' +
        'transaction, and that a redemption is counted once and not again on a duplicate event.',
    )
  })

  /* ---------------------------------------------------------------------------------------------
   * 7 — Refresh success URL
   * ------------------------------------------------------------------------------------------ */

  test('the success URL reports the order state it finds and a refresh changes nothing, because §17.1g says arriving there is not payment', async ({
    page,
  }) => {
    /*
     * An order id this fresh browser context cannot possibly own. `readOrderForConfirmation` checks
     * ownership through `isViewable`, so even in the vanishingly unlikely event that the row exists,
     * the answer is the same not-found page — the URL is deliberately not a way to enumerate other
     * people's orders.
     */
    const url = `${ROUTE.checkoutSuccess}?order=2147483647`

    const first = await test.step('open the success URL directly', async () => {
      await page.goto(url)
      await waitForShell(page)

      return readHonestConfirmation(page)
    })

    const second = await test.step('refresh it', async () => {
      await page.reload()
      await waitForShell(page)

      return readHonestConfirmation(page)
    })

    /*
     * The whole case in one line. §17.1g lists refreshing the success URL among six browser
     * behaviours that must not move an order, and this page writes nothing — so the second reading
     * must be the first reading. A page that promoted "Order received" to "Thank you" on a refresh
     * would be treating a keystroke as a payment.
     */
    expect(second, 'a refresh must not change what the confirmation page claims').toEqual(first)
  })

  /* ---------------------------------------------------------------------------------------------
   * 8 — Checkout cancellation
   * ------------------------------------------------------------------------------------------ */

  test('a cancelled checkout charges nothing and leaves the bag exactly as it was, because abandoning a payment is not a decision to empty it', async ({
    page,
  }) => {
    await openFirstProduct(page)

    const variantId = await addFirstAvailableVariantToBag(page)

    await test.step('return to the cancel URL the way Stripe would', async () => {
      await page.goto(ROUTE.checkoutCancelled)
      await waitForShell(page)

      await expect(
        page.getByRole('heading', { level: 1, name: 'Nothing has been charged' }),
      ).toBeVisible()

      /* Both ways out, because a customer who stopped has not necessarily changed their mind. */
      await expect(page.getByRole('link', { name: 'Back to your bag' })).toBeVisible()
      await expect(page.getByRole('link', { name: NAME.continueShopping })).toBeVisible()
    })

    await test.step('the bag is untouched', async () => {
      await page.getByRole('link', { name: 'Back to your bag' }).click()
      await page.waitForURL(/\/cart$/)

      /*
       * The assertion the page's own docblock asks for: *"The bag is deliberately left as it was. A
       * cancelled payment is a customer who has not decided, and emptying their bag would be
       * deciding for them."* The route writes nothing, so the same variant must still be here.
       */
      await expect(page.locator(`${SLOT.cartLine}[data-variant="${variantId}"]`)).toHaveCount(1)
      await expect(page.getByText(CART_COPY.empty)).toHaveCount(0)
    })
  })

  /* ---------------------------------------------------------------------------------------------
   * 9 — Guest cart merge collision
   * ------------------------------------------------------------------------------------------ */

  test('the same variant in a guest bag and an account bag merges into one line, because §14.1b sums duplicates rather than listing them twice', async ({
    page,
  }) => {
    const credentials = await registerNewCustomer(page)

    await openFirstProduct(page)

    const variantId = await addFirstAvailableVariantToBag(page)

    /*
     * The variant travels between the two sessions as a **URL**, because §13.1c keeps the selection
     * in the query string (`?color=Bone&size=M`). Adding to the bag is a Server Action and navigates
     * nowhere, so the address bar still holds the selection that was just added — and revisiting it
     * later renders the same variant already chosen.
     */
    const variantUrl = page.url()

    await test.step('sign out, which forgets the bag cookie', async () => {
      await page.goto(ROUTE.account)
      await page.getByRole('button', { name: NAME.signOut }).click()

      /*
       * `logout` redirects here and calls `forgetCartCookie`, so what follows is a genuine guest
       * with a genuine second bag — not the same cart wearing a different hat.
       */
      await page.waitForURL(/\/login/)
    })

    await test.step('put one of the same variant into a guest bag', async () => {
      await page.goto(variantUrl)

      const addToBag = page.getByRole('button', { name: NAME.addToBag })

      /* Already enabled: the size came in on the URL, so no second round trip is needed. */
      await expect(addToBag).toBeEnabled()
      await addToBag.click()

      await expect(slot(page, 'cartCount')).toBeVisible()
    })

    await signIn(page, credentials.email, credentials.password)

    await test.step('the two bags become one line, not two', async () => {
      await page.goto(ROUTE.cart)

      /*
       * **The collision, asserted.** `mergeCartLines` keys by `variantId`, so one variant held in
       * both bags is one entry whose quantities were summed. Two rows for one variant is the defect
       * this case exists to catch, and it is exactly the shape a naive concatenation produces.
       */
      await expect(page.locator(`${SLOT.cartLine}[data-variant="${variantId}"]`)).toHaveCount(1)
      await expect(slot(page, 'cartLine')).toHaveCount(1)

      const heading = page.getByRole('heading', { level: 1 })
      const summed = ((await heading.textContent()) ?? '').includes('(2)')

      if (!summed) {
        /*
         * One plus one is two, and two is what gets checked against stock — the sum is clamped, not
         * each side separately. So a merged bag holding fewer than two is legitimate *only* when the
         * warehouse said so, and §14.1b's step 4 requires the customer be told: `cart.drifted` puts
         * CART_COPY.revalidated above the lines. A bag that quietly lost a unit with nothing on
         * screen to explain it is the failure.
         */
        await expect(page.getByText(CART_COPY.revalidated)).toBeVisible()
      }
    })
  })

  /* ---------------------------------------------------------------------------------------------
   * 10 — Search no results
   * ------------------------------------------------------------------------------------------ */

  test('a search that matches nothing says so without apologising, and offers a way back into the catalogue', async ({
    page,
  }) => {
    const term = 'qzqzqzqzwxwx'

    await test.step('search for something the catalogue cannot hold', async () => {
      await page.goto(`${ROUTE.search}?q=${term}`)
      await waitForShell(page)
    })

    await test.step('the designed empty state renders, and it is not the outage state', async () => {
      const empty = slot(page, 'catalogEmpty')

      await expect(empty).toBeVisible()

      /* The term is echoed back, so the customer can see what was actually searched for. */
      await expect(empty).toContainText(term)
      await expect(empty).toContainText(SEARCH_COPY.empty.body)

      /*
       * **The distinction this test exists for**, and the reason `searchState` is a total function:
       * an outage and an empty result both produce zero cards, and telling a customer "nothing
       * matched" while the service is down blames their taste for a fault. If this assertion ever
       * fails, search is unavailable in the environment — which is a real failure of this test and
       * must not be softened into an `or`.
       */
      await expect(slot(page, 'catalogUnavailable')).toHaveCount(0)
      await expect(slot(page, 'productGrid')).toHaveCount(0)

      /*
       * Structure §12's *"offer category alternatives"* — the way out is a link, not an instruction
       * to try again. On a bare `/search?q=` these are the **category** links specifically:
       * `isFilteredQuery` treats the route's own term as standing somewhere rather than filtering,
       * so no "Clear filters" is offered here, deliberately — clearing would erase what they came
       * for. What must never be true is a dead end.
       */
      await expect(empty.getByRole('link').first()).toBeVisible()
    })
  })

  /* ---------------------------------------------------------------------------------------------
   * 11 — Search service unavailable
   * ------------------------------------------------------------------------------------------ */

  test('a search service that cannot answer says it is unavailable and never says nothing matched, because those are different sentences to a customer', async ({
    page,
  }) => {
    await test.step('make the suggest endpoint fail', async () => {
      /*
       * A URL predicate rather than a glob, and built from `ROUTE.search` — which is `SEARCH_PATH`
       * itself — so it cannot drift from the route the panel actually calls:
       * `${SEARCH_PATH}/suggest?q=…`.
       *
       * 503 rather than `abort()`: the handler is written never to fail — it answers 200 carrying
       * `state: 'unavailable'` inside the payload — so the realistic outage is the edge in front of
       * it, and this exercises `search-panel.tsx`'s `response.ok ? … : null` branch. `abort()` would
       * exercise its sibling `.catch`, which converges on the same payload.
       */
      await page.route(
        (url) => url.pathname === `${ROUTE.search}/suggest`,
        (route) => route.fulfill({ body: 'unavailable', status: 503 }),
      )

      await page.goto(ROUTE.home)
      await waitForShell(page)
    })

    await test.step('the panel reports an outage, not an empty shop', async () => {
      await page.getByRole('button', { name: NAME.searchTrigger }).click()

      const panel = slot(page, 'searchPanel')

      await expect(panel).toBeVisible()

      /*
       * Scoped to the panel, and by role. The header trigger also carries the accessible name
       * "Search", so an unscoped `getByLabel(NAME.searchInput)` would match both the button and the
       * input — two matches, and a strict-mode failure rather than an assertion.
       *
       * Four characters is above `SEARCH_MIN_TERM_LENGTH`, so the panel really does ask the
       * endpoint rather than answering locally.
       */
      await panel.getByRole('combobox').fill('merino')

      await expect(panel.getByText(SEARCH_COPY.unavailable.title)).toBeVisible()
      await expect(panel.getByText(SEARCH_COPY.unavailable.body)).toBeVisible()

      /*
       * `searchState` ranks `unavailable` above every other branch precisely so this cannot happen.
       * A failed search has a card count of zero and so does an empty one; deciding "empty" first is
       * how an outage comes to read as *"nothing matches your search"*.
       */
      await expect(panel.getByText(SEARCH_COPY.empty.title)).toHaveCount(0)
    })
  })

  /* ---------------------------------------------------------------------------------------------
   * 12 — Image failure
   * ------------------------------------------------------------------------------------------ */

  test('an image whose bytes never arrive leaves its box exactly where it was, because §8.1d reserves from the context and not from the asset', async ({
    page,
  }) => {
    let abortedImages = 0

    await test.step('load the shop with every image request failing', async () => {
      await page.route('**/*', async (route) => {
        if (route.request().resourceType() === 'image') {
          abortedImages += 1
          await route.abort('failed')

          return
        }

        await route.continue()
      })

      await page.goto(ROUTE.shop)
      await expect(slot(page, 'productGrid')).toBeVisible()
    })

    test.skip(
      abortedImages === 0,
      'The page requested no images at all, so nothing failed and there is nothing to assert. That ' +
        'is the state of a shop whose media library is empty, where every surface renders ' +
        '`[data-slot="media-placeholder"]` instead — a state `MediaImage` documents, and one in ' +
        'which this case is vacuous rather than passing.',
    )

    await test.step('the reserved box survives the failure at its declared ratio', async () => {
      const box = page.locator(RESERVED_MEDIA_BOX).first()

      await expect(box).toBeVisible()

      const reserved = await box.evaluate((element) => {
        const rect = element.getBoundingClientRect()

        return {
          declared: getComputedStyle(element).getPropertyValue('--media-ar').trim(),
          height: rect.height,
          naturalWidths: [...element.querySelectorAll('img')].map((image) => image.naturalWidth),
          width: rect.width,
        }
      })

      /*
       * Proof the abort landed on *this* element rather than somewhere else on the page. A browser
       * reports `naturalWidth === 0` for an image it could not decode, so a non-zero value here
       * would mean the picture rendered and everything below proved nothing.
       */
      for (const naturalWidth of reserved.naturalWidths) {
        expect(naturalWidth, 'the image must genuinely have failed to load').toBe(0)
      }

      const [declaredWidth, declaredHeight] = reserved.declared
        .split('/')
        .map((part) => Number(part.trim()))

      expect(declaredWidth, '--media-ar must carry the context ratio').toBeGreaterThan(0)
      expect(declaredHeight, '--media-ar must carry the context ratio').toBeGreaterThan(0)

      /*
       * **The rule, measured.** The box is held open by `aspect-ratio` reading a custom property the
       * *page* supplied, so a failed asset cannot collapse it — which is what "no layout shift"
       * actually means here. A collapsed box would report a height of zero, and everything below it
       * would jump up the page.
       *
       * One decimal place: `getBoundingClientRect` is sub-pixel and the ratio is exact in principle,
       * but a tolerance of ±0.05 is enough to separate a reserved 4:5 box from a collapsed or a
       * square one without turning the assertion into a rounding test.
       */
      expect(reserved.height, 'a reserved box has height before any asset arrives').toBeGreaterThan(
        0,
      )
      expect(reserved.width / reserved.height).toBeCloseTo(declaredWidth / declaredHeight, 1)
    })
  })

  /* ---------------------------------------------------------------------------------------------
   * 13 — Empty wishlist
   * ------------------------------------------------------------------------------------------ */

  test('a new account sees a designed empty wishlist rather than a blank page, because zero saved items is the normal first state', async ({
    page,
  }) => {
    /*
     * A brand-new customer, not a fixed one. Reusing an account would make this assert that nobody
     * had saved anything to it since the last run, which is a property of the database rather than
     * of the application.
     */
    await registerNewCustomer(page)

    await test.step('open the saved items of an account that has never saved anything', async () => {
      await page.goto(ROUTE.wishlist)

      await expect(page.getByRole('heading', { level: 1, name: 'Saved' })).toBeVisible()
    })

    await test.step('the zero state is a sentence and a way out', async () => {
      /* From `lib/wishlist/rules.ts` through the fixtures, rather than retyped. */
      await expect(page.getByText(WISHLIST_EMPTY_COPY.title)).toBeVisible()
      await expect(page.getByText(WISHLIST_EMPTY_COPY.body)).toBeVisible()

      const escape = page.getByRole('link', { name: WISHLIST_EMPTY_COPY.cta })

      await expect(escape).toBeVisible()

      /* A way out that goes nowhere is the empty state failing at the one job it has. */
      await escape.click()
      await page.waitForURL(/\/shop$/)
    })
  })

  /* ---------------------------------------------------------------------------------------------
   * 14 — Empty order history
   * ------------------------------------------------------------------------------------------ */

  test('a new account sees a designed empty order history, because a customer who has never bought anything is the ordinary case', async ({
    page,
  }) => {
    await registerNewCustomer(page)

    await test.step('open the orders of an account that has never ordered', async () => {
      await page.goto(ROUTE.orders)

      await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible()
    })

    await test.step('the zero state says what will appear here, and does not apologise', async () => {
      await expect(page.getByText('No orders yet.')).toBeVisible()
      await expect(
        page.getByText('Anything you buy will appear here, with its status and what you paid.'),
      ).toBeVisible()

      await expect(page.getByRole('link', { name: 'Browse the shop' })).toBeVisible()
    })
  })

  /* ---------------------------------------------------------------------------------------------
   * 15 — Unauthorized account route
   * ------------------------------------------------------------------------------------------ */

  test('a signed-out visitor is sent to sign in with the route they wanted preserved, so signing in finishes the journey they started', async ({
    page,
  }) => {
    const wanted = `${ROUTE.orders}?page=2`

    await test.step('ask for a protected route, with a query, while signed out', async () => {
      /*
       * The query matters. `proxy.ts` carries `pathname + search` deliberately, because a protected
       * route reached with filters or a page number should come back the same way — and a redirect
       * that dropped it loses that silently.
       */
      await page.goto(wanted)

      await page.waitForURL(/\/login/)
    })

    await test.step('the return path survives the redirect intact', async () => {
      const next = new URL(page.url()).searchParams.get('next')

      expect(next, 'proxy.ts sets `next` to pathname + search').toBe(wanted)

      /* And what renders is the sign-in form — not a fragment of the account it just refused. */
      await expect(page.getByRole('heading', { level: 1, name: NAME.signIn })).toBeVisible()
      await expect(page.getByLabel(NAME.email, { exact: true })).toBeVisible()
      await expect(page.getByLabel(NAME.password, { exact: true })).toBeVisible()
    })
  })
})

/**
 * ## What this file does not cover, and where those rules are covered instead
 *
 * The four skips above are the whole of it, and none of them is a gap in the *application*:
 *
 * | §27.1d case | What it needs | Where the rule is asserted today |
 * |---|---|---|
 * | Product unpublished after page load | a Payload write mid-test | `pnpm verify:cart` |
 * | Price changed before checkout | a Payload write mid-test | `pnpm verify:checkout`, `pnpm verify:cart` |
 * | Expired discount | a promotion row with a past `endsAt` | `pnpm verify:promotions` |
 * | Duplicate webhook | Stripe's signing secret and a database | `pnpm verify:webhook` |
 *
 * All four become writable here the moment a development database exists: each is a single
 * `payload.update`, or one signed replay, away — and the assertion each would make is already
 * written above it in prose. Until then the honest position is a skip carrying its reason, rather
 * than a green test that proves something adjacent.
 */
