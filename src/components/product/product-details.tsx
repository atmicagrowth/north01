import { Prose } from '@/components/editorial/prose'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { SizeGuideDialog } from '@/components/product/size-guide-dialog'
import type { Product, SizeGuide } from '@/payload-types'

/**
 * **Plan §13.1e's five accordions**, and the rule that decides whether each one appears.
 *
 * > Description. Details. Size & Fit. Care. Shipping & Returns.
 *
 * **A section with nothing in it is not rendered.** An accordion that opens onto a gap is the same
 * fake control §0.1.17 forbids, wearing a chevron — and it is worse than a missing section, because
 * the customer pays a click to discover there is nothing there. Every panel below is conditional on
 * having content, and `hasProse` is what decides it for the rich-text ones.
 *
 * That check is not `!== null`. An editor who selects a body and deletes it leaves a Lexical root
 * containing one empty paragraph, which is truthy — the defect Phase 10's audit found on the
 * homepage, where blocks stayed on the page as a heading with an invisible gap beneath.
 *
 * ### Shipping & Returns comes from `site-settings`, not from the product
 *
 * One policy, one source. `SiteSettings.ts` says so in as many words, and gap **G-08** already
 * records that the dedicated `/help/shipping` and `/help/returns` pages should render these same
 * fields rather than a second copy. A per-product shipping policy would be a promise an editor could
 * make in one place and forget in ninety.
 */

/**
 * Does this Lexical document contain anything a reader would see?
 *
 * The same shallow walk `lib/home/resolve.ts` carries, and it exists for the same reason: a cleared
 * body is a root with one empty paragraph, not `null`.
 */
function hasProse(value: unknown): boolean {
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') {
      return false
    }

    const { children, text } = node as { children?: unknown[]; text?: unknown }

    if (typeof text === 'string' && text.trim() !== '') {
      return true
    }

    return Array.isArray(children) && children.some(walk)
  }

  return walk((value as { root?: unknown })?.root)
}

export function ProductDetails({
  product,
  returnsPolicy,
  shippingPolicy,
  sizeGuide,
}: {
  product: Product
  returnsPolicy: unknown
  shippingPolicy: unknown
  sizeGuide: null | SizeGuide
}) {
  const materials = (product.materials ?? []).filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
  )

  const fitNotes = product.fitNotes?.trim() || null
  const hasShipping = hasProse(shippingPolicy) || hasProse(returnsPolicy)

  const sections = [
    {
      body: hasProse(product.description) ? <Prose value={product.description} /> : null,
      id: 'description',
      label: 'Description',
    },
    {
      body:
        materials.length > 0 || product.fit ? (
          <dl className="flex flex-col gap-s font-sans text-body-sm">
            {materials.length > 0 ? (
              <div className="flex flex-col gap-1">
                <dt className="text-meta uppercase text-foreground-muted">Materials</dt>
                {materials.map((entry) => (
                  <dd key={entry} className="text-foreground">
                    {entry}
                  </dd>
                ))}
              </div>
            ) : null}

            {product.fit ? (
              <div className="flex flex-col gap-1">
                <dt className="text-meta uppercase text-foreground-muted">Fit</dt>
                <dd className="capitalize text-foreground">{product.fit}</dd>
              </div>
            ) : null}
          </dl>
        ) : null,
      id: 'details',
      label: 'Details',
    },
    {
      body:
        fitNotes || sizeGuide ? (
          <div className="flex flex-col items-start gap-m">
            {fitNotes ? (
              <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
                {fitNotes}
              </p>
            ) : null}

            {sizeGuide ? (
              <SizeGuideDialog
                fitNotes={sizeGuide.fitNotes ? <Prose value={sizeGuide.fitNotes} /> : null}
                guide={sizeGuide}
              />
            ) : null}
          </div>
        ) : null,
      id: 'size-fit',
      label: 'Size & Fit',
    },
    {
      body: hasProse(product.care) ? <Prose value={product.care} /> : null,
      id: 'care',
      label: 'Care',
    },
    {
      body: hasShipping ? (
        <div className="flex flex-col gap-m">
          {hasProse(shippingPolicy) ? <Prose value={shippingPolicy} /> : null}
          {hasProse(returnsPolicy) ? <Prose value={returnsPolicy} /> : null}
        </div>
      ) : null,
      id: 'shipping',
      label: 'Shipping & Returns',
    },
  ].filter((section) => section.body !== null)

  if (sections.length === 0) {
    return null
  }

  return (
    <Accordion className="border-t border-border" data-slot="product-details" type="multiple">
      {sections.map((section) => (
        <AccordionItem key={section.id} value={section.id}>
          <AccordionTrigger>{section.label}</AccordionTrigger>
          <AccordionContent>{section.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
