'use server'

import { revalidatePath } from 'next/cache'

import { getCustomer } from '@/lib/auth/session'
import { getPayloadClient } from '@/lib/payload'

/**
 * **The address book's two mutations** — plan §20.1d's `/account/addresses`, and §7.1b's
 * *"read/write their own addresses"*, which is one of exactly two things a customer may write.
 *
 * ### Why this screen has an add form at all
 *
 * Checkout snapshots an address **onto the order** and does not write to `addresses` — an order's
 * address must be what was typed on the day, permanently, even if the customer later edits their
 * book. That means `addresses` is empty until somebody puts something in it, and an address screen
 * that could only ever show an empty state would be §0.1.17's fake surface: a page that looks like a
 * feature and cannot do anything.
 *
 * So the minimum honest version is add and remove. Editing in place is deliberately absent: an
 * address is short enough that retyping it is cheaper than an edit form, and `isDefaultShipping` is
 * left to a later phase rather than half-built here.
 *
 * ### Ownership is forced, not asked for
 *
 * There is no customer id in the form. `enforceCustomerOwnership('customer')` on the collection
 * *forces* `data.customer` to the session's own id on create **and on update** — Phase 7 recorded
 * why: *"reassigning an existing row is the same attack a second later."* The delete is scoped by
 * customer id in the query for the same reason the wishlist's is.
 */

export type AddressActionState = { notice: null | string; ok: boolean }

const REQUIRED = ['firstName', 'lastName', 'line1', 'city', 'postalCode', 'country'] as const

export async function addAddressAction(
  _previous: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const customer = await getCustomer()

  if (!customer) {
    return { notice: 'Sign in to save an address.', ok: false }
  }

  const read = (name: string): string => String(formData.get(name) ?? '').trim()

  const missing = REQUIRED.filter((name) => read(name).length === 0)

  if (missing.length > 0) {
    /*
     * Named rather than counted. "Six fields are required" tells somebody staring at a form nothing
     * they did not already know; naming the empty ones tells them where to look.
     */
    return { notice: 'Add the missing details and try again.', ok: false }
  }

  const payload = await getPayloadClient()

  try {
    await payload.create({
      collection: 'addresses',
      data: {
        city: read('city'),
        company: read('company') || undefined,
        country: read('country'),
        customer: customer.id,
        firstName: read('firstName'),
        label: read('label') || undefined,
        lastName: read('lastName'),
        line1: read('line1'),
        line2: read('line2') || undefined,
        phone: read('phone') || undefined,
        postalCode: read('postalCode'),
        region: read('region') || undefined,
      } as never,
      overrideAccess: false,
      user: { ...customer, collection: 'customers' } as never,
    })
  } catch {
    return {
      notice: 'That address could not be saved. Check the details and try again.',
      ok: false,
    }
  }

  revalidatePath('/account/addresses')

  return { notice: 'Address saved.', ok: true }
}

export async function removeAddressAction(
  _previous: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const customer = await getCustomer()

  if (!customer) {
    return { notice: null, ok: false }
  }

  const id = Number(formData.get('addressId'))

  if (!Number.isSafeInteger(id) || id <= 0) {
    return { notice: null, ok: false }
  }

  const payload = await getPayloadClient()

  /*
   * Scoped by customer as well as by id. The collection's own ownership rule would refuse a
   * cross-account delete anyway; naming the customer here keeps the boundary visible in the code that
   * would otherwise be the one to violate it, exactly as the wishlist's remove does.
   */
  const { docs } = await payload.find({
    collection: 'addresses',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ customer: { equals: customer.id } }, { id: { equals: id } }] },
  })

  if (docs[0]) {
    await payload.delete({ collection: 'addresses', id: docs[0].id, overrideAccess: true })
  }

  revalidatePath('/account/addresses')

  return { notice: 'Address removed.', ok: true }
}
