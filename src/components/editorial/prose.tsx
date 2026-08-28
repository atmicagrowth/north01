import type { SerializedAutoLinkNode, SerializedLinkNode } from '@payloadcms/richtext-lexical'
import type { JSXConverter } from '@payloadcms/richtext-lexical/react'
import { RichText, type JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import type { ReactNode } from 'react'

import { Link, NewTabHint } from '@/components/ui/link'
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
 * ### Why the converter map is built explicitly, and not by spreading the defaults
 *
 * **The first version of this file spread `defaultConverters` and overrode `link` alone. That left a
 * hole, and Phase 10's audit walked through it.** Lexical has *two* link node types — `link`, which
 * the toolbar creates, and **`autolink`**, which the editor's own plugin creates the moment someone
 * types something URL-shaped. `LinkJSXConverter` renders `autolink` as
 * `<a href={node.fields.url}>` with no validation whatever, and spreading the defaults inherited it.
 * Reproduced end to end: a campaign story saved through the Local API with an `autolink` node
 * rendered `<a href="//evil.example/phish">` and `<a href="data:text/html;base64,…">` on the page,
 * while the identical URLs written as `link` nodes correctly degraded to text.
 *
 * It is worse than an oversight in the override, because the *save* side cannot catch it either:
 * `AutoLinkNode`'s server config declares no `getSubFields`, so the `url` field's own hooks and
 * validators never run on it. Nothing between an editor's keystroke and a customer's browser
 * inspects that string except this file.
 *
 * So every converter is now listed by name. Two consequences, both wanted:
 *
 * 1. **`link` and `autolink` share one sanitised implementation.** Neither can drift from the other.
 * 2. **Node types this editor does not enable render nothing.** `payload.config.ts` enables
 *    paragraph, headings, bold, italic, link, lists, blockquote and the inline toolbar — and no
 *    upload, table, horizontal rule or tab feature. The default map supplies converters for all four
 *    anyway, so a node inserted by a script, an import, or a future config change would render with
 *    no design-system styling and — for `upload` — with an editor-controlled `src` and a
 *    `<link rel="preload">`. A converter for a feature the editor does not have is a rendering path
 *    nobody is maintaining.
 *
 * The rule for anyone enabling a new Lexical feature: **add its converter here in the same commit.**
 * Text that silently disappears is a visible bug; an unvalidated attribute is not.
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

/** A node type the editor does not enable. Rendering nothing is the honest answer. */
const renderNothing = () => null

const converters: JSXConvertersFunction = ({ defaultConverters }) => {
  /**
   * One implementation for both link node types.
   *
   * `newTab` is an editor's choice and it is honoured, but it is **announced** — `Link`'s own
   * docblock says the component cannot write the copy and requires the caller to say so, and here
   * the caller is a CMS field no reviewer sees before it renders. A visually hidden suffix is the
   * only way to keep WCAG 3.2.5 without constraining what an editor may type, which is exactly the
   * argument `NewTabHint` was created for in the site footer.
   */
  const renderLink: JSXConverter<SerializedAutoLinkNode | SerializedLinkNode> = ({
    node,
    nodesToJSX,
  }) => {
    const children = nodesToJSX({ nodes: node.children })
    const href = safeHref(node.fields?.url)

    // The words survive; only the navigation is removed. See the docblock.
    if (!href) {
      return <>{children}</>
    }

    const newTab = isExternalHref(href) || Boolean(node.fields?.newTab)

    return (
      <Link href={href} variant="inline" external={newTab}>
        {children}
        {newTab ? <NewTabHint /> : null}
      </Link>
    )
  }

  return {
    // --- enabled by `payload.config.ts`, rendered into the design system
    text: defaultConverters.text,
    linebreak: defaultConverters.linebreak,
    list: defaultConverters.list,
    listitem: defaultConverters.listitem,
    quote: defaultConverters.quote,

    link: renderLink,
    autolink: renderLink,

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

    // --- not enabled by this editor. See the docblock.
    upload: renderNothing,
    table: renderNothing,
    tablerow: renderNothing,
    tablecell: renderNothing,
    horizontalrule: renderNothing,
    tab: renderNothing,
  }
}

/**
 * A block of editorial copy.
 *
 * `tone="lede"` is the standfirst under a campaign headline. It is the **same size** as body copy and
 * differs only in colour — Bone rather than Stone. That is deliberate and it is the whole of the
 * difference: guide §03 warns against *"making every section headline enormous"*, and guide §02 says
 * *"stone and muted stone are supporting colors, not headline colors"*, so the standfirst is
 * promoted by contrast rather than by scale. (An earlier version of this comment claimed "one size
 * up", which the code never did.)
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
