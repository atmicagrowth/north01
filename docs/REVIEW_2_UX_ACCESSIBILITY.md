# Review Pass 2 — user experience, responsive design and accessibility

Plan §36.1b. Performed in Phase 36 (2026-09-11). Input: the Review Pass 2 findings R2-01…R2-20 in
the earlier audit (`docs/PHASE_35_36_AUDIT.md`, working input, not committed), each re-checked against
the code as it stands after Phases 31–35, plus the Playwright suite's first real run in Phase 35 and
real-browser checks on desktop (1440×900), tablet (820×1180) and phone (390×844).

Severity follows the audit's scale. **No High or Critical issue is open.**

## How it was checked

- **Journeys (§36.1b flows 1–8)** — the Playwright suite drives flows 1, 2, 3, 5, 7, 8 and the mobile
  navigation (flow 12 in plan §27): **43 passed, 0 failed, 14 skipped** on a production build of the
  development database. The skips are the flows that need Stripe test keys or a server-side mutation
  mid-test; they are listed in the specs with their reasons. Flow 6 (guest → payment) cannot complete
  without Stripe keys in any environment today (TODO.md §4).
- **Accessibility** — axe-core WCAG 2.1 A/AA over the six routes plan §27.1e names (in the suite), the
  keyboard tests in the mobile-navigation spec, and code review of every overlay.
- **Responsive** — screenshots at the three viewports of the homepage, product, lookbook, journal,
  collection, help and 404 pages (Phase 35).

## Findings

| ID | Severity | Issue | Root cause | Fix | Verification |
|---|---|---|---|---|---|
| R2-01 | High | Search dialog opened with focus on Close; typed text lost | Radix focuses the first tabbable element | **Fixed before this pass** — `onOpenAutoFocus` focuses the input; focus returns to the trigger | code review; mobile-navigation spec |
| R2-02 | Medium | Signed-out Wishlist link lands on a bare sign-in | the list is an account page | Sign-in explains why when `next=/account/wishlist`; saved items merge on sign-in (DEV-68) | component test |
| R2-03 | Medium | Sign-in merge dropped the guest's discount code and reduced lines silently | merge discarded the promotion and the merge report | Promotion carried over when the account bag has none. **The one-time notice of reduced lines is not built** — it needs a new cookie and action; recorded below | code review |
| R2-04 | Medium | Checkout never showed what was being bought | page reused the totals-only summary | Read-only line list above the summary | component test |
| R2-05 | Medium | Payment-unavailable panel in developer language | copy written for the project | "Online checkout isn't open yet." — and the bag says so under Checkout | component test |
| R2-06 | Medium | Partial refund shown as "Refunded" with no amount | refunded amount never read | "Partially refunded" and a "Refunded −$x" row | Review Pass 1 harness |
| R2-07 | Medium | Checkout looked the same as View bag | default button variant | `primary` in drawer and bag | screenshot |
| R2-08 | Medium | Mobile menu sub-links 18 px tall (WCAG 2.2 target size) | text-only links | `min-h-11` rows | mobile-navigation spec |
| R2-09 | Low | `begin_checkout` fired where checkout could not happen | — | **Fixed in Phase 31** | — |
| R2-10 | Low | Order page lacked date, address and help links; discount positive | — | Added; discount shown as "−$x" | Review Pass 1 harness |
| R2-11 | Low | "10 in stock" when the limit was the per-order cap | limit reason not carried | "You can have up to N of this per order." | component test |
| R2-12 | Low | Category filter flat | parent ignored | Tree order, children indented | component test |
| R2-13 | Low | "Checkout" twice; tax sentence wrong on checkout | copy | Eyebrow removed; "Tax is calculated from your delivery address." | unit tests |
| R2-14 | Low | Blue native clear in search | — | **Fixed earlier** (`scheme-dark`); Escape closes rather than clears, by decision | — |
| R2-15 | Low | PDP heading outline H1 → H3 | — | **Fixed earlier** | axe |
| R2-16 | Low | Skip link scrolled but did not move focus | `<main>` not focusable | `tabIndex={-1}` on `<main>` in both layouts | mobile-navigation spec |
| R2-17 | Low | Form errors not tied to fields | no `aria-invalid`/`aria-describedby` | Discount, address book and checkout wired | component test |
| R2-18 | Low | Mega menu open state trips axe `aria-hidden-focus` | Radix NavigationMenu's focus proxy is `aria-hidden` and focusable by design | **Accepted** — keyboard behaviour is correct (Tab, Shift+Tab, Escape); documented at the component | Radix source read |
| R2-19 | Low | Size-guide model note announced twice | description and body | Body copy removed | — |
| R2-20 | Low | 36 px Search/Close beside 44 px siblings | — | **Fixed earlier** (`pointer-coarse:size-11`) | — |

### Also found by this pass

- **A customer who had just written a review was told only that they had written one** — the
  pending-moderation sentence was lost on revalidation. Fixed in Phase 35 sweep 2 (found by the E2E
  run).
- **The homepage accessibility scan** was measuring text still faded out below the fold; the scan now
  reads the page as a reader sees it, and passes.
- The UX items of Phase 35 (breadcrumbs, one wishlist name, "Sold out" said aloud, instant size
  selection, shipping and returns reachable from bag, drawer, checkout and product) are recorded in
  notes §1.40.

## Open, by decision

| Item | Severity | Why it is open |
|---|---|---|
| R2-03 notice of reduced/dropped lines at sign-in | Low | Needs a one-time cookie plus a clearing action; the discount half is fixed. Design recorded in notes §1.41 |
| Mobile size guide is a dialog, not a drawer | Low | Works at every width; no deviation had recorded it — now in doc 02's as-built preface |
| No "Clear bag" control | Low | Recorded in doc 02's as-built preface |
