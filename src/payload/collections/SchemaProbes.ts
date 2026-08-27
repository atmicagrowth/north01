import type { CollectionConfig } from 'payload'

/**
 * Plan §5.1c's "one small test collection" — the fixture that proves the database foundation
 * before Phase 6 commits a real data model to it.
 *
 * It exists to make §5.1d's list of schema concerns concrete rather than aspirational. Every
 * requirement in that list is exercised by a field below, so the initial migration is a worked
 * example of each: an index, a unique constraint, a compound unique constraint, a foreign key,
 * a deliberately nullable column beside deliberately required ones, timestamps, and a
 * soft-delete strategy.
 *
 * **This collection is Phase 5 scaffolding and Phase 6 removes it.** That removal is deliberate
 * and useful: it will be this project's first *destructive* migration, which is the one migration
 * shape that has to be proved on something worthless before it is trusted with an order table.
 * See docs/DATABASE.md.
 *
 * Access control is left at Payload's default — `Boolean(req.user)` — so every operation here
 * requires an authenticated admin. Phase 7 owns access rules and this collection will be gone
 * before it arrives; what matters now is that the default is closed, not open.
 */
export const SchemaProbes: CollectionConfig = {
  slug: 'schema-probes',

  labels: {
    singular: 'Schema Probe',
    plural: 'Schema Probes',
  },

  admin: {
    useAsTitle: 'label',
    defaultColumns: ['reference', 'label', 'status', 'owner', 'updatedAt'],
    group: 'System',
    description:
      'Phase 5 database fixture. Proves connectivity, CRUD and the migration workflow. Removed in Phase 6.',
  },

  /**
   * §5.1d, "soft-delete/archive strategy where necessary".
   *
   * Payload's own soft delete: a delete sets `deleted_at` instead of removing the row, and every
   * read filters trashed documents out unless it asks for them. Proved here on a fixture so that
   * the phases that genuinely need it — orders, which must never be erasable by a mis-click, and
   * customers, where erasure is a legal question rather than a UI one — inherit a mechanism that
   * has already been exercised rather than one chosen under pressure.
   *
   * Note what it is not: `status: 'archived'` below is an *editorial* state, visible to staff and
   * meaningful in queries. `deletedAt` is a *lifecycle* state. Conflating them is how "archived"
   * ends up meaning three different things by Phase 20, so they are separate columns here.
   */
  trash: true,

  /**
   * §5.1d, "timestamps". Payload's default is already `true`; it is stated because the plan asks
   * for the decision to be deliberate, and because `created_at`/`updated_at` on every table is
   * what makes the audit questions of later phases answerable at all.
   */
  timestamps: true,

  /**
   * §5.1d, "unique constraints" — the multi-column case, which no single field can express.
   *
   * One label per owner. It compiles to a Postgres UNIQUE index over (owner_id, label).
   *
   * **The trap, recorded because it will recur in Phase 6.** `owner` is nullable, and in Postgres
   * NULLs are distinct from one another: two rows with no owner and the same label both satisfy
   * this constraint. A compound unique index over a nullable column therefore does not mean what
   * it reads like. PostgreSQL 15+ can say `NULLS NOT DISTINCT`, but Drizzle does not emit it, so
   * the constraint that actually exists is the weaker one. Any collection that needs the stronger
   * reading has to make the column required. See docs/DATABASE.md.
   */
  indexes: [
    {
      fields: ['owner', 'label'],
      unique: true,
    },
  ],

  fields: [
    {
      /**
       * §5.1d, "unique constraints" — the single-column case. `unique` implies an index, so this
       * is also half of "appropriate indexes".
       *
       * A human-authored external key, which is the shape that actually breaks: Phase 6's product
       * SKUs, variant codes and category slugs are all this field wearing different names, and all
       * of them will be typed in twice by someone eventually. The duplicate has to be refused by
       * the database, not by a form validator that a REST client can skip.
       */
      name: 'reference',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Stable external key. Unique across the collection.',
      },
    },
    {
      name: 'label',
      type: 'text',
      required: true,
      admin: {
        description:
          'Human-readable name. Unique per owner, not globally — see the compound index.',
      },
    },
    {
      /**
       * §5.1d, "appropriate indexes" — the non-unique case. Indexed because it is a filter
       * column: a query that says "the active ones" is a sequential scan without it, and that is
       * the exact shape of every catalogue query Phase 10 will write.
       */
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      index: true,
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Archived', value: 'archived' },
      ],
      admin: {
        description: 'Editorial state. Distinct from soft deletion, which is `deletedAt`.',
      },
    },
    {
      /**
       * §5.1d, "nullable vs required fields deliberately".
       *
       * Optional, and it means it: a probe with no note is a complete probe, not a half-filled
       * one. The rule this fixture is here to establish is that `required` is a statement about
       * the domain — a row that cannot be meaningfully read without the value — and never a
       * statement about the form.
       */
      name: 'note',
      type: 'textarea',
      admin: {
        description: 'Optional. Deliberately nullable.',
      },
    },
    {
      /**
       * §5.1d, "foreign key relationships where appropriate", and the "null relationships" and
       * "orphaned records" edge cases in one field.
       *
       * Payload writes a real `REFERENCES users(id)` column for a single, non-polymorphic
       * relationship, and Drizzle emits `ON DELETE SET NULL`. So deleting a user does not orphan
       * this row and does not cascade into it — the reference simply becomes null, which is why
       * every consumer of a relationship must treat "resolves to nothing" as an ordinary state
       * rather than an error. The actual SQL is in the initial migration; read it there rather
       * than trusting this comment.
       */
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: 'Optional relationship. Set to null if the user is deleted, never cascaded.',
      },
    },
  ],
}
