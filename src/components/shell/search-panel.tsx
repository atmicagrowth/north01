'use client'

import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'

import { MediaImage } from '@/components/media/media-image'
import { useShellOverlay } from '@/components/shell/overlay-context'
import { cn } from '@/lib/cn'
import { CATALOG_IMAGE_SIZES } from '@/lib/catalog/sizes'
import {
  RECENT_SEARCH_KEY,
  SEARCH_COPY,
  SEARCH_PATH,
  SUGGEST_DEBOUNCE_MS,
  nextOptionIndex,
  normaliseSearchTerm,
  pushRecentSearch,
  readRecentSearches,
  shouldReplaceHistory,
} from '@/lib/catalog/search'
import { suggestionGroups, suggestionOptions, type SuggestionPayload } from '@/lib/catalog/suggest'

/**
 * **Plan §12.1c's panel.** The seven sections, inside the dialog Phase 9 already built.
 *
 * `SearchOverlay`'s signature is unchanged — no new props — and that is deliberate rather than
 * incidental. The overlay is mounted **twice**: in the frontend layout and again in
 * `global-not-found.tsx`, which renders its own `<html>` outside the route group. A prop added here
 * would have to be supplied in both places or the 404 page's panel would silently lose a section.
 * Fetching on open instead of receiving props keeps both mount sites identical *and* leaves the
 * statically prerendered homepage's read set untouched.
 *
 * ---
 *
 * ### The combobox, and why it is hand-built
 *
 * ARIA 1.2's combobox pattern, inside Radix's dialog: `role="combobox"` on the input,
 * `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant` pointing
 * at the active option's id. One `role="listbox"` containing `role="group"` sections, each holding
 * `role="option"` elements **directly** — no `<ul>`/`<li>` between them, because their implicit
 * list roles break the ownership ARIA requires and axe reports it as critical.
 *
 * Every group, every option and the arrow-key order come from ONE derivation (`suggestionOptions`
 * then `suggestionGroups`), so the ARIA tree and the keyboard model cannot describe different
 * things — which they did until the browser pass caught it.
 *
 * **DOM focus never leaves the input.** Moving it into the list would fight Radix's `FocusScope`,
 * and it is not what the pattern asks for: the active option is communicated by
 * `aria-activedescendant`, not by focus. `suggestionOptions` builds the flat list and its ids in the
 * same order they render, so the attribute can never point at an element that is not on the page —
 * a dangling id is silent, and announces nothing at all.
 *
 * `scrollIntoView({ block: 'nearest' })` on the active option is required rather than polish: the
 * list scrolls, so without it arrowing past the fold moves an announcement the customer cannot see.
 *
 * ### It closes itself, because the shell will not
 *
 * `overlay-context.tsx` closes on a **pathname** change (`usePathname`, then
 * `if (seenPathname !== pathname)`). A query-only navigation is not a pathname change, so
 * re-searching from `/search?q=a` to `/search?q=b` — the single most common search interaction —
 * would leave the dialog sitting over its own results. The shipped panel avoided this by wrapping
 * every link in `<DialogClose>`; this one navigates programmatically, so it calls `close()` itself
 * before every push.
 *
 * ### The form works without JavaScript
 *
 * `<form method="get" action="/search">` with `name="q"`. With scripting disabled the panel is a
 * plain search form that submits to a real page. Everything below is enhancement.
 */

/* -------------------------------------------------------------------------------------------------
 * Recent searches, as an external store
 * ---------------------------------------------------------------------------------------------- */

/**
 * `localStorage` read through `useSyncExternalStore` rather than through an effect.
 *
 * Two reasons, and the second is the one that matters. It keeps the panel free of
 * `setState`-in-effect, which this repository lints as an error. And it gives React an explicit
 * **server snapshot** — the empty list — so the server-rendered markup and the first client render
 * agree by construction, instead of hydrating one thing and then flashing another.
 *
 * `getSnapshot` must return a stable reference or React re-renders forever, so the parsed array is
 * memoised against the raw string it came from.
 */
const RECENT_EMPTY: string[] = []

let recentRaw: null | string = null
let recentParsed: string[] = RECENT_EMPTY

const recentListeners = new Set<() => void>()

function subscribeRecent(listener: () => void): () => void {
  recentListeners.add(listener)

  /* Another tab writing the same key. Cheap to honour, and confusing to ignore. */
  window.addEventListener('storage', listener)

  return () => {
    recentListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function readRecentSnapshot(): string[] {
  let raw: null | string = null

  try {
    raw = window.localStorage.getItem(RECENT_SEARCH_KEY)
  } catch {
    /* Private mode, or storage disabled. Recent searches are a convenience, never a requirement. */
    return RECENT_EMPTY
  }

  if (raw !== recentRaw) {
    recentRaw = raw
    recentParsed = readRecentSearches(raw)
  }

  return recentParsed
}

/** The server has no storage, and saying so is what keeps hydration honest. */
function serverRecentSnapshot(): string[] {
  return RECENT_EMPTY
}

function writeRecent(next: string[]): void {
  try {
    window.localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next))
  } catch {
    /* Storage unavailable. The search still runs. */
    return
  }

  recentRaw = null
  recentListeners.forEach((listener) => listener())
}

const EMPTY_PAYLOAD: SuggestionPayload = {
  categories: [],
  collections: [],
  popular: [],
  products: [],
  recent: [],
  state: 'idle',
}

export function SearchPanel() {
  const router = useRouter()
  const { close } = useShellOverlay()

  const [term, setTerm] = useState('')
  /**
   * Only *fetched* results are state, and they carry the term they belong to.
   *
   * Everything else is derived. An earlier draft stored `payload`, `pending` and `active`
   * separately and reset them from effects, which is three `setState`-in-effect cascades and three
   * ways for the panel to disagree with the input: a stale payload rendered under a new term, a
   * `pending` that never cleared, an `active` index pointing past a shorter list. Deriving them
   * makes those states unrepresentable rather than merely unlikely.
   */
  const [fetched, setFetched] = useState<null | { payload: SuggestionPayload; term: string }>(null)
  const [active, setActive] = useState(-1)

  const recent = useSyncExternalStore(subscribeRecent, readRecentSnapshot, serverRecentSnapshot)

  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /*
   * A monotonic request id, so a slow response for "ho" can never overwrite a fast one for "hoodie".
   * The AbortController cancels the request; the id guards the *state write*, because an abort that
   * lands after the response has already been parsed would otherwise still call setState.
   */
  const requestId = useRef(0)

  /** Terms already fetched this panel session. Cleared when the panel unmounts. */
  const memo = useRef(new Map<string, SuggestionPayload>())

  const normalised = normaliseSearchTerm(term)
  const searchable = normalised.term !== null && normalised.status === 'ok' ? normalised.term : null

  /*
   * The debounce. `SUGGEST_DEBOUNCE_MS` explains why it is the only mechanism available: the SDK
   * caches nothing and does not use `fetch`, so neither it nor Next can dedupe a repeated query.
   *
   * **No synchronous `setState` here.** The only write happens inside `.then`, after a real
   * response — everything the old version reset up-front is derived below instead.
   */
  /*
   * The key is the term, or the EMPTY STRING when there is nothing searchable yet.
   *
   * That empty-string fetch is not a nicety — it is what makes §12.1c's *popular searches* section
   * exist at all. An earlier version returned early when there was no term, so the panel never asked
   * the server anything until the customer typed two characters, and the idle sections were dead
   * markup that could never populate. The browser pass caught it; nothing else could have, because
   * every unit involved was individually correct.
   *
   * The empty request is cheap by construction: the handler makes no Algolia call below the floor,
   * and both loaders behind it are cached.
   */
  const fetchKey = searchable ?? ''

  useEffect(() => {
    if (memo.current.has(fetchKey)) {
      const cached = memo.current.get(fetchKey) as SuggestionPayload
      const timer = setTimeout(() => setFetched({ payload: cached, term: fetchKey }), 0)

      return () => clearTimeout(timer)
    }

    const id = (requestId.current += 1)
    const controller = new AbortController()

    const timer = setTimeout(
      () => {
        void fetch(`${SEARCH_PATH}/suggest?q=${encodeURIComponent(fetchKey)}`, {
          signal: controller.signal,
        })
          .then((response) =>
            response.ok ? (response.json() as Promise<SuggestionPayload>) : null,
          )
          .then((next) => {
            if (id !== requestId.current) {
              return
            }

            const payload = next ?? { ...EMPTY_PAYLOAD, state: 'unavailable' as const }

            memo.current.set(fetchKey, payload)
            setFetched({ payload, term: fetchKey })
          })
          .catch(() => {
            if (id !== requestId.current) {
              return
            }

            /*
             * An aborted request is not a failure — it is a customer who kept typing. Only a real
             * failure reaches here with a current id, and it renders as `unavailable` rather than as
             * an empty list, so an outage is never mistaken for "nothing matched".
             */
            setFetched({
              payload: { ...EMPTY_PAYLOAD, state: 'unavailable' },
              term: fetchKey,
            })
          })
      },
      fetchKey === '' ? 0 : SUGGEST_DEBOUNCE_MS,
    )

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    /*
     * An idle fetch is not debounced — there is nothing to debounce, and waiting 200ms to show the
     * popular list makes the panel feel slow on the one interaction that has no typing in it.
     */
  }, [fetchKey])

  /**
   * Results belong to a key, and the key is the term **or the empty string**.
   *
   * This read `searchable !== null && ...` until the browser pass caught it: with an empty input
   * `searchable` is null, so the idle payload was discarded the instant it arrived and §12.1c's
   * popular-searches section could never render. The fetch was correct and the endpoint was correct;
   * the one line that consumed them disagreed about what counts as a key.
   */
  const payload = fetched?.term === fetchKey ? fetched.payload : EMPTY_PAYLOAD
  const pending = fetched?.term !== fetchKey

  const merged: SuggestionPayload = {
    ...payload,
    /*
     * Recent searches are the browser's, never the server's — sending them would be shipping one
     * person's browsing history to a log for nothing. They show only before a term is typed: once
     * the customer is searching, the panel is about *this* search.
     */
    recent: searchable === null ? recent : [],
  }

  const options = suggestionOptions(merged)

  /* The active option must be visible, not merely announced. The list scrolls. */
  useEffect(() => {
    if (active < 0 || !listRef.current) {
      return
    }

    listRef.current
      .querySelector(`#${CSS.escape(options[active]?.id ?? '')}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, options])

  const go = useCallback(
    (href: string) => {
      /* The shell only closes on a pathname change — see this file's docblock. */
      close()

      if (shouldReplaceHistory(`${window.location.pathname}${window.location.search}`, href)) {
        router.replace(href)
      } else {
        router.push(href)
      }
    },
    [close, router],
  )

  const submit = useCallback(
    (raw: string) => {
      const { term: normalised } = normaliseSearchTerm(raw)

      if (normalised === null) {
        return
      }

      writeRecent(pushRecentSearch(recent, normalised))

      go(`${SEARCH_PATH}?q=${encodeURIComponent(normalised)}`)
    },
    [go, recent],
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      if (options.length === 0) {
        return
      }

      event.preventDefault()
      setActive((current) => nextOptionIndex(current, options.length, event.key as 'ArrowDown'))
    }
  }

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const option = active >= 0 ? options[active] : undefined

    if (option) {
      if (option.href) {
        go(option.href)
      } else {
        submit(option.label)
      }

      return
    }

    submit(term)
  }

  /*
   * Groups are DERIVED from the same flat list the arrow keys walk. They used to be rebuilt here by
   * filtering on `kind`, which silently dropped recent and popular searches from the rendered
   * listbox while leaving them in the keyboard model — so `aria-activedescendant` pointed at ids
   * that were not in the document.
   */
  const groups = suggestionGroups(options)

  const showState =
    merged.state === 'unavailable' || (merged.state === 'empty' && !pending && searchable !== null)

  return (
    <div className="flex flex-col gap-l" data-slot="search-panel">
      <form action={SEARCH_PATH} method="get" onSubmit={onSubmit} role="search">
        <label className="sr-only" htmlFor="site-search">
          Search
        </label>

        <div className="flex items-center gap-s border-b border-border-control pb-s focus-within:border-border-strong">
          <Search aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />

          <input
            aria-activedescendant={active >= 0 ? options[active]?.id : undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={options.length > 0}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-sans text-body text-foreground outline-none placeholder:text-foreground-muted"
            id="site-search"
            name="q"
            onChange={(event) => {
              setTerm(event.target.value)
              /*
               * Reset here rather than in an effect on `payload`. Typing is the thing that
               * invalidates a selection, and doing it at the source means the index can never point
               * past a list that has since become shorter.
               */
              setActive(-1)
            }}
            onKeyDown={onKeyDown}
            placeholder="Hoodie, merino, Graphite…"
            ref={inputRef}
            role="combobox"
            type="search"
            value={term}
          />
        </div>
      </form>

      {/*
        Settled counts only, never per keystroke. A live region that fires on every character reads
        the whole list aloud repeatedly and makes the panel unusable with a screen reader.
      */}
      <p aria-live="polite" className="sr-only">
        {pending
          ? ''
          : options.length > 0
            ? `${options.length} suggestion${options.length === 1 ? '' : 's'}.`
            : ''}
      </p>

      <div
        className="max-h-[55vh] overflow-y-auto"
        id={listId}
        ref={listRef}
        role="listbox"
        aria-label="Search suggestions"
      >
        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            {/*
              Decoration: the group already carries the same words as its accessible name, so
              announcing the heading again would read every label twice.
            */}
            <p
              aria-hidden="true"
              className="mb-s mt-m font-sans text-meta uppercase text-foreground-muted first:mt-0"
            >
              {group.label}
            </p>

            {group.options.map((option) => {
              const index = options.indexOf(option)
              const product =
                option.productIndex === null ? undefined : merged.products[option.productIndex]

              return (
                /*
                 * A `div`, not an `<a>` or a `<button>`.
                 *
                 * ARIA requires `role="option"` to be owned directly by its `listbox` or `group`, and
                 * an interactive element inside an option is not part of the pattern. Wrapping these
                 * in `<ul>`/`<li>` — which is what the first version did — inserts implicit
                 * list/listitem roles between the two and breaks that ownership: axe reported
                 * `aria-required-parent` as a critical failure.
                 *
                 * The cost, recorded honestly: a product suggestion cannot be middle-clicked open in
                 * a new tab. Activation is click and Enter. The results page carries real anchors,
                 * and the panel is an enhancement over it.
                 */
                <div
                  aria-selected={index === active}
                  className={cn(
                    'flex cursor-pointer items-center gap-s py-2 text-body-sm',
                    index === active && 'bg-surface',
                  )}
                  id={option.id}
                  key={option.id}
                  onClick={() => {
                    if (option.href) {
                      go(option.href)
                    } else {
                      submit(option.label)
                    }
                  }}
                  role="option"
                >
                  {product ? (
                    <span className="w-14 shrink-0">
                      <MediaImage
                        alt=""
                        context="thumbnail"
                        media={product.image}
                        sizes={CATALOG_IMAGE_SIZES.searchSuggestionThumb}
                      />
                    </span>
                  ) : null}

                  <span className="min-w-0 flex-1 truncate text-foreground">{option.label}</span>

                  {product?.priceLabel ? (
                    <span className="shrink-0 font-sans text-meta text-foreground-muted">
                      {product.priceLabel}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {showState ? (
        <div role="status" className="flex flex-col gap-1">
          <p className="font-sans text-body-sm text-foreground">
            {SEARCH_COPY[merged.state].title}
          </p>
          <p className="max-w-measure font-sans text-body-sm text-foreground-muted">
            {SEARCH_COPY[merged.state].body}
          </p>
        </div>
      ) : null}

      {searchable !== null && merged.products.length > 0 ? (
        <button
          className="self-start font-sans text-meta uppercase text-foreground underline underline-offset-4"
          onClick={() => submit(term)}
          type="button"
        >
          View all results
        </button>
      ) : null}
    </div>
  )
}
