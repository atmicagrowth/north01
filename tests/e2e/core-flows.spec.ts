/**
 * **Plan §27.1c — the core storefront flows.** This file owns seven of the twelve: **1** homepage →
 * product → cart, **2** search → product → cart, **3** filter → product, **4** quick view → add to
 * cart, **5** guest cart → login → cart merge, **8** account → orders, and **9** wishlist.
 *
 * ### This suite has never been executed, and that is a fact about the environment rather than a hedge
 *
 * Every flow below writes. Flows 1, 2, 3 and 5 create carts and cart items; flows 5, 8 and 9 create a
 * **customer** through the real registration form; flow 9 writes a wishlist row. The only database
 * this project can reach is **production** — `TODO.md` §1 — and decision **D-10** exists precisely to
 * stop a writing harness being pointed at it. So none of these tests has ever run, and
 * `playwright.config.ts` refuses to start a server unless the caller has said which database it may
 * touch.
 *
 * What that costs, stated plainly: nothing here has been observed to pass. What it does **not** cost
 * is the correctness of the selectors. Every route, every accessible name and every `data-slot` below
 * was read out of `src/` — most of them through `fixtures.ts`, which is where this suite keeps the
 * ones more than one spec needs — and the comment beside a locator names the component it came from
 * wherever the anchor is not self-evident. Nothing is invented, and there is no `waitForTimeout`
 * anywhere in the file: a flow that needs a sleep is a flow whose real signal has not been found yet.
 *
 * ### Two environment preconditions, or the first green run will blame the shop for something else
 *
 * 1. **Turnstile must be unconfigured, or configured with Cloudflare's always-pass test keys.**
 *    `verifyTurnstile` returns `{ ok: true, skipped: true }` when either key is absent, and refuses a
 *    tokenless submission when both are present (`lib/security/turnstile.ts`). Flows 5, 8 and 9 post
 *    the login and registration forms, so a half-configured environment fails them at the first
 *    submit — which is the guard working, not the flow breaking.
 * 2. **The search index must be populated** for flow 2. That flow asserts against
 *    `SEARCH_COPY.unavailable.title` explicitly, so an Algolia outage names itself instead of arriving
 *    as a mysteriously empty grid three steps later.
 *
 * ### The anchors, in the order this project prefers them
 *
 * `getByRole` with an accessible name wherever the application gives a control one — which is most of
 * them, because `IconButton` requires a `label` and turns it into `aria-label` — then `getByLabel` for
 * form fields, then `data-slot` for structural regions, and `getByText` only for sentences that live
 * in a constant. Those constants are **imported**: `CART_COPY`, `SEARCH_COPY` and `WISHLIST_EMPTY_COPY`
 * are the shop's own words, and a spec that retypes one is testing the spec author's memory rather
 * than the shop. The same goes for `NAME`, `ROUTE` and `SLOT`, which `fixtures.ts` derives from
 * `utilityNav`, `SEARCH_PATH` and the components themselves.
 *
 * `data-item-name` deserves a note because it looks like a test hook and is not. `ProductCard` carries
 * `data-item-id` and `data-item-name` for §25.1a's `select_item` — see
 * `components/catalog/product-card.tsx` — and they hold the resolver's own `card.name`. Reading the
 * name off a card and asserting that the product page's `<h1>` matches it is how these flows prove a
 * link went where the card said it would, without a single hard-coded slug. A slug written into a spec
 * is a slug that goes stale the first time an editor unpublishes something.
 *
 * ### What is deliberately not asserted
 *
 * No screenshot and no snapshot. §27's own instruction is to *"prioritize business-critical logic and
 * user flows over superficial snapshot coverage"*, and a DOM snapshot of a CMS-driven storefront goes
 * red on the next copy edit while catching nothing a customer would notice.
 *
 * No total and no price arithmetic. Those belong to the cart harness, where they can be checked
 * against the rules rather than against whatever the page happens to render — and this project's spine
 * is that the **browser is never authoritative** for a total, so a browser-side assertion about one
 * proves the wrong thing. What these flows do assert in money's neighbourhood is the **count**, and
 * only where the server produced it: the header badge exists because `addToBagAction` called
 * `refreshBagSurfaces()` and the layout re-read the cart, so *Bag, 1 item* is the server agreeing that
 * the line is real. A click that had not persisted would leave it absent.
 */

import type { Locator, Page } from '@playwright/test'

import {
  addFirstAvailableVariantToBag,
  BUYABLE_PRODUCT_CARD,
  CART_COPY,
  closeCartDrawerIfOpen,
  expect,
  NAME,
  openCartDrawer,
  PRODUCT_URL,
  registerNewCustomer,
  ROUTE,
  SEARCH_COPY,
  slot,
  SLOT,
  test,
  WISHLIST_EMPTY_COPY,
} from './fixtures'

/**
 * The storefront shell has finished rendering.
 *
 * `site-footer` is the last thing `app/(frontend)/layout.tsx` puts below `{children}`, so its presence
 * means the page's own markup is in the document rather than half of it. It is not sufficient on
 * `/shop` or `/search`, whose grids stream in separately — those steps wait for the grid as well.
 */
async function waitForShell(page: Page): Promise<void> {
  await expect(slot(page, 'siteFooter')).toBeVisible()
}

/**
 * The product name a card claims, from the attribute the analytics layer already puts on it.
 *
 * Asserted non-null rather than defaulted, because an empty string would quietly turn every
 * `toHaveText(name)` below into an assertion that passes against any product at all — the worst kind
 * of green, because it looks like coverage.
 */
async function productNameOf(card: Locator): Promise<string> {
  await expect(card).toBeVisible()

  const name = await card.getAttribute('data-item-name')

  expect(name, 'ProductCard carries data-item-name for §25.1a select_item').not.toBeNull()

  return name ?? ''
}

test.describe('§27.1c — the core storefront flows', () => {
  test('flow 1 — a customer who arrives on the homepage can reach a product from it and finish with that product in the bag', async ({
    page,
  }) => {
    let productName = ''
    let variantId = ''

    await test.step('land on the homepage', async () => {
      await page.goto(ROUTE.home)
      await waitForShell(page)
    })

    await test.step('open the first product the homepage offers', async () => {
      /*
       * `product-tile` is the homepage's own card — `components/home/product-tile.tsx` — and is a
       * different component from the catalogue's `product-card`, deliberately so: it carries none of
       * §11.1b's nine states, and the whole tile is one link.
       *
       * The homepage is CMS-composed, so this assertion doubles as the honest failure message for a
       * composition with no product rail in it. That is a merchandising fact worth failing on rather
       * than skipping past: §27.1c's flow 1 does not exist on a homepage that offers no product.
       */
      const tile = slot(page, 'productTile').first()

      await expect(
        tile,
        'flow 1 needs at least one product rail on the homepage — this composition has none',
      ).toBeVisible()

      await tile.click()
      await page.waitForURL(PRODUCT_URL)

      /* `product-page.tsx` gives the PDP its single `<h1>`: the product name. */
      const heading = page.getByRole('heading', { level: 1 })

      await expect(heading).toBeVisible()

      productName = (await heading.textContent())?.trim() ?? ''

      expect(productName).not.toBe('')
    })

    await test.step('choose a size and add it to the bag', async () => {
      variantId = await addFirstAvailableVariantToBag(page)

      /*
       * The badge, by its text rather than merely present. A fresh browser context starts with no
       * cart cookie, so exactly one add means exactly one item — and the number is the **server's**,
       * re-read by the layout after `refreshBagSurfaces()`.
       */
      await expect(slot(page, 'cartCount')).toHaveText('1')
    })

    await test.step('the global bag drawer holds that line, opened from the page the customer is on', async () => {
      /* §9.1d: *"the global cart drawer must work from every page"* — including a product page. */
      const drawer = await openCartDrawer(page)

      /*
       * `CartLineRow` writes the variant it is for to `data-variant`, and `AddToBag` posted that same
       * id. Asserting on the pair is what makes this "the thing I added is in the bag" rather than
       * "something is in the bag".
       */
      await expect(drawer.locator(`${SLOT.cartLine}[data-variant="${variantId}"]`)).toHaveCount(1)

      /*
       * "View bag" is the drawer's secondary action; Checkout is the primary one, and flow 6 owns
       * that. Both are `Button asChild` around a `Link`, so both are links.
       */
      await drawer.getByRole('link', { name: NAME.viewBag }).click()
    })

    await test.step('/cart is the same single line, and the count in its title came from the server', async () => {
      await page.waitForURL(/\/cart$/)

      /*
       * `cart/page.tsx` titles the populated bag `Your bag (${cart.totals.itemCount})`, while the
       * empty branch reads "Your bag" with no number at all. So this assertion also proves the line
       * survived the navigation rather than only the click.
       */
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your bag (1)')

      const lines = slot(page, 'cartLine')

      await expect(lines).toHaveCount(1)
      await expect(lines.first()).toContainText(productName)
    })
  })

  test('flow 2 — a search for a real product name reaches that product, and it can be bought from the results', async ({
    page,
  }) => {
    let productName = ''

    await test.step('take a real product name from the catalogue rather than inventing a query', async () => {
      /*
       * The term is **derived**, never hard-coded. A spec that searches for "hoodie" fails the day the
       * range changes, and one that passes only because the seed happens to contain that word is not
       * testing search at all — it is testing the seed.
       *
       * The source is a buyable card, because this flow ends in the bag: searching for something
       * sold out would reach a product page where every size is `aria-disabled` and the add step
       * would fail on a page behaving exactly as §13.1c specifies.
       */
      await page.goto(ROUTE.shop)
      await waitForShell(page)

      const grid = slot(page, 'productGrid')

      await expect(grid).toBeVisible()

      productName = await productNameOf(grid.locator(BUYABLE_PRODUCT_CARD).first())
    })

    await test.step('open the search overlay from the header and submit that name', async () => {
      /*
       * `SearchTrigger` is an `IconButton` labelled "Search", and `IconButton` turns `label` into
       * `aria-label`. Scoped to the header so it cannot resolve to the panel's own input, whose
       * `sr-only` `<label for="site-search">` carries the same word.
       */
      await slot(page, 'siteHeader').getByRole('button', { name: NAME.searchTrigger }).click()

      const panel = page.getByRole('dialog', { name: NAME.searchDialog })

      await expect(panel).toBeVisible()

      /* An ARIA 1.2 combobox — `role="combobox"` on the input, per `search-panel.tsx`. */
      const input = panel.getByRole('combobox')

      await input.fill(productName)

      /*
       * Enter submits. With no arrow-key navigation `active` is `-1`, so `onSubmit` falls through to
       * `submit(term)` and pushes `/search?q=…` — the same destination the no-JavaScript
       * `<form method="get" action="/search">` would reach without any of this.
       */
      await input.press('Enter')
    })

    await test.step('the results page is for the term that was typed', async () => {
      await page.waitForURL(/\/search\?/)
      await waitForShell(page)

      /*
       * `search/page.tsx` titles the results `“${term}”` with typographic quotes, and
       * `normaliseSearchTerm` **preserves case** on purpose — the term is echoed back as the title, a
       * chip and a recent search, and folding it would show the customer something they did not type.
       * Both facts are asserted here at once. (It also strips wrapping quotes and a leading `-`, which
       * are Algolia operators rather than text; no product name in this catalogue begins with either.)
       */
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`“${productName}”`)

      /*
       * Load-bearing, and the reason `SEARCH_COPY` is imported. When the engine is unreachable the
       * route renders `catalog-unavailable` with this exact title — a page carrying no products and
       * no error — so without this the flow would fail below as "no product card found" and blame the
       * shop for an outage at the search provider.
       */
      await expect(page.getByText(SEARCH_COPY.unavailable.title)).toHaveCount(0)
    })

    await test.step('the product searched for is among the results, and opens', async () => {
      const grid = slot(page, 'productGrid')

      await expect(grid).toBeVisible()

      /*
       * Searching a product's full name and not getting that product back is a relevance defect worth
       * failing on, so the card is found by name rather than taking whatever came first.
       *
       * `getByRole('link')` with no `.first()` is an assertion in itself: `ProductCard` contains
       * exactly one anchor by construction, because Phase 20 moved the wishlist heart **out** of the
       * link and made it a sibling `<button>`. If a second interactive element ever reappears inside
       * it, strict mode says so here.
       */
      const match = grid.locator(SLOT.productCard).filter({ hasText: productName }).first()

      await expect(match).toBeVisible()

      await match.getByRole('link').click()
      await page.waitForURL(PRODUCT_URL)

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(productName)
    })

    await test.step('choose a size, add it to the bag, and find it on the bag page', async () => {
      const variantId = await addFirstAvailableVariantToBag(page)

      await page.goto(ROUTE.cart)
      await waitForShell(page)

      await expect(page.locator(`${SLOT.cartLine}[data-variant="${variantId}"]`)).toHaveCount(1)
    })
  })

  test('flow 3 — applying a filter narrows the grid to products that satisfy it, and a card still opens its own product', async ({
    page,
  }) => {
    let cardName = ''

    await test.step('open the shop', async () => {
      await page.goto(ROUTE.shop)
      await waitForShell(page)

      await expect(slot(page, 'productGrid')).toBeVisible()
    })

    await test.step('tick “In stock only”', async () => {
      /*
       * Availability is the one facet that is **always** rendered. `FilterPanel` builds category,
       * collection, size and colour from the vocabulary and drops any group with no options, while the
       * Availability and Price groups are unconditional — so filtering on a colour would make this
       * flow depend on the colours the shop happens to sell this week.
       *
       * The panel is scoped rather than reached for globally because `FilterDrawer` mounts a
       * **second** `FilterPanel` for viewports below `lg`. It lives in a Radix portal that exists only
       * while that drawer is open, so at this project's desktop viewport there is exactly one — and
       * the scope is what keeps this correct if the drawer is ever mounted eagerly.
       */
      const filters = slot(page, 'filterPanel')

      await expect(filters).toBeVisible()

      /*
       * Radix's `Checkbox.Root` is a `<button role="checkbox">` named by the `<label htmlFor>` beside
       * it, so asking for it by role is also the assertion that the pair is wired together at all —
       * which a click on the label would not have told us.
       */
      await filters.getByRole('checkbox', { name: 'In stock only' }).click()

      /*
       * `useUrlState` writes with `shallow: false`, so a filter is a real navigation and the URL is
       * the state. Waiting on the URL rather than on the grid means the assertions below run against
       * the filtered **server** render instead of against whatever was still on screen.
       */
      await page.waitForURL(/availability=in-stock/)
    })

    await test.step('the applied filter is shown, and is offered back for removal', async () => {
      /*
       * `active-filters.tsx`'s own rule: every applied filter becomes a removable chip. A filter a
       * customer can apply and cannot see is a filter they cannot clear, which is how a shop ends up
       * looking permanently empty. The chip's accessible name is `Remove filter: ${label}`, and
       * `activeFilterChips` labels this one "In stock".
       */
      await expect(
        slot(page, 'activeFilters').getByRole('link', { name: 'Remove filter: In stock' }),
      ).toBeVisible()
    })

    await test.step('nothing in the filtered grid is out of stock', async () => {
      const grid = slot(page, 'productGrid')

      await expect(grid).toBeVisible()

      /*
       * The point of the whole flow. `data-state` is the resolver's verdict on each card, so these two
       * counts are the difference between a filter that filters and a filter that only rewrites the
       * URL — which is the failure mode a URL-backed filter has, and the one no unit test of
       * `canonicaliseParams` could ever see.
       */
      await expect(grid.locator(`${SLOT.productCard}[data-state="soldOut"]`)).toHaveCount(0)
      await expect(grid.locator(`${SLOT.productCard}[data-state="unavailable"]`)).toHaveCount(0)
    })

    await test.step('a card in the filtered grid opens its own product', async () => {
      const card = slot(page, 'productGrid').locator(BUYABLE_PRODUCT_CARD).first()

      cardName = await productNameOf(card)

      await card.getByRole('link').click()
      await page.waitForURL(PRODUCT_URL)

      /*
       * The card said which product it was, so the page it led to has to be that product. A grid whose
       * links are off by one looks perfect in a screenshot and is unusable in a shop.
       */
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(cardName)
    })
  })

  test('flow 4 — quick view → add to cart', () => {
    /*
     * **Not implemented, and not faked.**
     *
     * §11.1c specifies a product card with *"quick view, quick add and a wishlist"*. Only the wishlist
     * half was ever built — `components/home/product-tile.tsx` still records the other two as unbuilt
     * in its own docblock — and no phase since Phase 11 has asked for them. There is no dialog, no
     * trigger, no route and no component anywhere in `src/` that opens a product without leaving the
     * grid.
     *
     * Phase 25 confirmed it from the other direction: `quick_view_opened` sits in the analytics union
     * because §25.1a lists it, and **nothing emits it**. That is recorded as **DEV-74**, together with
     * the reasoning for keeping the name in the taxonomy while the event stays silent — the vocabulary
     * is the deliverable, and the instrumentation says what is true.
     *
     * So this is skipped rather than written against an invented selector. Driving a quick view that
     * does not exist would be a red test describing a feature nobody removed; inventing a
     * `[data-slot="quick-view"]` to make it green would be the fake UI plan §0.1.17 forbids, arriving
     * through the test suite instead of through the shop.
     */
    test.skip(
      true,
      'No quick view exists — DEV-74. §11.1c specified quick view, quick add and a wishlist; only ' +
        'the wishlist half was built, and Phase 25 recorded quick_view_opened as an event nothing ' +
        'emits. Unskip when a quick view is built, not before.',
    )
  })

  test('flow 5 — signing in keeps the bag a guest filled, because §14.1b merges it rather than replacing it', async ({
    page,
  }) => {
    let productName = ''
    let variantId = ''

    const customer =
      await test.step('an account exists, and the browser is a guest again', async () => {
        /*
         * Registration signs you in — `register` performs a real `startSession`, then `claimGuestCart`,
         * then redirects — and `registerNewCustomer` leaves the page on `/account` with the Sign out
         * button visible. So the browser has to be put back to being a guest before this flow can start.
         *
         * Signing out is the honest way to do it rather than clearing cookies by hand: `logout` clears
         * the session cookie **and** calls `forgetCartCookie`, which is the pair Phase 14's second sweep
         * added after measuring the previous account holder's bag surviving a sign-out on a shared
         * machine. What follows is therefore a genuinely empty guest bag.
         */
        const created = await registerNewCustomer(page)

        await page.getByRole('button', { name: NAME.signOut }).click()

        /* `logout` redirects to `/login?signedOut=1`, and the page renders that flag as a notice. */
        await page.waitForURL(/\/login\?/)

        return created
      })

    await test.step('as a guest, put something in the bag', async () => {
      await page.goto(ROUTE.shop)
      await waitForShell(page)

      const card = slot(page, 'productGrid').locator(BUYABLE_PRODUCT_CARD).first()

      productName = await productNameOf(card)

      await card.getByRole('link').click()
      await page.waitForURL(PRODUCT_URL)

      variantId = await addFirstAvailableVariantToBag(page)

      await expect(slot(page, 'cartCount')).toHaveText('1')
    })

    await test.step('reaching for the account sends the guest to sign in, and remembers where they were going', async () => {
      /*
       * The header's account affordance — an `IconButton asChild` wrapping a `Link`, so it is a link
       * whose accessible name is `utilityNav.account.label`. Scoped to the header, because the footer
       * is CMS-driven and an editor may put the word "Account" in it.
       */
      await closeCartDrawerIfOpen(page)
      await slot(page, 'siteHeader').getByRole('link', { name: NAME.accountLink }).click()

      /*
       * `requireCustomer('/account')` redirects to `/login?next=…` rather than to a bare `/login`,
       * which is §7.1e's *"authentication should interrupt as little as possible"*. Asserting the
       * parameter is asserting that the interruption is resumable — and this is why the flow drives
       * the form itself instead of calling `signIn`, which deliberately goes to a bare `/login`.
       */
      await page.waitForURL(/\/login\?next=%2Faccount/)
    })

    await test.step('sign in', async () => {
      /*
       * `exact: true` is not decoration. `getByLabel` substring-matches, the footer renders on every
       * route, and `newsletter-signup.tsx` labels its input "Email address for the newsletter" —
       * chosen deliberately so it is not "Email" — which a loose match would still find. Two matches
       * is a strict-mode failure rather than a useful assertion.
       */
      await page.getByLabel(NAME.email, { exact: true }).fill(customer.email)
      await page.getByLabel(NAME.password, { exact: true }).fill(customer.password)

      await page.getByRole('button', { name: NAME.signIn }).click()

      /* `login` ends in `redirect(next ?? '/account')`, so the customer resumes the interrupted trip. */
      await page.waitForURL(/\/account$/)
    })

    await test.step('the guest bag survived the sign-in', async () => {
      /*
       * **The whole flow, in one number.** `login` calls `claimGuestCart` → `mergeGuestCart` *before*
       * the redirect, precisely so the page the customer lands on already renders the merged bag — a
       * merge one navigation later would show an empty badge and then change it.
       *
       * The badge is server-rendered from `getCart(customer.id)` in the layout, so a "1" here means
       * the line is now attached to the **customer's** cart rather than to a cookie that signing out
       * had already invalidated.
       */
      await expect(slot(page, 'cartCount')).toHaveText('1')
    })

    await test.step('and it is the same garment, on the bag page', async () => {
      await page.goto(ROUTE.cart)
      await waitForShell(page)

      /*
       * If the merge had dropped the guest lines this page would render `CART_COPY.empty` instead —
       * the silent failure that a badge assertion alone cannot tell apart from a stale number.
       * `mergeGuestCart` swallows its own errors by design, so this is the only place a failed merge
       * becomes visible to anything other than a log line.
       */
      await expect(page.getByText(CART_COPY.empty)).toHaveCount(0)

      const lines = slot(page, 'cartLine')

      await expect(lines).toHaveCount(1)
      await expect(page.locator(`${SLOT.cartLine}[data-variant="${variantId}"]`)).toHaveCount(1)
      await expect(lines.first()).toContainText(productName)
    })
  })

  test('flow 8 — a signed-in customer can reach their orders, and one with none is told so rather than shown a blank page', async ({
    page,
  }) => {
    const customer = await registerNewCustomer(page)

    await test.step('the account overview belongs to this customer', async () => {
      await page.goto(ROUTE.account)
      await waitForShell(page)

      /*
       * Not a redirect to `/login` — which is what `requireCustomer` does when the session cookie was
       * never set, and is the failure this assertion separates from every later one in the test.
       */
      await expect(page).toHaveURL(/\/account$/)

      /*
       * `account/page.tsx` renders the customer's own address in a `<dd>`. `uniqueEmail` makes it
       * fresh for every run, so this is a real identity check rather than a check that some email is
       * on screen — and identity is the point of a protected route.
       */
      await expect(page.getByText(customer.email)).toBeVisible()
    })

    await test.step('follow the account navigation to Orders', async () => {
      /*
       * `<nav aria-label="Account">` in `account-nav.tsx`, holding §20.1d's five routes. Scoping to it
       * keeps this off the header's own "Account" link, whose accessible name would otherwise match
       * the navigation landmark's.
       */
      await page
        .getByRole('navigation', { name: 'Account' })
        .getByRole('link', { name: 'Orders' })
        .click()

      await page.waitForURL(/\/account\/orders$/)

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Orders')
    })

    await test.step('a customer who has never bought anything is told what this page is for', async () => {
      /*
       * §27.1d lists *"empty order history"* as an edge case, and plan §31 forbids *"a generic blank
       * page when a known business state can be communicated clearly"*. A brand-new customer is the
       * one account guaranteed to be in that state, which is what makes this deterministic rather than
       * dependent on the shop's order history.
       *
       * It is also a stronger assertion than "the list is empty": an empty list and a query that threw
       * look identical, and only one of them still renders this sentence and this way out.
       */
      await expect(page.getByText('No orders yet.')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Browse the shop' })).toBeVisible()
    })
  })

  test('flow 9 — saving a product from its page puts it on the account list, where the customer can find it again', async ({
    page,
  }) => {
    let productName = ''

    await registerNewCustomer(page)

    await test.step('the session really exists, because the whole flow turns on which branch renders', async () => {
      /*
       * Load-bearing, and not a redundant repeat of `registerNewCustomer`'s own post-condition.
       * `WishlistButton` has **two** mechanisms: signed in it is a `<form>` posting
       * `saveToWishlistAction`, and signed out it writes to `localStorage` under
       * `GUEST_WISHLIST_KEY`. Both render a heart carrying the same label and the same `aria-pressed`.
       *
       * So a flow that had quietly lost its session would save to the device, pass every assertion up
       * to the last one, and then fail at `/account/wishlist` with an empty list and nothing to say
       * why. Proving the session first turns that into a failure that names itself.
       */
      await page.goto(ROUTE.account)
      await expect(page).toHaveURL(/\/account$/)
    })

    await test.step('open a product and save it', async () => {
      await page.goto(ROUTE.shop)
      await waitForShell(page)

      const card = slot(page, 'productGrid').locator(BUYABLE_PRODUCT_CARD).first()

      productName = await productNameOf(card)

      await card.getByRole('link').click()
      await page.waitForURL(PRODUCT_URL)

      /*
       * The **product page's** control, deliberately, and not the heart on the grid card. The PDP
       * route passes `signedIn` and `savedForCustomer` into `ProductPage` → `WishlistControl`, so the
       * signed-in branch renders there. `CatalogResults` passes neither to `ProductGrid`, so the
       * grid's heart is the guest branch for everybody — reported separately as a defect rather than
       * driven here, because a test written against a broken surface records the bug as the
       * specification.
       *
       * `NAME.save` / `NAME.saved` are `WISHLIST_COPY.save` and `.saved`, which the button uses as its
       * own `aria-label`. Imported rather than typed out, so a reworded label moves the suite with it.
       */
      await page.getByRole('button', { name: NAME.save }).click()

      const saved = page.getByRole('button', { name: NAME.saved })

      await expect(saved).toBeVisible()

      /*
       * `aria-pressed` is the machine-readable half of the same statement. A control whose visible
       * label changes and whose state does not is a control a screen-reader user cannot follow, and
       * this is a toggle whose entire job is to report a state.
       */
      await expect(saved).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('the header wishlist affordance leads to the saved list', async () => {
      /*
       * C-09 settled this: the wishlist is *"a global header affordance routing to
       * /account/wishlist"*, and `utilityNav.wishlist` is where that decision lives — which is where
       * `NAME.wishlistLink` and `ROUTE.wishlist` both come from, so the label and the destination
       * cannot drift apart in this assertion.
       */
      await slot(page, 'siteHeader').getByRole('link', { name: NAME.wishlistLink }).click()

      await page.waitForURL(new RegExp(`${ROUTE.wishlist}$`))

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wishlist')
    })

    await test.step('the saved product is on it', async () => {
      /*
       * Exactly one, because this customer was created moments ago and has saved exactly one thing.
       * Counting is what separates "the list rendered" from "the list rendered *this* product" — and
       * asserting the empty copy is absent separates both from a page that read the wrong customer's
       * list and correctly found nothing in it.
       */
      await expect(page.getByText(WISHLIST_EMPTY_COPY.title)).toHaveCount(0)

      const cards = slot(page, 'productCard')

      await expect(cards).toHaveCount(1)
      await expect(cards.first()).toContainText(productName)
    })
  })
})
