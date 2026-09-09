'use client'

import { useActionState } from 'react'

import type { AddressActionState } from '@/lib/account/addresses'

import { Button } from '@/components/ui/button'
import { addAddressAction, removeAddressAction } from '@/lib/account/addresses'

/**
 * **The address book's two controls** — plan §20.1d's `/account/addresses`.
 *
 * Real `<form action={…}>` elements with a server action, so both work before hydration and neither
 * needs a fetch. `AddToBag` set that pattern in Phase 14 and the reasoning carries: the browser is
 * told an id and some strings, and the server decides everything.
 *
 * The notice is an `aria-live` region rather than a toast, matching the only shipped precedent — the
 * `Toast` primitive exists in the design system and has no production consumer, and this is not the
 * feature to introduce it with.
 */

const IDLE: AddressActionState = { notice: null, ok: true }

const FIELDS = [
  { autoComplete: 'given-name', label: 'First name', name: 'firstName', required: true },
  { autoComplete: 'family-name', label: 'Last name', name: 'lastName', required: true },
  { autoComplete: 'organization', label: 'Company', name: 'company', required: false },
  { autoComplete: 'address-line1', label: 'Address', name: 'line1', required: true },
  { autoComplete: 'address-line2', label: 'Address line 2', name: 'line2', required: false },
  { autoComplete: 'address-level2', label: 'City', name: 'city', required: true },
  { autoComplete: 'address-level1', label: 'Region', name: 'region', required: false },
  { autoComplete: 'postal-code', label: 'Postcode', name: 'postalCode', required: true },
  { autoComplete: 'country-name', label: 'Country', name: 'country', required: true },
  { autoComplete: 'tel', label: 'Phone', name: 'phone', required: false },
] as const

export function AddAddressForm() {
  const [state, action, pending] = useActionState(addAddressAction, IDLE)

  return (
    <form action={action} className="flex flex-col gap-m">
      <div className="grid gap-m sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label className="flex flex-col gap-1" key={field.name}>
            <span className="font-sans text-micro uppercase text-foreground-muted">
              {field.label}
              {field.required ? '' : ' (optional)'}
            </span>
            <input
              autoComplete={field.autoComplete}
              className="border border-border-control bg-surface px-3 py-2 font-sans text-body-sm text-foreground"
              name={field.name}
              required={field.required}
              type="text"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center gap-m">
        <Button disabled={pending} size="lg" type="submit" variant="primary">
          Save address
        </Button>

        <p aria-live="polite" className="font-sans text-body-sm text-foreground-muted">
          {state.notice}
        </p>
      </div>
    </form>
  )
}

/**
 * Remove is its own form so it carries no address data at all — only an id, which the server then
 * scopes to the session's own customer before deleting anything.
 */
export function RemoveAddressButton({ addressId }: { addressId: number }) {
  const [, action, pending] = useActionState(removeAddressAction, IDLE)

  return (
    <form action={action}>
      <input name="addressId" type="hidden" value={addressId} />
      <button
        className="font-sans text-micro uppercase text-foreground-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        Remove
      </button>
    </form>
  )
}
