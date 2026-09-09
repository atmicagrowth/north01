# TODO — things only the project owner can do

## 1. Send a new Neon connection string — BLOCKING

**Status: blocking every gate and every deployment as of 2026-09-09.**

The password for the Postgres role `neondb_owner` stopped working part-way through Phase 19's first
sweep. Almost certainly the rotation recommended after the old password appeared in a chat transcript
and had to be treated as exposed.

```
CONNECT FAILED: password authentication failed for user 'neondb_owner'  (SQLSTATE 28P01)
```

### What this blocks

| Blocked | Why |
| --- | --- |
| `pnpm build` | Prerendering reads the catalogue and the site globals through Payload |
| Every `pnpm verify:*` harness | All fourteen open a Payload instance |
| `pnpm migrate:create` and any new schema | The generator diffs against a live database |
| Deploying to Vercel | The build runs `payload migrate` first |

`pnpm typecheck` and `pnpm lint` still pass and are the only gate available until this is fixed, so
commits made in the meantime say so explicitly rather than implying a full gate.

### What to send

**Two strings**, one per Neon branch. In the Neon console: your project → **Connect** (top right) →
set **Branch**, turn **Connection pooling** on, and copy.

1. **`development`** — endpoint `ep-winter-bird-ax9ouwid`. This is the one that unblocks local work.
2. **`production`** — endpoint `ep-delicate-waterfall-axjoiwvz`. Needed to update the Vercel
   environment variable, or the next deploy fails the same way.

They will look like:

```
postgresql://neondb_owner:<new-password>@ep-winter-bird-ax9ouwid-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Paste them in chat and they get handled from there:

- `.env` repointed at the development branch (using the **direct**, non-pooled endpoint locally, and
  `sslmode=verify-full`, which is what `docs/ENVIRONMENT.md` requires)
- `DATABASE_URL` updated in Vercel with the pooled production string
- the full gate re-run over everything committed since the credential died — Phase 19, its first
  sweep, and Phase 20
- a deploy, to confirm the `phase_19_email` migration applies cleanly to production

### If the password cannot be recovered

Neon → **Roles** → `neondb_owner` → **Reset password**. That issues a new one and invalidates the old
one everywhere, which is the desired end state anyway given the exposure.

---

## 2. Resend — needed before any email actually sends

Phase 19 is complete and has never delivered a message, which is deliberate and recorded as
**DEV-62**'s shape a second time in `NORTH01_Implementation_Notes_and_Deviations.md` §1.24.8.

Three values, all documented in `docs/ENVIRONMENT.md`:

| Variable | Where it comes from |
| --- | --- |
| `RESEND_API_KEY` | Resend → API Keys |
| `EMAIL_FROM` | Resend → Domains, **after the sending domain is verified** |
| `EMAIL_DEV_ALLOWLIST` | Your own address. Outside production nothing is delivered to anyone else, and an empty value delivers to nobody at all |

Until these exist the queue still records every message correctly; `pnpm email:drain` sends the
backlog the moment they appear. Nothing is lost in the meantime.

**A verified sending domain is required before any production send** — Resend rejects unverified
ones, and a shop that cannot send a password reset is a shop nobody can get back into.

---

## 3. Cloudinary — images survive a redeploy only once this exists

Currently unset. Anything uploaded through `/admin` is written to the deployment's own filesystem,
which Vercel discards on the next deploy. The imported photography is already on Cloudinary and is
unaffected; this is about anything uploaded *from now on*.

`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

---

## 4. Stripe — checkout is built and has never taken a payment

`DEV-62`. The checkout page says so rather than showing a form that can only fail. Signature
verification is verified offline; what has never run is one live `checkout.sessions.create`.

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, plus a webhook
endpoint pointed at `/api/stripe/webhook`.

---

## 5. Larger product photography — optional, and the most visible gap

The sixteen supplied photographs are 224–467 px wide. They are used where that size is honest —
category tiles, editorial surfaces — and the product galleries kept the generated fabric studies,
because a product page renders an image at up to 1400 px and an upscaled 264 px photograph reads as a
mistake.

Export the garment shots larger and the placement map in `scripts/import-brand-media.ts` is the one
file to change.
