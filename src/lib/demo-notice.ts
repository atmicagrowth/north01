/**
 * **The demonstration notice** — owner request, 2026-09-15, recorded as **DEV-86**.
 *
 * The words are the owner's. They are here, in a pure module, rather than inside the component, so
 * the component test and the E2E suite assert on the sentence the dialog renders instead of retyping
 * it — the rule `tests/e2e/fixtures.ts` states for every other piece of copy.
 */
export const DEMO_NOTICE_COPY = {
  title: 'This website is a demonstration.',
  body: [
    'Please do not submit any real information.',
    'All features work, and if you enter your card information at checkout, you will be charged.',
  ],
  continue: 'Continue',
} as const

/**
 * `localStorage` key recording that this browser has pressed Continue, namespaced like the other
 * device-local keys (`north01:wishlist`, `north01:recently-viewed`, `north01:recent-searches`). The
 * privacy notice lists it under *Cookies and device storage*, and `docs/SECURITY.md` §1 does too.
 */
export const DEMO_NOTICE_KEY = 'north01:demo-notice'

/** The only value written. Anything else — including an old or hand-edited value — shows the notice. */
export const DEMO_NOTICE_SEEN = '1'

export function hasSeenDemoNotice(raw: null | string): boolean {
  return raw === DEMO_NOTICE_SEEN
}
