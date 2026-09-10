import { SpeedInsights as VercelSpeedInsights } from '@vercel/speed-insights/next'

import { appEnv } from '@/lib/env.server'

/**
 * **Plan §25.1e — Vercel Speed Insights, and the condition attached to it.**
 *
 * > *"Enable after the application is stable enough to generate meaningful real-user data."*
 *
 * That is a schedule, not a design, and it is honoured by the environment check rather than by
 * leaving the package uninstalled. Speed Insights measures **real users** — Core Web Vitals from
 * actual devices — so a preview deployment being exercised by one developer produces a p75 built
 * from a sample of one, which is worse than no number because it looks like a number.
 *
 * So it renders in production and nowhere else. On a preview or a laptop it returns `null` and the
 * beacon script is never requested.
 *
 * **There is a second gate this file cannot control**, and it is worth stating so nobody looks for
 * data that was never being collected: the component reports nothing until Speed Insights is enabled
 * for the project in the Vercel dashboard. `TODO.md` carries that as an owner action.
 */
export function SpeedInsights() {
  if (appEnv !== 'production') {
    return null
  }

  return <VercelSpeedInsights />
}
