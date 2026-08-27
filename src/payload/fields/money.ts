import type { NumberField, NumberFieldSingleValidation } from 'payload'

/**
 * **This validator is also responsible for `required`, and that is not obvious.** Payload installs its
 * built-in validator only when a field declares none — `sanitize.js`: `if (typeof field.validate ===
 * 'undefined')` — so supplying one replaces `validations.number` wholesale, and with it the checks
 * that enforce `required`, `min` and `max`. A money field that returned `true` for an absent value
 * would let a required price through Payload and fail later on the `NOT NULL` column, reporting a
 * database error instead of naming the field.
 */
const validateMinorUnits: NumberFieldSingleValidation = (value, { req: { t }, required }) => {
  if (value === null || value === undefined) {
    return required ? t('validation:required') : true
  }

  if (!Number.isInteger(value)) {
    return 'Enter a whole number of minor units — 1999 for 19.99, not 19.99.'
  }

  if (value < 0) {
    return 'Cannot be negative.'
  }

  if (!Number.isSafeInteger(value)) {
    return 'Out of range.'
  }

  return true
}

/**
 * `NumberField` is a union over `hasMany`, so `Omit` keeps only the keys both branches share —
 * which is exactly the single-value half, and exactly what a money column may be. `hasMany` money
 * is not a thing, and this makes writing it a type error rather than a code review.
 */
type MinorUnitsOverrides = Omit<
  NumberField,
  'hasMany' | 'maxRows' | 'minRows' | 'type' | 'validate'
> & {
  name: string
  validate?: NumberFieldSingleValidation
}

/**
 * Money, everywhere in this schema, is an integer count of the currency's minor unit.
 *
 * **Why not a decimal.** Payload's `type: 'number'` compiles to Postgres `numeric` — arbitrary
 * precision, exact — but the adapter reads it back through Drizzle's `numeric({ mode: 'number' })`,
 * which hands JavaScript a `Number`. A `Number` is a binary float, and `19.99` is not representable
 * in one. Storing exactly and reading approximately is the worse half of both designs: the database
 * would be right and every total computed from it would be a rounding argument.
 *
 * Integers avoid it completely. `1999` survives the round trip through `numeric` and through
 * `Number` unchanged — JavaScript is exact for integers below 2^53, which at two decimal places is
 * ninety trillion in the major unit — so a subtotal is integer addition and a percentage discount is
 * one deliberate rounding at one known place rather than an accumulating drift at every one.
 *
 * It is also what the payment authority speaks. Stripe's amounts are minor units; an order total
 * that is already `1999` is sent as `1999`, and the number that reaches Stripe is the number that
 * was stored. See plan §0.1.5 and §17.1b — the browser is never authoritative for a total, and the
 * server's total has to be a number that means exactly one thing.
 *
 * **The name carries the unit.** Every money column in this schema ends in `Minor`. It is uglier
 * than `price` and it is the point: a field called `price` holding `1999` is a bug waiting for
 * someone to divide by nothing, and no amount of documentation reaches the person writing
 * `product.price * quantity` at two in the morning.
 *
 * Formatting for display belongs to the presentation layer, with the cart's or order's own
 * `currency` code — never to the schema.
 */
export const minorUnits = (overrides: MinorUnitsOverrides): NumberField => ({
  type: 'number',
  min: 0,

  ...overrides,

  admin: {
    step: 1,
    ...overrides.admin,
    description:
      overrides.admin?.description ??
      'Minor units — 1999 is 19.99. Whole numbers only; no decimal point.',
  },

  /**
   * `min: 0` and `step: 1` are both admin-side conveniences, and neither is enforced by Payload once
   * this field supplies its own `validate` — see the note on `validateMinorUnits`. `step` governs the
   * input widget alone and nothing stops a REST client sending `19.99`; `numeric` would then store
   * `19.99` happily and every downstream integer assumption would quietly be wrong. So the integer
   * rule, the lower bound and the required check are all real validators below.
   *
   * An explicit `validate` in `overrides` wins — a field with a tighter rule of its own should not
   * have to restate this one, and none currently does.
   */
  validate: overrides.validate ?? validateMinorUnits,
})

/**
 * The currency of a *transaction*, recorded on the record that has one — a cart, an order, a
 * fixed-amount promotion.
 *
 * This is not multi-currency pricing, and the schema should not be read as offering it. Catalogue
 * prices are held in one currency, the one `site-settings.defaultCurrency` names; what a cart and
 * an order store is which currency the money on *that row* was denominated in, so a historical
 * order still reads correctly if the store's default ever changes. Plan §6.1k asks for the field on
 * both, and plan §15.1a asks a promotion to check "currency compatibility if applicable", which
 * needs the code to compare against.
 *
 * ISO 4217, and all three of these have two decimal places — which the `Minor` convention above
 * quietly assumes. A zero-decimal currency (JPY) or a three-decimal one (KWD) would need that
 * assumption revisited at the formatting layer before being added here.
 */
export const CURRENCY_OPTIONS = [
  { label: 'USD — US Dollar', value: 'USD' },
  { label: 'GBP — Pound Sterling', value: 'GBP' },
  { label: 'EUR — Euro', value: 'EUR' },
] as const

export type CurrencyCode = (typeof CURRENCY_OPTIONS)[number]['value']

export const DEFAULT_CURRENCY: CurrencyCode = 'USD'
