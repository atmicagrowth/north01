/**
 * **Plan §27.1c — the shared fixtures the E2E specs in this directory import.**
 *
 * Not a spec: there are no tests in this file. It holds the three things a suite of twelve flows
 * must not restate twelve times — **where the routes are**, **how to name a control**, and **the
 * four or five sequences every flow opens with** — so that when a `data-slot` or a sentence of copy
 * changes, one file changes with it rather than twelve.
 *
 * ### Why this suite went unrun until Phase 35
 *
 * *Status: first run in Phase 35 — 43 passed, 0 failed, 14 skipped, against a local production
 * build of the development database (`docs/TESTING.md`). What follows is why it had not run before.*
 *
 * Every helper below was written by reading `src/`, and none of it has been run. An E2E suite needs
 * a running application, a running application needs a database it may write to, and `TODO.md` §1
 * records that the only reachable one is **production** — the development Neon endpoint still
 * refuses the supplied password. Decision **D-10** exists to stop a writing harness pointing at
 * production, and this is the most destructive harness in the repository: `registerNewCustomer`
 * creates a real customer row, `addFirstAvailableVariantToBag` writes a real cart line, and §27.1c's
 * flow 6 opens a real Stripe Checkout session.
 *
 * So the correctness of this file rests on the source rather than on a green run. Every selector is
 * a `data-slot` that exists in `src/components`, an ARIA role with the accessible name the component
 * actually supplies, or a label a form actually renders. **Nothing here is guessed.** Where the
 * application could not supply a durable anchor, no helper was written — a helper that guesses is
 * worse than no helper, because it fails in a way that blames the shop rather than the harness.
 *
 * The first green run is owed to the first non-production database.
 *
 * ### Two environment assumptions a first run must check
 *
 * 1. **Turnstile must be unconfigured, or configured with Cloudflare's always-passes test keys.**
 *    `registerNewCustomer` and `signIn` post to Server Actions that call `publicFormRefusal` first
 *    (`lib/security/guard.ts`, plan §26.1a). With no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` the widget is
 *    not rendered and nothing is verified — `TODO.md` §7 states that plainly — so the forms accept a
 *    harness. With **live** keys they fail closed, and every spec that signs in fails at the form
 *    rather than at the thing it was testing.
 * 2. **`E2E_BASE_URL` must name that non-production deployment.** `playwright.config.ts` falls back
 *    to `http://localhost:3000`, and a local server reads whatever `DATABASE_URL` holds.
 */

import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { CART_COPY } from '@/lib/cart/rules'
import { SEARCH_COPY, SEARCH_PATH } from '@/lib/catalog/search'
import { LOOK_COPY } from '@/lib/lookbook/rules'
import { utilityNav } from '@/lib/navigation/utility'
import { PASSWORD_MIN_LENGTH } from '@/lib/password-policy'
import { REVIEW_COPY, REVIEW_SECTION_COPY } from '@/lib/reviews/rules'
import { WISHLIST_COPY, WISHLIST_EMPTY_COPY } from '@/lib/wishlist/rules'

/**
 * `test` and `expect` come from here rather than from `@playwright/test` directly, so a spec has one
 * import line and so this file stays the single place a Playwright fixture could later be added.
 * They are Playwright's own, unextended — there is no custom fixture yet, and inventing one before a
 * spec needs it would be scaffolding nobody has asked for.
 */
export { expect, test }

/**
 * **The copy constants, re-exported so no spec retypes a sentence.**
 *
 * Asserting on a string literal typed into a spec is asserting that two people wrote the same words,
 * which is a test of the spec author's memory. Asserting on the constant the component renders is a
 * test of the application: the day `CART_COPY.empty` is reworded, the suite follows it instead of
 * going red for a reason that is not a defect.
 *
 * All five modules named in the brief are pure — no `server-only`, no environment, no Payload — so
 * importing them into a Node test process costs nothing and cannot fail at load. That was checked
 * rather than assumed: `lib/catalog/search.ts` reaches `./query` and `./resolve` with `import type`
 * only, and `lib/cart/rules.ts`'s single value import, `lib/money.ts`, is equally pure.
 */
export {
  CART_COPY,
  LOOK_COPY,
  REVIEW_COPY,
  REVIEW_SECTION_COPY,
  SEARCH_COPY,
  WISHLIST_COPY,
  WISHLIST_EMPTY_COPY,
}

/* -------------------------------------------------------------------------------------------------
 * Routes
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every route a flow in §27.1c or §27.1d visits, read from `src/app/(frontend)/`.
 *
 * `search`, `account` and `wishlist` are taken from the application's own constants rather than
 * retyped: `SEARCH_PATH` is what the search panel's `<form action>` posts to, and `utilityNav` is
 * what the header links to. The rest are directory names, which are the URL by construction —
 * `(auth)` and `(frontend)` are route groups and add no segment, so `/login` really is top-level.
 */
export const ROUTE = {
  account: utilityNav.account.href,
  cart: '/cart',
  checkout: '/checkout',
  checkoutCancelled: '/checkout/cancelled',
  checkoutSuccess: '/checkout/success',
  forgotPassword: '/forgot-password',
  home: '/',
  journal: '/journal',
  login: '/login',
  lookbook: '/lookbook',
  orders: '/account/orders',
  register: '/register',
  search: SEARCH_PATH,
  shop: '/shop',
  wishlist: utilityNav.wishlist.href,
} as const

/** `/product/<slug>`, for `page.waitForURL`. The slug is never hard-coded; a spec navigates to it. */
export const PRODUCT_URL = /\/product\//

/* -------------------------------------------------------------------------------------------------
 * Selectors
 * ---------------------------------------------------------------------------------------------- */

/**
 * **The `data-slot` map.** Every entry was found by grepping `src/` for `data-slot`, and the file
 * that renders it is named beside it — so a spec that fails on a missing slot has one place to look.
 *
 * `data-slot` is preferred over a class name because it is the project's own deliberate hook: the
 * classes are Tailwind utilities that change whenever the design does, and these attributes do not.
 * It is still third in the order this project prefers, behind a role with an accessible name and a
 * form label — see `NAME` below — because a role assertion also asserts that the control is
 * reachable by assistive technology, and a `data-slot` asserts only that an element exists.
 */
export const SLOT = {
  /* Shell — components/layout/announcement-bar.tsx, site-footer.tsx, page-title.tsx, shell/header-bar.tsx */
  announcementBar: '[data-slot="announcement-bar"]',
  pageTitle: '[data-slot="page-title"]',
  siteFooter: '[data-slot="site-footer"]',
  siteHeader: '[data-slot="site-header"]',

  /* Overlays — components/ui/drawer.tsx, components/shell/search-panel.tsx */
  drawerBody: '[data-slot="drawer-body"]',
  drawerContent: '[data-slot="drawer-content"]',
  drawerFooter: '[data-slot="drawer-footer"]',
  drawerTitle: '[data-slot="drawer-title"]',
  searchPanel: '[data-slot="search-panel"]',

  /* Catalogue — components/catalog/, components/home/product-tile.tsx */
  activeFilters: '[data-slot="active-filters"]',
  catalogEmpty: '[data-slot="catalog-empty"]',
  catalogToolbar: '[data-slot="catalog-toolbar"]',
  catalogUnavailable: '[data-slot="catalog-unavailable"]',
  filterPanel: '[data-slot="filter-panel"]',
  productCard: '[data-slot="product-card"]',
  productCardSkeleton: '[data-slot="product-card-skeleton"]',
  productGrid: '[data-slot="product-grid"]',
  /** The `<Suspense>` fallback, and a different slot from the grid — see `openFirstProduct`. */
  productGridSkeleton: '[data-slot="product-grid-skeleton"]',
  productTile: '[data-slot="product-tile"]',

  /* Product page — components/product/, components/cart/add-to-bag.tsx */
  addToBag: '[data-slot="add-to-bag"]',
  productDetails: '[data-slot="product-details"]',
  productGallery: '[data-slot="product-gallery"]',
  variantSelector: '[data-slot="variant-selector"]',

  /* Bag — components/cart/, components/shell/cart-drawer.tsx */
  cartCount: '[data-slot="cart-count"]',
  cartLine: '[data-slot="cart-line"]',
  cartStepper: '[data-slot="cart-stepper"]',
  cartSubtotal: '[data-slot="cart-subtotal"]',
  cartSummary: '[data-slot="cart-summary"]',
  discountApplied: '[data-slot="discount-applied"]',
  discountForm: '[data-slot="discount-form"]',
  shippingProgress: '[data-slot="shipping-progress"]',

  /* Checkout and the order — components/checkout/checkout-form.tsx, app/(frontend)/checkout/ */
  checkoutForm: '[data-slot="checkout-form"]',
  /** Rendered instead of the form when the deployment holds no Stripe keys — DEV-62. */
  checkoutUnavailable: '[data-slot="checkout-unavailable"]',
  orderNumber: '[data-slot="order-number"]',
  orderStatus: '[data-slot="order-status"]',
  orderSummary: '[data-slot="order-summary"]',
  orderTotal: '[data-slot="order-total"]',

  /* Forms and feedback — components/auth/, components/ui/, components/media/media-image.tsx */
  fieldMessage: '[data-slot="field-message"]',
  formStatus: '[data-slot="form-status"]',
  mediaPlaceholder: '[data-slot="media-placeholder"]',
  toast: '[data-slot="toast"]',
  toastViewport: '[data-slot="toast-viewport"]',
} as const

export type SlotName = keyof typeof SLOT

/**
 * A slot, as a locator, scoped to a page or to something already found.
 *
 * `slot(page, 'cartLine')` rather than `page.locator('[data-slot="cart-line"]')` for one reason: a
 * mistyped slot name is a compile error here and an empty locator there, and an empty locator fails
 * as a timeout that reads like the application is broken.
 */
export function slot(scope: Locator | Page, name: SlotName): Locator {
  return scope.locator(SLOT[name])
}

/**
 * **A card that can actually be bought.**
 *
 * `ProductCard` writes its own state to `data-state`, from `lib/catalog/resolve.ts`'s
 * `'available' | 'lowStock' | 'soldOut' | 'unavailable'`. The two listed here are the two with at
 * least one purchasable variant behind them.
 *
 * This is not tidiness. A sold-out product renders **every** size with `aria-disabled="true"` — the
 * selector keeps them focusable on purpose, so a keyboard user hears "sold out in this colour"
 * instead of having the option skipped — so `addFirstAvailableVariantToBag` would have nothing it is
 * allowed to click, and would fail on a product page behaving exactly as §13.1c specifies. A spec
 * that *wants* the sold-out case (§27.1d names it) should ask for `[data-state="soldOut"]`
 * explicitly rather than hope one turns up first.
 */
export const BUYABLE_PRODUCT_CARD =
  '[data-slot="product-card"][data-state="available"], [data-slot="product-card"][data-state="lowStock"]'

/**
 * **Accessible names, which are the anchors this project prefers over any attribute.**
 *
 * Each one is the string the component passes to `IconButton label`, renders as a `<Label>`, or puts
 * inside a `<button>`. Two carry a trap worth stating rather than discovering:
 *
 * - **`bag`** is a regular expression, not a string. `CartTrigger`'s label is `'Bag'` at zero and
 *   `Bag, 3 items` above it, so a plain string has to substring-match — and
 *   `getByRole('button', { name: 'Bag' })` then also matches **"Add to bag"** on every product page,
 *   which is a strict-mode failure in the middle of the most common flow in the suite. Anchored at
 *   the start it matches only the header control, and `openCartDrawer` additionally scopes to the
 *   header.
 * - **`colourGroup`** deliberately has no trailing text. `VariantSelector` labels the colour row
 *   "Color" and, once a colour is chosen, "Color — Bone", so the substring match is what makes one
 *   locator work in both states.
 */
export const NAME = {
  /* Header — components/shell/cart-drawer.tsx, search-overlay.tsx, components/layout/mobile-nav.tsx */
  accountLink: utilityNav.account.label,
  bag: /^Bag/,
  close: 'Close',
  menuTrigger: 'Open menu',
  searchTrigger: 'Search',
  wishlistLink: utilityNav.wishlist.label,

  /* Overlay accessible names — the `title` each DrawerContent / DialogContent is given */
  cartDialog: 'Bag',
  menuDialog: 'Menu',
  searchDialog: 'Search',
  /** The `sr-only` `<label for="site-search">` on the combobox inside the search panel. */
  searchInput: 'Search',
  /**
   * The `role="listbox"` the combobox owns. §27.1c flow 2 needs it: the panel's suggestions are
   * `role="option"` elements owned **directly** by the listbox or by one of its `role="group"`
   * sections, with no `<ul>`/`<li>` between them, so `getByRole('option')` inside this is the way to
   * reach one — not a list-item selector.
   */
  searchSuggestions: 'Search suggestions',

  /* Product page — components/product/variant-selector.tsx, components/cart/add-to-bag.tsx */
  addToBag: 'Add to bag',
  colourGroup: 'Color',
  quantity: 'Qty',
  sizeGroup: 'Size',

  /* Bag and checkout — components/shell/cart-drawer.tsx, app/(frontend)/cart/page.tsx */
  checkout: 'Checkout',
  continueShopping: 'Continue shopping',
  /** The one control on the empty `/cart` page. */
  startShopping: 'Start shopping',
  viewBag: 'View bag',

  /* Auth — components/auth/login-form.tsx, register-form.tsx, sign-out-button.tsx */
  createAccount: 'Create account',
  email: 'Email',
  firstName: 'First name',
  lastName: 'Last name',
  password: 'Password',
  signIn: 'Sign in',
  signOut: 'Sign out',

  /* Wishlist — components/wishlist/wishlist-button.tsx, which labels itself from WISHLIST_COPY */
  save: WISHLIST_COPY.save,
  saved: WISHLIST_COPY.saved,
} as const

/* -------------------------------------------------------------------------------------------------
 * Credentials
 * ---------------------------------------------------------------------------------------------- */

export type Credentials = {
  email: string
  firstName: string
  lastName: string
  password: string
}

/**
 * **A fresh address per call, so parallel runs cannot collide.**
 *
 * `playwright.config.ts` sets `fullyParallel: true` and leaves `workers` to Playwright outside CI, so
 * two registration specs really do run at once — and `customers.email` is unique, so a shared address
 * makes the second one fail with *"An account already uses that email address"*, which reads like a
 * defect in registration rather than a defect in the harness.
 *
 * A timestamp alone is not enough: two workers can start inside the same millisecond. `randomUUID` is
 * what actually makes it unique; the timestamp is there so a human reading a leftover row in the
 * database can tell when it was made.
 *
 * **`.test` is a reserved TLD (RFC 2606) and can never be delivered to.** That matters here rather
 * than being pedantry: `register` enqueues a real §19.1a welcome email, and a configured courier
 * would send it. A domain nobody owns cannot become mail to a stranger.
 */
export function uniqueEmail(prefix = 'e2e'): string {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)

  return `${prefix}-${stamp}-${randomUUID().slice(0, 8)}@north01.test`
}

/**
 * **A passphrase the server's own policy accepts, padded from the server's own constant.**
 *
 * `PASSWORD_MIN_LENGTH` is imported rather than the number 12 being retyped, so raising the floor in
 * `lib/password-policy.ts` cannot leave this suite quietly registering with a password the shop has
 * started refusing. `padEnd` is a no-op while the phrase is already long enough, which it is.
 *
 * It is deliberately not the email address — `RegisterSchema` refuses that combination outright, and
 * it is the one content rule the policy keeps.
 */
export const E2E_PASSWORD = 'north-01-e2e-passphrase'.padEnd(PASSWORD_MIN_LENGTH, '-')

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/shop` → the first product that can be bought.
 *
 * Navigates rather than hard-coding a slug, because a slug written into a spec is a slug that goes
 * stale the first time an editor unpublishes something — and §27.1c's flows say "product", not which
 * one.
 *
 * The wait is on `[data-slot="product-grid"]`, and that is load-bearing. `/shop` streams the grid
 * through a `<Suspense>` whose fallback is `[data-slot="product-grid-skeleton"]` — a **different**
 * slot, `aria-hidden="true"`, with no links in it. Waiting on this one waits for real cards instead
 * of for their placeholders.
 *
 * The click target is the card's link found by role, with no `.first()`: `ProductCard` contains
 * exactly one anchor by construction, because Phase 20 moved the wishlist heart **out** of it to
 * avoid a `<button>` inside an `<a>`. Strict mode is therefore an assertion here — if a second
 * interactive element ever reappears inside that link, this fails and says so.
 */
export async function openFirstProduct(page: Page): Promise<void> {
  await test.step('open the first buyable product from the shop', async () => {
    await page.goto(ROUTE.shop)

    const grid = slot(page, 'productGrid')

    await expect(grid).toBeVisible()

    await grid.locator(BUYABLE_PRODUCT_CARD).first().getByRole('link').click()

    await page.waitForURL(PRODUCT_URL)

    /* `product-page.tsx` gives the PDP its single `<h1>`: the product name. */
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
}

/**
 * Put one variant of the **currently open** product into the bag, and return the variant id it used.
 *
 * ### Why a size has to be chosen first
 *
 * §13.1c never preselects one, so `AddToBag` renders `blocked` — `variantId === null ||
 * maxQuantity <= 0` — until the customer picks. Choosing is a full server round trip:
 * `VariantSelector` commits `?size=` through `useUrlState` with `shallow: false`, and the server
 * re-resolves the variant, the price and the stock. That is why the wait afterwards is
 * `toBeEnabled()` **on the button** rather than anything timed — the button's disabled state is
 * precisely what that round trip changes.
 *
 * Sizes are optional in the data model (`VariantSelector` renders the row only when
 * `matrix.sizes.length > 0`), so the row is counted rather than assumed.
 *
 * `aria-disabled`, not `disabled`: unavailable sizes stay focusable on purpose, so the attribute is
 * present and `"false"` on the ones that can be chosen, and `:not([aria-disabled="true"])` is the
 * only correct way to ask for a selectable one.
 *
 * ### What the return value is for
 *
 * `AddToBag` posts a hidden `variantId` and nothing else — no price, no name, no availability, which
 * is §13.1d's *"never trust a client-submitted price"* satisfied by there being nothing to trust.
 * That input is also the only place the page states **which** variant is about to be added, and
 * `CartLineRow` writes the same id to `data-variant`, so a spec can assert on the exact line:
 *
 * ```ts
 * const variantId = await addFirstAvailableVariantToBag(page)
 * await expect(page.locator(`[data-slot="cart-line"][data-variant="${variantId}"]`)).toHaveCount(1)
 * ```
 *
 * ### The post-condition, and its one honest limitation
 *
 * `addToBagAction` calls `revalidatePath('/', 'layout')`, so the header badge is the **server**
 * confirming the line exists rather than the browser being optimistic about a click — the spine of
 * this project applied to a helper.
 *
 * The badge is only proof for the **first** add in a test: called twice, it is already visible and
 * the assertion passes without waiting for the second write. A spec that adds twice should assert on
 * the returned variant id, or on the badge's text, instead of trusting this step alone.
 */
export async function addFirstAvailableVariantToBag(page: Page): Promise<string> {
  return await test.step('choose the first selectable size and add it to the bag', async () => {
    const sizes = page.getByRole('radiogroup', { name: NAME.sizeGroup })

    if ((await sizes.count()) > 0) {
      await sizes.locator('[role="radio"]:not([aria-disabled="true"])').first().click()
    }

    const form = slot(page, 'addToBag')
    const addToBag = page.getByRole('button', { name: NAME.addToBag })

    await expect(addToBag).toBeEnabled()

    /*
     * Read **before** the click. The button becoming enabled is the proof that the server has
     * resolved a variant, so the hidden input holds that variant's id from this moment on — and
     * after the click the page has re-rendered and the same read is a different question.
     */
    const variantId = await form.locator('input[name="variantId"]').inputValue()

    await addToBag.click()

    await expect(slot(page, 'cartCount')).toBeVisible()

    return variantId
  })
}

/**
 * Open the global bag drawer from the header, and return it.
 *
 * The trigger is scoped to `[data-slot="site-header"]` **and** matched with an anchored regular
 * expression, and the two do different jobs. The pattern keeps "Bag" and "Bag, 2 items" matching one
 * locator without also matching "Add to bag"; the header scope keeps it away from any other control
 * a page might grow whose name begins with "Bag".
 *
 * The drawer is found by role and name rather than by `[data-slot="drawer-content"]`, because the
 * mobile menu and the mobile filter sheet are the same primitive and would match that slot too.
 * `Bag` is the `title` `CartDrawer` passes to `DrawerContent`, which becomes the
 * `DialogPrimitive.Title` labelling the dialog — so this locator is also an assertion that the
 * drawer has an accessible name at all.
 *
 * Nothing here waits for the bag's **contents**. An empty drawer is a legitimate state with its own
 * copy (`CART_COPY.empty`), and a helper that insisted on lines could not be used to test it.
 */
export async function openCartDrawer(page: Page): Promise<Locator> {
  return await test.step('open the bag drawer from the header', async () => {
    const drawer = page.getByRole('dialog', { name: NAME.cartDialog })

    /*
     * Add to Bag opens the drawer itself (Phase 30), and while it is open the rest of the page —
     * the header included — is inert and hidden from the accessibility tree, which is the modal
     * doing its job. Already open is the state this helper exists to reach.
     */
    if (!(await drawer.isVisible())) {
      await slot(page, 'siteHeader').getByRole('button', { name: NAME.bag }).click()
    }

    await expect(drawer).toBeVisible()

    return drawer
  })
}

/**
 * Close the bag drawer if an add opened it, so the page behind it can be used again. Escape is the
 * dialog's own close, and what a keyboard user would press.
 */
export async function closeCartDrawerIfOpen(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: NAME.cartDialog })

  if (await drawer.isVisible()) {
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
  }
}

/**
 * Sign an existing customer in, through the real form.
 *
 * `exact: true` on both fields is not decoration. `getByLabel` substring-matches by default, the
 * footer renders on every route, and `newsletter-signup.tsx` labels its input *"Email address for
 * the newsletter"* — deliberately not "Email" — which a loose match would still find. Two matches is
 * a strict-mode failure rather than a useful assertion.
 *
 * The landing URL is `/account`: `login` ends in `redirect(next ?? '/account')`, and this helper
 * navigates to a bare `/login` with no `next`, so there is nothing to honour. A spec testing the
 * `?next=` return path should drive the form itself rather than reach for this.
 *
 * The Sign out button is the post-condition rather than the URL alone, because arriving at
 * `/account` without a session does not happen — `requireCustomer` would have sent it back to
 * `/login` — so a visible Sign out is the evidence that a real session cookie was set.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await test.step(`sign in as ${email}`, async () => {
    await page.goto(ROUTE.login)

    await page.getByLabel(NAME.email, { exact: true }).fill(email)
    await page.getByLabel(NAME.password, { exact: true }).fill(password)

    await page.getByRole('button', { name: NAME.signIn }).click()

    await page.waitForURL(/\/account$/)

    await expect(page.getByRole('button', { name: NAME.signOut })).toBeVisible()
  })
}

/**
 * Create a customer through the real registration form, and hand back the credentials it used.
 *
 * They are returned rather than fixed so a spec can sign the same customer back in — §27.1c flow 5's
 * *"guest cart → login → cart merge"* needs exactly that — without either the spec or this file
 * holding one shared account that two parallel workers would fight over.
 *
 * **Registration signs you in.** `register` performs a real `startSession` rather than minting a
 * token, then `claimGuestCart`, then `redirect(next ?? '/account')` — so the wait below is the same
 * as `signIn`'s. One branch lands elsewhere: where the account was created and the automatic sign-in
 * was not, the action redirects to `/login?registered=1` instead. A timeout here is therefore a real
 * signal about session creation rather than a flake, and the URL in the failure says which happened.
 *
 * The names are constants because no flow depends on them; only the email must be unique, and only
 * the password must satisfy the policy.
 */
export async function registerNewCustomer(page: Page): Promise<Credentials> {
  const credentials: Credentials = {
    email: uniqueEmail(),
    firstName: 'North',
    lastName: 'Tester',
    password: E2E_PASSWORD,
  }

  await test.step(`register ${credentials.email}`, async () => {
    await page.goto(ROUTE.register)

    await page.getByLabel(NAME.firstName, { exact: true }).fill(credentials.firstName)
    await page.getByLabel(NAME.lastName, { exact: true }).fill(credentials.lastName)
    await page.getByLabel(NAME.email, { exact: true }).fill(credentials.email)
    await page.getByLabel(NAME.password, { exact: true }).fill(credentials.password)

    await page.getByRole('button', { name: NAME.createAccount }).click()

    await page.waitForURL(/\/account$/)

    await expect(page.getByRole('button', { name: NAME.signOut })).toBeVisible()
  })

  return credentials
}
