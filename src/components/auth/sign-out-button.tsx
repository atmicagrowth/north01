'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { logout } from '@/lib/auth/actions'

/**
 * Sign out. A form, not a link.
 *
 * A `<a href="/logout">` would be a GET, which means a link prefetcher, a browser preloading on
 * hover, or an antivirus scanner following links in a page can sign the customer out without them
 * touching anything. Any action with a side effect is a POST, and here that costs a two-line form.
 *
 * `useActionState` is used only for its `pending`; the action redirects, so its state is never
 * rendered. The `null` state and the ignored first argument are the price of the hook's signature.
 */
export function SignOutButton() {
  const [, action, pending] = useActionState(async () => {
    await logout()

    return null
  }, null)

  return (
    <form action={action}>
      <Button type="submit" variant="secondary" loading={pending}>
        Sign out
      </Button>
    </form>
  )
}
