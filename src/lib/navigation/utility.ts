import { richTextToPlainText } from '@/lib/seo/metadata'

/**
 * **The four header affordances that are not content.**
 *
 * Structure document §3 fixes them — *"Right: Search. Wishlist. Account. Bag."* — and the
 * `Navigation` global deliberately does not model them, for the reason written in its own docblock:
 * *"modelling them as content would let an editor delete the bag."*
 *
 * Two of the four are destinations and two are overlays, and the distinction is the honest one
 * rather than a stylistic preference:
 *
 * - **Account** and **Wishlist** are links, to routes that exist (`/account`, built in Phase 7) or
 *   that Phase 20 builds. C-09 settled wishlist as *"a global header affordance routing to
 *   `/account/wishlist`"*.
 * - **Search** and **Bag** are buttons that open the overlays plan §9.1b and §9.1d put in this
 *   phase. They are not links, because there is nothing to link to: `/search` is Phase 12's and
 *   `/cart` is Phase 14's, and an anchor pointing at a route that does not exist is the broken
 *   internal route the feature matrix asks us to avoid.
 *
 * `/account/wishlist` does not exist yet either — Phase 20 owns it — which is why it is the one
 * entry here that will 404 until then. It is kept because structure §3 puts it in the header, and
 * because `(frontend)/not-found.tsx` gives it an answer inside the shell rather than a dead end.
 */
export const utilityNav = {
  wishlist: { label: 'Wishlist', href: '/account/wishlist' },
  account: { label: 'Account', href: '/account' },
} as const

/**
 * The legal row in the footer. Structure §20: *"Social/legal."* Not editable content.
 *
 * **The row was empty because the copy did not exist — and now it does.** Phase 28's audit found
 * these two entries pointing at `/legal/privacy` and `/legal/terms` with neither route built: the
 * footer shipped two 404s on every page of the shop. They were withdrawn rather than filled in,
 * because a privacy policy and a set of terms are **legal text somebody has to write and be
 * accountable for**, and inventing plausible-sounding privacy copy would have been worse than the
 * broken link — a false statement about what this shop does with personal data, on the page a
 * regulator reads first. That was gap **G-19**.
 *
 * Phase 37 closed **G-19** with routes behind both links. The owner supplied the decisions the text
 * rests on — a real contact address and a retention window for unpaid orders — and asked for the
 * text itself, which was then **drafted from the code** as a plain-English starting draft
 * (`scripts/seed/legal.ts`). It is not legal advice and has not been reviewed by anyone qualified;
 * the owner is accountable for it, and TODO.md keeps the review in front of them.
 *
 * The words themselves are *not* here: they live in `site-settings.privacyPolicy` and
 * `site-settings.termsOfSale`, so a correction is an edit in the admin rather than a deployment —
 * which is the whole point for text that is amended far more often than it is written.
 *
 * The two *links* stay code for the reason `utilityNav` above is code: that the footer offers a
 * privacy notice at all is not a merchandising decision an editor should be able to delete.
 *
 * ### A link is shown only when its document has text
 *
 * Code decides that the row exists; **the content decides which entries it carries.** The seed puts
 * the draft into a development database, but production's `site-settings` is entered by hand, and the
 * migration that adds the two columns adds them empty. A static row would then have offered Privacy
 * and Terms on every page of a shop taking payments, each opening a page that said nothing — a
 * dead-looking legal link, which is the defect G-19 withdrew the row to avoid. So every consumer asks
 * `publishedLegalNav` rather than reading `legalNav` directly: the footer, `HelpNav`, the checkout
 * page's acceptance sentence and the sitemap. The routes themselves answer 404 for an unpublished
 * document, so a link that is not shown is also not a page that can be reached.
 */
export const legalNav: readonly { document: LegalDocument; href: string; label: string }[] = [
  { document: 'privacy', href: '/legal/privacy', label: 'Privacy' },
  { document: 'terms', href: '/legal/terms', label: 'Terms' },
]

/** The two legal documents, by the key `getSupportPolicies` returns them under. */
export type LegalDocument = 'privacy' | 'terms'

/** Which legal documents are published — see `hasPublishedText` for what *published* means. */
export type LegalPublication = Readonly<Record<LegalDocument, boolean>>

/** Neither document published: production's state until the owner enters the text. */
export const NO_LEGAL_DOCUMENTS: LegalPublication = { privacy: false, terms: false }

/** The legal row as a customer should see it: `legalNav`, less any document with no text. */
export function publishedLegalNav(published: LegalPublication): typeof legalNav {
  return legalNav.filter((entry) => published[entry.document])
}

/**
 * **Whether a stored rich-text document says anything at all** — the one definition of *published*
 * for the four `site-settings` policy documents.
 *
 * Truthiness is not the answer, and that is the whole reason this exists. When an editor selects all
 * of a Lexical field's text and deletes it, Payload saves the editor state rather than `null`: a
 * `root` holding one empty paragraph, which is a truthy object. A page that branched on the value
 * would render a title over an empty body, and a link row that branched on it would keep offering
 * the document. So a document counts as published only when it has **text** — flattened by the same
 * walk the meta descriptions use, with no length limit, and whitespace alone is not text.
 *
 * It lives here rather than in `lib/help/read.ts` because that module is `server-only`, and
 * `verify:shell` needs this rule against the real database from the Payload CLI. The import it adds
 * is safe for the client components that read `utilityNav` from this file: `seo/metadata.ts` imports
 * nothing at runtime.
 */
export function hasPublishedText(value: unknown): boolean {
  return richTextToPlainText(value, Number.POSITIVE_INFINITY).length > 0
}
