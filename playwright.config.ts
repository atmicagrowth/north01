import { defineConfig, devices } from '@playwright/test'

/**
 * **Plan §27.1c–§27.1e — Playwright.**
 *
 * ### Why this suite went unrun until Phase 35
 *
 * *Status: first run in Phase 35 — 43 passed, 0 failed, 14 skipped, against a local production
 * build of the development database (`docs/TESTING.md`). What follows is why it had not run before.*
 *
 * An end-to-end test needs a running application, and a running application needs a database it may
 * write to. This project has one reachable database and it is **production** — see `TODO.md` §1.
 * Decision **D-10** exists precisely to stop a harness pointing at it, and an E2E suite is the most
 * destructive harness in the repository: it creates customers, adds to bags, and (flow 6) opens
 * Stripe Checkout sessions.
 *
 * So `webServer` below is deliberately **conditional**, and the suite refuses itself when
 * `E2E_BASE_URL` is unset rather than quietly starting a server against whatever `DATABASE_URL`
 * happens to hold. §27.1f asks for *"E2E tests where environment permits"*, and this is what
 * "permits" means here.
 *
 * ### Why not point it at the deployed site
 *
 * Because flows 5, 6, 7, 9 and 10 all write. A green E2E run against production is a green run that
 * left real rows behind, and flow 7 finalises an order. The suite is worth having and is worth
 * having against a database it may ruin.
 *
 * ### One browser, deliberately
 *
 * Chromium only, plus one mobile project for §27.1c's flow 12. Cross-browser rendering is a **manual**
 * concern in this project — the visual guide is the authority and a screenshot diff is not — and
 * three engines would triple a suite whose value is in the flows, not in the engine.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

/** Only start a server when the caller has said which database it may touch. */
const managedServer = process.env.E2E_START_SERVER === '1'

export default defineConfig({
  /*
   * Zero retries locally, one in CI. A retry is a way to see whether a failure is real; it is not a
   * way to make a flaky test pass, and a suite that needs three attempts is a suite that is lying.
   */
  retries: process.env.CI ? 1 : 0,

  forbidOnly: Boolean(process.env.CI),

  fullyParallel: true,

  /*
   * One worker in CI. These flows share a database, and two workers adding to the same guest bag or
   * racing the same discount code produce failures that are about the harness rather than the shop.
   */
  workers: process.env.CI ? 1 : undefined,

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile-navigation\.spec\.ts/,
    },
    {
      /* §27.1c flow 12, "mobile navigation" — a real mobile viewport, not a narrowed desktop one. */
      name: 'mobile',
      testMatch: /mobile-navigation\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  testDir: './tests/e2e',

  use: {
    baseURL,
    /* On the first retry only — a trace for every passing test is gigabytes of nothing. */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  ...(managedServer
    ? {
        webServer: {
          command: 'pnpm build && pnpm start',
          reuseExistingServer: !process.env.CI,
          timeout: 5 * 60 * 1000,
          url: baseURL,
        },
      }
    : {}),
})
