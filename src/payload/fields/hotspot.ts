import type { Field, NumberFieldSingleValidation } from 'payload'

/**
 * A Shop-the-Look hotspot: a point on an editorial image that resolves to a product.
 *
 * Plan §22.1a states the fields — position, product reference, optional label, optional styling
 * variant — and opens with the rule this file exists to satisfy: **"Do not hard-code hotspot
 * coordinates in React."** Plan §22.1b then requires desktop *and* mobile positions, because the two
 * crops of the same photograph put the sleeve in different places.
 *
 * Coordinates are **percentages of the rendered image box**, not pixels. Pixels would be a promise
 * about a display size that a responsive layout never keeps; a percentage survives every breakpoint,
 * every crop ratio and every `srcset` variant, which is what plan §22.1b's "responsive anchor" means
 * in practice. `0,0` is the top-left corner.
 *
 * `product` is required. A hotspot with nothing behind it is a dot that does nothing when tapped —
 * plan §0.1.17's fake UI — so it cannot be saved. The *other* failure, a product that is deleted
 * after the hotspot was authored, cannot be prevented at the schema level: `ON DELETE SET NULL`
 * empties the reference (`docs/DATABASE.md` §8), and plan §22.1b already says what to do about it —
 * *"if the product reference is invalid: hide the hotspot; do not break the entire image"*. That is
 * the renderer's rule, and it is Phase 22's to implement.
 */
const validatePercentage: NumberFieldSingleValidation = (value, { req: { t }, required }) => {
  if (value === null || value === undefined) {
    return required ? t('validation:required') : true
  }

  return value >= 0 && value <= 100 ? true : 'A percentage of the image, between 0 and 100.'
}

const coordinate = (name: string, label: string): Field => ({
  name,
  type: 'number',
  required: true,
  min: 0,
  max: 100,
  label,
  validate: validatePercentage,
  admin: { width: '25%', step: 0.1 },
})

export const hotspotFields = (): Field[] => [
  {
    name: 'product',
    type: 'relationship',
    relationTo: 'products',
    required: true,
    admin: {
      description: 'Tapping the hotspot opens a preview of this product.',
    },
  },
  {
    name: 'label',
    type: 'text',
    admin: {
      description: 'Optional. Overrides the product name in the marker, for a styling note.',
    },
  },
  {
    type: 'row',
    fields: [
      coordinate('xDesktop', 'X — desktop (%)'),
      coordinate('yDesktop', 'Y — desktop (%)'),
      coordinate('xMobile', 'X — mobile (%)'),
      coordinate('yMobile', 'Y — mobile (%)'),
    ],
  },
  {
    /**
     * Plan §22.1a's "optional styling variant". Two options and no more: the marker sits on
     * photography whose exposure the art direction controls (visual guide §08), so the only real
     * question is whether this frame is light or dark under the dot. Anything richer would be a
     * styling system in the CMS, which the visual guide's guardrails (§11) exist to prevent.
     */
    name: 'markerTone',
    type: 'select',
    defaultValue: 'light',
    options: [
      { label: 'Light marker (on dark imagery)', value: 'light' },
      { label: 'Dark marker (on light imagery)', value: 'dark' },
    ],
  },
]
