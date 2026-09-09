/**
 * **Shop the look — plan §22.**
 *
 * ```
 * pnpm verify:lookbook
 * ```
 *
 * §22 names no tests of its own — it is one of the few sections with no acceptance criteria — but it
 * does name a **prohibition**, twice: *"do not guess sizes silently"* and *"never silently guess
 * unavailable or missing variants."* That is what this asserts, because a prohibition nothing tests
 * is a prohibition that holds until somebody refactors.
 *
 * Sections A and B are pure. C is the real database, and the **D-10** guard applies.
 */

import type { Payload } from 'payload'

import config from '../src/payload.config'

import { getCatalogSettings } from '../src/lib/catalog/catalog'
import { developmentDatabase } from '../src/lib/env.core'
import { readLookProduct, readLookProducts } from '../src/lib/lookbook/read'
import { lookNotice, planLookAddition, resolvesToOneVariant } from '../src/lib/lookbook/rules'

if (!developmentDatabase.ok) {
  throw new Error(
    `verify-lookbook refuses to run: ${developmentDatabase.reason}. ` +
      'It creates and deletes collection documents, so it may only touch the development database ' +
      'that DATABASE_PUSH_TARGET names — see D-10.',
  )
}

const { getPayload } = await import('payload')

type Result = { detail: string; name: string; ok: boolean }

const results: Result[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
}

const product = (id: number, variants: number) => ({
  href: `/product/p-${id}`,
  id,
  name: `Product ${id}`,
  priceLabel: '$100.00',
  purchasable: Array.from({ length: variants }, (_, index) => ({
    available: 3,
    id: id * 100 + index,
    label: `Bone / ${['S', 'M', 'L'][index] ?? index}`,
  })),
})

/* ============================================ A — §22.1d step 3, the prohibition */
{
  check(
    'A: **one purchasable variant is not a choice** — there is nothing to guess between',
    resolvesToOneVariant(product(1, 1))?.id === 100,
  )

  check(
    'A: **two IS a choice, and the answer is null rather than the first one**',
    resolvesToOneVariant(product(2, 2)) === null,
  )

  check('A: zero is not a default dressed up as one', resolvesToOneVariant(product(3, 0)) === null)
}

/* ============================================ B — §22.1d steps 4, 5 and 6 */
{
  const plan = planLookAddition([product(1, 1), product(2, 3), product(3, 0)])

  check(
    'B: step 5 — only the unambiguous product is added',
    plan.toAdd.length === 1 && plan.toAdd[0]?.product.id === 1,
  )
  check(
    'B: step 4 — the multi-size product is asked about, not guessed',
    plan.needsChoice.map((p) => p.id).join(',') === '2',
  )
  check(
    'B: step 6 — the sold-out product is reported, not omitted',
    plan.unavailable.map((p) => p.id).join(',') === '3',
  )

  check(
    'B: **a product needing a size carries no variant to add** — the type makes step 3 unskippable',
    !plan.toAdd.some((entry) => entry.product.id === 2),
  )

  /* The notice separates the two reasons a product was skipped. */
  const notice = lookNotice(plan, 1) ?? ''

  check('B: the notice says how many landed', notice.includes('1 item added'))
  check(
    'B: **…and names the size problem separately from the gone problem**',
    notice.includes('needs a size') && notice.includes('not available'),
    notice,
  )

  const clean = planLookAddition([product(1, 1), product(2, 1)])

  check(
    'B: nothing to report when everything went in — a count under a visibly fuller bag is noise',
    lookNotice(clean, 2) === null,
  )

  const nothing = planLookAddition([product(3, 0)])

  check('B: a look with nothing purchasable says so', (lookNotice(nothing, 0) ?? '').length > 0)
}

/* ============================================ C — against the database */

const payload: Payload = await getPayload({ config })

const created: { collection: 'product-variants' | 'products'; id: number }[] = []

const cleanup = async () => {
  for (const doc of [...created].reverse()) {
    await payload
      .delete({ collection: doc.collection, id: doc.id, overrideAccess: true, trash: false })
      .catch(() => undefined)
  }
}

const suffix = Date.now().toString().slice(-9)

async function makeProduct(index: string, published = true) {
  const doc = await payload.create({
    collection: 'products',
    data: {
      name: `Look fixture ${suffix}-${index}`,
      slug: `look-fixture-${suffix}-${index}`,
      sortOrder: 9999,
      status: published ? 'published' : 'draft',
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'products', id: doc.id })

  return doc
}

async function makeVariant(productId: number, size: string, stock: number, active = true) {
  const variant = await payload.create({
    collection: 'product-variants',
    data: {
      active,
      color: 'Bone',
      colorFamily: 'bone',
      colorHex: '#e8e4dc',
      inventoryQuantity: stock,
      priceMinor: 9_900,
      product: productId,
      size,
      sizeSortOrder: size === 'S' ? 20 : size === 'M' ? 30 : 40,
      sku: `LOOK-${suffix}-${productId}-${size}`,
    } as never,
    overrideAccess: true,
  })

  created.push({ collection: 'product-variants', id: variant.id })

  return variant
}

try {
  const settings = await getCatalogSettings()

  {
    const one = await makeProduct('one')

    await makeVariant(one.id, 'M', 4)

    const resolved = await readLookProduct(payload, one.id, settings)

    check('C: a product with one in-stock variant resolves', resolved !== null)
    check(
      'C: …with exactly one purchasable variant',
      resolved?.purchasable.length === 1,
      String(resolved?.purchasable.length),
    )
    check(
      'C: …labelled the way a customer would recognise it',
      resolved?.purchasable[0]?.label === 'Bone / M',
      String(resolved?.purchasable[0]?.label),
    )
  }

  {
    const many = await makeProduct('many')

    await makeVariant(many.id, 'S', 2)
    await makeVariant(many.id, 'M', 2)

    const resolved = await readLookProduct(payload, many.id, settings)

    check(
      'C: **a product with two sizes in stock needs a choice** — §22.1d step 4',
      resolved !== null && resolvesToOneVariant(resolved) === null,
    )
  }

  {
    const mixed = await makeProduct('mixed')

    await makeVariant(mixed.id, 'S', 0)
    await makeVariant(mixed.id, 'M', 5)
    await makeVariant(mixed.id, 'L', 3, false)

    const resolved = await readLookProduct(payload, mixed.id, settings)

    check(
      'C: **out-of-stock and inactive variants are not purchasable** — offering one would be the guess',
      resolved?.purchasable.length === 1 && resolved.purchasable[0]?.label === 'Bone / M',
      `${resolved?.purchasable.length}`,
    )
  }

  {
    const soldOut = await makeProduct('soldout')

    await makeVariant(soldOut.id, 'M', 0)

    const resolved = await readLookProduct(payload, soldOut.id, settings)

    check(
      'C: a product with nothing in stock resolves with an empty set, not null',
      resolved?.purchasable.length === 0,
    )
  }

  {
    const draft = await makeProduct('draft', false)

    await makeVariant(draft.id, 'M', 5)

    check(
      'C: **§22.1b an unpublished product resolves to nothing** — the hotspot is hidden, not broken',
      (await readLookProduct(payload, draft.id, settings)) === null,
    )

    const batch = await readLookProducts(payload, [draft.id, 2_147_483_600], settings)

    check(
      'C: …and a look containing only invalid references resolves to an empty look',
      batch.length === 0,
      String(batch.length),
    )
  }
} finally {
  await cleanup()
}

const failed = results.filter((result) => !result.ok)

const report = [
  `${results.length - failed.length}/${results.length} lookbook checks passed.`,
  ...failed.map((result) => `FAIL  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
  ...results.map(
    (result) =>
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  ),
].join('\n')

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${report}\n`, (error) => (error ? reject(error) : resolve()))
})

await payload.destroy()

if (failed.length > 0) {
  throw new Error(`${failed.length} lookbook check(s) failed.`)
}
