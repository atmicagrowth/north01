import type { Metadata } from 'next'

import {
  AccordionSpecimen,
  DialogSpecimen,
  DrawerSpecimen,
  DropdownSpecimen,
  SearchFieldSpecimen,
  SelectSpecimen,
  TabsSpecimen,
  ToastSpecimen,
} from './_components/overlay-specimens'
import { Cell, Matrix, Specimen, SpecimenGroup } from './_components/specimen'
import { EditorialBlock } from '@/components/layout/editorial-block'
import { PageContainer } from '@/components/layout/page-container'
import { PageTitle } from '@/components/layout/page-title'
import { Section, SectionHeading } from '@/components/layout/section'
import { SiteFooter } from '@/components/layout/site-footer'
import { SiteHeader } from '@/components/layout/site-header'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Input, Textarea } from '@/components/ui/input'
import { FieldMessage, Label } from '@/components/ui/label'
import { Link } from '@/components/ui/link'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Heart } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Design system',
  description: 'Internal specimen sheet for the NORTH / 01 design system.',
  // Internal documentation, not merchandise. It must never appear in search results.
  robots: { index: false, follow: false },
}

/**
 * The NORTH / 01 design-system specimen sheet.
 *
 * This is plan §3.1d's acceptance criterion — "a Storybook **or equivalent** visual test
 * page showing every primitive in default, hover, focus, active, disabled, error,
 * loading, dark/light context where relevant, and mobile width".
 *
 * It is the *equivalent*, and that was a decision rather than a fallback: contradiction
 * C-10 is resolved in favour of an in-app route, with the reasoning recorded in notes
 * §1.8.4. The short version is that this page runs inside the real application — same
 * Turbopack build, same PostCSS graph, same self-hosted `next/font` files, same
 * `(frontend)` layout and cascade — so what a reviewer sees here is literally what
 * ships, and Phase 27's axe-core sweep picks it up as one more route for free.
 *
 * Hover, focus and active are shown by `data-preview`, which makes each component's own
 * `hover:` / `focus-visible:` / `active:` classes apply. See the note in `globals.css`:
 * the specimen shows the real rule, not a hand-copied lookalike.
 */
export default function DesignSystemPage() {
  return (
    <>
      {/*
        The shell components, rendered for real rather than mocked. The header's
        navigation points at routes later phases build; the links are honest markup for a
        component specimen, and Phase 9 is what mounts this header on the storefront.
      */}
      <SiteHeader />

      <main>
        <PageContainer>
          <Section spacing="tight">
            <Breadcrumb className="mb-m">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href="/">Home</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Design system</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <PageTitle
              eyebrow="Internal · Phase 3"
              size="display-xl"
              lede="Every primitive and shell component in the states plan §3.1d requires. This page is
                    documentation, not merchandise — it is excluded from search indexing and is not
                    linked from the storefront navigation."
            >
              Design System
            </PageTitle>
          </Section>

          {/* ================================================================
              FOUNDATIONS
              ============================================================= */}
          <SpecimenGroup
            id="foundations"
            title="Foundations"
            description="Colour, type, spacing, radius, shadow and motion. The visual guide describes
                         several of these in adjectives only; the numbers were fixed in Phase 3 and
                         recorded against gap G-12."
          >
            <Specimen
              id="colour"
              name="Colour"
              note="Nine palette colours from guide §02, plus one signal colour introduced in Phase 3.
                    Ratios are measured against Obsidian #0A0A0A. Components address these through
                    semantic names only — there is no bg-obsidian utility, by design."
            >
              <div className="grid grid-cols-2 gap-s sm:grid-cols-3 lg:grid-cols-5">
                {[
                  {
                    name: 'Canvas',
                    hex: '#0A0A0A',
                    role: 'Page background',
                    cls: 'bg-canvas',
                    ratio: null,
                  },
                  {
                    name: 'Surface',
                    hex: '#151515',
                    role: 'Inputs, drawers, menus',
                    cls: 'bg-surface',
                    ratio: null,
                  },
                  {
                    name: 'Surface raised',
                    hex: '#1D1C1A',
                    role: 'Dialogs, hover',
                    cls: 'bg-surface-raised',
                    ratio: null,
                  },
                  {
                    name: 'Foreground',
                    hex: '#F1EEE8',
                    role: 'Primary text',
                    cls: 'bg-foreground',
                    ratio: '17.10:1',
                  },
                  {
                    name: 'Foreground bright',
                    hex: '#FAF8F4',
                    role: 'Bright text',
                    cls: 'bg-foreground-bright',
                    ratio: '18.67:1',
                  },
                  {
                    name: 'Foreground muted',
                    hex: '#A9A39A',
                    role: 'Secondary text',
                    cls: 'bg-foreground-muted',
                    ratio: '7.91:1',
                  },
                  {
                    name: 'Foreground disabled',
                    hex: '#77726B',
                    role: 'Disabled content only',
                    cls: 'bg-foreground-disabled',
                    ratio: '4.15:1',
                  },
                  {
                    name: 'Border',
                    hex: '#33312D',
                    role: 'Rules and dividers',
                    cls: 'bg-border',
                    ratio: '1.53:1',
                  },
                  {
                    name: 'Border control',
                    hex: '#77726B',
                    role: 'Control boundaries',
                    cls: 'bg-border-control',
                    ratio: '4.15:1',
                  },
                  {
                    name: 'Accent',
                    hex: '#C7B8A0',
                    role: 'Rules, rings, ≤10px labels',
                    cls: 'bg-accent',
                    ratio: '10.17:1',
                  },
                  {
                    name: 'Error',
                    hex: '#C0745F',
                    role: 'The one signal colour',
                    cls: 'bg-error',
                    ratio: '5.57:1',
                  },
                ].map((swatch) => (
                  <div key={swatch.name} className="flex flex-col gap-2">
                    <div
                      className={`h-16 w-full rounded-sm border border-border ${swatch.cls}`}
                      aria-hidden
                    />
                    <div className="flex flex-col gap-0.5">
                      <p className="font-sans text-micro uppercase text-foreground">
                        {swatch.name}
                      </p>
                      <p className="font-sans text-micro uppercase text-foreground-muted">
                        {swatch.hex}
                      </p>
                      <p className="font-sans text-body-sm text-foreground-muted">{swatch.role}</p>
                      {swatch.ratio ? (
                        <p className="font-sans text-micro uppercase text-foreground-muted">
                          {swatch.ratio}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-m flex flex-col gap-2 rounded-sm border border-border p-m">
                <p className="font-sans text-meta uppercase text-foreground">
                  Two rules worth stating
                </p>
                <p className="max-w-prose font-sans text-body-sm text-foreground-muted">
                  <strong className="text-foreground">Border vs border-control.</strong> Graphite is
                  1.53:1 — fine for a divider, which WCAG treats as decorative, and far below the
                  3:1 a control boundary needs. Structural rules stay Graphite; anything a customer
                  has to find and operate uses Muted Stone.
                </p>
                <p className="max-w-prose font-sans text-body-sm text-foreground-muted">
                  <strong className="text-foreground">There is no third grey for text.</strong>{' '}
                  Muted Stone is 4.15:1, below AA for normal text, so it answers only to{' '}
                  <em>disabled</em> — where WCAG 1.4.3 exempts it. Everything below primary is Stone
                  at 7.91:1, and the hierarchy is carried by size and tracking instead. A
                  &ldquo;tertiary text&rdquo; alias existed briefly; every one of its first uses
                  broke its own restriction, so it was deleted rather than re-documented.
                </p>
              </div>
            </Specimen>

            <Specimen
              id="typography"
              name="Typography"
              note="Bodoni Moda for display, Instrument Sans for UI — both self-hosted, both SIL OFL
                    1.1. The guide gives sizes with no weights, line-heights or tracking; those are
                    fixed here and every level stays inside the guide's stated range."
            >
              <div className="flex flex-col gap-l">
                {[
                  {
                    token: 'text-display-xl',
                    spec: '48–72px · 1.02 · 500 · −0.02em · serif',
                    cls: 'font-display text-display-xl',
                    sample: 'New Season.',
                  },
                  {
                    token: 'text-display-l',
                    spec: '36–52px · 1.06 · 500 · −0.015em · serif',
                    cls: 'font-display text-display-l',
                    sample: 'Essentials Collection',
                  },
                  {
                    token: 'text-heading-m',
                    spec: '24–34px · 1.15 · 500 · −0.01em · serif',
                    cls: 'font-display text-heading-m',
                    sample: 'Shaped by purpose',
                  },
                  {
                    token: 'text-heading-s',
                    spec: '16–20px · 1.30 · 500 · 0 · sans',
                    cls: 'font-sans text-heading-s',
                    sample: 'Heavyweight Hoodie',
                  },
                  {
                    token: 'text-body',
                    spec: '16px · 1.60 · 400 · 0 · sans',
                    cls: 'font-sans text-body',
                    sample:
                      'Crafted from 420 GSM heavyweight cotton, garment-dyed for a soft hand feel.',
                  },
                  {
                    token: 'text-body-sm',
                    spec: '14px · 1.55 · 400 · 0 · sans',
                    cls: 'font-sans text-body-sm',
                    sample: 'Supporting copy and secondary description.',
                  },
                  {
                    token: 'text-meta',
                    spec: '12px · 1.40 · 500 · 0.12em · sans',
                    cls: 'font-sans text-meta uppercase',
                    sample: 'Add to bag',
                  },
                  {
                    token: 'text-micro',
                    spec: '10px · 1.30 · 500 · 0.18em · sans',
                    cls: 'font-sans text-micro uppercase',
                    sample: 'Colour · Washed Black',
                  },
                ].map((level) => (
                  <div
                    key={level.token}
                    className="flex flex-col gap-2 border-b border-border pb-m"
                  >
                    <div className="flex flex-wrap items-baseline gap-m">
                      <code className="font-mono text-micro uppercase text-accent">
                        {level.token}
                      </code>
                      <span className="font-sans text-micro uppercase text-foreground-muted">
                        {level.spec}
                      </span>
                    </div>
                    <p className={level.cls}>{level.sample}</p>
                  </div>
                ))}
              </div>

              <p className="mt-m max-w-prose font-sans text-body-sm text-foreground-muted">
                Bodoni Moda carries an optical-size axis, so the display levels above are drawn with
                finer hairlines than the smaller ones — the browser applies it automatically. That
                is the difference between a fashion Didone and a general-purpose serif, and it only
                works because the committed file is the one that contains the axis.
              </p>
            </Specimen>

            <Specimen
              id="spacing"
              name="Spacing, radius and shadow"
              note="Spacing steps sit inside the guide's §05 ranges. Nothing in this system is rounder
                    than 4px except things that are actually circles, and there is exactly one shadow."
            >
              <Matrix>
                <Cell label="Spacing scale" wide>
                  <div className="flex w-full flex-col gap-3">
                    {[
                      { token: 'xs', px: '6px', guide: '4–6', w: 'w-xs' },
                      { token: 's', px: '12px', guide: '8–12', w: 'w-s' },
                      { token: 'm', px: '24px', guide: '16–24', w: 'w-m' },
                      { token: 'l', px: '40px', guide: '32–48', w: 'w-l' },
                      { token: 'xl', px: '80px', guide: '64–96', w: 'w-xl' },
                      { token: 'xxl', px: '144px', guide: '120–180', w: 'w-xxl' },
                    ].map((step) => (
                      <div key={step.token} className="flex items-center gap-m">
                        <code className="w-10 font-mono text-micro uppercase text-accent">
                          {step.token}
                        </code>
                        <div className={`h-2 ${step.w} bg-foreground-muted`} aria-hidden />
                        <span className="font-sans text-micro uppercase text-foreground-muted">
                          {step.px} · guide {step.guide}
                        </span>
                      </div>
                    ))}
                  </div>
                </Cell>

                <Cell label="Radius">
                  {[
                    { cls: 'rounded-none', label: 'none · 0' },
                    { cls: 'rounded-sm', label: 'sm · 2px' },
                    { cls: 'rounded-md', label: 'md · 4px' },
                    { cls: 'rounded-full', label: 'full · circles only' },
                  ].map((r) => (
                    <div key={r.cls} className="flex flex-col items-center gap-2">
                      <div
                        className={`size-12 border border-border-control bg-surface ${r.cls}`}
                        aria-hidden
                      />
                      <span className="font-sans text-micro uppercase text-foreground-muted">
                        {r.label}
                      </span>
                    </div>
                  ))}
                </Cell>

                <Cell label="Shadow — one value, one purpose">
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className="size-16 rounded-md border border-border bg-surface-raised shadow-overlay"
                      aria-hidden
                    />
                    <span className="font-sans text-micro uppercase text-foreground-muted">
                      shadow-overlay
                    </span>
                  </div>
                </Cell>

                <Cell label="Motion durations" wide>
                  <div className="flex w-full flex-wrap gap-m">
                    {[
                      ['instant', '80ms', 'pressed feedback'],
                      ['fast', '160ms', 'hover, focus'],
                      ['base', '240ms', 'menus, tabs, toasts'],
                      ['slow', '400ms', 'drawers, dialogs'],
                      ['editorial', '700ms', 'image reveals'],
                    ].map(([token, ms, use]) => (
                      <div key={token} className="flex flex-col gap-0.5">
                        <code className="font-mono text-micro uppercase text-accent">{token}</code>
                        <span className="font-sans text-body-sm text-foreground">{ms}</span>
                        <span className="font-sans text-micro uppercase text-foreground-muted">
                          {use}
                        </span>
                      </div>
                    ))}
                  </div>
                </Cell>
              </Matrix>

              <p className="mt-m max-w-prose font-sans text-body-sm text-foreground-muted">
                Every one of those durations collapses to 1ms under{' '}
                <code className="font-mono text-body-sm text-accent">prefers-reduced-motion</code>,
                from a single media query. The one exception is the button&rsquo;s loading spinner,
                which slows instead of stopping — a frozen spinner reads as a hung interface.
              </p>
            </Specimen>
          </SpecimenGroup>

          {/* ================================================================
              PRIMITIVES
              ============================================================= */}
          <SpecimenGroup
            id="primitives"
            title="Primitives"
            description="Every control in plan §3.1c. Hover, focus and active are forced with
                         data-preview, which triggers each component's own state classes rather than
                         a copy of them."
          >
            <Specimen
              id="button"
              name="Button"
              note="Three variants, three sizes. No pill variant exists."
            >
              <Matrix>
                {(['primary', 'secondary', 'ghost'] as const).map((variant) => (
                  <Cell key={variant} label={variant} wide>
                    <Button variant={variant}>Default</Button>
                    <Button variant={variant} data-preview="hover">
                      Hover
                    </Button>
                    <Button variant={variant} data-preview="focus">
                      Focus
                    </Button>
                    <Button variant={variant} data-preview="active">
                      Active
                    </Button>
                    <Button variant={variant} disabled>
                      Disabled
                    </Button>
                    <Button variant={variant} loading>
                      Loading
                    </Button>
                  </Cell>
                ))}

                <Cell label="Sizes">
                  <Button size="sm">Small</Button>
                  <Button size="md">Medium</Button>
                  <Button size="lg">Large</Button>
                </Cell>

                <Cell label="Full width" wide>
                  <Button variant="primary" size="lg" block>
                    Add to bag
                  </Button>
                </Cell>
              </Matrix>
            </Specimen>

            <Specimen
              id="icon-button"
              name="Icon button"
              note="`label` is a required prop — an icon-only control with no accessible name is a
                    compile error here rather than a review finding."
            >
              <Matrix>
                <Cell label="Ghost" wide>
                  {(['default', 'hover', 'focus', 'active'] as const).map((state) => (
                    <IconButton
                      key={state}
                      label={`Add to wishlist — ${state}`}
                      data-preview={state === 'default' ? undefined : state}
                    >
                      <Heart aria-hidden />
                    </IconButton>
                  ))}
                  <IconButton label="Add to wishlist — disabled" disabled>
                    <Heart aria-hidden />
                  </IconButton>
                </Cell>

                <Cell label="Outline" wide>
                  {(['default', 'hover', 'focus', 'active'] as const).map((state) => (
                    <IconButton
                      key={state}
                      variant="outline"
                      label={`Outline — ${state}`}
                      data-preview={state === 'default' ? undefined : state}
                    >
                      <Heart aria-hidden />
                    </IconButton>
                  ))}
                  <IconButton variant="outline" label="Outline — disabled" disabled>
                    <Heart aria-hidden />
                  </IconButton>
                </Cell>
              </Matrix>
            </Specimen>

            <Specimen id="link" name="Link" note="Text-first, with the rule doing the work.">
              <Matrix>
                <Cell label="Inline — in body copy" wide>
                  <p className="max-w-prose font-sans text-body text-foreground-muted">
                    Every item is made in limited quantities. Read our{' '}
                    <Link href="/about">materials and process</Link>, or see the{' '}
                    <Link href="/help/shipping" data-preview="hover">
                      shipping policy
                    </Link>{' '}
                    before ordering.
                  </p>
                </Cell>
                <Cell label="Quiet">
                  <Link href="/journal">Default</Link>
                  <Link href="/journal" variant="quiet" data-preview="hover">
                    Hover
                  </Link>
                  <Link href="/journal" variant="quiet" data-preview="focus">
                    Focus
                  </Link>
                </Cell>
                <Cell label="Meta">
                  <Link href="/shop" variant="meta">
                    Shop the collection
                  </Link>
                  <Link href="/shop" variant="meta" data-preview="hover">
                    Hover
                  </Link>
                </Cell>
              </Matrix>
            </Specimen>

            <Specimen
              id="input"
              name="Input, label and field message"
              note="Error is never carried by colour alone — the message brings an icon and its own
                    text, and the field is wired to it through aria-describedby."
            >
              <Matrix>
                <Cell label="Default">
                  <div className="flex w-full flex-col gap-2">
                    <Label htmlFor="ds-input">Email</Label>
                    <Input id="ds-input" type="email" placeholder="you@example.com" />
                  </div>
                </Cell>

                <Cell label="Hover">
                  <div className="flex w-full flex-col gap-2">
                    <Label htmlFor="ds-input-hover">Email</Label>
                    <Input id="ds-input-hover" data-preview="hover" placeholder="you@example.com" />
                  </div>
                </Cell>

                <Cell label="Focus">
                  <div className="flex w-full flex-col gap-2">
                    <Label htmlFor="ds-input-focus">Email</Label>
                    <Input id="ds-input-focus" data-preview="focus" placeholder="you@example.com" />
                  </div>
                </Cell>

                <Cell label="Filled">
                  <div className="flex w-full flex-col gap-2">
                    <Label htmlFor="ds-input-filled">Email</Label>
                    <Input id="ds-input-filled" defaultValue="ada@north01.example" />
                  </div>
                </Cell>

                <Cell label="Error">
                  <div className="flex w-full flex-col gap-2">
                    <Label htmlFor="ds-input-error">Email</Label>
                    <Input
                      id="ds-input-error"
                      aria-invalid
                      aria-describedby="ds-input-error-msg"
                      defaultValue="ada@"
                    />
                    <FieldMessage id="ds-input-error-msg" tone="error">
                      Enter a complete email address.
                    </FieldMessage>
                  </div>
                </Cell>

                <Cell label="Disabled">
                  <div className="flex w-full flex-col gap-2">
                    <Label htmlFor="ds-input-disabled">Email</Label>
                    <Input id="ds-input-disabled" disabled placeholder="Unavailable" />
                    <FieldMessage>Hint text sits here.</FieldMessage>
                  </div>
                </Cell>

                <Cell label="Textarea" wide>
                  <div className="flex w-full flex-col gap-2">
                    <Label htmlFor="ds-textarea">Gift message</Label>
                    <Textarea id="ds-textarea" placeholder="Add a note" />
                  </div>
                </Cell>

                <Cell label="Search field" wide>
                  <SearchFieldSpecimen />
                </Cell>
              </Matrix>
            </Specimen>

            <Specimen
              id="checkbox"
              name="Checkbox and radio"
              note="Selection is contrast, not colour — a Bone fill at 17:1 is a louder signal than
                    any hue the palette permits. This is the G-14 resolution in its plainest form."
            >
              <Matrix>
                <Cell label="Checkbox — states" wide>
                  {[
                    { id: 'c1', label: 'Unchecked', props: {} },
                    { id: 'c2', label: 'Checked', props: { defaultChecked: true } },
                    { id: 'c3', label: 'Hover', props: { 'data-preview': 'hover' } },
                    { id: 'c4', label: 'Focus', props: { 'data-preview': 'focus' } },
                    { id: 'c5', label: 'Disabled', props: { disabled: true } },
                    {
                      id: 'c6',
                      label: 'Disabled checked',
                      props: { disabled: true, defaultChecked: true },
                    },
                    { id: 'c7', label: 'Error', props: { 'aria-invalid': true } },
                  ].map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <Checkbox id={item.id} {...item.props} />
                      <Label htmlFor={item.id} className="normal-case tracking-normal text-body-sm">
                        {item.label}
                      </Label>
                    </div>
                  ))}
                </Cell>

                <Cell label="Radio group" wide>
                  <RadioGroup
                    defaultValue="standard"
                    aria-label="Shipping method"
                    className="w-full"
                  >
                    {[
                      { value: 'standard', label: 'Standard — 5–7 business days' },
                      { value: 'express', label: 'Express — 2–3 business days' },
                      { value: 'overnight', label: 'Overnight — 1 business day' },
                    ].map((option) => (
                      <div key={option.value} className="flex items-center gap-2">
                        <RadioGroupItem value={option.value} id={`r-${option.value}`} />
                        <Label
                          htmlFor={`r-${option.value}`}
                          className="normal-case tracking-normal text-body-sm"
                        >
                          {option.label}
                        </Label>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="disabled" id="r-disabled" disabled />
                      <Label
                        htmlFor="r-disabled"
                        className="normal-case tracking-normal text-body-sm text-foreground-disabled"
                      >
                        Unavailable to this address
                      </Label>
                    </div>
                  </RadioGroup>
                </Cell>
              </Matrix>
            </Specimen>

            <Specimen
              id="select"
              name="Select"
              note="Radix gives the combobox roles, typeahead and the hidden native select. It does
                    not give the trigger a name — every instance here is labelled."
            >
              <SelectSpecimen />
            </Specimen>

            <Specimen
              id="dialog"
              name="Dialog"
              note="Open one and try it: Tab cycles inside, Escape closes, focus returns to the
                    trigger. All of that is Radix's; the required `title` prop is ours, because
                    Radix 1.1.23 no longer warns when it is missing."
            >
              <DialogSpecimen />
            </Specimen>

            <Specimen
              id="drawer"
              name="Drawer"
              note="Radix Dialog anchored to an edge — no vaul. The body scrolls; the header and
                    footer stay put."
            >
              <DrawerSpecimen />
            </Specimen>

            <Specimen
              id="dropdown"
              name="Dropdown menu"
              note="Arrow keys, typeahead, Escape, focus restoration."
            >
              <DropdownSpecimen />
            </Specimen>

            <Specimen
              id="tabs"
              name="Tabs"
              note="One tab stop; arrows move within. The tab list is labelled."
            >
              <TabsSpecimen />
            </Specimen>

            <Specimen
              id="accordion"
              name="Accordion"
              note="Hairline rows, a rotating plus, animated height."
            >
              <AccordionSpecimen />
            </Specimen>

            <Specimen
              id="toast"
              name="Toast"
              note="Radix Toast rather than sonner — the aria-live region, swipe dismissal, and
                    pause-on-hover come with it. Raise one and press F8 to jump into the region."
            >
              <ToastSpecimen />
            </Specimen>

            <Specimen
              id="skeleton"
              name="Skeleton"
              note="An opacity pulse. Not a gradient sweep — guide §11 lists gradients under Avoid."
            >
              <Matrix>
                <Cell label="Product card placeholder" wide>
                  <div className="flex w-full max-w-xs flex-col gap-3">
                    <Skeleton className="aspect-[3/4] w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </Cell>
                <Cell label="Text lines">
                  <div className="flex w-full flex-col gap-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </Cell>
              </Matrix>
            </Specimen>

            <Specimen
              id="badge"
              name="Badge"
              note="Small, typographic, outlined. Never a filled sticker."
            >
              <Matrix>
                <Cell label="Variants" wide>
                  <Badge>New</Badge>
                  <Badge variant="accent">Sale</Badge>
                  <Badge variant="muted">Sold out</Badge>
                  <Badge variant="error">Payment failed</Badge>
                </Cell>

                <Cell label="Compare-at price — the G-14 answer" wide>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline gap-s">
                      <span className="font-sans text-body text-foreground">£96</span>
                      <span className="font-sans text-body-sm text-foreground-muted line-through">
                        £128
                      </span>
                      <Badge variant="accent">Sale</Badge>
                    </div>
                    <p className="max-w-prose font-sans text-body-sm text-foreground-muted">
                      The live price stays Bone; the struck-through price is Stone at 7.91:1, not
                      the dimmer tertiary tone, because it is still information a customer reads. No
                      red, no fill — the strike and the label carry it.
                    </p>
                  </div>
                </Cell>
              </Matrix>
            </Specimen>

            <Specimen id="separator" name="Separator and breadcrumb">
              <Matrix>
                <Cell label="Separator — horizontal and vertical" wide>
                  <div className="flex w-full flex-col gap-m">
                    <Separator />
                    <div className="flex h-8 items-center gap-m">
                      <span className="font-sans text-body-sm text-foreground-muted">XS</span>
                      <Separator orientation="vertical" />
                      <span className="font-sans text-body-sm text-foreground-muted">S</span>
                      <Separator orientation="vertical" />
                      <span className="font-sans text-body-sm text-foreground-muted">M</span>
                    </div>
                  </div>
                </Cell>

                <Cell label="Breadcrumb" wide>
                  <Breadcrumb>
                    <BreadcrumbList>
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link href="/">Home</Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                          <Link href="/shop">Shop</Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>Heavyweight Hoodie</BreadcrumbPage>
                      </BreadcrumbItem>
                    </BreadcrumbList>
                  </Breadcrumb>
                </Cell>
              </Matrix>
            </Specimen>
          </SpecimenGroup>

          {/* ================================================================
              SHELL
              ============================================================= */}
          <SpecimenGroup
            id="shell"
            title="Global shell"
            description="Plan §3.1d. The header and footer at the top and bottom of this page are the
                         real components. Below are the layout wrappers everything else composes from."
          >
            <Specimen
              id="page-title"
              name="Page title"
              note="Guide §01's visual tension made concrete: 12px tracked metadata above 72px serif."
            >
              <div className="rounded-sm border border-border p-m">
                <PageTitle
                  eyebrow="Spring / Summer '26"
                  size="display-xl"
                  lede="Discover the collection."
                >
                  New Season.
                  <br />
                  New Standard.
                </PageTitle>
              </div>
            </Specimen>

            <Specimen
              id="section"
              name="Section and section heading"
              note="Section padding is fluid between the guide's XL and XXL steps, so vertical rhythm
                    cannot drift page to page."
            >
              <div className="rounded-sm border border-border">
                <Section spacing="tight" className="px-m">
                  <SectionHeading
                    action={
                      <Link href="/shop" variant="meta">
                        View all
                      </Link>
                    }
                  >
                    New arrivals
                  </SectionHeading>
                  <div className="mt-m grid grid-cols-2 gap-s sm:grid-cols-4">
                    {Array.from({ length: 4 }, (_, i) => (
                      <Skeleton key={i} className="aspect-[3/4]" />
                    ))}
                  </div>
                </Section>
              </div>
            </Specimen>

            <Specimen
              id="editorial-block"
              name="Editorial block"
              note="7:5 and 5:7 on a twelve-column grid — never halves. Media leads on mobile whichever
                    side it takes on desktop."
            >
              <div className="flex flex-col gap-l">
                {(['media-start', 'media-end'] as const).map((layout) => (
                  <div key={layout} className="rounded-sm border border-border p-m">
                    <EditorialBlock
                      layout={layout}
                      media={<Skeleton className="aspect-[4/3] w-full" />}
                    >
                      <p className="font-sans text-meta uppercase text-foreground-muted">
                        {layout}
                      </p>
                      <h3 className="font-display text-heading-m">
                        Shaped by purpose. Driven by detail.
                      </h3>
                      <p className="font-sans text-body-sm text-foreground-muted">
                        Our story, our materials, our promise.
                      </p>
                      <Link href="/about" variant="meta">
                        Read our story
                      </Link>
                    </EditorialBlock>
                  </div>
                ))}
              </div>
            </Specimen>

            <Specimen
              id="page-container"
              name="Page container"
              note="Three measures, one gutter. The gutter is fluid from 20px to 64px so content never
                    reaches the screen edge and never floats untethered on a wide display."
            >
              <div className="flex flex-col gap-s">
                {(['page', 'narrow', 'prose'] as const).map((width) => (
                  <div key={width} className="rounded-sm border border-border py-3">
                    <PageContainer width={width}>
                      <div className="flex items-center justify-between gap-m bg-surface px-3 py-2">
                        <code className="font-mono text-micro uppercase text-accent">{width}</code>
                        <span className="font-sans text-micro uppercase text-foreground-muted">
                          {width === 'page' ? '1440px' : width === 'narrow' ? '1024px' : '672px'}
                        </span>
                      </div>
                    </PageContainer>
                  </div>
                ))}
              </div>
            </Specimen>

            <Specimen
              id="mobile"
              name="Mobile behaviour"
              note="Narrow this window to below 1024px. The primary navigation collapses into the
                    drawer, account and wishlist move inside it, and the wordmark centres between the
                    menu button and the two remaining utilities."
            >
              <p className="max-w-prose font-sans text-body-sm text-foreground-muted">
                Every specimen on this page is laid out on a grid that collapses to a single column
                below 640px, so this whole sheet doubles as the mobile-width check that plan §3.1d
                asks for. The drawer specimens above are the ones to open on a phone — they are what
                the mobile navigation and the cart become.
              </p>
            </Specimen>
          </SpecimenGroup>
        </PageContainer>
      </main>

      <SiteFooter />
    </>
  )
}
