/**
 * **The support copy the seed writes and the owner has to publish by hand.**
 *
 * `TODO.md` §12 exists because the seed refuses every database but the development one (**D-10**),
 * so production's FAQs, contact address, returns policy and size-guide fit notes were entered
 * separately and kept the wording Phase 36's sweep corrected. That list used to be prose an owner
 * retyped. It is data now, and both writers read it from here:
 *
 * - `scripts/seed.ts`, which writes it to the development database;
 * - `scripts/publish-owner-content.ts`, which the owner runs once against production.
 *
 * So a corrected sentence cannot be true in one place and stale in the other, which is exactly what
 * §12 was tracking by hand.
 */

/** The owner's support address — supplied 2026-09-11, closing gap **G-08**. */
export const CONTACT_EMAIL = 'admin@micagrowth.com'

/** Site Settings → Policies → Shipping policy. */
export const SHIPPING_POLICY_PARAGRAPHS: readonly string[] = [
  'Standard delivery is free above the threshold shown in your bag, and charged below it. Express and overnight are quoted at checkout.',
  'Everything ships from a single fulfilment centre. There is no collection point — NORTH / 01 is an online shop.',
]

/**
 * Site Settings → Policies → Returns policy. The second paragraph is **DOC-01**: the old wording
 * described an online returns flow that does not exist and named an address that cannot receive mail.
 */
export const RETURNS_POLICY_PARAGRAPHS: readonly string[] = [
  'Anything unworn, with its tags on, can be returned within 30 days of delivery.',
  `Returns are arranged with our team rather than started online — email ${CONTACT_EMAIL} and we will send you what to do.`,
]

export type FaqSpec = {
  question: string
  topic: string
  answer: string
  sortOrder: number
}

/**
 * The six answers the shop can actually keep.
 *
 * **The questions are never reworded.** FAQs are upserted by question, so a changed question leaves
 * the old answer published beside the new one.
 */
export const FAQ_SPECS: readonly FaqSpec[] = [
  {
    question: 'When will my order ship?',
    topic: 'orders',
    /*
     * Sweep 1, S09: this promised same-working-day dispatch before 2pm, with no timezone, and nothing
     * backs a cut-off — dispatch is a staff member marking the order shipped in the admin, and a held
     * order waits for a person. What is true: the dispatch email carries the carrier and a tracking
     * number (`planFulfillmentChange` requires both), and delivery estimates run from dispatch. How
     * soon an order is dispatched is the owner's promise to make, not the seed's (TODO.md §12).
     */
    answer:
      'When your order leaves us, we email you the carrier and a tracking number. The delivery estimate shown at checkout counts from then, not from the day you ordered.',
    sortOrder: 10,
  },
  {
    question: 'How much is delivery?',
    topic: 'shipping',
    answer:
      'Standard delivery is free above the threshold shown in your bag. Express and overnight are charged at checkout.',
    sortOrder: 20,
  },
  {
    question: 'Can I return something?',
    topic: 'returns',
    answer: `Anything unworn, with its tags on, can be returned within 30 days of delivery. Email ${CONTACT_EMAIL} to arrange one — returns are arranged with our team rather than started online.`,
    sortOrder: 30,
  },
  {
    question: 'How do I choose a size?',
    topic: 'sizing',
    /*
     * Sweep 1, S13: "every product page" was false for accessories, the sized cap and belt among
     * them, which set no `sizeGuide`. The belt's own description says how it is sized.
     */
    answer:
      'Every piece of clothing has a size guide on its product page, in centimetres. Accessories have none — a belt is sized to the trouser rather than the body, as its description says. Between sizes, take the larger.',
    sortOrder: 40,
  },
  {
    question: 'How should I wash wool?',
    topic: 'care',
    /*
     * Sweep 1, S14: this told everyone to hand wash wool, and the Wool Overshirt, Unstructured Blazer
     * and Pleated Trouser are labelled dry clean.
     */
    answer:
      'Knitted wool, such as merino and lambswool, can be hand washed cool and dried flat — never hang wet knitwear. Woven wool, such as melton, twill and suiting cloth, is dry clean only. The care notes on each product page come first.',
    sortOrder: 50,
  },
  {
    question: 'Do I need an account to order?',
    topic: 'account',
    answer: 'No. You can check out as a guest and create an account later.',
    sortOrder: 60,
  },
]

/**
 * Size guide → Fit notes, by the guide's title. Sweep 1, S13 and S18: the tops guide claimed a
 * regular fit for garments whose own details say slim, relaxed or oversized, and the trouser guide
 * described measurements it does not carry.
 */
export const SIZE_GUIDE_FIT_NOTES: Readonly<Record<string, string>> = {
  Tops: 'How each piece fits — slim, regular, relaxed or oversized — is listed in its details. Between sizes, take the larger.',
  'Trousers and shorts': 'Waist sizes run true. Between sizes, take the larger.',
}
