/**
 * **Plan §22's decisions, as pure functions.**
 *
 * §22 is unusual in this corpus: it names no route, no test list and no acceptance gate. What it does
 * name is a **sequence** — §22.1d's six numbered steps for adding a whole look — and a prohibition
 * repeated in the prompt: *"never silently guess unavailable or missing variants."*
 *
 * That prohibition is the phase. Everything here exists to make guessing impossible rather than
 * merely discouraged.
 *
 * `lib/lookbook/read.ts` next door does the reads. Neither decides anything.
 */

/* -------------------------------------------------------------------------------------------------
 * What a hotspot's product looks like once resolved
 * ---------------------------------------------------------------------------------------------- */

export type LookVariant = {
  /** How many can actually be bought right now. Zero is a real answer, not an absence. */
  available: number
  id: number
  /** "Bone / M" — what a customer would recognise. */
  label: string
}

export type LookProduct = {
  href: string
  id: number
  name: string
  priceLabel: null | string
  /** Every variant that is active and in stock. Empty means nothing on this product can be bought. */
  purchasable: LookVariant[]
}

/**
 * **§22.1d step 3, as a type-level fact rather than a rule somebody remembers.**
 *
 * > *"Do not guess sizes silently. If variant choice is required, ask for it."*
 *
 * A look can only be added without asking when every product in it has **exactly one** purchasable
 * variant. One is not a guess: there is nothing to choose between. Two is a guess, and so is zero
 * dressed up as a default.
 *
 * The subtlety worth naming: a product with three sizes of which only one is in stock still needs
 * asking, in the sense that matters to a *customer* — but not in the sense that matters to this
 * rule, because there is only one thing that could be added. A shop that silently adds the only
 * remaining size is not guessing; it is doing the single available thing. What it must not do is
 * silently pick medium out of three in stock.
 */
export function resolvesToOneVariant(product: LookProduct): null | LookVariant {
  return product.purchasable.length === 1 ? (product.purchasable[0] ?? null) : null
}

/* -------------------------------------------------------------------------------------------------
 * §22.1d — the whole look
 * ---------------------------------------------------------------------------------------------- */

export type LookPlan = {
  /** Products where a customer has to choose a size. §22.1d step 4: ask, do not guess. */
  needsChoice: LookProduct[]
  /** What can be added without asking anybody anything — §22.1d step 5. */
  toAdd: { product: LookProduct; variant: LookVariant }[]
  /** Nothing on these can be bought at all. §22.1d step 6: report, do not omit. */
  unavailable: LookProduct[]
}

/**
 * **§22.1d, all six steps.**
 *
 * > *"1. Determine products. 2. Resolve purchasable variants. 3. Do not guess sizes silently.
 * > 4. If variant choice is required, ask for it. 5. Add only valid available items.
 * > 6. Report skipped unavailable items."*
 *
 * Steps 1 and 2 are the caller's — they need a database. Steps 3 to 6 are this function, and the
 * shape of the return value is what makes them unskippable: a caller cannot add `needsChoice` by
 * accident, because those entries carry no variant to add.
 *
 * ### Why the three outcomes are separate rather than a boolean
 *
 * *"Report skipped unavailable items"* is step 6, and a customer who presses "add the look" and gets
 * four of six items needs to know **which two and why** — and the two reasons are completely
 * different. One is *"we have this, tell us your size"*, which is a thing they can act on in ten
 * seconds. The other is *"this is gone"*, which is not. Collapsing them into "2 items skipped" turns
 * an actionable outcome into a dead end.
 */
export function planLookAddition(products: readonly LookProduct[]): LookPlan {
  const needsChoice: LookProduct[] = []
  const toAdd: { product: LookProduct; variant: LookVariant }[] = []
  const unavailable: LookProduct[] = []

  for (const product of products) {
    if (product.purchasable.length === 0) {
      unavailable.push(product)
      continue
    }

    const only = resolvesToOneVariant(product)

    if (only) {
      toAdd.push({ product, variant: only })
      continue
    }

    needsChoice.push(product)
  }

  return { needsChoice, toAdd, unavailable }
}

/**
 * What to tell the customer after adding a look.
 *
 * Built from the plan rather than from the outcome of the writes, because the two can differ — a
 * variant can sell out between the plan and the write — and the caller passes what actually landed.
 *
 * Returns `null` when there is nothing worth saying, which is the case where everything went in. A
 * message saying *"6 items added"* under a bag that visibly now holds six items is noise.
 */
export function lookNotice(plan: LookPlan, added: number): null | string {
  const parts: string[] = []

  if (added > 0 && (plan.needsChoice.length > 0 || plan.unavailable.length > 0)) {
    parts.push(added === 1 ? '1 item added.' : `${added} items added.`)
  }

  if (plan.needsChoice.length > 0) {
    parts.push(
      plan.needsChoice.length === 1
        ? `${plan.needsChoice[0]?.name} needs a size — open it to choose one.`
        : `${plan.needsChoice.length} items need a size. Open them to choose.`,
    )
  }

  if (plan.unavailable.length > 0) {
    parts.push(
      plan.unavailable.length === 1
        ? `${plan.unavailable[0]?.name} is not available.`
        : `${plan.unavailable.length} items are not available.`,
    )
  }

  if (added === 0 && parts.length === 0) {
    return LOOK_COPY.nothingToAdd
  }

  return parts.length > 0 ? parts.join(' ') : null
}

export const LOOK_COPY = {
  addLook: 'Add the look',
  /** Shown on the marker's preview when the product has more than one size in stock. */
  chooseSize: 'Choose a size',
  nothingToAdd: 'Nothing in this look can be added right now.',
  /** §22.1c's *"allow full PDP navigation"*, which the preview must offer rather than replace. */
  viewProduct: 'View product',
} as const
