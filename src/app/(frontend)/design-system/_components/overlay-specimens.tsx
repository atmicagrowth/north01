'use client'

import { ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'

import { Cell, Matrix } from './specimen'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToastProvider, useToast } from '@/components/ui/toast'

/**
 * The specimens that need a client boundary: anything whose state a person has to
 * change to see. Every one is genuinely interactive — this page's job is to let a
 * reviewer open, tab through, Escape out of, and close each overlay for real.
 */

export function DialogSpecimen() {
  return (
    <Matrix>
      <Cell label="Dialog — trigger, focus trap, Escape, focus restoration">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open dialog</Button>
          </DialogTrigger>
          <DialogContent
            title="Size guide"
            description="Measurements are in centimetres and taken flat."
          >
            <p className="font-sans text-body-sm text-foreground-muted">
              Focus is trapped inside this dialog. Escape closes it, and focus returns to the button
              that opened it. Tab past the last control to confirm the cycle.
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ds-dialog-input">Search sizes</Label>
              <Input id="ds-dialog-input" placeholder="e.g. Medium" />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="primary">Done</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Cell>

      <Cell label="Dialog — visually hidden title">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost">No visible heading</Button>
          </DialogTrigger>
          <DialogContent title="Quick view" titleHidden>
            <p className="font-sans text-body-sm text-foreground-muted">
              This dialog shows no heading, but it still has an accessible name. Radix 1.1.23
              removed the warning for a missing title, so the name is enforced by the
              component&rsquo;s own API instead.
            </p>
          </DialogContent>
        </Dialog>
      </Cell>
    </Matrix>
  )
}

export function DrawerSpecimen() {
  return (
    <Matrix>
      {(['right', 'left', 'bottom'] as const).map((side) => (
        <Cell key={side} label={`Drawer — ${side}`}>
          <Drawer>
            <DrawerTrigger asChild>
              <Button>Open {side}</Button>
            </DrawerTrigger>
            <DrawerContent
              side={side}
              title="Bag"
              description="Scroll containment, focus trap and Escape are Radix Dialog's."
              footer={
                <>
                  <Button variant="primary" block>
                    Checkout
                  </Button>
                  <Button variant="ghost" block>
                    View bag
                  </Button>
                </>
              }
            >
              {/* Enough rows to genuinely overflow at any realistic viewport height, so the
                  scroll containment is demonstrated rather than merely configured. */}
              <div className="flex flex-col gap-m p-m">
                {Array.from({ length: 30 }, (_, i) => (
                  <p key={i} className="font-sans text-body-sm text-foreground-muted">
                    Body row {i + 1} — the body scrolls, the header and footer do not.
                  </p>
                ))}
              </div>
            </DrawerContent>
          </Drawer>
        </Cell>
      ))}
    </Matrix>
  )
}

export function DropdownSpecimen() {
  const [sort, setSort] = useState('newest')

  return (
    <Matrix>
      <Cell label="Dropdown menu — items, separator, disabled">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              Actions
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Product</DropdownMenuLabel>
            <DropdownMenuItem>Add to wishlist</DropdownMenuItem>
            <DropdownMenuItem>Share</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Notify me (Phase 11)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Cell>

      <Cell label="Dropdown menu — radio group">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost">
              Sort: {sort}
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
              <DropdownMenuRadioItem value="newest">Newest</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="price-asc">Price: low to high</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="price-desc">Price: high to low</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Cell>
    </Matrix>
  )
}

export function SelectSpecimen() {
  return (
    <Matrix>
      <Cell label="Default">
        <div className="flex w-full flex-col gap-2">
          <Label htmlFor="ds-select">Size</Label>
          <Select>
            <SelectTrigger id="ds-select">
              <SelectValue placeholder="Choose a size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="xs">XS</SelectItem>
              <SelectItem value="s">S</SelectItem>
              <SelectItem value="m">M</SelectItem>
              <SelectItem value="l">L</SelectItem>
              <SelectItem value="xl" disabled>
                XL — sold out
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Cell>

      <Cell label="Error">
        <div className="flex w-full flex-col gap-2">
          <Label htmlFor="ds-select-error">Size</Label>
          <Select>
            <SelectTrigger id="ds-select-error" aria-invalid>
              <SelectValue placeholder="Choose a size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="s">S</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Cell>

      <Cell label="Disabled">
        <div className="flex w-full flex-col gap-2">
          <Label htmlFor="ds-select-disabled">Size</Label>
          <Select disabled>
            <SelectTrigger id="ds-select-disabled">
              <SelectValue placeholder="Unavailable" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="s">S</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Cell>
    </Matrix>
  )
}

export function TabsSpecimen() {
  return (
    <Tabs defaultValue="description">
      <TabsList label="Product information">
        <TabsTrigger value="description">Description</TabsTrigger>
        <TabsTrigger value="fit">Size &amp; fit</TabsTrigger>
        <TabsTrigger value="shipping">Shipping</TabsTrigger>
        <TabsTrigger value="reviews" disabled>
          Reviews
        </TabsTrigger>
      </TabsList>
      <TabsContent value="description">
        <p className="max-w-prose font-sans text-body-sm text-foreground-muted">
          Arrow keys move between tabs; the tab list is a single tab stop. The active tab is marked
          by contrast and a 1px rule — no fill, no pill.
        </p>
      </TabsContent>
      <TabsContent value="fit">
        <p className="max-w-prose font-sans text-body-sm text-foreground-muted">Second panel.</p>
      </TabsContent>
      <TabsContent value="shipping">
        <p className="max-w-prose font-sans text-body-sm text-foreground-muted">Third panel.</p>
      </TabsContent>
    </Tabs>
  )
}

export function AccordionSpecimen() {
  return (
    <Accordion type="single" collapsible defaultValue="description" className="max-w-prose">
      <AccordionItem value="description">
        <AccordionTrigger>Description</AccordionTrigger>
        <AccordionContent>
          The indicator is a thin plus that rotates 45° rather than a chevron that flips, so the
          icon geometry stays constant across states.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="details">
        <AccordionTrigger>Details</AccordionTrigger>
        <AccordionContent>
          Height is animated against the custom property Radix publishes after measuring the panel.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="shipping">
        <AccordionTrigger>Shipping &amp; returns</AccordionTrigger>
        <AccordionContent>Rows are separated by hairlines and nothing else.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="disabled" disabled>
        <AccordionTrigger>Disabled row</AccordionTrigger>
        <AccordionContent>Unreachable.</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function ToastTriggers() {
  const { toast } = useToast()

  return (
    <Matrix>
      <Cell label="Default">
        <Button
          onClick={() => toast({ title: 'Added to bag', description: 'Heavyweight Hoodie — M' })}
        >
          Raise toast
        </Button>
      </Cell>
      <Cell label="Error">
        <Button
          variant="ghost"
          onClick={() =>
            toast({
              tone: 'error',
              title: 'Code not valid',
              description: 'That discount code has expired.',
            })
          }
        >
          Raise error toast
        </Button>
      </Cell>
      <Cell label="Persistent">
        <Button
          variant="ghost"
          onClick={() => toast({ title: 'Stays until dismissed', duration: Infinity })}
        >
          Raise persistent toast
        </Button>
      </Cell>
    </Matrix>
  )
}

export function ToastSpecimen() {
  return (
    <ToastProvider>
      <ToastTriggers />
    </ToastProvider>
  )
}

/**
 * Search field with a leading icon — the composition the header's search overlay will
 * use in Phase 12. Included because the icon-inside-a-field pattern is where padding
 * mistakes usually show up.
 */
export function SearchFieldSpecimen() {
  return (
    <div className="relative w-full max-w-sm">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-foreground-muted"
      />
      <Input placeholder="Search" className="pl-11" aria-label="Search products" />
    </div>
  )
}
