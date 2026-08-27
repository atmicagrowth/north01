import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * The schema half of the Phase 6 post-implementation audit.
 *
 * Every statement here drops a `NOT NULL` from a foreign key that also carries `ON DELETE SET NULL` —
 * a combination Payload produces from `required: true` and which makes the *referenced* row
 * undeletable rather than cascading. Where the dependant is a collection, `hooks/cascadeDelete.ts`
 * handles it. Where the dependant is an array or block row inside another document — a shop-the-look
 * hotspot, a gallery image, a review photo — nothing can: those rows are not documents. The
 * requirement moved to `validate`, which is enforced on every write and costs the column nothing.
 *
 * The result is the behaviour the plan already specified: plan §22.1b's *"hide the hotspot if the
 * product reference is invalid"* and plan §8.1d's neutral media placeholder both describe a reference
 * that has become empty, which could not previously happen.
 *
 * Hand-edited as `docs/DATABASE.md` §4 requires: parameters trimmed to `{ db }`, and every
 * `DROP CONSTRAINT` made `IF EXISTS`.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products_gallery" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "collections_blocks_figure" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "collections_blocks_split_feature" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "collections_blocks_gallery_images" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "collections_blocks_look_hotspots" ALTER COLUMN "product_id" DROP NOT NULL;
  ALTER TABLE "collections_blocks_look" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "edits_blocks_figure" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "edits_blocks_split_feature" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "edits_blocks_gallery_images" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "edits_blocks_look_hotspots" ALTER COLUMN "product_id" DROP NOT NULL;
  ALTER TABLE "edits_blocks_look" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "lookbooks_chapters_gallery" ALTER COLUMN "image_id" DROP NOT NULL;
  ALTER TABLE "lookbooks_chapters_hotspots" ALTER COLUMN "product_id" DROP NOT NULL;
  ALTER TABLE "reviews_photos" ALTER COLUMN "image_id" DROP NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products_gallery" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "collections_blocks_figure" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "collections_blocks_split_feature" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "collections_blocks_gallery_images" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "collections_blocks_look_hotspots" ALTER COLUMN "product_id" SET NOT NULL;
  ALTER TABLE "collections_blocks_look" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "edits_blocks_figure" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "edits_blocks_split_feature" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "edits_blocks_gallery_images" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "edits_blocks_look_hotspots" ALTER COLUMN "product_id" SET NOT NULL;
  ALTER TABLE "edits_blocks_look" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "lookbooks_chapters_gallery" ALTER COLUMN "image_id" SET NOT NULL;
  ALTER TABLE "lookbooks_chapters_hotspots" ALTER COLUMN "product_id" SET NOT NULL;
  ALTER TABLE "reviews_photos" ALTER COLUMN "image_id" SET NOT NULL;`)
}
