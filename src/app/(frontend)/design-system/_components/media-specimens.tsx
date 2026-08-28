import { MediaImage } from '@/components/media/media-image'
import { MEDIA_CONTEXTS, reserveBox, type MediaContext } from '@/lib/media/cloudinary-url'
import type { Media } from '@/payload-types'

import { Specimen } from './specimen'

/**
 * Phase 8's media primitive, on the specimen sheet — the same treatment Phase 3 gave every other
 * primitive, and for the same reason: a component whose whole job is *not shifting the layout* has to
 * be looked at, not asserted about.
 *
 * **The important specimen is the empty one.** The catalogue has no assets — `scripts/seed.ts`
 * deliberately creates none — so §8.1d's *"deliberate neutral placeholder"* is not an edge case here,
 * it is what the entire storefront renders today. Every box below is drawn by the delivery context
 * rather than by an image, which is precisely the property that stops the page moving when the images
 * do arrive.
 */

/** A media record shaped exactly as an unconfigured, asset-less project produces one. */
const ABSENT = null

/**
 * A record that exists and has a URL but no Cloudinary id — the degraded state, and the one this
 * project is committed in. `url` points at a file that is not there, which is also how the
 * delivery-failure state renders.
 */
const LOCAL_ONLY = {
  id: 1,
  alt: 'A stand-in for an asset stored on local disk',
  role: 'editorial',
  url: '/api/media/file/not-a-real-file.png',
  width: 1600,
  height: 1067,
  updatedAt: '',
  createdAt: '',
} as unknown as Media

const CONTEXTS = Object.keys(MEDIA_CONTEXTS) as MediaContext[]

export function MediaSpecimens() {
  return (
    <>
      <Specimen
        id="media-contexts"
        name="Delivery contexts"
        note="Plan §8.1c names six contexts and gives geometry for none of them; these ratios are this
              project's decision. Every tile below is empty — no asset exists — and every one is
              exactly the shape the real image will be. That is the whole of §8.1d: the box comes from
              the page, not from the picture."
      >
        <div className="grid gap-m sm:grid-cols-2 lg:grid-cols-4">
          {CONTEXTS.map((context) => {
            const box = reserveBox(context, null)
            const definition = MEDIA_CONTEXTS[context]

            return (
              <div key={context} className="flex flex-col gap-2">
                <MediaImage
                  media={ABSENT}
                  context={context}
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="font-sans text-meta uppercase text-foreground">{context}</span>
                  <span className="font-sans text-micro text-foreground-muted">
                    {definition.aspectRatio === null
                      ? 'natural · c_limit'
                      : `${(box.width / box.height).toFixed(3)} · c_fill`}
                    {' · '}
                    {definition.widths.length} width{definition.widths.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </Specimen>

      <Specimen
        id="media-states"
        name="The three states of a missing image"
        note="§8.1d asks for a deliberate neutral placeholder, preserved layout dimensions, and no
              broken-image layout shift. All three tiles occupy an identical 4:5 box. The middle one
              has a record whose bytes are missing, which is also what a Cloudinary 404 looks like —
              the alt text sits inside the reserved frame instead of collapsing it."
      >
        <div className="grid gap-m sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <MediaImage
              media={ABSENT}
              context="productCard"
              sizes="(min-width: 640px) 33vw, 100vw"
            />
            <span className="font-sans text-micro uppercase text-foreground-muted">
              No record at all
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <MediaImage
              media={LOCAL_ONLY}
              context="productCard"
              sizes="(min-width: 640px) 33vw, 100vw"
            />
            <span className="font-sans text-micro uppercase text-foreground-muted">
              Record present, bytes missing
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <MediaImage
              media={undefined}
              context="productCard"
              sizes="(min-width: 640px) 33vw, 100vw"
            />
            <span className="font-sans text-micro uppercase text-foreground-muted">
              Relationship not populated
            </span>
          </div>
        </div>
      </Specimen>

      <Specimen
        id="media-art-direction"
        name="Art direction"
        note="Visual guide §10: “Use intentional mobile crops instead of simply squeezing desktop
              images into a smaller box.” Below 768px this renders the 4:5 mobile hero; above it, the
              16:9 desktop one. Narrow the window and watch the frame change shape — that is a
              different crop, not a smaller copy, and it is why this component renders <picture>."
      >
        <MediaImage
          media={ABSENT}
          context="heroDesktop"
          mobileContext="heroMobile"
          sizes="100vw"
          priority
        />
      </Specimen>
    </>
  )
}
