# Photography candidates — 100 licensed images for the surfaces that need them

`TODO.md` §5 and §14.6 record the gap: the sixteen supplied photographs are 217–467 px wide, so every
full-width placement on the storefront is visibly soft, and `scripts/import-brand-media.ts` says as much
in its own docblock — the product galleries keep the generated fabric studies because an upscaled
264-pixel photograph reads as a mistake.

This is a shortlist to close that gap without a photoshoot. Every image below is **Creative Commons Zero
or CC BY**, at least 1,920 px wide (median **4,460 px**), and was chosen by eye against
`NORTH01_Visual_Guide_OnlineOnly.md`.

**This list is the monochrome half.** Its companion,
[`PHOTOGRAPHY_CANDIDATES_COLOUR.md`](PHOTOGRAPHY_CANDIDATES_COLOUR.md), is a second hundred chosen for
the opposite reason — indigo, oxblood, ochre, rust and neon on black, for the surfaces meant to carry
the colour on a page.

## How these were chosen

1. **Searched** the Openverse index (Wikimedia, StockSnap, rawpixel, Museums Victoria) across 110
   queries built from the guide: campaign, northern landscape, cloth, making, studio, architecture.
   Filters: CC0 / public domain / CC BY only, JPEG, large. **NC and ND licences were excluded** — a shop
   is commercial use, and it crops.
2. **Ranked** the 966 results by mean saturation, because the guide's palette rule is a number: *black,
   cream, stone, concrete, washed neutrals … avoid highly saturated or overly artificial grading.*
3. **Looked at every one** on contact sheets, and kept the hundred that answer the guide's other three
   demands — strong silhouettes, architectural or minimal environments, negative space typography can
   live in — and rejected anything with obvious stock-photo energy.

## Before you use any of them

- **Licence split:** 94 are CC0 or public domain (no attribution required, commercial use fine).
  6 are **CC BY 4.0** and must carry a credit line — they are listed with theirs at the end.
- **Where they come from matters for downloading.** StockSnap and Wikimedia give you the full file with no
  account. **rawpixel needs a free account** (its public-domain collection is unlimited for free members,
  and its previews are watermarked — the download is not).
- **People.** Only two frames contain a person, both unidentifiable (a figure from behind, a figure on a
  cliff). That is deliberate: a CC licence covers the photographer's copyright, never a model release, and
  a storefront is advertising. Do not add stock images of identifiable faces to this shop.
- **Some of these are museum objects.** The boots, hangers and cloth marked *(museum object)* are
  catalogue photographs from Museums Victoria and rawpixel's public-domain collection: clean, evenly lit,
  on a plain ground, and historical. They suit a journal or an Edit far better than a category tile.
- **This is not product photography.** Nothing here shows your garments. It fills campaign panels, chapter
  and article heroes, collection covers, category tiles and texture panels. Product galleries still need a
  shoot — see `scripts/import-brand-media.ts`.

## Putting one on the site

```bash
# 1. download the full-resolution file into ./brand-media
# 2. name it for the surface it fills, then add it to the placement map in
#    scripts/import-brand-media.ts (each entry names a collection, a slug and a field)
pnpm import:media          # uploads to Cloudinary and attaches it
```

The map is explicit on purpose: *"a script that scattered images by index would place a cap photograph on
the Jackets tile the first time the file list changed order, and nothing would catch it."* Sizes to aim
for: a campaign panel renders up to 2,400 px wide, a product gallery 1,400, a category tile about 300.

## The hundred

The number in the first column is this list's own index. `docs/photography-candidates.json` holds the
same rows for scripting — note that its `preview` URL is the **display copy** each site serves (960 px
on StockSnap, 1,024 px on rawpixel); the full-resolution file in the Pixels column comes from the
download button on the linked page.

### Campaign and homepage hero — 12

Wide, quiet, and built to carry type. Guide §07: strong silhouettes, controlled light, deliberate negative space.

| # | What it is | Pixels | Licence | Where from |
|---|---|---|---|---|
| 54 | A figure on a cliff edge in flat grey light; silhouette, not portrait | 4460×2973 | CC0 | [stocksnap](https://stocksnap.io/photo/rocks-cliff-C5Z5QDNVBP) |
| 627 | Ridge under broken cloud, cold and low-contrast | 4896×3264 | CC0 | [stocksnap](https://stocksnap.io/photo/mountain-highland-6VHIIRDJKI) |
| 622 | Rain on glass over a city silhouette, almost black | 2426×1617 | CC0 | [stocksnap](https://stocksnap.io/photo/raining-raindrops-AWI4TCQWK3) |
| 653 | Sea stacks in a storm, near-monochrome, deep negative space at the top | 4306×2871 | CC0 | [rawpixel](https://www.rawpixel.com/image/3288686/free-photo-image-dark-clouds-architecture-building) *(free account)* |
| 458 | Figure from behind in a black coat above the sea — no identifiable face | 4792×3195 | CC0 | [rawpixel](https://www.rawpixel.com/image/3302981/free-photo-image-adventure-apparel-back) *(free account)* |
| 90 | Wrecked fuselage on black sand — strong horizontal, room for a headline | 5722×3815 | CC0 | [rawpixel](https://www.rawpixel.com/image/3297200/free-photo-image-plane-wreckage-ruin-abandoned) *(free account)* |
| 93 | Black beach and sea stacks, monochrome and wide | 6000×4000 | CC0 | [rawpixel](https://www.rawpixel.com/image/3288113/free-photo-image-animal-asphalt-beach) *(free account)* |
| 88 | Wind ripples on black sand, shot flat — reads as texture at any crop | 2048×1536 | CC0 | [wordpress](https://wordpress.org/photos/photo/4246321d58/) |
| 652 | Lava rock and long-exposure water, charcoal on pewter | 6016×4016 | CC0 | [rawpixel](https://www.rawpixel.com/image/3289170/free-photo-image-exposure-png-hawaii-alps) *(free account)* |
| 609 | Squall over an empty shoreline, archival grain | 13863×10576 | CC0 | [rawpixel](https://www.rawpixel.com/image/12144580/image-cloud-art-sky) *(free account)* |
| 713 | Avenue of trees in fog with a single small figure | 2048×1536 | CC0 | [wordpress](https://wordpress.org/photos/photo/726307388d/) |
| 672 | Snow plain with one horse-drawn sledge, sepia archival | 2143×1260 | CC0 | [rawpixel](https://www.rawpixel.com/image/9817673/talvitie-1899-hugo-simberg) *(free account)* |

### Lookbook chapters — 12

Where a chapter needs a place rather than a garment — `lookbooks.chapters[].heroImage`.

| # | What it is | Pixels | Licence | Where from |
|---|---|---|---|---|
| 38 | Forest under low cloud, greens desaturated almost to grey | 4460×1855 | CC0 | [stocksnap](https://stocksnap.io/photo/fog-trees-F0Q7LBX1VP) |
| 702 | Road curving into pines, wet tarmac | 1920×1280 | CC0 | [stocksnap](https://stocksnap.io/photo/winding-road-5A6A443EB9) |
| 133 | Treeline dissolving into fog over water — the quietest frame in the set | 2832×4256 | CC0 | [rawpixel](https://www.rawpixel.com/image/3291327/free-photo-image-cc0-creative-commons) *(free account)* |
| 715 | Track disappearing into hill fog | 5184×3456 | CC0 | [rawpixel](https://www.rawpixel.com/image/3291246/free-photo-image-asphalt-cc0-creative-commons) *(free account)* |
| 719 | Flat field under mist, horizon barely there | 5132×3419 | CC0 | [rawpixel](https://www.rawpixel.com/image/3291984/free-photo-image-adventure-aerial-view-airfield) *(free account)* |
| 707 | Dark path through winter woodland | 4766×3157 | CC0 | [rawpixel](https://www.rawpixel.com/image/5916467/image-public-domain-woods-forest) *(free account)* |
| 705 | Bare trees in freezing fog | 4016×2465 | CC0 | [rawpixel](https://www.rawpixel.com/image/5940495/free-public-domain-cc0-photo) *(free account)* |
| 706 | Tyre tracks across a frozen field, black and white | 10000×7924 | CC0 | [rawpixel](https://www.rawpixel.com/image/8809309/photo-image-plant-tree-public-domain) *(free account)* |
| 709 | First snow on a country road | 3264×2448 | CC0 | [rawpixel](https://www.rawpixel.com/image/3302306/free-photo-image-913-carrizo-canyon-abies-asphalt) *(free account)* |
| 714 | Mountain ridge behind a fence line, muted | 5472×3648 | CC0 | [rawpixel](https://www.rawpixel.com/image/3293670/free-photo-image-train-snow-abies-asphalt) *(free account)* |
| 720 | Rocky shoreline fading into sea mist | 2048×1152 | CC0 | [wordpress](https://wordpress.org/photos/photo/367645e326/) |
| 74 | Snow-scattered plain with a distant white hill | 4096×2730 | CC0 | [rawpixel](https://www.rawpixel.com/image/3287275/free-photo-image-black-cc0-creative-commons) *(free account)* |

### Journal and Edit heroes — 12

Quieter still: these sit above long text, so the frame has to survive a headline across it.

| # | What it is | Pixels | Licence | Where from |
|---|---|---|---|---|
| 576 | Spruce in falling snow, soft edges | 2448×2448 | CC0 | [stocksnap](https://stocksnap.io/photo/nature-forests-4VNGY5H1TG) |
| 580 | Snow-covered trees over a buried hut | 2048×3072 | CC0 | [stocksnap](https://stocksnap.io/photo/nature-blanket-0IMP0KEHZV) |
| 65 | Cloud pouring over a forested ridge | 4460×2973 | CC0 | [stocksnap](https://stocksnap.io/photo/fog-mountain-ZKN6UKFKEO) |
| 110 | Pine forest in flat mist | 6000×4000 | CC0 | [stocksnap](https://stocksnap.io/photo/misty-morning-KPUOS5LKI1) |
| 147 | Snowfield under a wall of fog, black and white | 4272×2422 | CC0 | [rawpixel](https://www.rawpixel.com/image/3291615/free-photo-image-abies-animal-bird) *(free account)* |
| 560 | Dune grass in monochrome, large-format grain | 8368×11041 | CC0 | [rawpixel](https://www.rawpixel.com/image/9937428/dunes-the-netherlands-1906-1917-george-crombie) *(free account)* |
| 604 | Snow-laden conifers against white sky | 4272×2848 | CC0 | [rawpixel](https://www.rawpixel.com/image/6037340/photo-image-public-domain-tree-forest) *(free account)* |
| 815 | Path through frosted scrub, almost no colour | 4896×3264 | CC0 | [rawpixel](https://www.rawpixel.com/image/5926611/free-winter-image-public-domain-white-cc0-photo) *(free account)* |
| 820 | Broken sea ice to the horizon | 7200×4792 | CC0 | [rawpixel](https://www.rawpixel.com/image/4042471/photo-image-background-light-ocean) *(free account)* |
| 826 | Snow ridge and rock, cold light | 1986×1327 | CC0 | [rawpixel](https://www.rawpixel.com/image/440051/free-photo-image-antarctica-mountain-nasa) *(free account)* |
| 558 | Winter dune grass under white sky | 4000×2660 | CC0 | [rawpixel](https://www.rawpixel.com/image/5926836/free-winter-image-public-domain-white-cc0-photo) *(free account)* |
| 131 | Pines standing out of a fog bank | 4288×2848 | CC0 | [rawpixel](https://www.rawpixel.com/image/3388277/free-photo-image-nature-landscape-black) *(free account)* |

### Architecture and structure — 16

Concrete, stone and stair. Collection covers and the campaign panels that are not landscape.

| # | What it is | Pixels | Licence | Where from |
|---|---|---|---|---|
| 845 | Concrete wall and shadow, hard diagonal | 5184×2592 | CC0 | [stocksnap](https://stocksnap.io/photo/abstract-concrete-DXEDCZC25K) |
| 846 | Stacked white concrete blocks, pure geometry | 4601×3452 | CC0 | [stocksnap](https://stocksnap.io/photo/city-building-ASBLAB40D2) |
| 871 | Concrete columns in front of a library facade, black and white | 3190×4116 | CC0 | [stocksnap](https://stocksnap.io/photo/facade-building-Z5YTRWIMTU) |
| 858 | Angled window bays, repeating grid | 5184×3888 | CC0 | [stocksnap](https://stocksnap.io/photo/building-abstract-PJN2B9SJVH) |
| 491 | Curved white stair against pale stone | 5184×3888 | CC0 | [rawpixel](https://www.rawpixel.com/image/3305299/free-photo-image-stairs-design-cc0) *(free account)* |
| 231 | Whitewashed steps, high contrast, graphic | 5920×3947 | CC0 | [rawpixel](https://www.rawpixel.com/image/6049570/free-public-domain-cc0-photo) *(free account)* |
| 183 | Board-marked concrete, weathered | 3500×2333 | CC0 | [rawpixel](https://www.rawpixel.com/image/5972097/free-public-domain-cc0-photo) *(free account)* |
| 470 | Stacked concrete slabs, warm grey | 3947×2631 | CC0 | [rawpixel](https://www.rawpixel.com/image/5942141/free-public-domain-cc0-photo) *(free account)* |
| 494 | Dark mill corridor, single light source | 2488×1784 | CC0 | [rawpixel](https://www.rawpixel.com/image/8786481/photo-image-interior-room-night) *(free account)* |
| 474 | Dry stone wall, cool grey | 5184×2912 | CC0 | [rawpixel](https://www.rawpixel.com/image/6049401/free-public-domain-cc0-photo) *(free account)* |
| 476 | Cut stone blocks, even grey | 6000×4000 | CC0 | [rawpixel](https://www.rawpixel.com/image/5914093/image-background-texture-public-domain) *(free account)* |
| 519 | Glass block wall, soft grid | 2541×3811 | CC0 | [rawpixel](https://www.rawpixel.com/image/11176447/image-background-texture-pattern) *(free account)* |
| 184 | Painted black-and-white stripes on a wall — a typography panel | 2973×4460 | CC0 | [rawpixel](https://www.rawpixel.com/image/5975177/photo-image-background-textures-public-domain) *(free account)* |
| 185 | Poured concrete wall with tie holes | 6000×4000 | CC0 | [rawpixel](https://www.rawpixel.com/image/3297870/free-photo-image-akron-art-museum-architecture) *(free account)* |
| 913 | Concrete with a single crack across it | 5472×3080 | CC0 | [rawpixel](https://www.rawpixel.com/image/5963313/free-public-domain-cc0-photo) *(free account)* |
| 906 | Smooth grey concrete, even tone | 2500×2000 | CC0 | [rawpixel](https://www.rawpixel.com/image/5947423/free-public-domain-cc0-photo) *(free account)* |

### Neutral backdrops — 14

Plaster, concrete, slate and board — section grounds, category tiles and anything that needs a surface rather than a subject.

| # | What it is | Pixels | Licence | Where from |
|---|---|---|---|---|
| 876 | Plaster wall, bone white, no incident | 5472×3648 | CC0 | [stocksnap](https://stocksnap.io/photo/plaster-texture-KGKCTLNVID) |
| 877 | Troweled plaster, low relief | 4192×3052 | CC0 | [stocksnap](https://stocksnap.io/photo/white-plaster-V1SCOCHDK7) |
| 459 | Dark slate slab | 4811×3187 | CC0 | [stocksnap](https://stocksnap.io/photo/grey-stone-RS9VQHBKMO) |
| 460 | Split slate, layered | 5472×3648 | CC0 | [stocksnap](https://stocksnap.io/photo/rock-surface-UYABOO5HI7) |
| 882 | Rough render, white | 4288×2848 | CC0 | [rawpixel](https://www.rawpixel.com/image/6019936/photo-image-texture-public-domain-pattern) *(free account)* |
| 893 | Smooth plaster, flat light | 5472×3648 | CC0 | [rawpixel](https://www.rawpixel.com/image/5926239/photo-image-background-wallpaper-texture) *(free account)* |
| 900 | Polished concrete, marbled | 2400×1600 | CC0 | [rawpixel](https://www.rawpixel.com/image/5958008/free-public-domain-cc0-photo) *(free account)* |
| 905 | Marked concrete, pale | 1936×1965 | CC0 | [rawpixel](https://www.rawpixel.com/image/5946153/free-public-domain-cc0-photo) *(free account)* |
| 911 | Cracked stucco, high key | 5472×3080 | CC0 | [rawpixel](https://www.rawpixel.com/image/5947314/free-public-domain-cc0-photo) *(free account)* |
| 928 | Plain black fabric folder shot flat — a pure dark ground (museum object) | 2214×3000 | CC BY 4.0 | [museumsvictoria](https://collections.museumsvictoria.com.au/items/1255303) |
| 885 | Weathered white-painted boards | 4704×3136 | CC0 | [rawpixel](https://www.rawpixel.com/image/5957871/free-public-domain-cc0-photo) *(free account)* |
| 473 | Black rock face, wet | 2800×3500 | CC0 | [rawpixel](https://www.rawpixel.com/image/5971890/free-public-domain-cc0-photo) *(free account)* |
| 466 | Grey crushed stone | 5184×3456 | CC0 | [rawpixel](https://www.rawpixel.com/image/6049399/free-public-domain-cc0-photo) *(free account)* |
| 462 | Old lime render over pebble | 3500×2333 | CC0 | [rawpixel](https://www.rawpixel.com/image/5971993/free-public-domain-cc0-photo) *(free account)* |

### Cloth and texture — 20

Wool, linen, knit, tweed, denim. These are the closest thing here to the fabric studies the generated art stands in for.

| # | What it is | Pixels | Licence | Where from |
|---|---|---|---|---|
| 298 | Charcoal wool cloth, close weave | 6016×4016 | CC0 | [stocksnap](https://stocksnap.io/photo/linen-fabric-KXTLKQCVOS) |
| 299 | Dark linen with a fold across it | 4446×2968 | CC0 | [stocksnap](https://stocksnap.io/photo/linen-fabric-DFXVNYGUVU) |
| 301 | Open grey knit, strong structure | 4780×3187 | CC0 | [stocksnap](https://stocksnap.io/photo/abstract-texture-NVV9Y4J7KQ) |
| 149 | Tweed jacket cuff with horn buttons | 6016×4016 | CC0 | [stocksnap](https://stocksnap.io/photo/tweed-suit-IAEXJXGTXE) |
| 150 | Tweed sleeve, folded | 6016×4016 | CC0 | [stocksnap](https://stocksnap.io/photo/suit-coat-FJKO0JXTHV) |
| 360 | Denim hem and stitching | 6016×4016 | CC0 | [stocksnap](https://stocksnap.io/photo/denim-pocket-4UWBPTYDWI) |
| 366 | Near-black linen, diagonal fold | 4446×2968 | CC0 | [rawpixel](https://www.rawpixel.com/image/5968935/linen-fabric) *(free account)* |
| 361 | Natural linen, oat | 5616×3744 | CC0 | [rawpixel](https://www.rawpixel.com/image/5906856/photo-image-background-texture-public-domain) *(free account)* |
| 363 | Bone cotton twill, flat | 3534×5641 | CC0 | [rawpixel](https://www.rawpixel.com/image/5944035/free-public-domain-cc0-photo) *(free account)* |
| 285 | Undyed woven wool cloth, bone, with a single seam (museum object) | 4893×3668 | CC0 | [rawpixel](https://www.rawpixel.com/image/7450814/image-gold-public-domain-clothing) *(free account)* |
| 284 | Pale strip cloth with one dark motif — negative space (museum object) | 5378×3544 | CC0 | [rawpixel](https://www.rawpixel.com/image/7455700/tunic-strip-cloth-brocaded-decorative-pattern-woven-back-panel-wool) *(free account)* |
| 158 | Black wool suiting, matte | 4116×2342 | CC0 | [rawpixel](https://www.rawpixel.com/image/5941855/free-public-domain-cc0-photo) *(free account)* |
| 161 | Tweed, close weave | 6016×4016 | CC0 | [rawpixel](https://www.rawpixel.com/image/5966484/tweed-fabric-clothing) *(free account)* |
| 152 | Horn buttons on tweed, closer | 6016×4016 | CC0 | [rawpixel](https://www.rawpixel.com/image/5967785/tweed-suit-buttons) *(free account)* |
| 151 | Tweed pocket detail | 6016×4016 | CC0 | [rawpixel](https://www.rawpixel.com/image/5967286/suit-coat-close) *(free account)* |
| 154 | Dark corduroy, fine wale | 4273×2838 | CC0 | [rawpixel](https://www.rawpixel.com/image/5941771/free-public-domain-cc0-photo) *(free account)* |
| 163 | Wool with a faint overcheck | 6016×4016 | CC0 | [rawpixel](https://www.rawpixel.com/image/5966489/wool-fabric-pattern) *(free account)* |
| 364 | Slubbed cloth, cold grey | 2816×1880 | CC0 | [rawpixel](https://www.rawpixel.com/image/5958155/free-public-domain-cc0-photo) *(free account)* |
| 379 | Curled wool pile, undyed | 4608×3456 | CC0 | [rawpixel](https://www.rawpixel.com/image/6045284/free-public-domain-cc0-photo) *(free account)* |
| 272 | Folded knitwear stacked on dark wood | 4460×2973 | CC0 | [rawpixel](https://www.rawpixel.com/image/11515763/stack-folded-t-shirts) *(free account)* |

### Garments, rails and still life — 14

**Not product photography.** Rails, hangers, boots and interiors — atmosphere around the clothes, never a substitute for shooting your own.

| # | What it is | Pixels | Licence | Where from |
|---|---|---|---|---|
| 237 | Hangers on a rail, shallow focus | 7497×5000 | CC0 | [stocksnap](https://stocksnap.io/photo/wooden-hangers-LTQSRPX2A4) |
| 172 | Rail of white shirts, warm light | 3888×2592 | CC0 | [rawpixel](https://www.rawpixel.com/image/5928099/photo-image-public-domain-shirt-minimal) *(free account)* |
| 173 | Rail of neutral clothing against a white wall | 5472×3648 | CC0 | [rawpixel](https://www.rawpixel.com/image/3283850/free-photo-image-clothes-closet-dressing-room) *(free account)* |
| 241 | Hung garments in greys and indigo | 2087×3335 | CC0 | [rawpixel](https://www.rawpixel.com/image/3336903/free-photo-image-clothes-rack-styled-fashion) *(free account)* |
| 251 | Wooden coat hanger on white, 1940 (museum object) | 3000×2000 | CC BY 4.0 | [museumsvictoria](https://collections.museumsvictoria.com.au/items/251331) |
| 244 | Carved wooden hanger, isolated on white (museum object) | 3000×2000 | CC BY 4.0 | [museumsvictoria](https://collections.museumsvictoria.com.au/items/2246156) |
| 239 | Wooden hangers massed on a rail | 5902×3935 | CC0 | [rawpixel](https://www.rawpixel.com/image/3284282/free-photo-image-clothing-hangers-boutique) *(free account)* |
| 420 | Black riding boots on a grey ground (museum object) | 4550×6088 | CC0 | [rawpixel](https://www.rawpixel.com/image/11801373/pair-womans-riding-boots) *(free account)* |
| 452 | Tall black leather boots on grey, 1940s (museum object) | 2000×3000 | CC BY 4.0 | [museumsvictoria](https://collections.museumsvictoria.com.au/items/1417552) |
| 437 | Black leather ski boots on grey, c.1950 (museum object) | 3000×2000 | CC BY 4.0 | [museumsvictoria](https://collections.museumsvictoria.com.au/items/253372) |
| 421 | Split-toe grey field boots, pair (museum object) | 4120×5008 | CC0 | [rawpixel](https://www.rawpixel.com/image/11800545/image-art-public-domain-black) *(free account)* |
| 428 | Brown lace-up riding boots, worn, 1939 (museum object) | 2272×1704 | CC BY 4.0 | [museumsvictoria](https://collections.museumsvictoria.com.au/items/256270) |
| 513 | Dark interior, bowl on a table by a window | 6000×4000 | CC0 | [rawpixel](https://www.rawpixel.com/image/3288728/free-photo-image-banister-bowl-cc0) *(free account)* |
| 504 | Linen curtain in low sun | 2784×1856 | CC0 | [rawpixel](https://www.rawpixel.com/image/3285030/free-photo-image-morning-wooden-floor-sun-light-interior-decorations) *(free account)* |

## The six that need a credit line

CC BY 4.0 requires attribution wherever the image appears. Openverse supplies the exact wording:

- **928** — "Wallet Folder - Black, Fabric, circa 1960s" is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.
- **251** — "Coat Hanger - Bruno Bianchi, Wood, circa 1940" is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.
- **244** — "Coat Hanger - Wood & Metal, McArthur Family Doll's House, circa 1920" by Photographer: Deborah Tout-Smith is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.
- **452** — "Boots - Ukrainian, Female, Black Leather, 1940s" by Photographer: Taryn Ellis is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.
- **437** — "Boots - Ski, Black Leather, circa 1950" is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.
- **428** — "Boots - Riding, Brown Leather, Lace-up, circa 1939" by Photographer: Celia Lariba is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.

## What this list does not solve

- **Your garments.** Sixteen photographs of the actual clothes, at 2,400 px or more, would do more for the
  shop than all hundred of these. `TODO.md` §5 is still the real fix.
- **Faces.** If you want people wearing the clothes, that is a shoot with a model release, not a download.
- **Consistency.** These are a hundred photographers, not one. Choose a dozen that sit together rather than
  the dozen that are individually best, and put the rest back.
