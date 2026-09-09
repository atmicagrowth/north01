import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { ReactNode } from 'react'

import { COLOR, CONTAINER_WIDTH, FONT, SPACE, TYPE } from './theme'

/**
 * **The frame every message shares** — plan §19.1b's *"branded"*, made into one component so that it
 * is branded the same way eight times.
 *
 * ### Why this is deliberately plain
 *
 * Visual guide §11 lists *"excessive gradients"*, *"glows"*, *"rounded-card overload"* and
 * *"excessive shadows"* under Avoid, and an inbox punishes all four harder than a browser does. What
 * is left is what the guide actually asks for: black surfaces, bone typography, one hairline rule,
 * strong left alignment, and metadata set small and wide against larger type.
 *
 * There is **no image and no tracking pixel** in any of these templates. Two reasons, and the second
 * is the one that decided it: a remote image is blocked by default in most clients, so a design that
 * depends on one is a design that arrives broken; and a transactional receipt that phones home when
 * opened is a surveillance decision nobody asked for. The wordmark is therefore set as text, which
 * also means it renders in a text-only client.
 *
 * ### Dark by default, and what that costs
 *
 * The shop is Obsidian and this follows it. Some clients — Gmail on Android most aggressively —
 * invert or re-tint dark palettes, and there is no reliable way to stop them. The mitigation is that
 * every colour here is either near-black or near-bone, so an inversion produces a legible light
 * message rather than a broken one. Contrast is checked at both ends: Bone on Obsidian is 17.10:1,
 * and Obsidian on Bone is the same ratio.
 */
export function EmailShell({
  children,
  footnote,
  preview,
}: {
  children: ReactNode
  /** A closing line under the rule — what to do if this message was not expected. */
  footnote?: ReactNode
  /** The inbox preview line. Never a repeat of the subject; it earns its own sentence. */
  preview: string
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: COLOR.canvas,
          color: COLOR.foreground,
          fontFamily: FONT.sans,
          margin: 0,
          padding: `${SPACE.l}px ${SPACE.m}px`,
        }}
      >
        <Container style={{ margin: '0 auto', maxWidth: `${CONTAINER_WIDTH}px`, width: '100%' }}>
          <Section>
            <Text
              style={{
                ...TYPE.meta,
                color: COLOR.foregroundBright,
                fontFamily: FONT.sans,
                margin: 0,
                textTransform: 'uppercase',
              }}
            >
              NORTH / 01
            </Text>
          </Section>

          <Hr style={dividerStyle(SPACE.m)} />

          {children}

          <Hr style={dividerStyle(SPACE.l)} />

          {footnote ? (
            <Text
              style={{
                ...TYPE.bodySmall,
                color: COLOR.foregroundMuted,
                fontFamily: FONT.sans,
                margin: `0 0 ${SPACE.s}px`,
              }}
            >
              {footnote}
            </Text>
          ) : null}

          <Text
            style={{
              ...TYPE.micro,
              color: COLOR.foregroundFaint,
              fontFamily: FONT.sans,
              margin: 0,
              textTransform: 'uppercase',
            }}
          >
            NORTH / 01 — Online only
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

function dividerStyle(marginY: number) {
  return {
    border: 'none',
    borderTop: `1px solid ${COLOR.border}`,
    margin: `${marginY}px 0`,
  }
}

/** The one big line. Serif, because the guide reserves the display face for statements. */
export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        ...TYPE.headingM,
        color: COLOR.foregroundBright,
        fontFamily: FONT.serif,
        fontWeight: 400,
        margin: `0 0 ${SPACE.s}px`,
      }}
    >
      {children}
    </Text>
  )
}

/** Reading copy. Weight 400, per the guide's rule that only reading copy is 400. */
export function EmailText({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <Text
      style={{
        ...TYPE.body,
        color: muted ? COLOR.foregroundMuted : COLOR.foreground,
        fontFamily: FONT.sans,
        fontWeight: 400,
        margin: `0 0 ${SPACE.s}px`,
      }}
    >
      {children}
    </Text>
  )
}

/** Uppercase, wide-tracked, small. Section labels and order references. */
export function EmailMeta({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        ...TYPE.meta,
        color: COLOR.foregroundMuted,
        fontFamily: FONT.sans,
        fontWeight: 500,
        margin: `0 0 ${SPACE.xs}px`,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  )
}

/**
 * A bordered call to action.
 *
 * Not a `<Button>` with a background fill: the guide asks for *"restrained fills"* and *"thin
 * borders"*, and one strong fill per page. In an email the whole message is the page, so the border
 * treatment is the right one — and a bordered link degrades to a legible underlined link when a
 * client strips the styling, where a white-on-white filled button does not.
 */
export function EmailAction({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Section style={{ margin: `${SPACE.m}px 0` }}>
      <Link
        href={href}
        style={{
          ...TYPE.meta,
          border: `1px solid ${COLOR.foreground}`,
          borderRadius: '2px',
          color: COLOR.foreground,
          display: 'inline-block',
          fontFamily: FONT.sans,
          fontWeight: 500,
          padding: '14px 24px',
          textDecoration: 'none',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </Link>
    </Section>
  )
}

/**
 * The same destination as text.
 *
 * Every message that carries an action also prints its URL, because a client that strips the anchor
 * leaves a customer with a button that does nothing and no way to reach the page. `resetPasswordEmail`
 * established this in Phase 7 and it is kept.
 */
export function EmailFallbackUrl({ href }: { href: string }) {
  return (
    <Text
      style={{
        ...TYPE.bodySmall,
        color: COLOR.foregroundMuted,
        fontFamily: FONT.sans,
        margin: `0 0 ${SPACE.s}px`,
        wordBreak: 'break-all',
      }}
    >
      {href}
    </Text>
  )
}

/** A label/value pair, right-aligned value. Totals, tracking numbers, dates. */
export function EmailRow({
  emphasis = false,
  label,
  value,
}: {
  emphasis?: boolean
  label: string
  value: string
}) {
  return (
    <Section style={{ margin: `0 0 ${SPACE.xs}px` }}>
      <table cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          <tr>
            <td
              style={{
                ...(emphasis ? TYPE.headingS : TYPE.bodySmall),
                color: emphasis ? COLOR.foregroundBright : COLOR.foregroundMuted,
                fontFamily: FONT.sans,
                textAlign: 'left',
              }}
            >
              {label}
            </td>
            <td
              style={{
                ...(emphasis ? TYPE.headingS : TYPE.bodySmall),
                color: emphasis ? COLOR.foregroundBright : COLOR.foreground,
                fontFamily: FONT.sans,
                textAlign: 'right',
              }}
            >
              {value}
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  )
}
