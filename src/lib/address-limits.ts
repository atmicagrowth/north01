/**
 * **How long each line of an address may be** — plan §34, audit R1-24.
 *
 * One table read by the schema (`payload/fields/address.ts`, where Payload refuses a longer value),
 * by checkout preflight (which answers with the address message rather than failing on the write)
 * and by the two forms (so the browser stops the typing before either). Payload's default for a text
 * field is 40,000 characters; these are sized to real addresses with room to spare.
 *
 * `country` is not here: it is exactly two letters and says so itself.
 */
export const ADDRESS_MAX_LENGTH = {
  city: 100,
  company: 100,
  firstName: 100,
  lastName: 100,
  line1: 200,
  line2: 200,
  phone: 32,
  postalCode: 20,
  region: 100,
} as const

export type BoundedAddressField = keyof typeof ADDRESS_MAX_LENGTH

/** Whether every bounded field that is present fits. Absent and null values fit. */
export function addressFits(address: Partial<Record<BoundedAddressField, null | string>>): boolean {
  return (Object.keys(ADDRESS_MAX_LENGTH) as BoundedAddressField[]).every(
    (name) => (address[name] ?? '').trim().length <= ADDRESS_MAX_LENGTH[name],
  )
}
