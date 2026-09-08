'use server'

import { redirect } from 'next/navigation'

import { getCustomer } from '@/lib/auth/session'
import { PREFLIGHT_COPY, type PreflightFailure } from '@/lib/checkout/rules'

import type { CheckoutActionState } from './action-state'
import { runPreflight, type CheckoutContact } from './preflight'
import { createCheckoutSession } from './session'

/**
 * **The one action that starts a payment** — plan §17.1a's eleven steps, run in order, followed by a
 * redirect to Stripe.
 *
 * The browser sends an email, an address and a **shipping method id**. It sends no amount, no total
 * and no promotion — those are read from the database inside preflight, which is what §17.1b's
 * *"never accept a client-provided total"* means when there is nothing to accept.
 *
 * ### A failure here is a refusal, not an error page
 *
 * Every one of §17.1a's steps can fail for a reason the customer can do something about: a code that
 * expired while they were typing, a size that sold out, an address we do not deliver to. Each returns
 * a sentence and leaves them on the page with their details still filled in. The one exception is a
 * bag that changed underneath them, which sends them back to look at it — because the honest response
 * to *"this is not what you were shown"* is to show them what it is now.
 *
 * ### The redirect is outside the try, deliberately
 *
 * `redirect()` works by throwing. Catching around it would swallow the redirect and report it as a
 * checkout failure, which is a bug this pattern invites — so the session is created, checked, and
 * only then redirected to.
 */
function failure(reason: PreflightFailure): CheckoutActionState {
  return {
    error: PREFLIGHT_COPY[reason],
    field:
      reason === 'addressUnsupported' || reason === 'invalidAddress'
        ? 'address'
        : reason === 'noShippingMethod'
          ? 'method'
          : null,
  }
}

const text = (form: FormData, key: string): string => (form.get(key)?.toString() ?? '').trim()

export async function startCheckoutAction(
  _previous: CheckoutActionState,
  formData: FormData,
): Promise<CheckoutActionState> {
  const contact: CheckoutContact = {
    email: text(formData, 'email'),
    shippingAddress: {
      city: text(formData, 'city'),
      country: text(formData, 'country'),
      firstName: text(formData, 'firstName'),
      lastName: text(formData, 'lastName'),
      line1: text(formData, 'line1'),
      line2: text(formData, 'line2') || null,
      phone: text(formData, 'phone') || null,
      postalCode: text(formData, 'postalCode'),
      region: text(formData, 'region') || null,
    },
    shippingMethodId: text(formData, 'shippingMethod'),
  }

  const customer = await getCustomer()
  const preflight = await runPreflight(customer?.id ?? null, contact)

  if (!preflight.ok) {
    if (preflight.reason === 'totalMismatch' || preflight.reason === 'lineUnavailable') {
      redirect('/cart?changed=1')
    }

    return failure(preflight.reason)
  }

  const session = await createCheckoutSession(preflight)

  if (!session.ok) {
    return { error: PREFLIGHT_COPY.stripeUnconfigured, field: null }
  }

  redirect(session.url)
}
