import { Hr, render, Section } from '@react-email/components'
import type { ReactElement } from 'react'

import type { EmailKind } from '@/lib/email/rules'

import {
  EmailAction,
  EmailFallbackUrl,
  EmailHeading,
  EmailMeta,
  EmailRow,
  EmailShell,
  EmailText,
} from './shell'
import { COLOR, FONT, SPACE, TYPE } from './theme'

/**
 * **§19.1b's eight templates.**
 *
 * They sit in one file on purpose. Eight messages from one shop should read as though one person
 * wrote them, and the fastest way to notice that one of them has drifted into a different voice is to
 * have the other seven immediately above it.
 *
 * ### Every template is a pure function of data it is handed
 *
 * No template reads a database, formats a currency, resolves a URL or knows what environment it is
 * in. Money arrives pre-formatted, links arrive absolute. That is what lets `pnpm verify:email`
 * render all eight and assert their content without a Payload instance — and it is the same split
 * every `rules.ts` in this project uses.
 *
 * ### The voice
 *
 * Short sentences, no exclamation marks, no marketing in a transactional message. Where a status has
 * already been written for the storefront, the template reuses that wording rather than inventing a
 * second one: `DISPLAY_STATUS_COPY` in `lib/orders/rules.ts` is the approved customer voice for
 * shipped, delivered and refunded, and these echo it.
 */

/* -------------------------------------------------------------------------------------------------
 * What each template is handed
 * ---------------------------------------------------------------------------------------------- */

export type OrderLine = {
  /** Pre-formatted. The template never sees minor units. */
  lineTotal: string
  productName: string
  quantity: number
  variantLabel: string
}

export type EmailData = {
  contactConfirmation: { name: null | string }
  orderConfirmation: {
    discount: null | string
    lines: OrderLine[]
    orderNumber: string
    shipping: null | string
    shippingMethodLabel: null | string
    shippingEstimate?: null | string
    subtotal: null | string
    tax: null | string
    total: string
  }
  orderDelivered: { orderNumber: string }
  orderShipped: {
    carrier: null | string
    orderNumber: string
    trackingNumber: null | string
    trackingUrl: null | string
  }
  passwordReset: { resetHref: string }
  refund: { amount: null | string; orderNumber: string }
  verification: { verifyHref: string }
  welcome: { accountHref: string; firstName: null | string }
}

/* -------------------------------------------------------------------------------------------------
 * Account
 * ---------------------------------------------------------------------------------------------- */

function Welcome({ accountHref, firstName }: EmailData['welcome']) {
  return (
    <EmailShell preview="Your account is ready. Nothing to confirm.">
      <EmailHeading>{firstName ? `Welcome, ${firstName}.` : 'Welcome.'}</EmailHeading>
      <EmailText>
        Your account is ready. Orders you place from now on will be kept here, so you can find a
        receipt or a tracking number without searching your inbox for it.
      </EmailText>
      <EmailAction href={accountHref}>Your account</EmailAction>
      <EmailFallbackUrl href={accountHref} />
    </EmailShell>
  )
}

/**
 * Unwired on purpose. `Customers.auth.verify` is deliberately off — turning it on would make every
 * registration depend on a message being delivered, and Phase 7 recorded that decision. The template
 * exists because §19.1b names it and because the day verification is switched on should not also be
 * the day somebody writes the email in a hurry.
 */
function Verification({ verifyHref }: EmailData['verification']) {
  return (
    <EmailShell preview="One link to confirm this address belongs to you.">
      <EmailHeading>Confirm your email address.</EmailHeading>
      <EmailText>
        Use the link below to confirm this address. If you did not create an account with us,
        nothing will happen — you can ignore this.
      </EmailText>
      <EmailAction href={verifyHref}>Confirm address</EmailAction>
      <EmailFallbackUrl href={verifyHref} />
    </EmailShell>
  )
}

/**
 * The one template that replaces something already in production. Phase 7's
 * `payload/email/resetPasswordEmail.ts` said what must not change when Phase 19 restyled it: *"the
 * destination and the query parameter, which the reset page reads."* Both are carried by `resetHref`,
 * which is built by the same module that built it before.
 */
function PasswordReset({ resetHref }: EmailData['passwordReset']) {
  return (
    <EmailShell
      footnote="If you did not ask for this, you can ignore it — your password has not changed, and the link expires on its own."
      preview="One link to choose a new password. It expires in an hour."
    >
      <EmailHeading>Choose a new password.</EmailHeading>
      <EmailText>Use the link below to set a new password on your account.</EmailText>
      <EmailAction href={resetHref}>Choose a new password</EmailAction>
      <EmailFallbackUrl href={resetHref} />
      <EmailText muted>This link can be used once and expires in one hour.</EmailText>
    </EmailShell>
  )
}

/**
 * Also unwired: no contact form exists yet — the contact and help routes are gap **G-08**, assigned
 * to Phase 23. §19.1b names the template, so it is written and tested; Phase 23 supplies the sender.
 */
function ContactConfirmation({ name }: EmailData['contactConfirmation']) {
  return (
    <EmailShell preview="We have your message and will reply by email.">
      <EmailHeading>{name ? `Thank you, ${name}.` : 'Thank you.'}</EmailHeading>
      <EmailText>
        We have your message. Someone will reply to this address — usually within two working days.
      </EmailText>
      <EmailText muted>There is nothing you need to do in the meantime.</EmailText>
    </EmailShell>
  )
}

/* -------------------------------------------------------------------------------------------------
 * Orders
 * ---------------------------------------------------------------------------------------------- */

/**
 * The receipt.
 *
 * It prints the lines and the totals because **this message is the record**. `/checkout/success`
 * already tells a customer so — *"if you have just paid, your confirmation email is the record"* —
 * and that sentence is only true if the email contains what a receipt contains. Every figure is a
 * snapshot taken at purchase, from `order-items`, so it stays correct after the product is edited.
 */
function OrderConfirmation({
  discount,
  lines,
  orderNumber,
  shipping,
  shippingEstimate,
  shippingMethodLabel,
  subtotal,
  tax,
  total,
}: EmailData['orderConfirmation']) {
  return (
    <EmailShell
      footnote="Keep this message — it is the record of what you ordered and what you paid."
      preview={`Order ${orderNumber} is confirmed. Here is what you ordered.`}
    >
      <EmailMeta>Order {orderNumber}</EmailMeta>
      <EmailHeading>Thank you — your order is confirmed.</EmailHeading>
      <EmailText>
        We have your payment and are getting the order ready to send. You will hear from us again
        when it is on its way.
      </EmailText>

      <Hr
        style={{ border: 'none', borderTop: `1px solid ${COLOR.border}`, margin: `${SPACE.m}px 0` }}
      />

      {lines.map((line, index) => (
        <Section key={`${line.productName}-${index}`} style={{ margin: `0 0 ${SPACE.s}px` }}>
          <table
            cellPadding={0}
            cellSpacing={0}
            style={{ borderCollapse: 'collapse', width: '100%' }}
          >
            <tbody>
              <tr>
                <td style={{ ...TYPE.bodySmall, color: COLOR.foreground, fontFamily: FONT.sans }}>
                  {line.productName}
                  <br />
                  <span style={{ color: COLOR.foregroundMuted }}>
                    {line.variantLabel} · {line.quantity}
                  </span>
                </td>
                <td
                  style={{
                    ...TYPE.bodySmall,
                    color: COLOR.foreground,
                    fontFamily: FONT.sans,
                    textAlign: 'right',
                    verticalAlign: 'top',
                  }}
                >
                  {line.lineTotal}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      ))}

      <Hr
        style={{ border: 'none', borderTop: `1px solid ${COLOR.border}`, margin: `${SPACE.m}px 0` }}
      />

      {subtotal ? <EmailRow label="Subtotal" value={subtotal} /> : null}
      {discount ? <EmailRow label="Discount" value={discount} /> : null}
      {shipping ? <EmailRow label={shippingMethodLabel ?? 'Delivery'} value={shipping} /> : null}
      {shippingEstimate ? <EmailRow label="Estimated delivery" value={shippingEstimate} /> : null}
      {tax ? <EmailRow label="Tax" value={tax} /> : null}
      <EmailRow emphasis label="Total" value={total} />
    </EmailShell>
  )
}

/**
 * §18.1c: *"When marking shipped: require tracking where appropriate. Store carrier. Store tracking
 * number. Trigger shipment email."*
 *
 * `planFulfillmentChange` refuses the transition unless both the carrier and the tracking number are
 * present, so this template can rely on them — but it still guards, because a template that throws on
 * a null is a template that can take down a send.
 */
function OrderShipped({
  carrier,
  orderNumber,
  trackingNumber,
  trackingUrl,
}: EmailData['orderShipped']) {
  return (
    <EmailShell preview={`Order ${orderNumber} has left us.`}>
      <EmailMeta>Order {orderNumber}</EmailMeta>
      <EmailHeading>On its way.</EmailHeading>
      <EmailText>Your order has left us. The carrier will have it from here.</EmailText>

      {carrier ? <EmailRow label="Carrier" value={carrier} /> : null}
      {trackingNumber ? <EmailRow label="Tracking" value={trackingNumber} /> : null}

      {trackingUrl ? (
        <>
          <EmailAction href={trackingUrl}>Track this parcel</EmailAction>
          <EmailFallbackUrl href={trackingUrl} />
        </>
      ) : null}
    </EmailShell>
  )
}

function OrderDelivered({ orderNumber }: EmailData['orderDelivered']) {
  return (
    <EmailShell
      footnote="If something is not right with the order, reply to this message and we will sort it out."
      preview={`Order ${orderNumber} has been delivered.`}
    >
      <EmailMeta>Order {orderNumber}</EmailMeta>
      <EmailHeading>Delivered.</EmailHeading>
      <EmailText>The carrier has marked your order as delivered.</EmailText>
    </EmailShell>
  )
}

/**
 * The refund figure is the one place the signal colour is used in an email. DEV-21 reserves Oxide for
 * signal, and money going back to a customer is the only thing in this set that qualifies.
 */
function Refund({ amount, orderNumber }: EmailData['refund']) {
  return (
    <EmailShell
      footnote="Refunds usually reach a card within five to ten working days, depending on the bank."
      preview={`Order ${orderNumber} has been refunded.`}
    >
      <EmailMeta>Order {orderNumber}</EmailMeta>
      <EmailHeading>Refunded.</EmailHeading>
      <EmailText>The money is on its way back to you.</EmailText>
      {amount ? (
        <Section style={{ margin: `${SPACE.m}px 0 0` }}>
          <table
            cellPadding={0}
            cellSpacing={0}
            style={{ borderCollapse: 'collapse', width: '100%' }}
          >
            <tbody>
              <tr>
                <td
                  style={{
                    ...TYPE.headingS,
                    color: COLOR.foregroundMuted,
                    fontFamily: FONT.sans,
                  }}
                >
                  Refunded
                </td>
                <td
                  style={{
                    ...TYPE.headingM,
                    color: COLOR.signal,
                    fontFamily: FONT.sans,
                    textAlign: 'right',
                  }}
                >
                  {amount}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      ) : null}
    </EmailShell>
  )
}

/* -------------------------------------------------------------------------------------------------
 * The registry
 * ---------------------------------------------------------------------------------------------- */

/**
 * One entry per kind, exhaustively keyed, so adding a kind to `EMAIL_KINDS` without writing its
 * template is a type error rather than a runtime one.
 */
const TEMPLATES: { [K in EmailKind]: (data: EmailData[K]) => ReactElement } = {
  contactConfirmation: ContactConfirmation,
  orderConfirmation: OrderConfirmation,
  orderDelivered: OrderDelivered,
  orderShipped: OrderShipped,
  passwordReset: PasswordReset,
  refund: Refund,
  verification: Verification,
  welcome: Welcome,
}

/**
 * Render one message to the two bodies a send needs.
 *
 * **Both, always.** A `text/plain` alternative is not a nicety: without one, several clients and most
 * spam filters treat an HTML-only transactional message as a worse citizen, and a customer reading in
 * a text-only client gets nothing at all. React Email produces it from the same component, so the two
 * cannot drift.
 */
export async function renderEmail<K extends EmailKind>(
  kind: K,
  data: EmailData[K],
): Promise<{ html: string; text: string }> {
  const element = TEMPLATES[kind](data)

  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])

  return { html, text }
}
