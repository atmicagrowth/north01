import type { CollectionConfig } from 'payload'

import { anyone, isAdmin, isStaff } from '../access'
import { slugField } from '../fields/slug'

/**
 * **Gap G-02**, assigned to this phase. Plan §6.1b gives a product a *"size guide reference"* and
 * never defines what it references; feature matrix §8 specifies the feature — measurement tables,
 * fit notes, model info, a mobile drawer and an accessible dialog — and names Payload structured
 * content as its source. This is the collection both were pointing at. Recorded in **DEV-10**.
 *
 * **Rows carry their own labels.** The obvious model — a list of column headers plus rows of values
 * aligned by position — is the one that breaks: a row with one fewer value silently shifts every
 * measurement after it into the wrong column, and nothing in the admin panel shows the editor that
 * it happened. Here each cell states what it measures, so a missing cell renders blank instead of
 * corrupting its neighbours. The renderer takes the column order from the order labels first appear.
 *
 * `appliesTo` is a convenience, not a constraint: a product points at its guide directly
 * (`products.sizeGuide`), and this lists the categories the guide was written for so an editor
 * adding a shirt can find the shirt guide. Nothing enforces agreement between the two, because a
 * one-off product with a borrowed guide is a legitimate thing and a validator forbidding it would
 * only be worked around.
 */
export const SizeGuides: CollectionConfig = {
  slug: 'size-guides',

  labels: { singular: 'Size guide', plural: 'Size guides' },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'unit', 'updatedAt'],
    group: 'Catalogue',
    description: 'Measurement tables opened from the product page beside the size selector.',
  },

  /**
   * Public, unconditionally: a size guide has no draft state (it is reference data, not a page) and
   * nothing on it is private. Plan §13.1c renders it in a drawer on every product detail page.
   */
  access: {
    read: anyone,
    create: isStaff,
    update: isStaff,
    delete: isAdmin,
  },

  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'What the customer sees at the top of the dialog — "Men\'s tops".' },
    },
    slugField(),
    {
      name: 'appliesTo',
      type: 'relationship',
      relationTo: 'categories',
      hasMany: true,
      admin: {
        description:
          'Which categories this guide was written for. A hint for editors — the binding link is the field on the product itself.',
      },
    },
    {
      name: 'unit',
      type: 'select',
      required: true,
      defaultValue: 'cm',
      options: [
        { label: 'Centimetres', value: 'cm' },
        { label: 'Inches', value: 'in' },
      ],
      admin: {
        description:
          'One unit per guide. Write a second guide rather than mixing units in one table.',
      },
    },
    {
      name: 'rows',
      type: 'array',
      required: true,
      minRows: 1,
      labels: { singular: 'Size', plural: 'Sizes' },
      admin: {
        description: 'One row per size, in the order they should be displayed.',
      },
      fields: [
        {
          name: 'size',
          type: 'text',
          required: true,
          admin: {
            description:
              'Must match the variant size exactly — "M", "32" — or the guide and the selector disagree.',
          },
        },
        {
          name: 'measurements',
          type: 'array',
          required: true,
          minRows: 1,
          labels: { singular: 'Measurement', plural: 'Measurements' },
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'label',
                  type: 'text',
                  required: true,
                  admin: { width: '50%', description: 'Chest, Waist, Sleeve…' },
                },
                {
                  /**
                   * Text, not a number, because a real size chart says "96–101" as often as it says
                   * "98". A numeric column would force the range to be split into two fields that
                   * every guide then leaves half empty.
                   */
                  name: 'value',
                  type: 'text',
                  required: true,
                  admin: { width: '50%', description: 'A number or a range — "98" or "96–101".' },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'fitNotes',
      type: 'richText',
      admin: { description: 'How the garment is cut, and how to choose between two sizes.' },
    },
    {
      name: 'modelNote',
      type: 'text',
      admin: {
        description: 'Optional — feature matrix §8. "Model is 183 cm and wears a size M."',
      },
    },
  ],
}
