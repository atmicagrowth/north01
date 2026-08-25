import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * Button — visual guide §06.
 *
 * "Mostly rectangular or softly squared. Thin borders. Restrained fills. Uppercase
 * labels where appropriate. Compact letter spacing. Avoid oversized pill buttons as
 * the default." Radius is 2px; there is no pill variant, and `rounded-full` does not
 * exist in this system for anything that is not literally a circle.
 *
 * Three variants and no more. `primary` is the single strong call to action on a page —
 * a bone fill is the loudest thing the palette can do, so it stays rare. Everything
 * else is an outline or bare text.
 */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-sans text-meta uppercase',
    'rounded-sm border transition-colors',
    'duration-(--duration-fast) ease-entrance',
    // Disabled is styled, not merely inert: the control must read as unavailable
    // rather than broken. WCAG 1.4.3 exempts disabled controls from contrast, so a
    // recessed treatment is legitimate here and nowhere else.
    'disabled:pointer-events-none disabled:cursor-not-allowed',
    // Busy is a different state from unavailable and must not look like it, so each
    // variant restores its resting colours while loading (see the compound rules below).
    // `data-loading:disabled:*` compiles to `[data-loading]:disabled`, one class more
    // specific than the plain `disabled:*` it overrides — so the win is by specificity
    // rather than by stylesheet order, which Tailwind controls and we do not.
    //
    // Only colours are restored, not `pointer-events` — a `cursor-wait` would need
    // pointer events back on, and keeping them off is what stops a busy button
    // registering hover.

    // Icons inside a button are decoration for the label beside them.
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: [
          'border-foreground bg-foreground text-canvas',
          'hover:border-foreground-bright hover:bg-foreground-bright',
          'active:border-foreground-muted active:bg-foreground-muted',
          'disabled:border-border disabled:bg-border disabled:text-foreground-disabled',
          'data-loading:disabled:border-foreground data-loading:disabled:bg-foreground',
          'data-loading:disabled:text-canvas',
        ],
        secondary: [
          'border-border-control bg-transparent text-foreground',
          'hover:border-border-strong hover:bg-surface',
          'active:bg-surface-raised',
          'disabled:border-border disabled:bg-transparent disabled:text-foreground-disabled',
          'data-loading:disabled:border-border-control data-loading:disabled:text-foreground',
        ],
        ghost: [
          'border-transparent bg-transparent text-foreground-muted',
          'hover:text-foreground',
          'active:text-foreground-muted',
          'disabled:text-foreground-disabled',
          'data-loading:disabled:text-foreground-muted',
        ],
      },
      size: {
        // 36px. For dense utility rows only; keep 24px of clear space around it so
        // the WCAG 2.5.8 target-size minimum is still met by spacing.
        sm: 'h-9 px-4',
        // 44px — the default, and the WCAG 2.5.5 (AAA) target size.
        md: 'h-11 px-6',
        // 52px. Primary commerce actions.
        lg: 'h-13 px-8',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      block: false,
    },
  },
)

/**
 * `asChild` and `loading` are mutually exclusive, and the type says so.
 *
 * `asChild` hands the consumer's element to Radix's Slot, which adopts a child only when
 * there is exactly one of them. A spinner is necessarily a second child, so the two
 * features cannot both be honoured — the earlier implementation rendered the label
 * wrapper *and* a `{loading ? … : null}` slot unconditionally, and `React.Children.count`
 * counts that `null`, so **every** `<Button asChild>` threw "Slot failed to slot onto its
 * children" whether or not `loading` was set. Nothing caught it: TypeScript cannot model
 * child arity, and no call site used it yet.
 *
 * Rather than reconcile them, the combination is now unrepresentable. It is also
 * meaningless: `asChild` exists to turn this into a link, and a link navigates rather
 * than submits, so it has nothing to be busy about.
 */
type ButtonOwnProps = VariantProps<typeof buttonVariants> &
  (
    | {
        /** Render as the single child element instead of a `<button>`. */
        asChild: true
        loading?: never
      }
    | {
        asChild?: false
        /**
         * Marks the action as in flight: sets `aria-busy`, blocks activation, and swaps the
         * label for a spinner without changing the button's width — a commerce button that
         * resizes mid-submit moves the layout under the customer's cursor.
         *
         * Busy is expressed with the real `disabled` attribute rather than `aria-disabled`
         * plus a JavaScript click guard. The guard version was written first and reverted:
         * attaching an `onClick` unconditionally makes this component impossible to render
         * from a Server Component, and Button is used from server components throughout.
         * `disabled` needs no JavaScript, cannot be raced, and keeps the primitive free of a
         * client boundary.
         *
         * **The consequence to know about:** a `<button>` that becomes disabled while focused
         * loses focus to the document body. In a real submit flow the surrounding form has to
         * move focus somewhere deliberate and announce the result. **Phase 7 owns that**, when
         * forms first exist; it is a form-level responsibility, not something a button
         * primitive can solve for its caller.
         */
        loading?: boolean
      }
  )

export type ButtonProps = ComponentProps<'button'> & ButtonOwnProps

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, block }), className)

  // Exactly one child, which is what Slot requires to adopt it.
  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={classes} {...props}>
        {children}
      </Slot.Root>
    )
  }

  return (
    <button
      data-slot="button"
      data-loading={loading || undefined}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {/*
        Kept in the layout so the button does not change width, and faded with `opacity-0`
        rather than `invisible`. That distinction is load-bearing: `visibility: hidden`
        removes the text from the accessibility tree, which leaves a loading button with no
        accessible name at all — axe-core flagged exactly that as a critical `button-name`
        violation on the first pass. Opacity hides it from sight and keeps the name.
      */}
      <span className={cn('inline-flex items-center justify-center gap-2', loading && 'opacity-0')}>
        {children}
      </span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle aria-hidden data-motion="essential" className="size-4 animate-spin" />
        </span>
      ) : null}
    </button>
  )
}

export { buttonVariants }
