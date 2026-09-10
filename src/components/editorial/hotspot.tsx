'use client'

import { Popover } from 'radix-ui'
import { useActionState, useState, useTransition } from 'react'

import type { LookProduct } from '@/lib/lookbook/rules'

import { useActionResult } from '@/components/analytics/use-action-result'
import { Button } from '@/components/ui/button'
import { trackEvent } from '@/lib/analytics/track'
import { Link } from '@/components/ui/link'
import { CART_ACTION_IDLE } from '@/lib/cart/action-state'
import { addToBagAction } from '@/lib/cart/actions'
import { cn } from '@/lib/cn'
import { previewLookProductAction } from '@/lib/lookbook/actions'
import { LOOK_COPY, resolvesToOneVariant } from '@/lib/lookbook/rules'
import { DEFAULT_CURRENCY } from '@/payload/fields/money'

/**
 * **§22.1c's hotspot, upgraded from a link into a preview.**
 *
 * > *"Click hotspot: open product preview. Show image/name/price/variant state. Allow add to bag.
 * > Allow full PDP navigation."*
 *
 * Four requirements, and the fourth is the one that shapes the component: the preview must **offer**
 * the product page, not **replace** it. Phase 10's marker was an anchor straight to the PDP, and the
 * naive upgrade — turn it into a button that opens a popover — would satisfy the first three clauses
 * by breaking the fourth, and would break something the plan never had to state.
 *
 * ---
 *
 * ### The trigger is still an anchor, and that is progressive enhancement rather than pedantry
 *
 * `Popover.Trigger asChild` wraps the same `Link` Phase 10 rendered. With JavaScript, the click is
 * prevented and the popover opens. **Without it, the anchor navigates to the product page**, exactly
 * as it did before — so the whole look stays operable when the bundle fails, which is the same
 * reasoning that makes `AddToBag` a real `<form>` with hidden inputs.
 *
 * It also means the marker keeps the accessible name Phase 10 gave it — the product's name and price,
 * visually hidden — rather than becoming a dot that only a mouse can use.
 *
 * ### Radix supplies the ARIA that this project once got wrong by hand
 *
 * `overlay-context.tsx` records the bug: `aria-controls` pointing at an id Radix has unmounted is a
 * real axe violation, and two clean automated sweeps had passed over markup missing `aria-haspopup`
 * entirely, because axe treats it as an enhancement. `Popover.Trigger` emits all three correctly and
 * keeps them in step with the open state, so none of it is hand-written here.
 *
 * **`Popover`, not `Dialog`.** A preview is anchored to the thing that opened it and does not deserve
 * a focus trap, a scrim or a scroll lock — a customer scanning a look should be able to open one
 * marker, glance, and move to the next. The shell's three overlays are modal because they replace the
 * page; this augments it.
 *
 * The shell's `overlay-context` is deliberately **not** used. It exists because the cart, menu and
 * search panels are mounted beside the footer with no trigger in their own subtree, so Radix focuses
 * a null ref and drops focus to `document.body`. A hotspot's trigger is right next to its content, so
 * Radix's own restoration is correct — and reaching for that context would also enter a
 * mutual-exclusion state machine that would close the customer's bag.
 *
 * ### The preview is fetched when it is opened
 *
 * A homepage can carry four of these blocks with eight markers each. Resolving thirty-two products'
 * live stock on every render, for a section most visitors never touch, would be paid by everyone for
 * the benefit of a few. So the marker is cheap and the preview costs one round trip when asked for.
 */
export function Hotspot({
  hotspot,
}: {
  hotspot: {
    label: null | string
    product: { href: string; id: number; name: string; priceLabel: string }
    tone: 'dark' | 'light'
    x: number
    xMobile: number
    y: number
    yMobile: number
  }
}) {
  const [preview, setPreview] = useState<LookProduct | null | 'gone'>(null)
  const [loading, startLoading] = useTransition()

  const onOpenChange = (open: boolean) => {
    if (!open) {
      return
    }

    /*
     * **§25.1a's `shop_the_look_opened`, on every open** — including re-opens, which is why it sits
     * above the `preview !== null` guard below. That guard exists to avoid re-fetching a preview
     * already in hand; re-using a cached preview is still a customer opening a hotspot, and
     * counting it once per page would under-report the interaction §22 exists to measure.
     *
     * The look is identified by its product, because a hotspot has no id of its own — it is a
     * coordinate on an image, and the product is the only stable thing about it.
     */
    trackEvent('shop_the_look_opened', { lookId: String(hotspot.product.id) })

    if (preview !== null) {
      return
    }

    startLoading(async () => {
      const resolved = await previewLookProductAction(hotspot.product.id)

      setPreview(resolved ?? 'gone')
    })
  }

  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Link
          className={cn(
            'absolute grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full',
            'left-[var(--x-mobile)] top-[var(--y-mobile)]',
            'md:left-[var(--x)] md:top-[var(--y)]',
            'transition-transform duration-(--duration-base) ease-entrance hover:scale-110',
            hotspot.tone === 'dark'
              ? 'bg-canvas/80 text-foreground ring-1 ring-foreground/30'
              : 'bg-foreground/85 text-canvas ring-1 ring-canvas/20',
          )}
          href={hotspot.product.href}
          /*
           * The whole of the progressive enhancement. With JS this opens the preview; without it,
           * this handler never runs and the anchor does what an anchor does.
           */
          onClick={(event) => event.preventDefault()}
          style={
            {
              '--x': `${hotspot.x}%`,
              '--x-mobile': `${hotspot.xMobile}%`,
              '--y': `${hotspot.y}%`,
              '--y-mobile': `${hotspot.yMobile}%`,
            } as React.CSSProperties
          }
          variant="unstyled"
        >
          {/* A plus, drawn rather than iconised — guide §06's "simple geometry, small footprint". */}
          <span aria-hidden className="text-body-sm leading-none">
            +
          </span>

          <span className="sr-only">
            {hotspot.label ?? hotspot.product.name} — {hotspot.product.priceLabel}
          </span>
        </Link>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="center"
          className="z-50 w-64 border border-border bg-surface p-m shadow-overlay"
          collisionPadding={16}
          sideOffset={12}
        >
          <HotspotPreview fallback={hotspot.product} loading={loading} preview={preview} />

          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * What the popover shows, in its three real states.
 *
 * The **loading** state renders the name and price the page already had rather than a spinner — the
 * marker's accessible name carried them, so the popover can be useful in the first frame and only
 * the variant state has to wait.
 */
function HotspotPreview({
  fallback,
  loading,
  preview,
}: {
  fallback: { href: string; name: string; priceLabel: string }
  loading: boolean
  preview: LookProduct | null | 'gone'
}) {
  if (preview === 'gone') {
    /*
     * §22.1b's spirit applied one layer later. The hotspot was valid when the page rendered and the
     * product has been withdrawn since; saying so is better than an empty frame or a dead button.
     */
    return (
      <p className="font-sans text-body-sm text-foreground-muted">
        This product is no longer available.
      </p>
    )
  }

  const product = preview === null ? null : preview
  const only = product ? resolvesToOneVariant(product) : null

  return (
    <div className="flex flex-col gap-s">
      <div className="flex flex-col gap-1">
        <p className="font-sans text-body-sm text-foreground">{product?.name ?? fallback.name}</p>
        <p className="font-sans text-meta text-foreground-muted">
          {product?.priceLabel ?? fallback.priceLabel}
        </p>
      </div>

      {/*
        §22.1c's "variant state", and §22.1d step 3 enforced at the smallest surface that could break
        it. One purchasable variant is not a choice, so it is added directly. More than one IS a
        choice, and the preview refuses to make it — it sends the customer to the page that asks.
      */}
      {product && only ? (
        <AddOneVariant
          label={only.label}
          product={{ id: product.id, name: product.name }}
          variantId={only.id}
        />
      ) : null}

      {product && !only && product.purchasable.length > 1 ? (
        <Button asChild className="w-full" size="sm" variant="secondary">
          <Link href={product.href} variant="unstyled">
            {LOOK_COPY.chooseSize}
          </Link>
        </Button>
      ) : null}

      {product && product.purchasable.length === 0 ? (
        <p className="font-sans text-body-sm text-foreground-muted">Sold out.</p>
      ) : null}

      {loading ? (
        <p aria-live="polite" className="font-sans text-micro uppercase text-foreground-muted">
          Checking availability…
        </p>
      ) : null}

      {/* §22.1c's fourth clause. The preview offers the product page; it never replaces it. */}
      <Link
        className="font-sans text-micro uppercase text-foreground-muted"
        href={product?.href ?? fallback.href}
      >
        {LOOK_COPY.viewProduct}
      </Link>
    </div>
  )
}

/**
 * The single-variant add.
 *
 * A real `<form>` with the action, so it behaves like every other add-to-bag in this project rather
 * than like a bespoke button — and so the notice `addToBagAction` returns (a clamp, a refusal) has
 * somewhere to be read. Phase 14 built that action to answer with a sentence rather than a total,
 * and the sentence is worth as much here as it is on a product page.
 */
function AddOneVariant({
  label,
  product,
  variantId,
}: {
  label: string
  /** For §25.1a's `shop_the_look_add_item`. */
  product: { id: number; name: string }
  variantId: number
}) {
  const [state, action, pending] = useActionState(addToBagAction, CART_ACTION_IDLE)

  /*
   * §25.1a distinguishes `shop_the_look_add_item` from `add_to_cart`, so **both** are sent: the
   * first says which surface converted, the second keeps the ecommerce funnel whole. Reporting only
   * the editorial one would make every look-driven add invisible to the cart funnel, and reporting
   * only the cart one would make §22 unmeasurable — which is the reason §25.1a names it separately.
   */
  useActionResult(state, (result) => {
    if (!result.ok) {
      return
    }

    const items = [{ itemId: String(product.id), itemName: product.name, quantity: 1 }]

    trackEvent('shop_the_look_add_item', { items, lookId: String(product.id) })
    trackEvent('add_to_cart', { currency: DEFAULT_CURRENCY, items, valueMinor: null })
  })

  return (
    <form action={action} className="flex flex-col gap-1">
      <input name="variantId" type="hidden" value={variantId} />
      <input name="quantity" type="hidden" value={1} />

      <Button className="w-full" disabled={pending} size="sm" type="submit" variant="primary">
        Add {label}
      </Button>

      {state.notice ? (
        <p aria-live="polite" className="font-sans text-micro text-foreground-muted">
          {state.notice}
        </p>
      ) : null}
    </form>
  )
}
