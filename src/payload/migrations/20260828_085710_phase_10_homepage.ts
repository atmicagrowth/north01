import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * **Phase 10 — the homepage global, and one field on `campaigns`.**
 *
 * Purely additive. The `up` contains **no `DROP COLUMN` and no `DROP TABLE`**, so nothing existing
 * loses data: 17 new tables (`homepage`, `homepage_rels` and fifteen `homepage_blocks_*`), 15 enums,
 * 34 foreign keys, 62 indexes, and three columns on `campaigns` for plan §10.1b's secondary hero CTA.
 *
 * ### Two things that were checked before this file existed
 *
 * **Identifier lengths.** Postgres truncates anything over 63 bytes silently, and symmetrically — the
 * matching `DROP CONSTRAINT` truncates the same way, so a roll forward and back passes while the
 * Drizzle snapshot holds a name the database has never had. Two blocks breached it at the default
 * naming and carry the function form of `dbName` in `payload/blocks/home.ts`:
 *
 * | | Default | Shortened |
 * |---|---|---|
 * | `collectionFeature` | `homepage_blocks_collection_feature_collection_id_collections_id_fk` (**66**) | `…_collection_collection_id_collections_id_fk` (58) |
 * | `categoryTiles` | `homepage_blocks_category_tiles_items_category_id_categories_id_fk` (**65**) | `…_tiles_items_category_id_categories_id_fk` (56) |
 *
 * Verified against the pushed schema afterwards: no identifier anywhere in the database is 63 bytes
 * or longer. `scripts/verify-home.ts` holds that as an invariant.
 *
 * **`DROP CONSTRAINT IF EXISTS` is not needed here, and the absence is deliberate rather than an
 * oversight.** `docs/DATABASE.md` §4.6 requires it *"whenever the migration drops a collection"*,
 * because Drizzle emits `DROP TABLE … CASCADE` beside explicit drops of constraints the cascade has
 * already removed. This `down` contains **zero** explicit `DROP CONSTRAINT` statements — only the
 * cascading table drops — so there is nothing for the hazard to bite. Counted, not assumed.
 *
 * The `down` drops the three `campaigns` columns, which is real data loss for any campaign whose
 * secondary CTA an editor has filled in. That is the correct inverse and is stated here so nobody
 * runs it casually.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_campaigns_secondary_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_homepage_blocks_promo_strip_items_link_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_homepage_blocks_product_rail_source" AS ENUM('new', 'bestSellers', 'limited', 'featured');
  CREATE TYPE "public"."enum_homepage_blocks_product_rail_layout" AS ENUM('grid', 'rail');
  CREATE TYPE "public"."enum_homepage_blocks_product_rail_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_homepage_blocks_split_feature_image_side" AS ENUM('left', 'right');
  CREATE TYPE "public"."enum_homepage_blocks_split_feature_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_homepage_blocks_figure_treatment" AS ENUM('contained', 'fullBleed');
  CREATE TYPE "public"."enum_homepage_blocks_figure_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_homepage_blocks_editorial_width" AS ENUM('narrow', 'wide');
  CREATE TYPE "public"."enum_homepage_blocks_editorial_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_homepage_blocks_look_hotspots_marker_tone" AS ENUM('light', 'dark');
  CREATE TYPE "public"."enum_homepage_blocks_product_group_layout" AS ENUM('grid', 'rail');
  CREATE TYPE "public"."enum_homepage_blocks_collection_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_homepage_blocks_social_gallery_items_link_kind" AS ENUM('reference', 'url');
  CREATE TABLE "homepage_blocks_hero" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"campaign_id" integer,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_promo_strip_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL,
  	"link_label" varchar,
  	"link_kind" "enum_homepage_blocks_promo_strip_items_link_kind" DEFAULT 'reference' NOT NULL,
  	"link_href" varchar
  );
  
  CREATE TABLE "homepage_blocks_promo_strip" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_tiles_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"category_id" integer,
  	"image_id" integer,
  	"label" varchar
  );
  
  CREATE TABLE "homepage_blocks_tiles" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_product_rail" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"source" "enum_homepage_blocks_product_rail_source" DEFAULT 'new' NOT NULL,
  	"limit" numeric DEFAULT 4,
  	"layout" "enum_homepage_blocks_product_rail_layout" DEFAULT 'grid',
  	"cta_label" varchar,
  	"cta_kind" "enum_homepage_blocks_product_rail_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_split_feature" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"image_side" "enum_homepage_blocks_split_feature_image_side" DEFAULT 'left',
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" jsonb,
  	"cta_label" varchar,
  	"cta_kind" "enum_homepage_blocks_split_feature_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_figure" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"mobile_image_id" integer,
  	"treatment" "enum_homepage_blocks_figure_treatment" DEFAULT 'contained',
  	"caption" varchar,
  	"cta_label" varchar,
  	"cta_kind" "enum_homepage_blocks_figure_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_editorial" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" jsonb,
  	"width" "enum_homepage_blocks_editorial_width" DEFAULT 'narrow',
  	"cta_label" varchar,
  	"cta_kind" "enum_homepage_blocks_editorial_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_look_hotspots" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"product_id" integer,
  	"label" varchar,
  	"x_desktop" numeric NOT NULL,
  	"y_desktop" numeric NOT NULL,
  	"x_mobile" numeric NOT NULL,
  	"y_mobile" numeric NOT NULL,
  	"marker_tone" "enum_homepage_blocks_look_hotspots_marker_tone" DEFAULT 'light'
  );
  
  CREATE TABLE "homepage_blocks_look" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_product_group" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"intro" varchar,
  	"layout" "enum_homepage_blocks_product_group_layout" DEFAULT 'grid',
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_collection" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"collection_id" integer,
  	"eyebrow" varchar,
  	"image_id" integer,
  	"mobile_image_id" integer,
  	"body" varchar,
  	"cta_label" varchar,
  	"cta_kind" "enum_homepage_blocks_collection_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage_blocks_social_gallery_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer,
  	"handle" varchar,
  	"link_label" varchar,
  	"link_kind" "enum_homepage_blocks_social_gallery_items_link_kind" DEFAULT 'reference' NOT NULL,
  	"link_href" varchar
  );
  
  CREATE TABLE "homepage_blocks_social_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "homepage" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "homepage_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer,
  	"categories_id" integer,
  	"collections_id" integer,
  	"edits_id" integer,
  	"lookbooks_id" integer,
  	"journal_id" integer
  );
  
  ALTER TABLE "campaigns" ADD COLUMN "secondary_cta_label" varchar;
  ALTER TABLE "campaigns" ADD COLUMN "secondary_cta_kind" "enum_campaigns_secondary_cta_kind" DEFAULT 'reference' NOT NULL;
  ALTER TABLE "campaigns" ADD COLUMN "secondary_cta_href" varchar;
  ALTER TABLE "homepage_blocks_hero" ADD CONSTRAINT "homepage_blocks_hero_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_hero" ADD CONSTRAINT "homepage_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_promo_strip_items" ADD CONSTRAINT "homepage_blocks_promo_strip_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage_blocks_promo_strip"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_promo_strip" ADD CONSTRAINT "homepage_blocks_promo_strip_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_tiles_items" ADD CONSTRAINT "homepage_blocks_tiles_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_tiles_items" ADD CONSTRAINT "homepage_blocks_tiles_items_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_tiles_items" ADD CONSTRAINT "homepage_blocks_tiles_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage_blocks_tiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_tiles" ADD CONSTRAINT "homepage_blocks_tiles_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_product_rail" ADD CONSTRAINT "homepage_blocks_product_rail_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_split_feature" ADD CONSTRAINT "homepage_blocks_split_feature_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_split_feature" ADD CONSTRAINT "homepage_blocks_split_feature_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_figure" ADD CONSTRAINT "homepage_blocks_figure_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_figure" ADD CONSTRAINT "homepage_blocks_figure_mobile_image_id_media_id_fk" FOREIGN KEY ("mobile_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_figure" ADD CONSTRAINT "homepage_blocks_figure_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_editorial" ADD CONSTRAINT "homepage_blocks_editorial_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_look_hotspots" ADD CONSTRAINT "homepage_blocks_look_hotspots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_look_hotspots" ADD CONSTRAINT "homepage_blocks_look_hotspots_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage_blocks_look"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_look" ADD CONSTRAINT "homepage_blocks_look_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_look" ADD CONSTRAINT "homepage_blocks_look_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_product_group" ADD CONSTRAINT "homepage_blocks_product_group_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_collection" ADD CONSTRAINT "homepage_blocks_collection_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_collection" ADD CONSTRAINT "homepage_blocks_collection_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_collection" ADD CONSTRAINT "homepage_blocks_collection_mobile_image_id_media_id_fk" FOREIGN KEY ("mobile_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_collection" ADD CONSTRAINT "homepage_blocks_collection_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_social_gallery_items" ADD CONSTRAINT "homepage_blocks_social_gallery_items_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "homepage_blocks_social_gallery_items" ADD CONSTRAINT "homepage_blocks_social_gallery_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage_blocks_social_gallery"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_blocks_social_gallery" ADD CONSTRAINT "homepage_blocks_social_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_rels" ADD CONSTRAINT "homepage_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_rels" ADD CONSTRAINT "homepage_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_rels" ADD CONSTRAINT "homepage_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_rels" ADD CONSTRAINT "homepage_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_rels" ADD CONSTRAINT "homepage_rels_edits_fk" FOREIGN KEY ("edits_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_rels" ADD CONSTRAINT "homepage_rels_lookbooks_fk" FOREIGN KEY ("lookbooks_id") REFERENCES "public"."lookbooks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "homepage_rels" ADD CONSTRAINT "homepage_rels_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "homepage_blocks_hero_order_idx" ON "homepage_blocks_hero" USING btree ("_order");
  CREATE INDEX "homepage_blocks_hero_parent_id_idx" ON "homepage_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_hero_path_idx" ON "homepage_blocks_hero" USING btree ("_path");
  CREATE INDEX "homepage_blocks_hero_campaign_idx" ON "homepage_blocks_hero" USING btree ("campaign_id");
  CREATE INDEX "homepage_blocks_promo_strip_items_order_idx" ON "homepage_blocks_promo_strip_items" USING btree ("_order");
  CREATE INDEX "homepage_blocks_promo_strip_items_parent_id_idx" ON "homepage_blocks_promo_strip_items" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_promo_strip_order_idx" ON "homepage_blocks_promo_strip" USING btree ("_order");
  CREATE INDEX "homepage_blocks_promo_strip_parent_id_idx" ON "homepage_blocks_promo_strip" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_promo_strip_path_idx" ON "homepage_blocks_promo_strip" USING btree ("_path");
  CREATE INDEX "homepage_blocks_tiles_items_order_idx" ON "homepage_blocks_tiles_items" USING btree ("_order");
  CREATE INDEX "homepage_blocks_tiles_items_parent_id_idx" ON "homepage_blocks_tiles_items" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_tiles_items_category_idx" ON "homepage_blocks_tiles_items" USING btree ("category_id");
  CREATE INDEX "homepage_blocks_tiles_items_image_idx" ON "homepage_blocks_tiles_items" USING btree ("image_id");
  CREATE INDEX "homepage_blocks_tiles_order_idx" ON "homepage_blocks_tiles" USING btree ("_order");
  CREATE INDEX "homepage_blocks_tiles_parent_id_idx" ON "homepage_blocks_tiles" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_tiles_path_idx" ON "homepage_blocks_tiles" USING btree ("_path");
  CREATE INDEX "homepage_blocks_product_rail_order_idx" ON "homepage_blocks_product_rail" USING btree ("_order");
  CREATE INDEX "homepage_blocks_product_rail_parent_id_idx" ON "homepage_blocks_product_rail" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_product_rail_path_idx" ON "homepage_blocks_product_rail" USING btree ("_path");
  CREATE INDEX "homepage_blocks_split_feature_order_idx" ON "homepage_blocks_split_feature" USING btree ("_order");
  CREATE INDEX "homepage_blocks_split_feature_parent_id_idx" ON "homepage_blocks_split_feature" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_split_feature_path_idx" ON "homepage_blocks_split_feature" USING btree ("_path");
  CREATE INDEX "homepage_blocks_split_feature_image_idx" ON "homepage_blocks_split_feature" USING btree ("image_id");
  CREATE INDEX "homepage_blocks_figure_order_idx" ON "homepage_blocks_figure" USING btree ("_order");
  CREATE INDEX "homepage_blocks_figure_parent_id_idx" ON "homepage_blocks_figure" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_figure_path_idx" ON "homepage_blocks_figure" USING btree ("_path");
  CREATE INDEX "homepage_blocks_figure_image_idx" ON "homepage_blocks_figure" USING btree ("image_id");
  CREATE INDEX "homepage_blocks_figure_mobile_image_idx" ON "homepage_blocks_figure" USING btree ("mobile_image_id");
  CREATE INDEX "homepage_blocks_editorial_order_idx" ON "homepage_blocks_editorial" USING btree ("_order");
  CREATE INDEX "homepage_blocks_editorial_parent_id_idx" ON "homepage_blocks_editorial" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_editorial_path_idx" ON "homepage_blocks_editorial" USING btree ("_path");
  CREATE INDEX "homepage_blocks_look_hotspots_order_idx" ON "homepage_blocks_look_hotspots" USING btree ("_order");
  CREATE INDEX "homepage_blocks_look_hotspots_parent_id_idx" ON "homepage_blocks_look_hotspots" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_look_hotspots_product_idx" ON "homepage_blocks_look_hotspots" USING btree ("product_id");
  CREATE INDEX "homepage_blocks_look_order_idx" ON "homepage_blocks_look" USING btree ("_order");
  CREATE INDEX "homepage_blocks_look_parent_id_idx" ON "homepage_blocks_look" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_look_path_idx" ON "homepage_blocks_look" USING btree ("_path");
  CREATE INDEX "homepage_blocks_look_image_idx" ON "homepage_blocks_look" USING btree ("image_id");
  CREATE INDEX "homepage_blocks_product_group_order_idx" ON "homepage_blocks_product_group" USING btree ("_order");
  CREATE INDEX "homepage_blocks_product_group_parent_id_idx" ON "homepage_blocks_product_group" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_product_group_path_idx" ON "homepage_blocks_product_group" USING btree ("_path");
  CREATE INDEX "homepage_blocks_collection_order_idx" ON "homepage_blocks_collection" USING btree ("_order");
  CREATE INDEX "homepage_blocks_collection_parent_id_idx" ON "homepage_blocks_collection" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_collection_path_idx" ON "homepage_blocks_collection" USING btree ("_path");
  CREATE INDEX "homepage_blocks_collection_collection_idx" ON "homepage_blocks_collection" USING btree ("collection_id");
  CREATE INDEX "homepage_blocks_collection_image_idx" ON "homepage_blocks_collection" USING btree ("image_id");
  CREATE INDEX "homepage_blocks_collection_mobile_image_idx" ON "homepage_blocks_collection" USING btree ("mobile_image_id");
  CREATE INDEX "homepage_blocks_social_gallery_items_order_idx" ON "homepage_blocks_social_gallery_items" USING btree ("_order");
  CREATE INDEX "homepage_blocks_social_gallery_items_parent_id_idx" ON "homepage_blocks_social_gallery_items" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_social_gallery_items_image_idx" ON "homepage_blocks_social_gallery_items" USING btree ("image_id");
  CREATE INDEX "homepage_blocks_social_gallery_order_idx" ON "homepage_blocks_social_gallery" USING btree ("_order");
  CREATE INDEX "homepage_blocks_social_gallery_parent_id_idx" ON "homepage_blocks_social_gallery" USING btree ("_parent_id");
  CREATE INDEX "homepage_blocks_social_gallery_path_idx" ON "homepage_blocks_social_gallery" USING btree ("_path");
  CREATE INDEX "homepage_rels_order_idx" ON "homepage_rels" USING btree ("order");
  CREATE INDEX "homepage_rels_parent_idx" ON "homepage_rels" USING btree ("parent_id");
  CREATE INDEX "homepage_rels_path_idx" ON "homepage_rels" USING btree ("path");
  CREATE INDEX "homepage_rels_products_id_idx" ON "homepage_rels" USING btree ("products_id");
  CREATE INDEX "homepage_rels_categories_id_idx" ON "homepage_rels" USING btree ("categories_id");
  CREATE INDEX "homepage_rels_collections_id_idx" ON "homepage_rels" USING btree ("collections_id");
  CREATE INDEX "homepage_rels_edits_id_idx" ON "homepage_rels" USING btree ("edits_id");
  CREATE INDEX "homepage_rels_lookbooks_id_idx" ON "homepage_rels" USING btree ("lookbooks_id");
  CREATE INDEX "homepage_rels_journal_id_idx" ON "homepage_rels" USING btree ("journal_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "homepage_blocks_hero" CASCADE;
  DROP TABLE "homepage_blocks_promo_strip_items" CASCADE;
  DROP TABLE "homepage_blocks_promo_strip" CASCADE;
  DROP TABLE "homepage_blocks_tiles_items" CASCADE;
  DROP TABLE "homepage_blocks_tiles" CASCADE;
  DROP TABLE "homepage_blocks_product_rail" CASCADE;
  DROP TABLE "homepage_blocks_split_feature" CASCADE;
  DROP TABLE "homepage_blocks_figure" CASCADE;
  DROP TABLE "homepage_blocks_editorial" CASCADE;
  DROP TABLE "homepage_blocks_look_hotspots" CASCADE;
  DROP TABLE "homepage_blocks_look" CASCADE;
  DROP TABLE "homepage_blocks_product_group" CASCADE;
  DROP TABLE "homepage_blocks_collection" CASCADE;
  DROP TABLE "homepage_blocks_social_gallery_items" CASCADE;
  DROP TABLE "homepage_blocks_social_gallery" CASCADE;
  DROP TABLE "homepage" CASCADE;
  DROP TABLE "homepage_rels" CASCADE;
  ALTER TABLE "campaigns" DROP COLUMN "secondary_cta_label";
  ALTER TABLE "campaigns" DROP COLUMN "secondary_cta_kind";
  ALTER TABLE "campaigns" DROP COLUMN "secondary_cta_href";
  DROP TYPE "public"."enum_campaigns_secondary_cta_kind";
  DROP TYPE "public"."enum_homepage_blocks_promo_strip_items_link_kind";
  DROP TYPE "public"."enum_homepage_blocks_product_rail_source";
  DROP TYPE "public"."enum_homepage_blocks_product_rail_layout";
  DROP TYPE "public"."enum_homepage_blocks_product_rail_cta_kind";
  DROP TYPE "public"."enum_homepage_blocks_split_feature_image_side";
  DROP TYPE "public"."enum_homepage_blocks_split_feature_cta_kind";
  DROP TYPE "public"."enum_homepage_blocks_figure_treatment";
  DROP TYPE "public"."enum_homepage_blocks_figure_cta_kind";
  DROP TYPE "public"."enum_homepage_blocks_editorial_width";
  DROP TYPE "public"."enum_homepage_blocks_editorial_cta_kind";
  DROP TYPE "public"."enum_homepage_blocks_look_hotspots_marker_tone";
  DROP TYPE "public"."enum_homepage_blocks_product_group_layout";
  DROP TYPE "public"."enum_homepage_blocks_collection_cta_kind";
  DROP TYPE "public"."enum_homepage_blocks_social_gallery_items_link_kind";`)
}
