import type {
  RelationshipFieldSingleValidation,
  UploadFieldSingleValidation,
  Validate,
} from 'payload'

/**
 * **Required to author, nullable in the database.** The shape that a `relationship` or `upload`
 * pointing at something deletable has to take in this schema, and the reason is a contradiction
 * Payload sets up without meaning to.
 *
 * `required: true` on a relationship produces two things at once: `NOT NULL` on the column, and
 * `ON DELETE SET NULL` on the foreign key — the latter is the adapter's only behaviour and has no
 * configuration option. Postgres then cannot delete the *parent*: it tries to null a column that may
 * not be null and raises `null value in column "product_id" violates not-null constraint`, failing
 * the delete of the row that was actually being removed.
 *
 * Where the dependant is a collection, `hooks/cascadeDelete.ts` resolves it by removing the children
 * first. Where the dependant is an **array or block row inside another document** — a shop-the-look
 * hotspot, a gallery image, a review photo — it cannot: those rows are not documents, have no
 * collection, and cannot be deleted independently of the page that contains them. A required column
 * there makes the referenced product or media asset permanently undeletable, and the error names an
 * internal block table.
 *
 * So the column is nullable and the requirement moves to `validate`, which Payload runs on the server
 * for every operation including REST and the Local API. Authoring is unchanged: a hotspot still cannot
 * be saved without a product, a gallery row still cannot be saved without an image.
 *
 * **And the resulting behaviour is the one the plan actually specifies.** Deleting a product now nulls
 * the hotspot's reference instead of refusing, which is exactly the state plan §22.1b describes and
 * tells the renderer to handle — *"if the product reference is invalid: hide the hotspot; do not break
 * the entire image"* — a rule that was unreachable while the delete could not happen. The same is true
 * of media and plan §8.1d's *"deliberate neutral placeholder"*. Both were written for a schema in
 * which a reference can go away.
 */

const REQUIRED = 'This field is required.'

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

/**
 * For an `upload` field. Payload's own required check lives in the built-in validator, and supplying
 * a custom `validate` replaces it — so the requirement has to be restated here rather than declared
 * alongside it. See `validation.ts` for why that replacement is easy to miss.
 */
export const validateRequiredUpload: UploadFieldSingleValidation = (value) =>
  isEmpty(value) ? REQUIRED : true

/** For a single (non-`hasMany`) `relationship` field. */
export const validateRequiredRelationship: RelationshipFieldSingleValidation = (value) =>
  isEmpty(value) ? REQUIRED : true

/**
 * The general case, for field types whose validation signature this file does not special-case.
 * Typed loosely on purpose: `Validate` is the union every field's validator narrows from.
 */
export const validateRequired: Validate = (value) => (isEmpty(value) ? REQUIRED : true)
