'use client'

import { SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'

import { FilterPanel } from '@/components/catalog/filter-controls'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import type { CatalogVocabulary } from '@/lib/catalog/query'

/**
 * **Structure §5's *"mobile filter drawer"*.**
 *
 * The desktop rail and this drawer render the identical `FilterPanel`, so there is one set of
 * controls with one behaviour and one set of bugs. The drawer contributes the box and nothing else.
 *
 * ### It does not close when a filter changes, and that is the point
 *
 * The obvious implementation closes the drawer on every tick so the customer can see the result.
 * That makes filtering on a phone a sequence of open-tick-close-open-tick-close, which is four
 * interactions to apply two filters. Structure §5 asks for a shop that *"stays visually calm"*;
 * fighting the customer's own panel is not calm.
 *
 * So the drawer stays open and the grid updates behind it. `Done` closes it when they are finished.
 * The count in the toolbar is `aria-live`, so a screen-reader user hears the result change without
 * leaving the panel — which is the part that makes staying open an improvement rather than a way of
 * hiding the answer.
 *
 * `side="bottom"` because the trigger is at the bottom of the customer's reach on a phone and a
 * sheet rising from the same edge is the platform idiom; `max-h-[85dvh]` in the primitive keeps the
 * grid visible above it, which is what lets the live count be seen as well as heard.
 */
export function FilterDrawer({
  routeCategory,
  vocabulary,
}: {
  routeCategory?: null | string
  vocabulary: CatalogVocabulary
}) {
  const [open, setOpen] = useState(false)

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="secondary" size="sm">
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Filter
        </Button>
      </DrawerTrigger>

      <DrawerContent
        side="bottom"
        title="Filter"
        description="Narrow the shop by category, size, colour, availability and price."
        footer={
          <Button block onClick={() => setOpen(false)} variant="primary">
            Done
          </Button>
        }
      >
        <div className="overflow-y-auto px-m pb-m">
          <FilterPanel routeCategory={routeCategory} vocabulary={vocabulary} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
