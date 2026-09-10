import type { Metadata } from 'next'

import { AddAddressForm, RemoveAddressButton } from '@/components/account/address-book'
import { PageTitle } from '@/components/layout/page-title'
import { requireCustomer } from '@/lib/auth/session'
import { getPayloadClient } from '@/lib/payload'
import { privateMetadata } from '@/lib/seo/metadata'

export const metadata: Metadata = privateMetadata('Addresses')

/**
 * **`/account/addresses`** — plan §20.1d, and §7.1b's *"read/write their own addresses"*.
 *
 * ### Why this screen can add as well as read
 *
 * Checkout snapshots an address **onto the order** and never writes to `addresses`, because an
 * order's address must stay what was typed on the day. So `addresses` is empty until this screen puts
 * something in it — and a screen that could only ever render an empty state would be §0.1.17's fake
 * surface, a page that looks like a feature and cannot do anything.
 *
 * Editing in place is deliberately absent: an address is short enough that retyping is cheaper than
 * an edit form, and a half-built one is worse than none.
 *
 * ### The read is scoped, and the write cannot name an owner
 *
 * The query names the session's customer. The create carries no customer field at all —
 * `enforceCustomerOwnership` forces it, on create **and** on update, because Phase 7 recorded that
 * *"reassigning an existing row is the same attack a second later."*
 *
 * The phase prompt requires the zero state by name: *"missing addresses"*.
 */
export default async function AccountAddressesPage() {
  const customer = await requireCustomer('/account/addresses')

  const payload = await getPayloadClient()

  const { docs } = await payload.find({
    collection: 'addresses',
    depth: 0,
    limit: 50,
    overrideAccess: true,
    sort: '-createdAt',
    where: { customer: { equals: customer.id } },
  })

  return (
    <div className="flex flex-col gap-l">
      <PageTitle eyebrow="Account" size="display-l">
        Addresses
      </PageTitle>

      {docs.length === 0 ? (
        <p className="max-w-measure border-t border-border pt-6 font-sans text-body-sm text-foreground-muted">
          No saved addresses yet. Anything you save here is offered at checkout; the address on a
          past order stays exactly as it was on the day.
        </p>
      ) : (
        <ul className="flex flex-col border-t border-border">
          {docs.map((address) => (
            <li
              className="flex flex-wrap items-start justify-between gap-s border-b border-border py-5"
              key={address.id}
            >
              <address className="font-sans text-body-sm not-italic text-foreground">
                {[
                  `${address.firstName ?? ''} ${address.lastName ?? ''}`.trim(),
                  address.company,
                  address.line1,
                  address.line2,
                  address.city,
                  address.region,
                  address.postalCode,
                  address.country,
                ]
                  .filter((part) => typeof part === 'string' && part.length > 0)
                  .map((part) => (
                    <span className="block" key={String(part)}>
                      {String(part)}
                    </span>
                  ))}
              </address>

              <RemoveAddressButton addressId={address.id} />
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-m border-t border-border pt-6">
        <h2 className="font-sans text-meta uppercase text-foreground-muted">Add an address</h2>
        <AddAddressForm />
      </section>
    </div>
  )
}
