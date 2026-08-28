import { Link, NewTabHint } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import type { ShellAnnouncement } from '@/lib/navigation/resolve'

/**
 * The announcement bar — plan §6.1a's *"maintenance/banner messaging"*, in the half of it that is
 * content.
 *
 * `SiteSettings.ts` explains why only this half exists: a maintenance *switch* that nothing enforces
 * is a control that lies to the editor who flips it, so the schema carries a message an editor
 * writes and this renders, and nothing else.
 *
 * ### It is above the sticky header, and it does not stick
 *
 * A promotional line that follows the customer down a product page is exactly the *"never visually
 * overpower content"* that structure §3 rules out for the header itself, and it would cost 40px of
 * a phone's viewport permanently. It scrolls away and comes back at the top of the page, which is
 * also what makes the header's compact-on-scroll sentinel land in a sensible place.
 *
 * There is no dismiss control. A dismissal has to be remembered to mean anything, and remembering it
 * is either a cookie — a consent question this project has not reached (Phase 26/34) — or a
 * `localStorage` read that makes a server-rendered bar flicker on every page load. One short line
 * that scrolls away is quieter than either.
 *
 * Guide §06, §11: no fill louder than `surface`, a hairline beneath, micro type, tracked. The bar is
 * the quietest thing on the page that is still legible.
 */
export function AnnouncementBar({ announcement }: { announcement: ShellAnnouncement }) {
  const content = (
    <span className="font-sans text-micro uppercase text-foreground-muted">
      {announcement.message}
      {announcement.external ? <NewTabHint /> : null}
    </span>
  )

  return (
    <div
      data-slot="announcement-bar"
      className={cn(
        'flex w-full items-center justify-center border-b border-border bg-surface',
        'px-[clamp(1.25rem,4vw,4rem)] py-2 text-center',
      )}
    >
      {announcement.href ? (
        <Link
          href={announcement.href}
          variant="unstyled"
          external={announcement.external}
          className="transition-colors duration-(--duration-fast) ease-entrance hover:[&>span]:text-foreground"
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  )
}
