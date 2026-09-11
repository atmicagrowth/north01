import 'server-only'

import { unstable_rethrow } from 'next/navigation'
import { cache } from 'react'

import { getCustomer } from '@/lib/auth/session'
import { getCart } from '@/lib/cart/cart'
import { reportFailure } from '@/lib/observability/report'

/**
 * **The shell's two per-visitor reads, which may fail without taking the shop with them.**
 *
 * Plan §31.1a, measured in Phase 31 by pointing a server at a database that refused it: every route
 * answered a bare 500 — including `/help/faq`, whose own content had nothing to do with the database
 * being down. The root layout and the header both read the signed-in customer and the bag for the
 * badge, those reads threw, and an error in the root layout is one no boundary inside it can catch.
 * The navigation and SEO defaults already fell back (`getShell`, `getSeoDefaults`); these two did not.
 *
 * Now a failure here means *no badge and a signed-out shell*, and the page underneath gets its chance:
 * if it needs the database too, `(frontend)/error.tsx` renders inside the header and footer, which is
 * the whole difference between an outage and a blank page.
 *
 * `failed` is passed to the cart drawer so an unreadable bag says so (`CART_COPY.failed`) instead of
 * claiming to be empty. `cache()` makes the layout, the header and the drawer one read, and one
 * failure, per render.
 */
export const getShellSession = cache(async () => {
  try {
    const customer = await getCustomer()
    const cart = await getCart(customer?.id ?? null)

    return { cart, customer, failed: false }
  } catch (error) {
    /*
     * Next's own interrupts first. `cookies()` and `headers()` throw a dynamic-usage signal while a
     * route is being prerendered, and `notFound()`/`redirect()` throw too; swallowing them turned
     * per-visitor routes into static ones with a signed-out, empty-bag shell baked in. Phase 31's
     * build caught exactly that on /help/faq and /collections.
     */
    unstable_rethrow(error)

    /* Logged, not swallowed — the same rule `getShell` follows: a degraded shell is invisible on the page. */
    console.error(
      '[shell] The customer or bag could not be read; rendering a signed-out shell.',
      error,
    )
    reportFailure(error, 'shell', { read: 'session' })

    return { cart: null, customer: null, failed: true }
  }
})
