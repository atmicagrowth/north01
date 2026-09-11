import { AnnouncementBar } from '@/components/layout/announcement-bar'
import { HeaderBar } from '@/components/shell/header-bar'
import { cn } from '@/lib/cn'
import { getShell } from '@/lib/navigation/shell'
import { getShellSession } from '@/lib/navigation/shell-session'

/**
 * SiteHeader — plan §9.1a, mounted in the storefront root layout.
 *
 * This component is a **server** component and does exactly two things: it reads the shell once
 * (`getShell` memoises, so the footer's read below is free) and it puts the skip link, the
 * announcement bar and the interactive bar in the right order. Everything that needs an event
 * handler lives in `shell/header-bar.tsx` and its children, so the client bundle carries the
 * navigation and nothing else.
 *
 * ### The skip link is first in the document, deliberately
 *
 * WCAG 2.4.1 Bypass Blocks, Level A. The primary navigation repeats on every page, so a keyboard
 * user needs a way past it; automated checking cannot detect its absence, which is how a project
 * reaches Phase 9 without one. It is before the announcement bar as well as before the header,
 * because a promotional line is also a block to bypass.
 *
 * **The contract it creates:** every page renders inside the layout's single `<main id="main-content">`
 * and no page declares a `<main>` of its own. Phase 9 is where that became a rule rather than a
 * convention — the layout owns the landmark, so it cannot be forgotten one route at a time.
 */
export async function SiteHeader() {
  const { navigation, settings } = await getShell()

  /*
   * The bag count, for the trigger's badge. `getCart` is React-memoised for the render, so the
   * drawer below reads the same object — one query, two consumers. It returns `null` when there is
   * no cart at all, which is the common case and costs a single indexed lookup.
   */
  const { cart } = await getShellSession()

  return (
    <>
      <a
        href="#main-content"
        className={cn(
          'sr-only',
          'focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4',
          'focus-visible:z-50 focus-visible:rounded-sm focus-visible:border focus-visible:border-border-strong',
          'focus-visible:bg-surface-raised focus-visible:px-4 focus-visible:py-3',
          'focus-visible:font-sans focus-visible:text-meta focus-visible:uppercase',
          'focus-visible:text-foreground',
        )}
      >
        Skip to content
      </a>

      {settings.announcement ? <AnnouncementBar announcement={settings.announcement} /> : null}

      <HeaderBar
        cartCount={cart?.totals.itemCount ?? 0}
        items={navigation.primary}
        settings={settings}
      />
    </>
  )
}
