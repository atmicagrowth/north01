import { z } from 'zod'

/**
 * What the newsletter form may submit.
 *
 * Deliberately the same shaping `lib/auth/schemas.ts` applies to an address, for the same stated
 * reason: `.trim()` is not cosmetic, because a pasted address routinely carries a leading space and
 * the unique index does not consider `" ada@example.com"` and `"ada@example.com"` the same address.
 * `.toLowerCase()` matches `normaliseEmail`, the `beforeValidate` hook on the collection, so the
 * value this schema produces is the value that will be stored and compared.
 *
 * **The trim is piped *into* the email check, not chained after it**, and that ordering is the whole
 * point — `z.email()` is its own schema type, so a `.trim()` chained onto it validates the raw input
 * and only tidies the output. `pnpm verify:home` asserts the behaviour rather than the syntax; the
 * measurement, and the Phase 7 defect it exposed, are in `lib/auth/schemas.ts`.
 *
 * ### The field is `newsletterEmail`, and the name is load-bearing
 *
 * The footer renders on **every** route — including `/login`, `/register`, `/forgot-password` and
 * `/reset-password`, each of which already has a field named `email`. `components/auth/field.tsx`
 * derives `id`, `htmlFor` and both `aria-describedby` targets from the field's `name`, on a stated
 * assumption that *"these forms carry one of each field"* — an assumption that was true when it was
 * written and stops being true the moment a form appears in the global shell.
 *
 * Two `id="email"` on one page is not a cosmetic problem: `htmlFor` binds to the first match, so the
 * sign-in form's label would focus the footer's input, and an `aria-describedby` pointing at a
 * duplicated id resolves unpredictably. Renaming the field is the fix that needs no change to a
 * Phase 7 component.
 */
export const NewsletterSchema = z.object({
  newsletterEmail: z
    .string({ error: 'Enter a valid email address.' })
    .trim()
    .toLowerCase()
    .pipe(
      z
        .email({ error: 'Enter a valid email address.' })
        .max(320, 'That email address is too long.'),
    ),
})

export type NewsletterInput = z.infer<typeof NewsletterSchema>
