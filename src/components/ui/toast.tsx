'use client'

import { CircleAlert, X } from 'lucide-react'
import { Toast as ToastPrimitive } from 'radix-ui'
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/cn'
import { IconButton } from '@/components/ui/icon-button'

/**
 * Toast — transient confirmation. "Added to bag", "Address saved", "Code not valid".
 *
 * **Built on Radix Toast rather than `sonner`.** The current shadcn abstraction is
 * sonner, which would add a second animation and stacking model plus `next-themes` (a
 * theme switcher, on a site with exactly one theme). Radix Toast is already in the
 * `radix-ui` package this project depends on, and it brings the parts that are hard to
 * get right: the `aria-live` region, swipe-to-dismiss, the pause-on-hover/focus timer,
 * and the F8 hotkey that moves focus into the notification region.
 *
 * Guide §06 applies: solid surface, 1px border, minimal shadowing, restrained motion.
 */

type ToastTone = 'default' | 'error'

type ToastRecord = {
  id: string
  title: string
  description?: string
  tone: ToastTone
  /** Milliseconds. `Infinity` keeps it until dismissed. */
  duration?: number
}

type ToastInput = Omit<ToastRecord, 'id' | 'tone'> & { tone?: ToastTone }

/**
 * `open` is tracked per toast so the exit animation can actually run.
 *
 * Dismissing used to delete the record inside `onOpenChange`, which unmounted the element
 * in the same commit — Radix wraps each toast in `<Presence>` precisely so the exit plays
 * to `animationend` first, and deleting the record stepped over it. The
 * `data-[state=closed]` and `data-[swipe=end]` animations were dead classes as a result.
 * Now dismissal flips `open` to false and the record is removed when its exit finishes.
 */
type LiveToast = ToastRecord & { open: boolean }

type ToastContextValue = {
  toast: (input: ToastInput) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/**
 * Mount once, high in the tree. Phase 9 puts this in the storefront layout; until then
 * only surfaces that raise a toast need it.
 */
export function ToastProvider({
  children,
  swipeDirection = 'right',
}: {
  children: ReactNode
  swipeDirection?: ComponentProps<typeof ToastPrimitive.Provider>['swipeDirection']
}) {
  const [toasts, setToasts] = useState<LiveToast[]>([])
  const idPrefix = useId()
  /*
   * A counter, not `crypto.randomUUID()`. `randomUUID` is only defined in a **secure
   * context**, so it is present on localhost and HTTPS but `undefined` when the dev
   * server is opened over plain HTTP on a LAN address — which is exactly how the mobile
   * behaviour this project requires gets tested. Raising a toast there would have thrown.
   * A per-provider counter is sufficient: these ids only need to be unique among the
   * toasts currently on screen, and `useId` already namespaces them per provider.
   */
  const nextId = useRef(0)

  /** Starts the exit. The record is removed by `remove` once the animation ends. */
  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, open: false } : t)))
  }, [])

  const remove = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (input: ToastInput) => {
      const id = `${idPrefix}-${(nextId.current += 1)}`
      setToasts((current) => [...current, { tone: 'default', ...input, id, open: true }])
      return id
    },
    [idPrefix],
  )

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection={swipeDirection} label="Notifications">
        {children}
        {toasts.map((t) => (
          <Toast
            key={t.id}
            record={t}
            onDismiss={() => dismiss(t.id)}
            onExited={() => remove(t.id)}
          />
        ))}
        <ToastViewport />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>.')
  }
  return context
}

function ToastViewport({ className, ...props }: ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        'fixed bottom-0 right-0 z-50 flex w-full flex-col gap-s p-m',
        'sm:max-w-panel',
        // No `outline-none`. Radix makes this container the F8 focus target, and
        // suppressing the ring removed the only signal that focus had moved into it.
        className,
      )}
      {...props}
    />
  )
}

function Toast({
  record,
  onDismiss,
  onExited,
}: {
  record: LiveToast
  onDismiss: () => void
  onExited: () => void
}) {
  const isError = record.tone === 'error'

  return (
    <ToastPrimitive.Root
      data-slot="toast"
      data-tone={record.tone}
      open={record.open}
      /*
       * Passed straight through, including `Infinity`. Radix handles it natively —
       * its timer starts with `if (!duration || duration === Infinity) return`.
       *
       * This previously converted `Infinity` to `Number.MAX_SAFE_INTEGER`, which broke
       * the feature it was meant to implement: `setTimeout` clamps above 2^31−1 ms and
       * fires **immediately** on overflow, so a toast asked to persist dismissed itself
       * within a millisecond. Measured at 0.1ms before the fix.
       */
      duration={record.duration}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
      // Fires for the enter animation too, so both guards matter: only this element, and
      // only once it has actually left.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && !record.open) onExited()
      }}
      className={cn(
        'flex items-start gap-m',
        'rounded-md border bg-surface-raised p-m shadow-overlay',
        isError ? 'border-error' : 'border-border',
        'data-[state=open]:animate-menu-in data-[state=closed]:animate-fade-out',
        // Radix drives the swipe offset; the toast follows the finger and springs back.
        'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)',
        'data-[swipe=cancel]:translate-x-0',
        'data-[swipe=end]:animate-fade-out',
      )}
    >
      {isError ? <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-error" /> : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ToastPrimitive.Title className="font-sans text-meta uppercase text-foreground">
          {record.title}
        </ToastPrimitive.Title>
        {record.description ? (
          <ToastPrimitive.Description className="font-sans text-body-sm text-foreground-muted">
            {record.description}
          </ToastPrimitive.Description>
        ) : null}
      </div>

      <ToastPrimitive.Close asChild>
        <IconButton label="Dismiss notification" size="sm" className="-mr-2 -mt-2">
          <X aria-hidden />
        </IconButton>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  )
}
