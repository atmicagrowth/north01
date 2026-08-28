import { RichText, type JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import type { ReactNode } from 'react'

import { Link } from '@/components/ui/link'
import { cn } from '@/lib/cn'
import { isExternalHref, isInternalHref } from '@/lib/navigation/routes'

/**
 * **Lexical rich text, rendered into the design system.**
 *
 * Campaign stories, editorial bodies and split-feature copy are all `richText` fields, so Phase 10
 * is the **first phase to put editor-authored rich text on a public page**. Two consequences follow,
 * and the second is a security boundary.
 *
 * ### It adds no client JavaScript
 *
 * `RichText` from `@payloadcms/richtext-lexical/react` is a plain function component — no
 * `'use client'` anywhere in its module graph, verified in
 * `dist/features/converters/lexicalToJSX/Component/index.js`. It renders inside a React Server
 * Component and ships nothing to the browser, which is what keeps the homepage at two client
 * components.
 *
 * ### Every href is re-validated at render — decision **D-35**
 *
 * `payload.config.ts` registers `LinkFeature()` with no `fields` override, so a link node stores
 * **whatever URL the editor typed**, unvalidated. That is a different posture from every other link
 * in this application: `fields/link.ts` refuses anything but a rooted path or an absolute `http(s)`
 * URL *at save time*, and `navigation/resolve.ts` re-checks it *at render*. A Lexical link has been
 * through neither.
 *
 * So it is checked here, with the same two functions, and a link that fails **renders as plain
 * text** rather than as a disabled or missing element. That closes `javascript:` and `data:` URLs,
 * and it closes the protocol-relative `//evil.example` and the tab-prefixed `/\t/evil.example` that
 * Phase 9's audit found in four other places — because `isInternalHref` is `lib/same-site-path.ts`,
 * the one rule, rather than a `startsWith` written out again here.
 *
 * Dropping to text rather than dropping the words is the right failure: the sentence an editor wrote
 * still reads, and only the navigation is removed.
 *
 * ### Headings cannot break the page outline
 *
 * The editor config caps headings at `h2`/`h3` (`payload.config.ts`), so prose can never emit an
 * `h1` and compete with the hero. The converters below keep that true by rendering the tags the
 * nodes actually carry, at the type scale rather than at browser defaults.
 */

/** A link the customer may safely be sent to, or `null`. */
function safeHref(value: unknown): null | string {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  return isInternalHref(trimmed) || isExternalHref(trimmed) ? trimmed : null
}

const converters: JSXConvertersFunction = ({ defaultConverters }) => ({
  ...defaultConverters,

  paragraph: ({ node, nodesToJSX }) => {
    const children = nodesToJSX({ nodes: node.children })

    // Lexical emits an empty paragraph for a blank line; a `<p>` with nothing in it is a gap.
    return children.length === 0 ? null : <p>{children}</p>
  },

  heading: ({ node, nodesToJSX }) => {
    const children = nodesToJSX({ nodes: node.children })

    return node.tag === 'h3' ? (
      <h3 className="font-display text-heading-s">{children}</h3>
    ) : (
      <h2 className="font-display text-heading-m">{children}</h2>
    )
  },

  link: ({ node, nodesToJSX }) => {
    const children = nodesToJSX({ nodes: node.children })
    const fields = node.fields as { newTab?: boolean | null; url?: unknown } | undefined
    const href = safeHref(fields?.url)

    // The words survive; only the navigation is removed. See the docblock.
    if (!href) {
      return <>{children}</>
    }

    const external = isExternalHref(href)

    return (
      <Link href={href} variant="inline" external={external || Boolean(fields?.newTab)}>
        {children}
      </Link>
    )
  },
})

/**
 * A block of editorial copy.
 *
 * `tone="lede"` is the standfirst under a campaign headline — one size up and in the primary
 * foreground. Everything else is body copy in Stone, which is guide §02's rule that *"stone and
 * muted stone are supporting colors"* applied to the one place long prose appears.
 *
 * The vertical rhythm is `space-y` on the container rather than margins on the children, so an
 * empty first paragraph cannot leave a gap at the top of a section.
 */
export function Prose({
  value,
  className,
  tone = 'body',
}: {
  /** A Lexical document from Payload. `null`/`undefined` renders nothing. */
  value: unknown
  className?: string
  tone?: 'body' | 'lede'
}): ReactNode {
  if (!value || typeof value !== 'object') {
    return null
  }

  return (
    <div
      data-slot="prose"
      className={cn(
        'space-y-m font-sans',
        tone === 'lede' ? 'text-body text-foreground' : 'text-body text-foreground-muted',
        '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:mt-1',
        '[&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-m',
        '[&_blockquote]:font-display [&_blockquote]:text-heading-s [&_blockquote]:text-foreground',
        className,
      )}
    >
      <RichText
        data={value as Parameters<typeof RichText>[0]['data']}
        converters={converters}
        disableContainer
      />
    </div>
  )
}
