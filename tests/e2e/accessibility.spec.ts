/**
 * **Plan §27.1e — automated accessibility checks**, over the six routes that section names by hand:
 * Home, Shop, Product, Cart, Account/login and Checkout entry.
 *
 * ### Why this suite went unrun until Phase 35
 *
 * *Status: first run in Phase 35 — 43 passed, 0 failed, 14 skipped, against a local production
 * build of the development database (`docs/TESTING.md`). What follows is why it had not run before.*
 *
 * An axe scan needs a running application, and a running application here needs a database it may
 * write to. `TODO.md` §1 records that the only reachable one is **production**, and decision **D-10**
 * forbids pointing a writing harness at it. This file writes: two of its seven scans put a real
 * variant into a real bag, because §27.1e's *"Cart"* with something in it and its *"Checkout entry"*
 * are not reachable any other way. So it is written from the source of the routes it drives — every
 * selector below was read out of `src/`, never guessed — and it is checked in unrun, exactly as
 * `playwright.config.ts` describes for the whole E2E directory. The first green run is owed to the
 * first non-production database.
 *
 * ### What is asserted, and why it is four tags rather than one
 *
 * `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. WCAG 2.1 is a superset of 2.0, but axe tags each
 * success criterion by the version that *introduced* it — so `wcag21aa` alone would drop 1.4.3
 * Contrast and 4.1.2 Name/Role/Value, which are 2.0 criteria and are most of what this storefront can
 * plausibly get wrong. All four together are "WCAG 2.1 A and AA", spelled the way axe stores it.
 *
 * **No `disableRules()` anywhere in this file, blanket or otherwise.** Nothing is excluded, for one
 * route or for all of them. The one rule with any claim on an exclusion — `document-title`, which
 * notes §1.12.8 records firing spuriously in the middle of a client transition — is answered by
 * *settling the navigation* instead; see `settleTitle`. Switching a rule off to accommodate a race is
 * how a suite goes green while the shop stays unusable, and it would have hidden a genuinely missing
 * title on every route it was applied to.
 *
 * ### A failure names the rule, the impact and the element
 *
 * The assertion is on a flattened list of failing **nodes**, not on a count and not on the raw
 * `violations` array. A count tells you the build is red; `color-contrast [serious] .text-foreground-disabled`
 * tells you which element to open. Phase 11 found exactly one real contrast defect this way — a struck
 * compare-at price at 4.15:1, recorded in notes §1.16 — and the fix was one class, once the selector
 * was in the message.
 *
 * ### Chromium only
 *
 * `playwright.config.ts` gives the `mobile` project a `testMatch` of `mobile-navigation.spec.ts`
 * alone, so this file runs once, in `chromium`. Axe's findings here are DOM and computed-style facts;
 * a second engine would re-assert the same tree.
 */

import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import {
  addFirstAvailableVariantToBag,
  CART_COPY,
  expect,
  NAME,
  openFirstProduct,
  ROUTE,
  SLOT,
  slot,
  test,
} from './fixtures'

/**
 * WCAG 2.1 Level A and AA, as axe tags it. See the docblock above for why 2.0's tags are here
 * alongside 2.1's rather than being implied by them.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const

/** `AxeResults['violations'][number]`, taken from the builder so `axe-core` is not imported directly. */
type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]

/**
 * A failing node's target as one readable string.
 *
 * `target` is `CrossTreeSelector[]`: usually plain CSS strings, but a nested array when the element
 * sits inside a shadow root. Both are printed rather than one being dropped, because an element this
 * suite cannot name is an element nobody will go and find.
 */
function selectorOf(target: AxeViolation['nodes'][number]['target']): string {
  return target.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' >> ')
}

/** One line per failing element: rule id, impact, selector, and the rule's own explanation. */
function failureLines(violations: AxeViolation[]): string[] {
  return violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id} [${violation.impact ?? 'impact unknown'}] ${selectorOf(node.target)}` +
        ` — ${violation.help} (${violation.helpUrl})`,
    ),
  )
}

/**
 * Scan whatever is currently rendered and require zero violations.
 *
 * Deliberately takes no `include`/`exclude`: §27.1e asks about *routes*, and a scan narrowed to a
 * region is a scan that cannot see a duplicated landmark, a heading order broken across two
 * components, or the header the layout mounts above every page.
 *
 * The caller must already have waited for the page to be settled — see each test. Axe reads the DOM
 * once, so scanning a route whose grid is still a `<Suspense>` skeleton passes for the wrong reason.
 */
async function expectNoAxeViolations(page: Page, route: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze()

  /*
   * `toEqual([])` on the flattened lines rather than on `results.violations`: the diff Playwright
   * prints for an array of strings *is* the report, and it names every failing element instead of
   * burying it among the serialised rule objects around it.
   */
  expect(
    failureLines(results.violations),
    `axe-core found WCAG 2.1 A/AA violations on ${route}`,
  ).toEqual([])
}

/**
 * Wait for the storefront shell to have finished rendering.
 *
 * The footer is the last thing `app/(frontend)/layout.tsx` renders below `{children}`, so its
 * presence means the page's own markup is in the document. It is not sufficient on `/shop`, whose
 * grid streams in separately — that route waits for the grid as well.
 */
async function waitForShell(page: Page): Promise<void> {
  await expect(slot(page, 'siteFooter')).toBeVisible()
}

/**
 * Wait for a **client-side** navigation to have finished swapping the document title.
 *
 * This is not a nicety and it is not a sleep in disguise. Notes §1.12.8 records the exact result:
 * during an RSC client transition React removes the old `<title>` before inserting the new one, so a
 * scan fired on `waitForURL` can catch the gap and report `document-title` (WCAG 2.4.2, Level A)
 * against a page whose title is correct both before and after. That note ends *"Phase 27's suite
 * should settle the navigation before scanning, or it will chase this"* — this is that settle.
 *
 * `toHaveTitle` retries, so this is a web-first assertion on the condition itself rather than a guess
 * at how long React needs. Only the routes reached by a **click** need it; every `page.goto` below is
 * a full document load, where no such gap exists.
 */
async function settleTitle(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/\S/)
}

test.describe('§27.1e — automated accessibility over the six routes the plan names', () => {
  test('the homepage has no WCAG 2.1 A or AA violations, because it is the page every visit starts on', async ({
    page,
  }) => {
    await test.step('load the homepage', async () => {
      await page.goto(ROUTE.home)
      await waitForShell(page)
    })

    await test.step('scroll the page through, as a reader does', async () => {
      /*
       * Sections below the fold start faded out and open as the reader reaches them (`Reveal`). Axe
       * reads the DOM once, so scanning straight after load measured the contrast of text nobody
       * could see yet — seventeen "violations" on content at opacity 0 (Phase 35's first E2E run).
       * Scrolling to the foot opens every section (the observer's upward root margin), and reduced
       * motion makes the fade instant, so what is scanned is what a reader sees.
       */
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await expect(page.locator('[data-reveal="closed"]')).toHaveCount(0)
      await page.evaluate(() => window.scrollTo(0, 0))
    })

    await test.step('scan', async () => {
      await expectNoAxeViolations(page, ROUTE.home)
    })
  })

  test('the shop grid has no WCAG 2.1 A or AA violations once the real cards have replaced the skeleton', async ({
    page,
  }) => {
    await test.step('load the shop and wait for real cards', async () => {
      await page.goto(ROUTE.shop)
      await waitForShell(page)

      /*
       * Load-bearing. `ProductGridSkeleton` is `aria-hidden="true"` and carries no text, no links and
       * no colour worth checking — a scan that ran against it would find nothing and report a clean
       * catalogue page that had not rendered yet. It is a different `data-slot` from the real grid
       * precisely so the two can be told apart here.
       */
      await expect(slot(page, 'productGrid')).toBeVisible()
    })

    await test.step('scan', async () => {
      await expectNoAxeViolations(page, ROUTE.shop)
    })
  })

  test('a product page reached from the shop has no WCAG 2.1 A or AA violations in the unselected state a customer arrives in', async ({
    page,
  }) => {
    await openFirstProduct(page)

    /*
     * The only click-driven navigation in this file, so the only one that can catch React mid-swap of
     * the `<title>`. See `settleTitle` — this is the alternative to excluding `document-title`.
     */
    await settleTitle(page)

    await test.step('scan', async () => {
      /*
       * Scanned with nothing chosen, which is what every customer arriving from the shop sees: no size
       * selected, the stock line reading its "choose a size" sentence, and the size row's single tab
       * stop sitting on the first option, because `tabbableIndex` is given a selected index of -1.
       */
      await expectNoAxeViolations(page, '/product/<first buyable>')
    })
  })

  test('the empty bag has no WCAG 2.1 A or AA violations, because an empty bag is the state most visits show', async ({
    page,
  }) => {
    await test.step('load the bag with no cart cookie', async () => {
      /* Each test gets a fresh context, so this really is the no-cart rendering of the route. */
      await page.goto(ROUTE.cart)
      await waitForShell(page)

      /*
       * The empty branch of `cart/page.tsx`: this sentence, then one control. The sentence comes from
       * the constant the page renders rather than being retyped, so rewording `CART_COPY` cannot leave
       * a green test anchored to copy the shop no longer shows.
       */
      await expect(page.getByText(CART_COPY.empty)).toBeVisible()
      await expect(page.getByRole('link', { name: NAME.startShopping })).toBeVisible()
    })

    await test.step('scan', async () => {
      await expectNoAxeViolations(page, `${ROUTE.cart} (empty)`)
    })
  })

  test('a bag with a line in it has no WCAG 2.1 A or AA violations, because the stepper, discount form and summary exist only here', async ({
    page,
  }) => {
    await openFirstProduct(page)
    await addFirstAvailableVariantToBag(page)

    await test.step('load the bag', async () => {
      await page.goto(ROUTE.cart)
      await waitForShell(page)

      /*
       * The populated bag is a materially different document from the empty one: the line rows, the
       * quantity stepper, the discount form and the summary's totals all exist only in this branch.
       * Scanning the empty state alone would leave every control on this page unchecked.
       */
      await expect(slot(page, 'cartLine').first()).toBeVisible()
    })

    await test.step('scan', async () => {
      await expectNoAxeViolations(page, `${ROUTE.cart} (one line)`)
    })
  })

  test('the sign-in page has no WCAG 2.1 A or AA violations, because a form nobody can fill in is an account nobody can reach', async ({
    page,
  }) => {
    await test.step('load sign in', async () => {
      await page.goto(ROUTE.login)
      await waitForShell(page)

      /*
       * Both fields, by their labels — which is also the assertion that `Field` wires `htmlFor` to the
       * input's `id` at all.
       *
       * `exact: true` is not decoration. `getByLabel` substring-matches by default, and the footer
       * renders on every route: `newsletter-signup.tsx` labels its input *"Email address for the
       * newsletter"* — chosen deliberately so it is not "Email" — which a loose match would also find,
       * and two matches is a strict-mode failure rather than a useful assertion.
       */
      await expect(page.getByLabel(NAME.email, { exact: true })).toBeVisible()
      await expect(page.getByLabel(NAME.password, { exact: true })).toBeVisible()
    })

    await test.step('scan', async () => {
      await expectNoAxeViolations(page, ROUTE.login)
    })
  })

  test('checkout entry has no WCAG 2.1 A or AA violations, scanned with a bag so the empty-bag redirect cannot substitute the cart page', async ({
    page,
  }) => {
    /*
     * **The trap this test exists to avoid.** `app/(frontend)/checkout/page.tsx` opens with
     * `if (!cart || cart.lines.length === 0) redirect('/cart')`. A bare `page.goto('/checkout')`
     * therefore lands on the bag, axe scans *that*, and the run goes green having never looked at
     * checkout at all — the worst kind of passing test, because it reports coverage it does not have.
     *
     * So the bag is seeded through the real UI first, and the URL is asserted afterwards.
     */
    await openFirstProduct(page)
    await addFirstAvailableVariantToBag(page)

    await test.step('enter checkout and prove the redirect did not fire', async () => {
      await page.goto(ROUTE.checkout)

      await expect(page).toHaveURL(/\/checkout$/)

      /*
       * Either rendering of the route is a legitimate scan target, and which one appears depends on
       * whether the deployment holds Stripe keys: `checkout-form` when `isStripeConfigured()`, and
       * `checkout-unavailable` when it does not (**DEV-62** — the page says so in a sentence rather
       * than offering a form whose only outcome is a refusal at the last step). Accepting either means
       * this scan does not quietly become a test of Stripe configuration; strict mode still holds,
       * because exactly one of the two branches renders.
       */
      await expect(page.locator(`${SLOT.checkoutForm}, ${SLOT.checkoutUnavailable}`)).toBeVisible()
    })

    await test.step('scan', async () => {
      await expectNoAxeViolations(page, ROUTE.checkout)
    })
  })
})

/**
 * ## Still owed: the manual keyboard and focus review
 *
 * §27.1e requires the automated pass *"while still requiring manual keyboard/focus review because
 * automated tools cannot cover all interaction and content problems"*. That is not boilerplate here.
 * Axe reads one static DOM per scan; every item below is a **sequence** — a thing that can only go
 * wrong between two keystrokes — and a green run above says nothing about any of them. This project
 * has already paid for that twice: notes §1.14.3 records every overlay dropping focus to
 * `document.body` on close *while two clean axe sweeps passed over the same markup*, and §1.14.4
 * records the header's triggers announcing as bare buttons for the same reason — `aria-haspopup` is an
 * enhancement, so its absence is not a violation any scan will report.
 *
 * ### 1. The cart drawer's focus trap — `src/components/shell/cart-drawer.tsx`
 *
 * Radix's dialog primitive traps focus, but the *return* is this application's own: `CartTrigger`
 * calls `registerTrigger(event.currentTarget)` before opening and `shell/overlay-context.tsx` owns
 * putting focus back, because the trigger is in the header while the dialog is mounted beside the
 * footer — so `Dialog.Trigger`, which would normally do this, is bypassed entirely. Walk it: Tab to
 * the bag button, open, confirm focus lands **inside** the drawer and cannot Tab out to the page
 * behind it, press Escape, and confirm `document.activeElement` is the bag button rather than
 * `<body>`. Then do the same having opened the drawer from somewhere other than the header — a
 * different registered trigger is where a return path is most likely to be lost — and confirm the
 * handoff case, one overlay opening another, deliberately does *not* restore, because a restore there
 * would land inside a fresh focus trap and fight it.
 *
 * ### 2. The search overlay — `src/components/shell/search-panel.tsx`
 *
 * An ARIA 1.2 combobox inside a dialog, which is two focus contracts at once. Axe can see that
 * `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant` are *present*; it
 * cannot see whether `aria-activedescendant` actually tracks the arrow keys, whether DOM focus stays
 * on the input while it does, whether Escape closes the suggestions before it closes the dialog, or
 * whether Enter commits the highlighted option rather than submitting the raw query. Check each, and
 * check that the `role="group"` sections are announced by the `aria-label` they carry.
 *
 * ### 3. The variant selector's roving tabindex — `src/lib/product/roving.ts`, used by
 * `src/components/product/variant-selector.tsx` and by `product-gallery.tsx`'s thumbnails
 *
 * The group is **one** tab stop. Verify: Tab reaches the size row exactly once; Arrow Right/Down and
 * Left/Up move focus and **wrap**; Home and End jump to the ends; both axes work, because the row
 * wraps to two lines at 390px and a customer whose sizes have wrapped will reach for Down. Critically,
 * verify that arrowing does **not** select — this group is manual-activation, so `aria-checked` must
 * follow a click, Space or Enter only, and a screen reader must not announce a selection the server
 * has not made. Also confirm a sold-out size is **visited** by the arrows and announced with its
 * `sr-only` reason rather than skipped: that is the whole point of `aria-disabled` over `disabled`,
 * and it is exactly the behaviour a well-meaning refactor to `disabled` would silently remove without
 * failing a single check above.
 *
 * ### 4. The skip link — `src/components/layout/site-header.tsx`
 *
 * WCAG 2.4.1. It is `sr-only` until `focus-visible`, so no scan above could have seen it rendered. On
 * every route: the first Tab from a fresh load reveals it, it reads "Skip to content", activating it
 * moves **focus** to the layout's single `<main id="main-content">` and not merely the scroll
 * position, and the next Tab lands inside the page rather than back at the top of the header.
 *
 * ### 5. The hotspot popovers — `src/components/editorial/hotspot.tsx`
 *
 * Shop-the-look. The trigger is a `Link` wrapped by `Popover.Trigger asChild`, which is one control
 * that both navigates and discloses; confirm Enter and Space do the right and distinct things, that
 * Escape closes the popover without following the link, and that focus returns to the hotspot
 * afterwards. On a lookbook page, confirm the hotspots are reachable in a sensible order rather than
 * in whatever order their absolute positions imply.
 *
 * ### 6. Announcements, of which axe can only see the markup
 *
 * Several live regions sit inside the flows above — add-to-bag's notice, the catalogue's result count,
 * the product page's stock line, and the bag's `CART_COPY.revalidated`. `aria-live` being present is
 * not the same as the text changing in a way a screen reader speaks. Verify each with a real screen
 * reader, and verify the `focus-visible` outline's own contrast against every ground it lands on —
 * including the translucent one the wishlist button and the badge share over a photograph, where the
 * ground is a garment rather than a token and no contrast rule can be computed at all.
 */
