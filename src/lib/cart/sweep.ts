import 'server-only'

import type { Payload } from 'payload'

/**
 * **Expired bags are deleted** — plan §34.1c data minimisation, audit R1-27.
 *
 * `Carts.expiresAt` was added so that a sweep was possible, and no phase ever ran one: every visit
 * that put something in a bag left a row — and its lines — forever. An anonymous bag is still personal
 * data by association (it sits beside a cookie, a time and what someone considered buying), and
 * keeping it past the thirty days it can be used serves nobody.
 *
 * Only `active` bags past their expiry. A `converted` bag is the order's history and is not touched.
 * An order that pointed at a swept bag keeps its snapshot; the relationship clears (`Orders.ts`
 * already documents that the link lives "while that bag still exists"), and a Stripe Checkout
 * Session lives 24 hours, far inside the thirty days.
 *
 * Bounded per run so one invocation stays well inside a function's time limit; a backlog clears over
 * successive days. Deleting through Payload runs `Carts.beforeDelete`, which removes the lines first.
 */
export const CART_SWEEP_BATCH = 200

export async function sweepExpiredCarts(
  payload: Payload,
  now: Date = new Date(),
  batch: number = CART_SWEEP_BATCH,
): Promise<{ deleted: number; more: boolean }> {
  const expired = await payload.find({
    collection: 'carts',
    depth: 0,
    limit: batch,
    overrideAccess: true,
    select: {},
    sort: 'expiresAt',
    where: {
      and: [{ status: { equals: 'active' } }, { expiresAt: { less_than: now.toISOString() } }],
    },
  })

  const ids = expired.docs.map((cart) => cart.id)

  if (ids.length === 0) return { deleted: 0, more: false }

  const result = await payload.delete({
    collection: 'carts',
    overrideAccess: true,
    where: { id: { in: ids } },
  })

  if (result.errors.length > 0) {
    payload.logger.error({
      errors: result.errors.length,
      msg: 'Cart sweep: some bags were not deleted',
    })
  }

  return { deleted: result.docs.length, more: ids.length === batch }
}
