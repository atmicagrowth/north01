import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Foundation',
}

/**
 * Phase 2 baseline page.
 *
 * It exists to prove the storefront route group renders as a React Server Component with
 * Tailwind applied. It is not the homepage and states plainly that nothing is built yet -
 * the plan forbids UI that implies functionality which does not exist. Phase 9 replaces it.
 */
export default function FoundationPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-12 px-6 py-24">
      <header className="flex flex-col gap-6">
        <p className="text-stone text-xs tracking-[0.35em] uppercase">Foundation</p>
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight sm:text-7xl">
          NORTH / 01
        </h1>
        <p className="text-stone max-w-prose text-base leading-relaxed">
          The application shell is running. Next.js renders this route as a server component,
          Payload is mounted in the same deployable, and Tailwind is applied. No storefront feature
          has been built yet.
        </p>
      </header>

      <dl className="border-graphite grid gap-px border-t text-sm sm:grid-cols-2">
        <div className="border-graphite flex flex-col gap-1 border-b py-5">
          <dt className="text-stone text-xs tracking-[0.2em] uppercase">Storefront</dt>
          <dd>Phase 2 baseline — replaced in Phase 9</dd>
        </div>
        <div className="border-graphite flex flex-col gap-1 border-b py-5">
          <dt className="text-stone text-xs tracking-[0.2em] uppercase">Content</dt>
          <dd>
            {/*
              Intentionally an anchor, not next/link. /admin lives in the (payload) route
              group under a different root layout, so crossing into it must be a full
              document load - and prefetching the admin bundle from the storefront would
              be pure waste.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              className="underline underline-offset-4 transition-opacity hover:opacity-70"
              href="/admin"
            >
              Payload admin
            </a>
          </dd>
        </div>
      </dl>
    </main>
  )
}
