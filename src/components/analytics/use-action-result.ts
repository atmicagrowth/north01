'use client'

import { useEffect, useRef } from 'react'

/**
 * **Run something once, when a `useActionState` action comes back.**
 *
 * Plan §25.1a's events are emitted where they are **true**, which for a form is after the server
 * answered — not on click. A click that hits a sold-out variant, a rejected discount code or a
 * validation error is not an `add_to_cart`, and instrumenting the click would report one anyway.
 * That is the difference between a funnel and a wish.
 *
 * ### Why identity is the right guard
 *
 * `useActionState` returns whatever the action returned, and every invocation returns a **new
 * object** — two identical successes are two distinct references. Comparing by reference therefore
 * counts two adds of the same variant as two events, which is correct, while a re-render that does
 * not involve a submission changes nothing and fires nothing.
 *
 * The initial state is skipped, because a form that has been rendered and not submitted has produced
 * no result to report.
 *
 * `onResult` is held in a ref so an inline arrow at the call site — which every call site will
 * write — does not turn every render into a fire.
 */
export function useActionResult<S>(state: S, onResult: (state: S) => void): void {
  const seen = useRef<{ value: S } | null>(null)
  const handler = useRef(onResult)

  /*
   * The "latest ref" pattern, written in an effect rather than during render because
   * `react-hooks/refs` forbids the latter — and is right to: a ref written during render is a value
   * React cannot see, so a re-render triggered by anything else reads whatever the last render left
   * behind. Declared **before** the effect that reads it, because React runs effects in order.
   */
  useEffect(() => {
    handler.current = onResult
  })

  useEffect(() => {
    if (seen.current === null) {
      /* First render. There is no result yet, only the initial value. */
      seen.current = { value: state }

      return
    }

    if (seen.current.value === state) {
      return
    }

    seen.current = { value: state }

    handler.current(state)
  }, [state])
}
