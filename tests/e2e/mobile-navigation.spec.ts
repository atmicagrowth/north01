/**
 * **Plan §27.1c flow 12 — mobile navigation.**
 *
 * This file's **name is load-bearing**. `playwright.config.ts` gives the `mobile` project a
 * `testMatch` of `/mobile-navigation\.spec\.ts/` and the `chromium` project the matching
 * `testIgnore`, so these tests run once, on a Pixel 7 profile, and nothing else does. Renaming the
 * file would silently move it to a desktop viewport where the whole mobile bar is `lg:hidden` and
 * every assertion below would fail for the wrong reason.
 *
 * ---
 *
 * ### Why this suite went unrun until Phase 35
 *
 * *Status: first run in Phase 35 — 43 passed, 0 failed, 14 skipped, against a local production
 * build of the development database (`docs/TESTING.md`). What follows is why it had not run before.*
 *
 * An end-to-end run needs a running application, and a running application here needs a database it
 * may write to. `TODO.md` §1 records that the only reachable one is **production**, and decision
 * **D-10** forbids pointing a writing harness at it. So this file is checked in **unrun**, written
 * from the source of the components it drives — `layout/site-header.tsx`, `shell/header-bar.tsx`,
 * `layout/mobile-nav.tsx`, `ui/drawer.tsx`, `shell/overlay-context.tsx`, `shell/cart-drawer.tsx` and
 * `shell/search-overlay.tsx` — and every selector, label and sentence below was read out of `src/`.
 *
 * Of the specs in `tests/e2e/`, this is the one that **writes nothing**: it opens panels, expands a
 * group and follows a link. It is therefore the one most likely to be the first to run once a
 * database exists.
 *
 * ### What is asserted, and why these things rather than a screenshot
 *
 * §9's acceptance criterion is a statement about *state*, not appearance:
 *
 * > A user can open/close search, mobile menu, and cart from any major route without navigation
 * > state conflicts.
 *
 * and §9.1c lists what the drawer owes: no accidental navigation while expanding, a close control,
 * Escape, a focus trap, focus restoration and scroll containment. Each of those is a **sequence** —
 * a thing that can only go wrong between two events — which is exactly what a rendering test cannot
 * see, and what the visual guide is not the authority on.
 *
 * ### What is deliberately not asserted: mutual exclusion, by clicking
 *
 * `overlay-context.tsx` holds one variable and at most one overlay name, so "open the cart" *is*
 * "close whatever else was open". The obvious test — open the menu, then click the bag — cannot be
 * written, and it cannot be written for a **good** reason: `Drawer` is Radix's modal dialog, so
 * while the menu is open the header behind it is inert and a customer genuinely cannot reach the bag
 * trigger. The exclusion is real and unreachable from this surface. What *is* reachable, and is
 * asserted below, is the focus containment and restoration that make it unreachable.
 */

import { CART_COPY, expect, NAME, ROUTE, slot, test } from './fixtures'

test.describe('§27.1c flow 12 — mobile navigation on a real mobile viewport', () => {
  test('the mobile bar carries the three actions structure §3 names, and moves the other two into the drawer', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)

    const header = slot(page, 'siteHeader')

    await test.step('menu, search and bag are in the bar', async () => {
      await expect(header.getByRole('button', { name: NAME.menuTrigger })).toBeVisible()
      await expect(header.getByRole('button', { name: NAME.searchTrigger })).toBeVisible()

      /* `NAME.bag` is `/^Bag/` rather than a string: `CartTrigger`'s label is "Bag" at zero and
         "Bag, 3 items" above it, and an unanchored "Bag" would also match "Add to bag". */
      await expect(header.getByRole('button', { name: NAME.bag })).toBeVisible()
    })

    await test.step('account and wishlist are not, because §3 refuses to crowd a 390px bar', async () => {
      /*
       * Both are rendered with `hidden lg:inline-flex`, so they exist in the DOM and must not be
       * *visible* here. `toBeHidden()` rather than `toHaveCount(0)` is the difference between
       * asserting the responsive rule and asserting the markup was deleted.
       *
       * Scoped to the header on purpose: the same two labels appear inside the drawer, which is the
       * whole point of a later test.
       */
      await expect(header.getByRole('link', { name: NAME.accountLink })).toBeHidden()
      await expect(header.getByRole('link', { name: NAME.wishlistLink })).toBeHidden()
    })
  })

  test('opening the menu discloses a panel and does not navigate — §9.1c', async ({ page }) => {
    await page.goto(ROUTE.home)

    const trigger = page.getByRole('button', { name: NAME.menuTrigger })
    const menu = page.getByRole('dialog', { name: NAME.menuDialog })

    await test.step('the trigger announces itself as a disclosure before it is used', async () => {
      /*
       * `DrawerTrigger asChild` gives the `IconButton` Radix's own `aria-haspopup`/`aria-expanded`.
       * That pairing is not decoration here — `overlay-context.tsx` records the Phase 9 audit
       * finding that a screen-reader user tabbing the header heard "Search, button" and "Bag,
       * button" with no indication that either opened a dialog, and that axe reports nothing at all,
       * because `aria-haspopup` is an enhancement rather than a violation.
       */
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })

    await test.step('opening it changes state, not the route', async () => {
      const url = page.url()

      await trigger.click()

      await expect(menu).toBeVisible()
      expect(page.url()).toBe(url)

      /*
       * **Read by attribute, and that is not a shortcut past `getByRole`.** `Drawer` is Radix's
       * *modal* dialog, so mounting the content calls `hideOthers` and puts `aria-hidden="true"` on
       * everything outside the portal — the header included. A role query is defined to skip what is
       * hidden from the accessibility tree, so `getByRole` genuinely cannot see this button while
       * the panel is open, and asserting through it would time out for a correct reason.
       *
       * `button[aria-label="…"]` reads the exact attribute `IconButton` emits from its `label` prop,
       * which is the same string the role query matched a moment ago.
       */
      await expect(page.locator(`button[aria-label="${NAME.menuTrigger}"]`)).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })

    await test.step('and the rest of the document is hidden while it is open — §9.1c', async () => {
      /*
       * The other half of the paragraph above, stated as an assertion rather than as a caveat. This
       * is what §9.1c's *"focus trap"* actually buys a customer: while the menu is open, nothing
       * behind it is announceable or reachable, which is also **why** the mutual exclusion in
       * `overlay-context.tsx` cannot be provoked from this surface by clicking the bag.
       *
       * A role query returning nothing is exactly the right shape for that claim — the control is
       * still in the DOM, and it is no longer in the accessibility tree.
       */
      await expect(page.getByRole('button', { name: NAME.bag })).toHaveCount(0)
      await expect(page.getByRole('button', { name: NAME.searchTrigger })).toHaveCount(0)
    })

    await test.step('the panel is a named navigation landmark with its own scroll container', async () => {
      /* Not "Primary" — `desktop-nav.tsx` already claims that name, and two navigation landmarks
         called the same thing are indistinguishable in a landmark list. */
      await expect(menu.getByRole('navigation', { name: 'Site' })).toBeVisible()

      /* §9.1c's *"scroll containment"*: only the body scrolls, so the drawer's header and any footer
         stay put. The slot is the structure that makes that true. */
      await expect(slot(menu, 'drawerBody')).toBeVisible()
    })
  })

  test('tapping a group expands it and never navigates, and the group keeps an explicit landing row — §9.1c', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)
    await page.getByRole('button', { name: NAME.menuTrigger }).click()

    const menu = page.getByRole('dialog', { name: NAME.menuDialog })

    /* `accordion-trigger` is `components/ui/accordion.tsx`'s own slot. It is not in `fixtures.SLOT`,
       which is shared and holds only what more than one spec needs. */
    const groups = menu.locator('[data-slot="accordion-trigger"]')

    test.skip(
      (await groups.count()) === 0,
      'every primary navigation item in this environment is a bare destination with no columns, so ' +
        "§9.1c's hierarchical expansion has nothing to expand. This is CMS content, not code.",
    )

    const group = groups.first()

    /* The trigger's accessible name is the item's own label; the `Plus` beside it is `aria-hidden`. */
    const label = (await group.textContent())?.trim() ?? ''

    await test.step('the group header is a button, so a tap cannot navigate by accident', async () => {
      const url = page.url()

      await expect(group).toHaveAttribute('aria-expanded', 'false')
      await group.click()
      await expect(group).toHaveAttribute('aria-expanded', 'true')

      /*
       * **The requirement, stated as a URL that did not change.** §9.1c: *"no accidental navigation
       * while expanding."* The group header is an accordion trigger rather than a link precisely so
       * that tapping SHOP opens the group and never leaves the page — and the drawer stays open,
       * which a navigation would have closed.
       */
      expect(page.url()).toBe(url)
      await expect(menu).toBeVisible()
    })

    await test.step('the landing page for the group is an explicit row inside it', async () => {
      /*
       * The other half of the same decision: because the header does not navigate, the group's own
       * destination has to be reachable some other way, and `All {label}` is it. Without that row a
       * customer could expand SHOP and have no way at all to reach `/shop` itself.
       */
      await expect(menu.getByRole('link', { name: `All ${label}` })).toBeVisible()
    })
  })

  test('account and wishlist remain reachable from the mobile navigation — structure §3', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)
    await page.getByRole('button', { name: NAME.menuTrigger }).click()

    const menu = page.getByRole('dialog', { name: NAME.menuDialog })

    await test.step('both are in the drawer, pointing where utilityNav says', async () => {
      /*
       * The labels and hrefs come from `utilityNav` through `fixtures`, rather than being retyped:
       * that module exists because *"modelling them as content would let an editor delete the bag"*,
       * and a test that hard-coded "Wishlist" would keep passing after the label changed everywhere
       * else.
       */
      const account = menu.getByRole('link', { name: NAME.accountLink })
      const wishlist = menu.getByRole('link', { name: NAME.wishlistLink })

      await expect(account).toBeVisible()
      await expect(wishlist).toBeVisible()

      await expect(account).toHaveAttribute('href', ROUTE.account)
      await expect(wishlist).toHaveAttribute('href', ROUTE.wishlist)
    })
  })

  test('following a link closes the drawer behind it, so no panel is left over the page it opened', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)

    const trigger = page.getByRole('button', { name: NAME.menuTrigger })
    const menu = page.getByRole('dialog', { name: NAME.menuDialog })

    await trigger.click()
    await expect(menu).toBeVisible()

    const start = page.url()

    await test.step('follow the account row', async () => {
      /*
       * The utility rows are used rather than a CMS destination, because `utilityNav` always has two
       * and the `Navigation` global may legitimately have none. A signed-out visitor is redirected
       * from `/account` to sign in, which is why the assertion below is *"the URL changed"* rather
       * than a particular destination — the subject here is the drawer, not the guard.
       */
      await menu.getByRole('link', { name: NAME.accountLink }).click()
      await page.waitForURL((url) => url.toString() !== start)
    })

    await test.step('the drawer is gone, and its trigger agrees', async () => {
      /*
       * §9's *"without navigation state conflicts"*. Two mechanisms make this true and both must:
       * every row is wrapped in `DrawerClose`, and `overlay-context.tsx` closes everything on a
       * pathname change — the second being what also covers the browser's back button and a
       * `redirect()` from a server action, neither of which is a click on a link.
       *
       * The trigger's `aria-expanded` is asserted as well as the panel's absence, because a panel
       * that unmounted while its trigger still said `true` is the state a screen-reader user cannot
       * see and a sighted one cannot notice.
       */
      await expect(menu).toBeHidden()
      await expect(page.getByRole('button', { name: NAME.menuTrigger })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })
  })

  test('Escape closes the drawer and gives focus back to the control that opened it — WCAG 2.4.3', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)

    const trigger = page.getByRole('button', { name: NAME.menuTrigger })
    const menu = page.getByRole('dialog', { name: NAME.menuDialog })

    await trigger.click()
    await expect(menu).toBeVisible()

    await test.step('press Escape', async () => {
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    })

    await test.step('focus is on the trigger, not on the document body', async () => {
      /*
       * **The regression this test exists for.** `overlay-context.tsx` records it in full: Radix's
       * modal dialog restores focus to its `DialogTrigger`, these overlays are mounted beside the
       * footer with no trigger in their own subtree, so `triggerRef` was `null` and focus dropped to
       * `document.body` every time — silent, invisible in the markup, and a WCAG 2.4.3 failure that
       * two clean axe sweeps could not see, because axe reads one static DOM and this is a sequence.
       *
       * `handleCloseAutoFocus` plus `registerTrigger` is the fix, and this is the only automated
       * assertion in the repository that it still holds.
       */
      await expect(trigger).toBeFocused()
    })
  })

  test('the close control closes it too, because Escape is not a control a touch user has', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)
    await page.getByRole('button', { name: NAME.menuTrigger }).click()

    const menu = page.getByRole('dialog', { name: NAME.menuDialog })

    await expect(menu).toBeVisible()

    await test.step('press the drawer close button', async () => {
      /* §9.1c asks for a *"close control"* by name, and it is separate from Escape for the reason
         this test's title gives: on the viewport this project actually mobile-tests, there is no
         keyboard. `DrawerContent` renders it as an `IconButton` labelled "Close". */
      await menu.getByRole('button', { name: NAME.close }).click()
      await expect(menu).toBeHidden()
    })
  })

  test('search opens from the mobile bar and returns focus when it closes — §9.1b', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)

    const trigger = page.getByRole('button', { name: NAME.searchTrigger })
    const panel = page.getByRole('dialog', { name: NAME.searchDialog })

    await test.step('open it', async () => {
      await trigger.click()
      await expect(panel).toBeVisible()

      /*
       * The panel's *contents* are Phase 12's and its chrome is Phase 9's, so both are asserted: the
       * slot proves `SearchPanel` mounted at all, and the combobox proves it is the real ARIA 1.2
       * widget rather than the placeholder Phase 9 shipped while `/search` did not exist (DEV-37).
       */
      await expect(slot(panel, 'searchPanel')).toBeVisible()
      await expect(panel.getByRole('combobox', { name: NAME.searchInput })).toBeVisible()
    })

    await test.step('close it', async () => {
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(trigger).toBeFocused()
    })
  })

  test('the bag opens from the mobile bar and is honest about being empty — §9.1d', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)

    const trigger = slot(page, 'siteHeader').getByRole('button', { name: NAME.bag })
    const bag = page.getByRole('dialog', { name: NAME.cartDialog })

    await test.step('open it', async () => {
      await trigger.click()
      await expect(bag).toBeVisible()

      /*
       * A fresh context has no cart cookie, so this is the empty rendering. The sentences come from
       * `CART_COPY` rather than being retyped, and the empty branch is worth asserting because it is
       * the one most visitors see and the one where a broken drawer looks identical to a working
       * one.
       */
      await expect(bag.getByText(CART_COPY.empty)).toBeVisible()
      await expect(bag.getByText(CART_COPY.emptyDetail)).toBeVisible()
    })

    await test.step('an empty bag offers no checkout, because there is nothing to check out', async () => {
      /*
       * `CartDrawer` renders its pinned footer only when `lines.length > 0 && cart`. A Checkout
       * button over an empty bag would be §0.1.17's fake control, and `/checkout` would bounce it
       * straight back to `/cart` — the same rule stated twice, in two files.
       */
      await expect(bag.getByRole('link', { name: NAME.checkout })).toHaveCount(0)
      await expect(bag.getByRole('link', { name: NAME.viewBag })).toHaveCount(0)
    })

    await test.step('close it', async () => {
      await page.keyboard.press('Escape')
      await expect(bag).toBeHidden()
      await expect(trigger).toBeFocused()
    })
  })

  test('the skip link is the first thing a keyboard reaches on a mobile page too — WCAG 2.4.1', async ({
    page,
  }) => {
    await page.goto(ROUTE.home)

    await test.step('the first Tab lands on it', async () => {
      await page.keyboard.press('Tab')

      /*
       * `site-header.tsx` puts it before the announcement bar as well as before the header, because
       * a promotional line is also a block to bypass. It is `sr-only` until `focus-visible`, so no
       * axe scan could ever have seen it — `accessibility.spec.ts` lists it under the manual review
       * still owed, and this closes the first half of that item.
       *
       * The second half — activating it moves *focus* into `<main id="main-content">`, not only the
       * scroll position — became a promise in Phase 36 (audit R2-16), when `<main>` gained
       * `tabIndex={-1}`, so it is asserted below.
       */
      await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
    })

    await test.step('activating it moves focus into the main content', async () => {
      await page.keyboard.press('Enter')
      await expect(page.locator('main#main-content')).toBeFocused()
    })
  })

  test('the panels open from a route that is not the homepage, which is the whole of §9.1d', async ({
    page,
  }) => {
    /*
     * *"Global cart drawer must work from every page"*, and §9's criterion says the same of all
     * three: *"from any major route"*. The drawer and the search dialog are mounted once in the root
     * layout precisely so that is true by construction — but "by construction" is a claim about a
     * file, and this is the one route other than `/` where it is checked.
     */
    await page.goto(ROUTE.shop)

    const menu = page.getByRole('dialog', { name: NAME.menuDialog })

    await test.step('the menu opens on /shop', async () => {
      await page.getByRole('button', { name: NAME.menuTrigger }).click()
      await expect(menu).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    })

    await test.step('and so does the bag', async () => {
      await slot(page, 'siteHeader').getByRole('button', { name: NAME.bag }).click()
      await expect(page.getByRole('dialog', { name: NAME.cartDialog })).toBeVisible()
    })
  })
})
