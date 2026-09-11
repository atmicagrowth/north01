'use client'

import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { sizeGuideTable } from '@/lib/product/size-guide'
import type { SizeGuide } from '@/payload-types'

/**
 * **Feature matrix §8's size guide.** Measurement table, fit notes, model info, in a dialog.
 *
 * The corpus asks for *"mobile drawer"* and *"accessible dialog"* as two bullets. They are one
 * component here: Radix's dialog is the same primitive the drawer is built on, and this content is a
 * **table** — a bottom sheet would give it the narrowest possible box and force horizontal scrolling
 * on the axis the data actually needs. The dialog is styled to fill the small-screen viewport, which
 * is what "mobile drawer" is asking for in substance.
 *
 * ### The table is a table
 *
 * Measurements are two-dimensional data — size down, measurement across — so `<table>` with real
 * `<th scope>` on both axes. A grid of divs looks identical and tells a screen-reader user nothing
 * about which number belongs to which measurement in which size, which is the entire content.
 *
 * The header row is built from the **first row's** measurement labels, and every cell is then found
 * by label rather than by position — so a row that lists its measurements in a different order still
 * lands in the right columns, and a row missing one renders an empty cell instead of shifting
 * everything left. That rule lives in `lib/product/size-guide.ts` rather than here, because until
 * Phase 13's second sweep it was a promise in a comment that nothing could execute.
 *
 * `overflow-x-auto` on a wrapper rather than on the table: a wide table must scroll inside its own
 * box, never make the page scroll sideways — the invariant every browser pass in this project
 * asserts at eight widths.
 */
/**
 * `fitNotes` arrives **rendered**, from the server. This component is `'use client'`, and it used to
 * import `Prose` to render the guide's rich-text notes itself — which put the Lexical converters into
 * the product page's client bundle on every product, including the ones with no size guide at all.
 * The server already renders `Prose` for the description; it renders the notes too and hands them
 * across the boundary as children, the pattern `Reveal` uses.
 */
export function SizeGuideDialog({ fitNotes, guide }: { fitNotes?: ReactNode; guide: SizeGuide }) {
  const [open, setOpen] = useState(false)

  /* The rule is in `lib/product/size-guide.ts`, where a harness can reach it. */
  const { columns, rows } = sizeGuideTable(guide.rows ?? [])

  const unit = guide.unit ? ` (${guide.unit})` : ''

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Size guide
        </Button>
      </DialogTrigger>

      <DialogContent
        className="max-h-[90vh] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto"
        description={guide.modelNote ?? undefined}
        title={guide.title ?? 'Size guide'}
      >
        <div className="flex flex-col gap-l">
          {rows.length > 0 && columns.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-sans text-body-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th
                      className="py-2 pr-m text-left text-meta uppercase text-foreground-muted"
                      scope="col"
                    >
                      Size
                    </th>
                    {columns.map((column) => (
                      <th
                        className="py-2 pr-m text-left text-meta uppercase text-foreground-muted"
                        key={column}
                        scope="col"
                      >
                        {column}
                        {unit}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => (
                    <tr className="border-b border-border last:border-0" key={row.key}>
                      <th className="py-2 pr-m text-left font-normal text-foreground" scope="row">
                        {row.size}
                      </th>

                      {row.cells.map((cell, index) => (
                        <td className="py-2 pr-m text-foreground-muted" key={columns[index]}>
                          {cell ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {fitNotes}

          {guide.modelNote ? (
            <p className="font-sans text-body-sm text-foreground-muted">{guide.modelNote}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
