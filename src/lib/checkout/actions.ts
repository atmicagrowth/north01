'use server'

import { redirect } from 'next/navigation'

import { getCustomer } from '@/lib/auth/session'
import { PREFLIGHT_COPY, type PreflightFailure } from '@/lib/checkout/rules'
import { reportFailure } from '@/lib/observability/report'

import type { CheckoutActionState } from './action-state'
import { runPreflight, type CheckoutContact, type PreflightResult } from './preflight'
import { createCheckoutSession, type SessionResult } from './session'

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
 * bag that changed underneath them, which sends them back to look at it.
 *
 * **Phase 36 (audit R1-03):** an *unexpected* failure is a refusal too. Preflight and session creation
 * are wrapped, and anything they throw — a database error, a transition the order hook refused —
 * becomes `checkoutFailed`'s sentence instead of an uncaught error on the last click before paying.
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

function unexpected(error: unknown, step: string): CheckoutActionState {
  console.error(`Checkout failed unexpectedly during ${step}.`, error)
  reportFailure(error, 'checkout.action', { step })

  return failure('checkoutFailed')
}

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

  let preflight: PreflightResult

  try {
    const customer = await getCustomer()

    preflight = await runPreflight(customer?.id ?? null, contact)
  } catch (error) {
    return unexpected(error, 'preflight')
  }

  if (!preflight.ok) {
    if (preflight.reason === 'sessionExpired') {
      redirect('/login?next=%2Fcheckout&expired=1')
    }

    if (preflight.reason === 'totalMismatch' || preflight.reason === 'lineUnavailable') {
      redirect('/cart?changed=1')
    }

    return failure(preflight.reason)
  }

  let session: SessionResult

  try {
    session = await createCheckoutSession(preflight)
  } catch (error) {
    return unexpected(error, 'session creation')
  }

  if (!session.ok) {
    return { error: PREFLIGHT_COPY.stripeUnconfigured, field: null }
  }

  redirect(session.url)
}
