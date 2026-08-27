import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Phase 6 — the whole Payload domain model, in one migration. Every collection and global the data
 * model needs, plus the columns and foreign keys Payload adds to `payload_locked_documents_rels` and
 * `payload_preferences_rels` for each new collection.
 *
 * Two hand-edits, both required, both listed as steps in `docs/DATABASE.md` §4:
 *
 * 1. `{ db, payload, req }` reduced to `{ db }` — this project compiles with `noUnusedParameters`.
 * 2. Every `DROP CONSTRAINT` in `down` made `IF EXISTS`. Drizzle emits `DROP TABLE … CASCADE`
 *    alongside explicit cleanup of the objects that referenced those tables, and `CASCADE` has
 *    already removed them by the time the explicit statement runs. Measured: without this,
 *    `pnpm migrate:down` fails on the first one and rolls the whole batch back.
 *
 * Both directions were run against a real Neon database before this file was committed — `up`,
 * then `down`, then `up` again.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_products_fit" AS ENUM('slim', 'regular', 'relaxed', 'oversized');
  CREATE TYPE "public"."enum_products_gender" AS ENUM('women', 'men', 'unisex');
  CREATE TYPE "public"."enum_products_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_product_variants_color_family" AS ENUM('black', 'charcoal', 'grey', 'bone', 'white', 'tan', 'brown', 'navy', 'blue', 'green', 'rust');
  CREATE TYPE "public"."enum_categories_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_size_guides_unit" AS ENUM('cm', 'in');
  CREATE TYPE "public"."enum_collections_blocks_figure_treatment" AS ENUM('contained', 'fullBleed');
  CREATE TYPE "public"."enum_collections_blocks_figure_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_collections_blocks_split_feature_image_side" AS ENUM('left', 'right');
  CREATE TYPE "public"."enum_collections_blocks_split_feature_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_collections_blocks_editorial_width" AS ENUM('narrow', 'wide');
  CREATE TYPE "public"."enum_collections_blocks_editorial_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_collections_blocks_gallery_layout" AS ENUM('pair', 'triptych', 'grid');
  CREATE TYPE "public"."enum_collections_blocks_product_group_layout" AS ENUM('grid', 'rail');
  CREATE TYPE "public"."enum_collections_blocks_look_hotspots_marker_tone" AS ENUM('light', 'dark');
  CREATE TYPE "public"."enum_collections_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_edits_blocks_figure_treatment" AS ENUM('contained', 'fullBleed');
  CREATE TYPE "public"."enum_edits_blocks_figure_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_edits_blocks_split_feature_image_side" AS ENUM('left', 'right');
  CREATE TYPE "public"."enum_edits_blocks_split_feature_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_edits_blocks_editorial_width" AS ENUM('narrow', 'wide');
  CREATE TYPE "public"."enum_edits_blocks_editorial_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_edits_blocks_gallery_layout" AS ENUM('pair', 'triptych', 'grid');
  CREATE TYPE "public"."enum_edits_blocks_product_group_layout" AS ENUM('grid', 'rail');
  CREATE TYPE "public"."enum_edits_blocks_look_hotspots_marker_tone" AS ENUM('light', 'dark');
  CREATE TYPE "public"."enum_edits_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_campaigns_cta_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_campaigns_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_lookbooks_chapters_hotspots_marker_tone" AS ENUM('light', 'dark');
  CREATE TYPE "public"."enum_lookbooks_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_journal_category" AS ENUM('craft', 'design', 'people', 'places', 'style');
  CREATE TYPE "public"."enum_journal_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_carts_currency" AS ENUM('USD', 'GBP', 'EUR');
  CREATE TYPE "public"."enum_carts_status" AS ENUM('active', 'converted');
  CREATE TYPE "public"."enum_orders_payment_status" AS ENUM('draft', 'checkout_started', 'pending_payment', 'paid', 'payment_failed', 'refunded', 'cancelled');
  CREATE TYPE "public"."enum_orders_fulfillment_status" AS ENUM('unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled');
  CREATE TYPE "public"."enum_orders_currency" AS ENUM('USD', 'GBP', 'EUR');
  CREATE TYPE "public"."enum_promotions_type" AS ENUM('percentage', 'fixed', 'free_shipping');
  CREATE TYPE "public"."enum_promotions_currency" AS ENUM('USD', 'GBP', 'EUR');
  CREATE TYPE "public"."enum_reviews_status" AS ENUM('pending', 'approved', 'rejected');
  CREATE TYPE "public"."enum_newsletter_subscribers_source" AS ENUM('footer', 'checkout', 'editorial', 'import');
  CREATE TYPE "public"."enum_newsletter_subscribers_status" AS ENUM('subscribed', 'unsubscribed');
  CREATE TYPE "public"."enum_faqs_topic" AS ENUM('orders', 'shipping', 'returns', 'sizing', 'care', 'account');
  CREATE TYPE "public"."enum_faqs_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_site_settings_default_currency" AS ENUM('USD', 'GBP', 'EUR');
  CREATE TYPE "public"."enum_navigation_primary_columns_links_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_navigation_primary_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_navigation_primary_feature_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_navigation_footer_links_kind" AS ENUM('reference', 'url');
  CREATE TYPE "public"."enum_navigation_social_platform" AS ENUM('instagram', 'tiktok', 'pinterest', 'youtube', 'x', 'linkedin');
  CREATE TABLE "products_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL
  );
  
  CREATE TABLE "products" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"short_description" varchar,
  	"description" jsonb,
  	"editorial_copy" jsonb,
  	"video_id" integer,
  	"care" jsonb,
  	"fit" "enum_products_fit",
  	"fit_notes" varchar,
  	"size_guide_id" integer,
  	"gender" "enum_products_gender",
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"slug" varchar NOT NULL,
  	"status" "enum_products_status" DEFAULT 'draft' NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"featured" boolean DEFAULT false,
  	"is_new" boolean DEFAULT false,
  	"is_best_seller" boolean DEFAULT false,
  	"is_limited_edition" boolean DEFAULT false,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"derived_price_from_minor" numeric,
  	"derived_price_to_minor" numeric,
  	"derived_compare_at_from_minor" numeric,
  	"derived_inventory_total" numeric DEFAULT 0 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "products_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "products_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"categories_id" integer
  );
  
  CREATE TABLE "product_variants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"sku" varchar NOT NULL,
  	"color" varchar NOT NULL,
  	"color_hex" varchar,
  	"color_family" "enum_product_variants_color_family" NOT NULL,
  	"size" varchar NOT NULL,
  	"size_sort_order" numeric DEFAULT 0 NOT NULL,
  	"price_minor" numeric NOT NULL,
  	"compare_at_price_minor" numeric,
  	"inventory_quantity" numeric DEFAULT 0 NOT NULL,
  	"active" boolean DEFAULT true NOT NULL,
  	"image_id" integer,
  	"weight_grams" numeric,
  	"length_mm" numeric,
  	"width_mm" numeric,
  	"height_mm" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	CONSTRAINT "product_variants_inventory_non_negative" CHECK (inventory_quantity >= 0)
  );
  
  CREATE TABLE "categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"parent_id" integer,
  	"description" varchar,
  	"image_id" integer,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"status" "enum_categories_status" DEFAULT 'draft' NOT NULL,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "size_guides_rows_measurements" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"value" varchar NOT NULL
  );
  
  CREATE TABLE "size_guides_rows" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"size" varchar NOT NULL
  );
  
  CREATE TABLE "size_guides" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"unit" "enum_size_guides_unit" DEFAULT 'cm' NOT NULL,
  	"fit_notes" jsonb,
  	"model_note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "size_guides_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"categories_id" integer
  );
  
  CREATE TABLE "collections_blocks_figure" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"mobile_image_id" integer,
  	"treatment" "enum_collections_blocks_figure_treatment" DEFAULT 'contained',
  	"caption" varchar,
  	"cta_label" varchar,
  	"cta_kind" "enum_collections_blocks_figure_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "collections_blocks_split_feature" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"image_side" "enum_collections_blocks_split_feature_image_side" DEFAULT 'left',
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" jsonb,
  	"cta_label" varchar,
  	"cta_kind" "enum_collections_blocks_split_feature_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "collections_blocks_editorial" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" jsonb,
  	"width" "enum_collections_blocks_editorial_width" DEFAULT 'narrow',
  	"cta_label" varchar,
  	"cta_kind" "enum_collections_blocks_editorial_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "collections_blocks_gallery_images" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"caption" varchar
  );
  
  CREATE TABLE "collections_blocks_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"layout" "enum_collections_blocks_gallery_layout" DEFAULT 'pair',
  	"block_name" varchar
  );
  
  CREATE TABLE "collections_blocks_pull_quote" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"quote" varchar NOT NULL,
  	"attribution" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "collections_blocks_product_group" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"intro" varchar,
  	"layout" "enum_collections_blocks_product_group_layout" DEFAULT 'grid',
  	"block_name" varchar
  );
  
  CREATE TABLE "collections_blocks_look_hotspots" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"label" varchar,
  	"x_desktop" numeric NOT NULL,
  	"y_desktop" numeric NOT NULL,
  	"x_mobile" numeric NOT NULL,
  	"y_mobile" numeric NOT NULL,
  	"marker_tone" "enum_collections_blocks_look_hotspots_marker_tone" DEFAULT 'light'
  );
  
  CREATE TABLE "collections_blocks_look" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "collections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"description" jsonb,
  	"hero_media_id" integer,
  	"intro_media_id" integer,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"slug" varchar NOT NULL,
  	"status" "enum_collections_status" DEFAULT 'draft' NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "collections_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer,
  	"collections_id" integer,
  	"categories_id" integer,
  	"edits_id" integer,
  	"lookbooks_id" integer,
  	"journal_id" integer,
  	"campaigns_id" integer
  );
  
  CREATE TABLE "edits_product_groups" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"intro" varchar
  );
  
  CREATE TABLE "edits_blocks_figure" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"mobile_image_id" integer,
  	"treatment" "enum_edits_blocks_figure_treatment" DEFAULT 'contained',
  	"caption" varchar,
  	"cta_label" varchar,
  	"cta_kind" "enum_edits_blocks_figure_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "edits_blocks_split_feature" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"image_side" "enum_edits_blocks_split_feature_image_side" DEFAULT 'left',
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" jsonb,
  	"cta_label" varchar,
  	"cta_kind" "enum_edits_blocks_split_feature_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "edits_blocks_editorial" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" jsonb,
  	"width" "enum_edits_blocks_editorial_width" DEFAULT 'narrow',
  	"cta_label" varchar,
  	"cta_kind" "enum_edits_blocks_editorial_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "edits_blocks_gallery_images" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"caption" varchar
  );
  
  CREATE TABLE "edits_blocks_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"layout" "enum_edits_blocks_gallery_layout" DEFAULT 'pair',
  	"block_name" varchar
  );
  
  CREATE TABLE "edits_blocks_pull_quote" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"quote" varchar NOT NULL,
  	"attribution" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "edits_blocks_product_group" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"intro" varchar,
  	"layout" "enum_edits_blocks_product_group_layout" DEFAULT 'grid',
  	"block_name" varchar
  );
  
  CREATE TABLE "edits_blocks_look_hotspots" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"label" varchar,
  	"x_desktop" numeric NOT NULL,
  	"y_desktop" numeric NOT NULL,
  	"x_mobile" numeric NOT NULL,
  	"y_mobile" numeric NOT NULL,
  	"marker_tone" "enum_edits_blocks_look_hotspots_marker_tone" DEFAULT 'light'
  );
  
  CREATE TABLE "edits_blocks_look" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"heading" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "edits" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"intro" jsonb,
  	"hero_id" integer,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"slug" varchar NOT NULL,
  	"status" "enum_edits_status" DEFAULT 'draft' NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "edits_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer,
  	"lookbooks_id" integer,
  	"categories_id" integer,
  	"collections_id" integer,
  	"edits_id" integer,
  	"journal_id" integer,
  	"campaigns_id" integer
  );
  
  CREATE TABLE "campaigns" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"season" varchar,
  	"hero_id" integer,
  	"mobile_hero_id" integer,
  	"story" jsonb,
  	"cta_label" varchar,
  	"cta_kind" "enum_campaigns_cta_kind" DEFAULT 'reference' NOT NULL,
  	"cta_href" varchar,
  	"collection_id" integer,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"slug" varchar NOT NULL,
  	"status" "enum_campaigns_status" DEFAULT 'draft' NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "campaigns_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer,
  	"categories_id" integer,
  	"collections_id" integer,
  	"edits_id" integer,
  	"lookbooks_id" integer,
  	"journal_id" integer,
  	"campaigns_id" integer
  );
  
  CREATE TABLE "lookbooks_chapters_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"caption" varchar
  );
  
  CREATE TABLE "lookbooks_chapters_hotspots" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"label" varchar,
  	"x_desktop" numeric NOT NULL,
  	"y_desktop" numeric NOT NULL,
  	"x_mobile" numeric NOT NULL,
  	"y_mobile" numeric NOT NULL,
  	"marker_tone" "enum_lookbooks_chapters_hotspots_marker_tone" DEFAULT 'light'
  );
  
  CREATE TABLE "lookbooks_chapters" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"hero_image_id" integer,
  	"editorial_text" jsonb
  );
  
  CREATE TABLE "lookbooks" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"season" varchar,
  	"cover_image_id" integer,
  	"intro" jsonb,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"slug" varchar NOT NULL,
  	"status" "enum_lookbooks_status" DEFAULT 'draft' NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "journal" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"excerpt" varchar,
  	"hero_image_id" integer,
  	"body" jsonb,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"slug" varchar NOT NULL,
  	"category" "enum_journal_category",
  	"author" varchar,
  	"status" "enum_journal_status" DEFAULT 'draft' NOT NULL,
  	"published_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "journal_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer,
  	"collections_id" integer,
  	"journal_id" integer
  );
  
  CREATE TABLE "carts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"token" varchar NOT NULL,
  	"customer_id" integer,
  	"currency" "enum_carts_currency" DEFAULT 'USD' NOT NULL,
  	"status" "enum_carts_status" DEFAULT 'active' NOT NULL,
  	"promotion_id" integer,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "cart_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"cart_id" integer NOT NULL,
  	"product_id" integer NOT NULL,
  	"variant_id" integer NOT NULL,
  	"quantity" numeric DEFAULT 1 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "orders" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"payment_status" "enum_orders_payment_status" DEFAULT 'draft' NOT NULL,
  	"fulfillment_status" "enum_orders_fulfillment_status" DEFAULT 'unfulfilled' NOT NULL,
  	"customer_id" integer,
  	"email" varchar NOT NULL,
  	"currency" "enum_orders_currency" DEFAULT 'USD' NOT NULL,
  	"subtotal_minor" numeric DEFAULT 0 NOT NULL,
  	"discount_minor" numeric DEFAULT 0 NOT NULL,
  	"shipping_minor" numeric DEFAULT 0 NOT NULL,
  	"tax_minor" numeric DEFAULT 0 NOT NULL,
  	"total_minor" numeric DEFAULT 0 NOT NULL,
  	"promotion_id" integer,
  	"discount_code" varchar,
  	"shipping_method_code" varchar,
  	"shipping_method_label" varchar,
  	"shipping_address_first_name" varchar,
  	"shipping_address_last_name" varchar,
  	"shipping_address_company" varchar,
  	"shipping_address_line1" varchar,
  	"shipping_address_line2" varchar,
  	"shipping_address_city" varchar,
  	"shipping_address_region" varchar,
  	"shipping_address_postal_code" varchar,
  	"shipping_address_country" varchar,
  	"shipping_address_phone" varchar,
  	"billing_address_first_name" varchar,
  	"billing_address_last_name" varchar,
  	"billing_address_company" varchar,
  	"billing_address_line1" varchar,
  	"billing_address_line2" varchar,
  	"billing_address_city" varchar,
  	"billing_address_region" varchar,
  	"billing_address_postal_code" varchar,
  	"billing_address_country" varchar,
  	"billing_address_phone" varchar,
  	"carrier" varchar,
  	"tracking_number" varchar,
  	"tracking_url" varchar,
  	"shipped_at" timestamp(3) with time zone,
  	"delivered_at" timestamp(3) with time zone,
  	"stripe_checkout_session_id" varchar,
  	"stripe_payment_intent_id" varchar,
  	"paid_at" timestamp(3) with time zone,
  	"order_number" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "order_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"product_id" integer,
  	"variant_id" integer,
  	"sku" varchar NOT NULL,
  	"product_name" varchar NOT NULL,
  	"variant_label" varchar NOT NULL,
  	"unit_price_minor" numeric NOT NULL,
  	"quantity" numeric NOT NULL,
  	"line_total_minor" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "promotions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"description" varchar,
  	"type" "enum_promotions_type" DEFAULT 'percentage' NOT NULL,
  	"percentage" numeric,
  	"value_minor" numeric,
  	"currency" "enum_promotions_currency" DEFAULT 'USD',
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"minimum_subtotal_minor" numeric,
  	"usage_limit" numeric,
  	"per_customer_limit" numeric,
  	"times_used" numeric DEFAULT 0 NOT NULL,
  	"active" boolean DEFAULT false NOT NULL,
  	"combinable" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "promotions_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer,
  	"collections_id" integer
  );
  
  CREATE TABLE "customers_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "customers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"first_name" varchar NOT NULL,
  	"last_name" varchar NOT NULL,
  	"phone" varchar,
  	"stripe_customer_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "addresses" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"label" varchar,
  	"first_name" varchar NOT NULL,
  	"last_name" varchar NOT NULL,
  	"company" varchar,
  	"line1" varchar NOT NULL,
  	"line2" varchar,
  	"city" varchar NOT NULL,
  	"region" varchar,
  	"postal_code" varchar NOT NULL,
  	"country" varchar NOT NULL,
  	"phone" varchar,
  	"is_default_shipping" boolean DEFAULT false,
  	"is_default_billing" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "wishlist_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"product_id" integer NOT NULL,
  	"variant_preference_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "reviews_photos" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL
  );
  
  CREATE TABLE "reviews" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"customer_id" integer NOT NULL,
  	"display_name" varchar NOT NULL,
  	"rating" numeric NOT NULL,
  	"title" varchar,
  	"body" varchar NOT NULL,
  	"status" "enum_reviews_status" DEFAULT 'pending' NOT NULL,
  	"verified_purchase" boolean DEFAULT false NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "newsletter_subscribers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"email" varchar NOT NULL,
  	"consented_at" timestamp(3) with time zone NOT NULL,
  	"source" "enum_newsletter_subscribers_source" DEFAULT 'footer' NOT NULL,
  	"status" "enum_newsletter_subscribers_status" DEFAULT 'subscribed' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "faqs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"question" varchar NOT NULL,
  	"answer" jsonb NOT NULL,
  	"topic" "enum_faqs_topic" NOT NULL,
  	"sort_order" numeric DEFAULT 0 NOT NULL,
  	"status" "enum_faqs_status" DEFAULT 'draft' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"caption" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_name" varchar DEFAULT 'NORTH / 01' NOT NULL,
  	"logo_id" integer,
  	"tagline" varchar,
  	"contact_email" varchar,
  	"contact_phone" varchar,
  	"default_currency" "enum_site_settings_default_currency" DEFAULT 'USD' NOT NULL,
  	"default_locale" varchar DEFAULT 'en-US' NOT NULL,
  	"free_shipping_threshold_minor" numeric,
  	"low_stock_threshold" numeric DEFAULT 5 NOT NULL,
  	"max_quantity_per_line" numeric DEFAULT 10 NOT NULL,
  	"shipping_policy" jsonb,
  	"returns_policy" jsonb,
  	"default_seo_title" varchar,
  	"default_seo_description" varchar,
  	"default_og_image_id" integer,
  	"announcement_enabled" boolean DEFAULT false,
  	"announcement_message" varchar,
  	"announcement_href" varchar,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "navigation_primary_columns_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"kind" "enum_navigation_primary_columns_links_kind" DEFAULT 'reference' NOT NULL,
  	"href" varchar
  );
  
  CREATE TABLE "navigation_primary_columns" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar
  );
  
  CREATE TABLE "navigation_primary" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"kind" "enum_navigation_primary_kind" DEFAULT 'reference' NOT NULL,
  	"href" varchar,
  	"feature_image_id" integer,
  	"feature_caption" varchar,
  	"feature_label" varchar,
  	"feature_kind" "enum_navigation_primary_feature_kind" DEFAULT 'reference' NOT NULL,
  	"feature_href" varchar
  );
  
  CREATE TABLE "navigation_footer_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"kind" "enum_navigation_footer_links_kind" DEFAULT 'reference' NOT NULL,
  	"href" varchar
  );
  
  CREATE TABLE "navigation_footer" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar NOT NULL
  );
  
  CREATE TABLE "navigation_social" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"platform" "enum_navigation_social_platform" NOT NULL,
  	"url" varchar NOT NULL
  );
  
  CREATE TABLE "navigation" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "navigation_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer,
  	"categories_id" integer,
  	"collections_id" integer,
  	"edits_id" integer,
  	"lookbooks_id" integer,
  	"journal_id" integer,
  	"campaigns_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "products_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "product_variants_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "categories_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "size_guides_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "collections_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "edits_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "campaigns_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "lookbooks_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "journal_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "carts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "cart_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "orders_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "order_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "promotions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "customers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "addresses_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "wishlist_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "reviews_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "newsletter_subscribers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "faqs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "media_id" integer;
  ALTER TABLE "payload_preferences_rels" ADD COLUMN "customers_id" integer;
  ALTER TABLE "products_gallery" ADD CONSTRAINT "products_gallery_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_gallery" ADD CONSTRAINT "products_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_video_id_media_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_size_guide_id_size_guides_id_fk" FOREIGN KEY ("size_guide_id") REFERENCES "public"."size_guides"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_texts" ADD CONSTRAINT "products_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "size_guides_rows_measurements" ADD CONSTRAINT "size_guides_rows_measurements_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."size_guides_rows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "size_guides_rows" ADD CONSTRAINT "size_guides_rows_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."size_guides"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "size_guides_rels" ADD CONSTRAINT "size_guides_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."size_guides"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "size_guides_rels" ADD CONSTRAINT "size_guides_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_figure" ADD CONSTRAINT "collections_blocks_figure_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections_blocks_figure" ADD CONSTRAINT "collections_blocks_figure_mobile_image_id_media_id_fk" FOREIGN KEY ("mobile_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections_blocks_figure" ADD CONSTRAINT "collections_blocks_figure_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_split_feature" ADD CONSTRAINT "collections_blocks_split_feature_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections_blocks_split_feature" ADD CONSTRAINT "collections_blocks_split_feature_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_editorial" ADD CONSTRAINT "collections_blocks_editorial_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_gallery_images" ADD CONSTRAINT "collections_blocks_gallery_images_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections_blocks_gallery_images" ADD CONSTRAINT "collections_blocks_gallery_images_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections_blocks_gallery"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_gallery" ADD CONSTRAINT "collections_blocks_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_pull_quote" ADD CONSTRAINT "collections_blocks_pull_quote_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_product_group" ADD CONSTRAINT "collections_blocks_product_group_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_look_hotspots" ADD CONSTRAINT "collections_blocks_look_hotspots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections_blocks_look_hotspots" ADD CONSTRAINT "collections_blocks_look_hotspots_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections_blocks_look"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_blocks_look" ADD CONSTRAINT "collections_blocks_look_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections_blocks_look" ADD CONSTRAINT "collections_blocks_look_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections" ADD CONSTRAINT "collections_hero_media_id_media_id_fk" FOREIGN KEY ("hero_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections" ADD CONSTRAINT "collections_intro_media_id_media_id_fk" FOREIGN KEY ("intro_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections" ADD CONSTRAINT "collections_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_edits_fk" FOREIGN KEY ("edits_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_lookbooks_fk" FOREIGN KEY ("lookbooks_id") REFERENCES "public"."lookbooks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "collections_rels" ADD CONSTRAINT "collections_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_product_groups" ADD CONSTRAINT "edits_product_groups_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_figure" ADD CONSTRAINT "edits_blocks_figure_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edits_blocks_figure" ADD CONSTRAINT "edits_blocks_figure_mobile_image_id_media_id_fk" FOREIGN KEY ("mobile_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edits_blocks_figure" ADD CONSTRAINT "edits_blocks_figure_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_split_feature" ADD CONSTRAINT "edits_blocks_split_feature_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edits_blocks_split_feature" ADD CONSTRAINT "edits_blocks_split_feature_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_editorial" ADD CONSTRAINT "edits_blocks_editorial_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_gallery_images" ADD CONSTRAINT "edits_blocks_gallery_images_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edits_blocks_gallery_images" ADD CONSTRAINT "edits_blocks_gallery_images_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits_blocks_gallery"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_gallery" ADD CONSTRAINT "edits_blocks_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_pull_quote" ADD CONSTRAINT "edits_blocks_pull_quote_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_product_group" ADD CONSTRAINT "edits_blocks_product_group_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_look_hotspots" ADD CONSTRAINT "edits_blocks_look_hotspots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edits_blocks_look_hotspots" ADD CONSTRAINT "edits_blocks_look_hotspots_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits_blocks_look"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_blocks_look" ADD CONSTRAINT "edits_blocks_look_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edits_blocks_look" ADD CONSTRAINT "edits_blocks_look_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits" ADD CONSTRAINT "edits_hero_id_media_id_fk" FOREIGN KEY ("hero_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edits" ADD CONSTRAINT "edits_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_lookbooks_fk" FOREIGN KEY ("lookbooks_id") REFERENCES "public"."lookbooks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_edits_fk" FOREIGN KEY ("edits_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "edits_rels" ADD CONSTRAINT "edits_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_hero_id_media_id_fk" FOREIGN KEY ("hero_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_mobile_hero_id_media_id_fk" FOREIGN KEY ("mobile_hero_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_edits_fk" FOREIGN KEY ("edits_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_lookbooks_fk" FOREIGN KEY ("lookbooks_id") REFERENCES "public"."lookbooks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "campaigns_rels" ADD CONSTRAINT "campaigns_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "lookbooks_chapters_gallery" ADD CONSTRAINT "lookbooks_chapters_gallery_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "lookbooks_chapters_gallery" ADD CONSTRAINT "lookbooks_chapters_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."lookbooks_chapters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "lookbooks_chapters_hotspots" ADD CONSTRAINT "lookbooks_chapters_hotspots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "lookbooks_chapters_hotspots" ADD CONSTRAINT "lookbooks_chapters_hotspots_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."lookbooks_chapters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "lookbooks_chapters" ADD CONSTRAINT "lookbooks_chapters_hero_image_id_media_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "lookbooks_chapters" ADD CONSTRAINT "lookbooks_chapters_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."lookbooks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "lookbooks" ADD CONSTRAINT "lookbooks_cover_image_id_media_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "lookbooks" ADD CONSTRAINT "lookbooks_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "journal" ADD CONSTRAINT "journal_hero_image_id_media_id_fk" FOREIGN KEY ("hero_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "journal" ADD CONSTRAINT "journal_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "journal_rels" ADD CONSTRAINT "journal_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."journal"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "journal_rels" ADD CONSTRAINT "journal_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "journal_rels" ADD CONSTRAINT "journal_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "journal_rels" ADD CONSTRAINT "journal_rels_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "carts" ADD CONSTRAINT "carts_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "promotions_rels" ADD CONSTRAINT "promotions_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "promotions_rels" ADD CONSTRAINT "promotions_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "promotions_rels" ADD CONSTRAINT "promotions_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "customers_sessions" ADD CONSTRAINT "customers_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variant_preference_id_product_variants_id_fk" FOREIGN KEY ("variant_preference_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reviews_photos" ADD CONSTRAINT "reviews_photos_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reviews_photos" ADD CONSTRAINT "reviews_photos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_default_og_image_id_media_id_fk" FOREIGN KEY ("default_og_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "navigation_primary_columns_links" ADD CONSTRAINT "navigation_primary_columns_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."navigation_primary_columns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_primary_columns" ADD CONSTRAINT "navigation_primary_columns_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."navigation_primary"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_primary" ADD CONSTRAINT "navigation_primary_feature_image_id_media_id_fk" FOREIGN KEY ("feature_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "navigation_primary" ADD CONSTRAINT "navigation_primary_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."navigation"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_footer_links" ADD CONSTRAINT "navigation_footer_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."navigation_footer"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_footer" ADD CONSTRAINT "navigation_footer_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."navigation"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_social" ADD CONSTRAINT "navigation_social_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."navigation"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."navigation"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_edits_fk" FOREIGN KEY ("edits_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_lookbooks_fk" FOREIGN KEY ("lookbooks_id") REFERENCES "public"."lookbooks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "navigation_rels" ADD CONSTRAINT "navigation_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "products_gallery_order_idx" ON "products_gallery" USING btree ("_order");
  CREATE INDEX "products_gallery_parent_id_idx" ON "products_gallery" USING btree ("_parent_id");
  CREATE INDEX "products_gallery_image_idx" ON "products_gallery" USING btree ("image_id");
  CREATE INDEX "products_name_idx" ON "products" USING btree ("name");
  CREATE INDEX "products_video_idx" ON "products" USING btree ("video_id");
  CREATE INDEX "products_fit_idx" ON "products" USING btree ("fit");
  CREATE INDEX "products_size_guide_idx" ON "products" USING btree ("size_guide_id");
  CREATE INDEX "products_gender_idx" ON "products" USING btree ("gender");
  CREATE INDEX "products_seo_seo_image_idx" ON "products" USING btree ("seo_image_id");
  CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");
  CREATE INDEX "products_status_idx" ON "products" USING btree ("status");
  CREATE INDEX "products_published_at_idx" ON "products" USING btree ("published_at");
  CREATE INDEX "products_featured_idx" ON "products" USING btree ("featured");
  CREATE INDEX "products_is_new_idx" ON "products" USING btree ("is_new");
  CREATE INDEX "products_is_best_seller_idx" ON "products" USING btree ("is_best_seller");
  CREATE INDEX "products_is_limited_edition_idx" ON "products" USING btree ("is_limited_edition");
  CREATE INDEX "products_sort_order_idx" ON "products" USING btree ("sort_order");
  CREATE INDEX "products_derived_derived_price_from_minor_idx" ON "products" USING btree ("derived_price_from_minor");
  CREATE INDEX "products_derived_derived_price_to_minor_idx" ON "products" USING btree ("derived_price_to_minor");
  CREATE INDEX "products_derived_derived_inventory_total_idx" ON "products" USING btree ("derived_inventory_total");
  CREATE INDEX "products_updated_at_idx" ON "products" USING btree ("updated_at");
  CREATE INDEX "products_created_at_idx" ON "products" USING btree ("created_at");
  CREATE INDEX "products_deleted_at_idx" ON "products" USING btree ("deleted_at");
  CREATE INDEX "products_texts_order_parent" ON "products_texts" USING btree ("order","parent_id");
  CREATE INDEX "products_texts_text_idx" ON "products_texts" USING btree ("text");
  CREATE INDEX "products_rels_order_idx" ON "products_rels" USING btree ("order");
  CREATE INDEX "products_rels_parent_idx" ON "products_rels" USING btree ("parent_id");
  CREATE INDEX "products_rels_path_idx" ON "products_rels" USING btree ("path");
  CREATE INDEX "products_rels_categories_id_idx" ON "products_rels" USING btree ("categories_id");
  CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");
  CREATE UNIQUE INDEX "product_variants_sku_idx" ON "product_variants" USING btree ("sku");
  CREATE INDEX "product_variants_color_idx" ON "product_variants" USING btree ("color");
  CREATE INDEX "product_variants_color_family_idx" ON "product_variants" USING btree ("color_family");
  CREATE INDEX "product_variants_size_idx" ON "product_variants" USING btree ("size");
  CREATE INDEX "product_variants_price_minor_idx" ON "product_variants" USING btree ("price_minor");
  CREATE INDEX "product_variants_inventory_quantity_idx" ON "product_variants" USING btree ("inventory_quantity");
  CREATE INDEX "product_variants_active_idx" ON "product_variants" USING btree ("active");
  CREATE INDEX "product_variants_image_idx" ON "product_variants" USING btree ("image_id");
  CREATE INDEX "product_variants_updated_at_idx" ON "product_variants" USING btree ("updated_at");
  CREATE INDEX "product_variants_created_at_idx" ON "product_variants" USING btree ("created_at");
  CREATE INDEX "product_variants_deleted_at_idx" ON "product_variants" USING btree ("deleted_at");
  CREATE UNIQUE INDEX "product_color_size_idx" ON "product_variants" USING btree ("product_id","color","size");
  CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");
  CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");
  CREATE INDEX "categories_image_idx" ON "categories" USING btree ("image_id");
  CREATE INDEX "categories_sort_order_idx" ON "categories" USING btree ("sort_order");
  CREATE INDEX "categories_status_idx" ON "categories" USING btree ("status");
  CREATE INDEX "categories_seo_seo_image_idx" ON "categories" USING btree ("seo_image_id");
  CREATE INDEX "categories_updated_at_idx" ON "categories" USING btree ("updated_at");
  CREATE INDEX "categories_created_at_idx" ON "categories" USING btree ("created_at");
  CREATE INDEX "size_guides_rows_measurements_order_idx" ON "size_guides_rows_measurements" USING btree ("_order");
  CREATE INDEX "size_guides_rows_measurements_parent_id_idx" ON "size_guides_rows_measurements" USING btree ("_parent_id");
  CREATE INDEX "size_guides_rows_order_idx" ON "size_guides_rows" USING btree ("_order");
  CREATE INDEX "size_guides_rows_parent_id_idx" ON "size_guides_rows" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "size_guides_slug_idx" ON "size_guides" USING btree ("slug");
  CREATE INDEX "size_guides_updated_at_idx" ON "size_guides" USING btree ("updated_at");
  CREATE INDEX "size_guides_created_at_idx" ON "size_guides" USING btree ("created_at");
  CREATE INDEX "size_guides_rels_order_idx" ON "size_guides_rels" USING btree ("order");
  CREATE INDEX "size_guides_rels_parent_idx" ON "size_guides_rels" USING btree ("parent_id");
  CREATE INDEX "size_guides_rels_path_idx" ON "size_guides_rels" USING btree ("path");
  CREATE INDEX "size_guides_rels_categories_id_idx" ON "size_guides_rels" USING btree ("categories_id");
  CREATE INDEX "collections_blocks_figure_order_idx" ON "collections_blocks_figure" USING btree ("_order");
  CREATE INDEX "collections_blocks_figure_parent_id_idx" ON "collections_blocks_figure" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_figure_path_idx" ON "collections_blocks_figure" USING btree ("_path");
  CREATE INDEX "collections_blocks_figure_image_idx" ON "collections_blocks_figure" USING btree ("image_id");
  CREATE INDEX "collections_blocks_figure_mobile_image_idx" ON "collections_blocks_figure" USING btree ("mobile_image_id");
  CREATE INDEX "collections_blocks_split_feature_order_idx" ON "collections_blocks_split_feature" USING btree ("_order");
  CREATE INDEX "collections_blocks_split_feature_parent_id_idx" ON "collections_blocks_split_feature" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_split_feature_path_idx" ON "collections_blocks_split_feature" USING btree ("_path");
  CREATE INDEX "collections_blocks_split_feature_image_idx" ON "collections_blocks_split_feature" USING btree ("image_id");
  CREATE INDEX "collections_blocks_editorial_order_idx" ON "collections_blocks_editorial" USING btree ("_order");
  CREATE INDEX "collections_blocks_editorial_parent_id_idx" ON "collections_blocks_editorial" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_editorial_path_idx" ON "collections_blocks_editorial" USING btree ("_path");
  CREATE INDEX "collections_blocks_gallery_images_order_idx" ON "collections_blocks_gallery_images" USING btree ("_order");
  CREATE INDEX "collections_blocks_gallery_images_parent_id_idx" ON "collections_blocks_gallery_images" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_gallery_images_image_idx" ON "collections_blocks_gallery_images" USING btree ("image_id");
  CREATE INDEX "collections_blocks_gallery_order_idx" ON "collections_blocks_gallery" USING btree ("_order");
  CREATE INDEX "collections_blocks_gallery_parent_id_idx" ON "collections_blocks_gallery" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_gallery_path_idx" ON "collections_blocks_gallery" USING btree ("_path");
  CREATE INDEX "collections_blocks_pull_quote_order_idx" ON "collections_blocks_pull_quote" USING btree ("_order");
  CREATE INDEX "collections_blocks_pull_quote_parent_id_idx" ON "collections_blocks_pull_quote" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_pull_quote_path_idx" ON "collections_blocks_pull_quote" USING btree ("_path");
  CREATE INDEX "collections_blocks_product_group_order_idx" ON "collections_blocks_product_group" USING btree ("_order");
  CREATE INDEX "collections_blocks_product_group_parent_id_idx" ON "collections_blocks_product_group" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_product_group_path_idx" ON "collections_blocks_product_group" USING btree ("_path");
  CREATE INDEX "collections_blocks_look_hotspots_order_idx" ON "collections_blocks_look_hotspots" USING btree ("_order");
  CREATE INDEX "collections_blocks_look_hotspots_parent_id_idx" ON "collections_blocks_look_hotspots" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_look_hotspots_product_idx" ON "collections_blocks_look_hotspots" USING btree ("product_id");
  CREATE INDEX "collections_blocks_look_order_idx" ON "collections_blocks_look" USING btree ("_order");
  CREATE INDEX "collections_blocks_look_parent_id_idx" ON "collections_blocks_look" USING btree ("_parent_id");
  CREATE INDEX "collections_blocks_look_path_idx" ON "collections_blocks_look" USING btree ("_path");
  CREATE INDEX "collections_blocks_look_image_idx" ON "collections_blocks_look" USING btree ("image_id");
  CREATE INDEX "collections_hero_media_idx" ON "collections" USING btree ("hero_media_id");
  CREATE INDEX "collections_intro_media_idx" ON "collections" USING btree ("intro_media_id");
  CREATE INDEX "collections_seo_seo_image_idx" ON "collections" USING btree ("seo_image_id");
  CREATE UNIQUE INDEX "collections_slug_idx" ON "collections" USING btree ("slug");
  CREATE INDEX "collections_status_idx" ON "collections" USING btree ("status");
  CREATE INDEX "collections_published_at_idx" ON "collections" USING btree ("published_at");
  CREATE INDEX "collections_updated_at_idx" ON "collections" USING btree ("updated_at");
  CREATE INDEX "collections_created_at_idx" ON "collections" USING btree ("created_at");
  CREATE INDEX "collections_rels_order_idx" ON "collections_rels" USING btree ("order");
  CREATE INDEX "collections_rels_parent_idx" ON "collections_rels" USING btree ("parent_id");
  CREATE INDEX "collections_rels_path_idx" ON "collections_rels" USING btree ("path");
  CREATE INDEX "collections_rels_products_id_idx" ON "collections_rels" USING btree ("products_id");
  CREATE INDEX "collections_rels_collections_id_idx" ON "collections_rels" USING btree ("collections_id");
  CREATE INDEX "collections_rels_categories_id_idx" ON "collections_rels" USING btree ("categories_id");
  CREATE INDEX "collections_rels_edits_id_idx" ON "collections_rels" USING btree ("edits_id");
  CREATE INDEX "collections_rels_lookbooks_id_idx" ON "collections_rels" USING btree ("lookbooks_id");
  CREATE INDEX "collections_rels_journal_id_idx" ON "collections_rels" USING btree ("journal_id");
  CREATE INDEX "collections_rels_campaigns_id_idx" ON "collections_rels" USING btree ("campaigns_id");
  CREATE INDEX "edits_product_groups_order_idx" ON "edits_product_groups" USING btree ("_order");
  CREATE INDEX "edits_product_groups_parent_id_idx" ON "edits_product_groups" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_figure_order_idx" ON "edits_blocks_figure" USING btree ("_order");
  CREATE INDEX "edits_blocks_figure_parent_id_idx" ON "edits_blocks_figure" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_figure_path_idx" ON "edits_blocks_figure" USING btree ("_path");
  CREATE INDEX "edits_blocks_figure_image_idx" ON "edits_blocks_figure" USING btree ("image_id");
  CREATE INDEX "edits_blocks_figure_mobile_image_idx" ON "edits_blocks_figure" USING btree ("mobile_image_id");
  CREATE INDEX "edits_blocks_split_feature_order_idx" ON "edits_blocks_split_feature" USING btree ("_order");
  CREATE INDEX "edits_blocks_split_feature_parent_id_idx" ON "edits_blocks_split_feature" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_split_feature_path_idx" ON "edits_blocks_split_feature" USING btree ("_path");
  CREATE INDEX "edits_blocks_split_feature_image_idx" ON "edits_blocks_split_feature" USING btree ("image_id");
  CREATE INDEX "edits_blocks_editorial_order_idx" ON "edits_blocks_editorial" USING btree ("_order");
  CREATE INDEX "edits_blocks_editorial_parent_id_idx" ON "edits_blocks_editorial" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_editorial_path_idx" ON "edits_blocks_editorial" USING btree ("_path");
  CREATE INDEX "edits_blocks_gallery_images_order_idx" ON "edits_blocks_gallery_images" USING btree ("_order");
  CREATE INDEX "edits_blocks_gallery_images_parent_id_idx" ON "edits_blocks_gallery_images" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_gallery_images_image_idx" ON "edits_blocks_gallery_images" USING btree ("image_id");
  CREATE INDEX "edits_blocks_gallery_order_idx" ON "edits_blocks_gallery" USING btree ("_order");
  CREATE INDEX "edits_blocks_gallery_parent_id_idx" ON "edits_blocks_gallery" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_gallery_path_idx" ON "edits_blocks_gallery" USING btree ("_path");
  CREATE INDEX "edits_blocks_pull_quote_order_idx" ON "edits_blocks_pull_quote" USING btree ("_order");
  CREATE INDEX "edits_blocks_pull_quote_parent_id_idx" ON "edits_blocks_pull_quote" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_pull_quote_path_idx" ON "edits_blocks_pull_quote" USING btree ("_path");
  CREATE INDEX "edits_blocks_product_group_order_idx" ON "edits_blocks_product_group" USING btree ("_order");
  CREATE INDEX "edits_blocks_product_group_parent_id_idx" ON "edits_blocks_product_group" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_product_group_path_idx" ON "edits_blocks_product_group" USING btree ("_path");
  CREATE INDEX "edits_blocks_look_hotspots_order_idx" ON "edits_blocks_look_hotspots" USING btree ("_order");
  CREATE INDEX "edits_blocks_look_hotspots_parent_id_idx" ON "edits_blocks_look_hotspots" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_look_hotspots_product_idx" ON "edits_blocks_look_hotspots" USING btree ("product_id");
  CREATE INDEX "edits_blocks_look_order_idx" ON "edits_blocks_look" USING btree ("_order");
  CREATE INDEX "edits_blocks_look_parent_id_idx" ON "edits_blocks_look" USING btree ("_parent_id");
  CREATE INDEX "edits_blocks_look_path_idx" ON "edits_blocks_look" USING btree ("_path");
  CREATE INDEX "edits_blocks_look_image_idx" ON "edits_blocks_look" USING btree ("image_id");
  CREATE INDEX "edits_hero_idx" ON "edits" USING btree ("hero_id");
  CREATE INDEX "edits_seo_seo_image_idx" ON "edits" USING btree ("seo_image_id");
  CREATE UNIQUE INDEX "edits_slug_idx" ON "edits" USING btree ("slug");
  CREATE INDEX "edits_status_idx" ON "edits" USING btree ("status");
  CREATE INDEX "edits_published_at_idx" ON "edits" USING btree ("published_at");
  CREATE INDEX "edits_updated_at_idx" ON "edits" USING btree ("updated_at");
  CREATE INDEX "edits_created_at_idx" ON "edits" USING btree ("created_at");
  CREATE INDEX "edits_rels_order_idx" ON "edits_rels" USING btree ("order");
  CREATE INDEX "edits_rels_parent_idx" ON "edits_rels" USING btree ("parent_id");
  CREATE INDEX "edits_rels_path_idx" ON "edits_rels" USING btree ("path");
  CREATE INDEX "edits_rels_products_id_idx" ON "edits_rels" USING btree ("products_id");
  CREATE INDEX "edits_rels_lookbooks_id_idx" ON "edits_rels" USING btree ("lookbooks_id");
  CREATE INDEX "edits_rels_categories_id_idx" ON "edits_rels" USING btree ("categories_id");
  CREATE INDEX "edits_rels_collections_id_idx" ON "edits_rels" USING btree ("collections_id");
  CREATE INDEX "edits_rels_edits_id_idx" ON "edits_rels" USING btree ("edits_id");
  CREATE INDEX "edits_rels_journal_id_idx" ON "edits_rels" USING btree ("journal_id");
  CREATE INDEX "edits_rels_campaigns_id_idx" ON "edits_rels" USING btree ("campaigns_id");
  CREATE INDEX "campaigns_season_idx" ON "campaigns" USING btree ("season");
  CREATE INDEX "campaigns_hero_idx" ON "campaigns" USING btree ("hero_id");
  CREATE INDEX "campaigns_mobile_hero_idx" ON "campaigns" USING btree ("mobile_hero_id");
  CREATE INDEX "campaigns_collection_idx" ON "campaigns" USING btree ("collection_id");
  CREATE INDEX "campaigns_seo_seo_image_idx" ON "campaigns" USING btree ("seo_image_id");
  CREATE UNIQUE INDEX "campaigns_slug_idx" ON "campaigns" USING btree ("slug");
  CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");
  CREATE INDEX "campaigns_published_at_idx" ON "campaigns" USING btree ("published_at");
  CREATE INDEX "campaigns_updated_at_idx" ON "campaigns" USING btree ("updated_at");
  CREATE INDEX "campaigns_created_at_idx" ON "campaigns" USING btree ("created_at");
  CREATE INDEX "campaigns_rels_order_idx" ON "campaigns_rels" USING btree ("order");
  CREATE INDEX "campaigns_rels_parent_idx" ON "campaigns_rels" USING btree ("parent_id");
  CREATE INDEX "campaigns_rels_path_idx" ON "campaigns_rels" USING btree ("path");
  CREATE INDEX "campaigns_rels_products_id_idx" ON "campaigns_rels" USING btree ("products_id");
  CREATE INDEX "campaigns_rels_categories_id_idx" ON "campaigns_rels" USING btree ("categories_id");
  CREATE INDEX "campaigns_rels_collections_id_idx" ON "campaigns_rels" USING btree ("collections_id");
  CREATE INDEX "campaigns_rels_edits_id_idx" ON "campaigns_rels" USING btree ("edits_id");
  CREATE INDEX "campaigns_rels_lookbooks_id_idx" ON "campaigns_rels" USING btree ("lookbooks_id");
  CREATE INDEX "campaigns_rels_journal_id_idx" ON "campaigns_rels" USING btree ("journal_id");
  CREATE INDEX "campaigns_rels_campaigns_id_idx" ON "campaigns_rels" USING btree ("campaigns_id");
  CREATE INDEX "lookbooks_chapters_gallery_order_idx" ON "lookbooks_chapters_gallery" USING btree ("_order");
  CREATE INDEX "lookbooks_chapters_gallery_parent_id_idx" ON "lookbooks_chapters_gallery" USING btree ("_parent_id");
  CREATE INDEX "lookbooks_chapters_gallery_image_idx" ON "lookbooks_chapters_gallery" USING btree ("image_id");
  CREATE INDEX "lookbooks_chapters_hotspots_order_idx" ON "lookbooks_chapters_hotspots" USING btree ("_order");
  CREATE INDEX "lookbooks_chapters_hotspots_parent_id_idx" ON "lookbooks_chapters_hotspots" USING btree ("_parent_id");
  CREATE INDEX "lookbooks_chapters_hotspots_product_idx" ON "lookbooks_chapters_hotspots" USING btree ("product_id");
  CREATE INDEX "lookbooks_chapters_order_idx" ON "lookbooks_chapters" USING btree ("_order");
  CREATE INDEX "lookbooks_chapters_parent_id_idx" ON "lookbooks_chapters" USING btree ("_parent_id");
  CREATE INDEX "lookbooks_chapters_hero_image_idx" ON "lookbooks_chapters" USING btree ("hero_image_id");
  CREATE INDEX "lookbooks_season_idx" ON "lookbooks" USING btree ("season");
  CREATE INDEX "lookbooks_cover_image_idx" ON "lookbooks" USING btree ("cover_image_id");
  CREATE INDEX "lookbooks_seo_seo_image_idx" ON "lookbooks" USING btree ("seo_image_id");
  CREATE UNIQUE INDEX "lookbooks_slug_idx" ON "lookbooks" USING btree ("slug");
  CREATE INDEX "lookbooks_status_idx" ON "lookbooks" USING btree ("status");
  CREATE INDEX "lookbooks_published_at_idx" ON "lookbooks" USING btree ("published_at");
  CREATE INDEX "lookbooks_updated_at_idx" ON "lookbooks" USING btree ("updated_at");
  CREATE INDEX "lookbooks_created_at_idx" ON "lookbooks" USING btree ("created_at");
  CREATE INDEX "journal_hero_image_idx" ON "journal" USING btree ("hero_image_id");
  CREATE INDEX "journal_seo_seo_image_idx" ON "journal" USING btree ("seo_image_id");
  CREATE UNIQUE INDEX "journal_slug_idx" ON "journal" USING btree ("slug");
  CREATE INDEX "journal_category_idx" ON "journal" USING btree ("category");
  CREATE INDEX "journal_status_idx" ON "journal" USING btree ("status");
  CREATE INDEX "journal_published_at_idx" ON "journal" USING btree ("published_at");
  CREATE INDEX "journal_updated_at_idx" ON "journal" USING btree ("updated_at");
  CREATE INDEX "journal_created_at_idx" ON "journal" USING btree ("created_at");
  CREATE INDEX "journal_rels_order_idx" ON "journal_rels" USING btree ("order");
  CREATE INDEX "journal_rels_parent_idx" ON "journal_rels" USING btree ("parent_id");
  CREATE INDEX "journal_rels_path_idx" ON "journal_rels" USING btree ("path");
  CREATE INDEX "journal_rels_products_id_idx" ON "journal_rels" USING btree ("products_id");
  CREATE INDEX "journal_rels_collections_id_idx" ON "journal_rels" USING btree ("collections_id");
  CREATE INDEX "journal_rels_journal_id_idx" ON "journal_rels" USING btree ("journal_id");
  CREATE UNIQUE INDEX "carts_token_idx" ON "carts" USING btree ("token");
  CREATE INDEX "carts_customer_idx" ON "carts" USING btree ("customer_id");
  CREATE INDEX "carts_status_idx" ON "carts" USING btree ("status");
  CREATE INDEX "carts_promotion_idx" ON "carts" USING btree ("promotion_id");
  CREATE INDEX "carts_expires_at_idx" ON "carts" USING btree ("expires_at");
  CREATE INDEX "carts_updated_at_idx" ON "carts" USING btree ("updated_at");
  CREATE INDEX "carts_created_at_idx" ON "carts" USING btree ("created_at");
  CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");
  CREATE INDEX "cart_items_product_idx" ON "cart_items" USING btree ("product_id");
  CREATE INDEX "cart_items_variant_idx" ON "cart_items" USING btree ("variant_id");
  CREATE INDEX "cart_items_updated_at_idx" ON "cart_items" USING btree ("updated_at");
  CREATE INDEX "cart_items_created_at_idx" ON "cart_items" USING btree ("created_at");
  CREATE UNIQUE INDEX "cart_variant_idx" ON "cart_items" USING btree ("cart_id","variant_id");
  CREATE INDEX "orders_payment_status_idx" ON "orders" USING btree ("payment_status");
  CREATE INDEX "orders_fulfillment_status_idx" ON "orders" USING btree ("fulfillment_status");
  CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");
  CREATE INDEX "orders_email_idx" ON "orders" USING btree ("email");
  CREATE INDEX "orders_total_minor_idx" ON "orders" USING btree ("total_minor");
  CREATE INDEX "orders_promotion_idx" ON "orders" USING btree ("promotion_id");
  CREATE INDEX "orders_shipping_method_code_idx" ON "orders" USING btree ("shipping_method_code");
  CREATE INDEX "orders_tracking_number_idx" ON "orders" USING btree ("tracking_number");
  CREATE UNIQUE INDEX "orders_stripe_checkout_session_id_idx" ON "orders" USING btree ("stripe_checkout_session_id");
  CREATE UNIQUE INDEX "orders_stripe_payment_intent_id_idx" ON "orders" USING btree ("stripe_payment_intent_id");
  CREATE UNIQUE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");
  CREATE INDEX "orders_updated_at_idx" ON "orders" USING btree ("updated_at");
  CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");
  CREATE INDEX "orders_deleted_at_idx" ON "orders" USING btree ("deleted_at");
  CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");
  CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");
  CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");
  CREATE INDEX "order_items_sku_idx" ON "order_items" USING btree ("sku");
  CREATE INDEX "order_items_updated_at_idx" ON "order_items" USING btree ("updated_at");
  CREATE INDEX "order_items_created_at_idx" ON "order_items" USING btree ("created_at");
  CREATE INDEX "order_items_deleted_at_idx" ON "order_items" USING btree ("deleted_at");
  CREATE UNIQUE INDEX "promotions_code_idx" ON "promotions" USING btree ("code");
  CREATE INDEX "promotions_type_idx" ON "promotions" USING btree ("type");
  CREATE INDEX "promotions_starts_at_idx" ON "promotions" USING btree ("starts_at");
  CREATE INDEX "promotions_ends_at_idx" ON "promotions" USING btree ("ends_at");
  CREATE INDEX "promotions_active_idx" ON "promotions" USING btree ("active");
  CREATE INDEX "promotions_updated_at_idx" ON "promotions" USING btree ("updated_at");
  CREATE INDEX "promotions_created_at_idx" ON "promotions" USING btree ("created_at");
  CREATE INDEX "promotions_rels_order_idx" ON "promotions_rels" USING btree ("order");
  CREATE INDEX "promotions_rels_parent_idx" ON "promotions_rels" USING btree ("parent_id");
  CREATE INDEX "promotions_rels_path_idx" ON "promotions_rels" USING btree ("path");
  CREATE INDEX "promotions_rels_products_id_idx" ON "promotions_rels" USING btree ("products_id");
  CREATE INDEX "promotions_rels_collections_id_idx" ON "promotions_rels" USING btree ("collections_id");
  CREATE INDEX "customers_sessions_order_idx" ON "customers_sessions" USING btree ("_order");
  CREATE INDEX "customers_sessions_parent_id_idx" ON "customers_sessions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "customers_stripe_customer_id_idx" ON "customers" USING btree ("stripe_customer_id");
  CREATE INDEX "customers_updated_at_idx" ON "customers" USING btree ("updated_at");
  CREATE INDEX "customers_created_at_idx" ON "customers" USING btree ("created_at");
  CREATE INDEX "customers_deleted_at_idx" ON "customers" USING btree ("deleted_at");
  CREATE UNIQUE INDEX "customers_email_idx" ON "customers" USING btree ("email");
  CREATE INDEX "addresses_customer_idx" ON "addresses" USING btree ("customer_id");
  CREATE INDEX "addresses_updated_at_idx" ON "addresses" USING btree ("updated_at");
  CREATE INDEX "addresses_created_at_idx" ON "addresses" USING btree ("created_at");
  CREATE INDEX "wishlist_items_customer_idx" ON "wishlist_items" USING btree ("customer_id");
  CREATE INDEX "wishlist_items_product_idx" ON "wishlist_items" USING btree ("product_id");
  CREATE INDEX "wishlist_items_variant_preference_idx" ON "wishlist_items" USING btree ("variant_preference_id");
  CREATE INDEX "wishlist_items_updated_at_idx" ON "wishlist_items" USING btree ("updated_at");
  CREATE INDEX "wishlist_items_created_at_idx" ON "wishlist_items" USING btree ("created_at");
  CREATE UNIQUE INDEX "customer_product_idx" ON "wishlist_items" USING btree ("customer_id","product_id");
  CREATE INDEX "reviews_photos_order_idx" ON "reviews_photos" USING btree ("_order");
  CREATE INDEX "reviews_photos_parent_id_idx" ON "reviews_photos" USING btree ("_parent_id");
  CREATE INDEX "reviews_photos_image_idx" ON "reviews_photos" USING btree ("image_id");
  CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_id");
  CREATE INDEX "reviews_customer_idx" ON "reviews" USING btree ("customer_id");
  CREATE INDEX "reviews_rating_idx" ON "reviews" USING btree ("rating");
  CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status");
  CREATE INDEX "reviews_verified_purchase_idx" ON "reviews" USING btree ("verified_purchase");
  CREATE INDEX "reviews_updated_at_idx" ON "reviews" USING btree ("updated_at");
  CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");
  CREATE UNIQUE INDEX "product_customer_idx" ON "reviews" USING btree ("product_id","customer_id");
  CREATE UNIQUE INDEX "newsletter_subscribers_email_idx" ON "newsletter_subscribers" USING btree ("email");
  CREATE INDEX "newsletter_subscribers_consented_at_idx" ON "newsletter_subscribers" USING btree ("consented_at");
  CREATE INDEX "newsletter_subscribers_source_idx" ON "newsletter_subscribers" USING btree ("source");
  CREATE INDEX "newsletter_subscribers_status_idx" ON "newsletter_subscribers" USING btree ("status");
  CREATE INDEX "newsletter_subscribers_updated_at_idx" ON "newsletter_subscribers" USING btree ("updated_at");
  CREATE INDEX "newsletter_subscribers_created_at_idx" ON "newsletter_subscribers" USING btree ("created_at");
  CREATE INDEX "faqs_topic_idx" ON "faqs" USING btree ("topic");
  CREATE INDEX "faqs_sort_order_idx" ON "faqs" USING btree ("sort_order");
  CREATE INDEX "faqs_status_idx" ON "faqs" USING btree ("status");
  CREATE INDEX "faqs_updated_at_idx" ON "faqs" USING btree ("updated_at");
  CREATE INDEX "faqs_created_at_idx" ON "faqs" USING btree ("created_at");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "site_settings_logo_idx" ON "site_settings" USING btree ("logo_id");
  CREATE INDEX "site_settings_default_og_image_idx" ON "site_settings" USING btree ("default_og_image_id");
  CREATE INDEX "navigation_primary_columns_links_order_idx" ON "navigation_primary_columns_links" USING btree ("_order");
  CREATE INDEX "navigation_primary_columns_links_parent_id_idx" ON "navigation_primary_columns_links" USING btree ("_parent_id");
  CREATE INDEX "navigation_primary_columns_order_idx" ON "navigation_primary_columns" USING btree ("_order");
  CREATE INDEX "navigation_primary_columns_parent_id_idx" ON "navigation_primary_columns" USING btree ("_parent_id");
  CREATE INDEX "navigation_primary_order_idx" ON "navigation_primary" USING btree ("_order");
  CREATE INDEX "navigation_primary_parent_id_idx" ON "navigation_primary" USING btree ("_parent_id");
  CREATE INDEX "navigation_primary_feature_feature_image_idx" ON "navigation_primary" USING btree ("feature_image_id");
  CREATE INDEX "navigation_footer_links_order_idx" ON "navigation_footer_links" USING btree ("_order");
  CREATE INDEX "navigation_footer_links_parent_id_idx" ON "navigation_footer_links" USING btree ("_parent_id");
  CREATE INDEX "navigation_footer_order_idx" ON "navigation_footer" USING btree ("_order");
  CREATE INDEX "navigation_footer_parent_id_idx" ON "navigation_footer" USING btree ("_parent_id");
  CREATE INDEX "navigation_social_order_idx" ON "navigation_social" USING btree ("_order");
  CREATE INDEX "navigation_social_parent_id_idx" ON "navigation_social" USING btree ("_parent_id");
  CREATE INDEX "navigation_rels_order_idx" ON "navigation_rels" USING btree ("order");
  CREATE INDEX "navigation_rels_parent_idx" ON "navigation_rels" USING btree ("parent_id");
  CREATE INDEX "navigation_rels_path_idx" ON "navigation_rels" USING btree ("path");
  CREATE INDEX "navigation_rels_products_id_idx" ON "navigation_rels" USING btree ("products_id");
  CREATE INDEX "navigation_rels_categories_id_idx" ON "navigation_rels" USING btree ("categories_id");
  CREATE INDEX "navigation_rels_collections_id_idx" ON "navigation_rels" USING btree ("collections_id");
  CREATE INDEX "navigation_rels_edits_id_idx" ON "navigation_rels" USING btree ("edits_id");
  CREATE INDEX "navigation_rels_lookbooks_id_idx" ON "navigation_rels" USING btree ("lookbooks_id");
  CREATE INDEX "navigation_rels_journal_id_idx" ON "navigation_rels" USING btree ("journal_id");
  CREATE INDEX "navigation_rels_campaigns_id_idx" ON "navigation_rels" USING btree ("campaigns_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_variants_fk" FOREIGN KEY ("product_variants_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_size_guides_fk" FOREIGN KEY ("size_guides_id") REFERENCES "public"."size_guides"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_collections_fk" FOREIGN KEY ("collections_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_edits_fk" FOREIGN KEY ("edits_id") REFERENCES "public"."edits"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_campaigns_fk" FOREIGN KEY ("campaigns_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_lookbooks_fk" FOREIGN KEY ("lookbooks_id") REFERENCES "public"."lookbooks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_journal_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journal"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_carts_fk" FOREIGN KEY ("carts_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_cart_items_fk" FOREIGN KEY ("cart_items_id") REFERENCES "public"."cart_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_orders_fk" FOREIGN KEY ("orders_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_order_items_fk" FOREIGN KEY ("order_items_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_promotions_fk" FOREIGN KEY ("promotions_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_addresses_fk" FOREIGN KEY ("addresses_id") REFERENCES "public"."addresses"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_wishlist_items_fk" FOREIGN KEY ("wishlist_items_id") REFERENCES "public"."wishlist_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_reviews_fk" FOREIGN KEY ("reviews_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_newsletter_subscribers_fk" FOREIGN KEY ("newsletter_subscribers_id") REFERENCES "public"."newsletter_subscribers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_faqs_fk" FOREIGN KEY ("faqs_id") REFERENCES "public"."faqs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_products_id_idx" ON "payload_locked_documents_rels" USING btree ("products_id");
  CREATE INDEX "payload_locked_documents_rels_product_variants_id_idx" ON "payload_locked_documents_rels" USING btree ("product_variants_id");
  CREATE INDEX "payload_locked_documents_rels_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("categories_id");
  CREATE INDEX "payload_locked_documents_rels_size_guides_id_idx" ON "payload_locked_documents_rels" USING btree ("size_guides_id");
  CREATE INDEX "payload_locked_documents_rels_collections_id_idx" ON "payload_locked_documents_rels" USING btree ("collections_id");
  CREATE INDEX "payload_locked_documents_rels_edits_id_idx" ON "payload_locked_documents_rels" USING btree ("edits_id");
  CREATE INDEX "payload_locked_documents_rels_campaigns_id_idx" ON "payload_locked_documents_rels" USING btree ("campaigns_id");
  CREATE INDEX "payload_locked_documents_rels_lookbooks_id_idx" ON "payload_locked_documents_rels" USING btree ("lookbooks_id");
  CREATE INDEX "payload_locked_documents_rels_journal_id_idx" ON "payload_locked_documents_rels" USING btree ("journal_id");
  CREATE INDEX "payload_locked_documents_rels_carts_id_idx" ON "payload_locked_documents_rels" USING btree ("carts_id");
  CREATE INDEX "payload_locked_documents_rels_cart_items_id_idx" ON "payload_locked_documents_rels" USING btree ("cart_items_id");
  CREATE INDEX "payload_locked_documents_rels_orders_id_idx" ON "payload_locked_documents_rels" USING btree ("orders_id");
  CREATE INDEX "payload_locked_documents_rels_order_items_id_idx" ON "payload_locked_documents_rels" USING btree ("order_items_id");
  CREATE INDEX "payload_locked_documents_rels_promotions_id_idx" ON "payload_locked_documents_rels" USING btree ("promotions_id");
  CREATE INDEX "payload_locked_documents_rels_customers_id_idx" ON "payload_locked_documents_rels" USING btree ("customers_id");
  CREATE INDEX "payload_locked_documents_rels_addresses_id_idx" ON "payload_locked_documents_rels" USING btree ("addresses_id");
  CREATE INDEX "payload_locked_documents_rels_wishlist_items_id_idx" ON "payload_locked_documents_rels" USING btree ("wishlist_items_id");
  CREATE INDEX "payload_locked_documents_rels_reviews_id_idx" ON "payload_locked_documents_rels" USING btree ("reviews_id");
  CREATE INDEX "payload_locked_documents_rels_newsletter_subscribers_id_idx" ON "payload_locked_documents_rels" USING btree ("newsletter_subscribers_id");
  CREATE INDEX "payload_locked_documents_rels_faqs_id_idx" ON "payload_locked_documents_rels" USING btree ("faqs_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_preferences_rels_customers_id_idx" ON "payload_preferences_rels" USING btree ("customers_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products_gallery" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "product_variants" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "size_guides_rows_measurements" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "size_guides_rows" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "size_guides" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "size_guides_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_figure" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_split_feature" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_editorial" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_gallery_images" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_gallery" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_pull_quote" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_product_group" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_look_hotspots" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_blocks_look" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "collections_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_product_groups" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_figure" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_split_feature" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_editorial" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_gallery_images" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_gallery" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_pull_quote" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_product_group" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_look_hotspots" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_blocks_look" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "edits_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "campaigns" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "campaigns_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "lookbooks_chapters_gallery" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "lookbooks_chapters_hotspots" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "lookbooks_chapters" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "lookbooks" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "journal" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "journal_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "carts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cart_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "order_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "promotions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "promotions_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "customers_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "customers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "addresses" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "wishlist_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "reviews_photos" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "reviews" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "newsletter_subscribers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "faqs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "media" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "navigation_primary_columns_links" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "navigation_primary_columns" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "navigation_primary" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "navigation_footer_links" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "navigation_footer" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "navigation_social" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "navigation" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "navigation_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "products_gallery" CASCADE;
  DROP TABLE "products" CASCADE;
  DROP TABLE "products_texts" CASCADE;
  DROP TABLE "products_rels" CASCADE;
  DROP TABLE "product_variants" CASCADE;
  DROP TABLE "categories" CASCADE;
  DROP TABLE "size_guides_rows_measurements" CASCADE;
  DROP TABLE "size_guides_rows" CASCADE;
  DROP TABLE "size_guides" CASCADE;
  DROP TABLE "size_guides_rels" CASCADE;
  DROP TABLE "collections_blocks_figure" CASCADE;
  DROP TABLE "collections_blocks_split_feature" CASCADE;
  DROP TABLE "collections_blocks_editorial" CASCADE;
  DROP TABLE "collections_blocks_gallery_images" CASCADE;
  DROP TABLE "collections_blocks_gallery" CASCADE;
  DROP TABLE "collections_blocks_pull_quote" CASCADE;
  DROP TABLE "collections_blocks_product_group" CASCADE;
  DROP TABLE "collections_blocks_look_hotspots" CASCADE;
  DROP TABLE "collections_blocks_look" CASCADE;
  DROP TABLE "collections" CASCADE;
  DROP TABLE "collections_rels" CASCADE;
  DROP TABLE "edits_product_groups" CASCADE;
  DROP TABLE "edits_blocks_figure" CASCADE;
  DROP TABLE "edits_blocks_split_feature" CASCADE;
  DROP TABLE "edits_blocks_editorial" CASCADE;
  DROP TABLE "edits_blocks_gallery_images" CASCADE;
  DROP TABLE "edits_blocks_gallery" CASCADE;
  DROP TABLE "edits_blocks_pull_quote" CASCADE;
  DROP TABLE "edits_blocks_product_group" CASCADE;
  DROP TABLE "edits_blocks_look_hotspots" CASCADE;
  DROP TABLE "edits_blocks_look" CASCADE;
  DROP TABLE "edits" CASCADE;
  DROP TABLE "edits_rels" CASCADE;
  DROP TABLE "campaigns" CASCADE;
  DROP TABLE "campaigns_rels" CASCADE;
  DROP TABLE "lookbooks_chapters_gallery" CASCADE;
  DROP TABLE "lookbooks_chapters_hotspots" CASCADE;
  DROP TABLE "lookbooks_chapters" CASCADE;
  DROP TABLE "lookbooks" CASCADE;
  DROP TABLE "journal" CASCADE;
  DROP TABLE "journal_rels" CASCADE;
  DROP TABLE "carts" CASCADE;
  DROP TABLE "cart_items" CASCADE;
  DROP TABLE "orders" CASCADE;
  DROP TABLE "order_items" CASCADE;
  DROP TABLE "promotions" CASCADE;
  DROP TABLE "promotions_rels" CASCADE;
  DROP TABLE "customers_sessions" CASCADE;
  DROP TABLE "customers" CASCADE;
  DROP TABLE "addresses" CASCADE;
  DROP TABLE "wishlist_items" CASCADE;
  DROP TABLE "reviews_photos" CASCADE;
  DROP TABLE "reviews" CASCADE;
  DROP TABLE "newsletter_subscribers" CASCADE;
  DROP TABLE "faqs" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "site_settings" CASCADE;
  DROP TABLE "navigation_primary_columns_links" CASCADE;
  DROP TABLE "navigation_primary_columns" CASCADE;
  DROP TABLE "navigation_primary" CASCADE;
  DROP TABLE "navigation_footer_links" CASCADE;
  DROP TABLE "navigation_footer" CASCADE;
  DROP TABLE "navigation_social" CASCADE;
  DROP TABLE "navigation" CASCADE;
  DROP TABLE "navigation_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_products_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_product_variants_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_categories_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_size_guides_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_collections_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_edits_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_campaigns_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_lookbooks_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_journal_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_carts_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_cart_items_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_orders_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_order_items_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_promotions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_customers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_addresses_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_wishlist_items_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_reviews_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_newsletter_subscribers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_faqs_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_media_fk";
  
  ALTER TABLE "payload_preferences_rels" DROP CONSTRAINT IF EXISTS "payload_preferences_rels_customers_fk";
  
  DROP INDEX "payload_locked_documents_rels_products_id_idx";
  DROP INDEX "payload_locked_documents_rels_product_variants_id_idx";
  DROP INDEX "payload_locked_documents_rels_categories_id_idx";
  DROP INDEX "payload_locked_documents_rels_size_guides_id_idx";
  DROP INDEX "payload_locked_documents_rels_collections_id_idx";
  DROP INDEX "payload_locked_documents_rels_edits_id_idx";
  DROP INDEX "payload_locked_documents_rels_campaigns_id_idx";
  DROP INDEX "payload_locked_documents_rels_lookbooks_id_idx";
  DROP INDEX "payload_locked_documents_rels_journal_id_idx";
  DROP INDEX "payload_locked_documents_rels_carts_id_idx";
  DROP INDEX "payload_locked_documents_rels_cart_items_id_idx";
  DROP INDEX "payload_locked_documents_rels_orders_id_idx";
  DROP INDEX "payload_locked_documents_rels_order_items_id_idx";
  DROP INDEX "payload_locked_documents_rels_promotions_id_idx";
  DROP INDEX "payload_locked_documents_rels_customers_id_idx";
  DROP INDEX "payload_locked_documents_rels_addresses_id_idx";
  DROP INDEX "payload_locked_documents_rels_wishlist_items_id_idx";
  DROP INDEX "payload_locked_documents_rels_reviews_id_idx";
  DROP INDEX "payload_locked_documents_rels_newsletter_subscribers_id_idx";
  DROP INDEX "payload_locked_documents_rels_faqs_id_idx";
  DROP INDEX "payload_locked_documents_rels_media_id_idx";
  DROP INDEX "payload_preferences_rels_customers_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "products_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "product_variants_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "categories_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "size_guides_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "collections_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "edits_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "campaigns_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "lookbooks_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "journal_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "carts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "cart_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "orders_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "order_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "promotions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "customers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "addresses_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "wishlist_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "reviews_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "newsletter_subscribers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "faqs_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "media_id";
  ALTER TABLE "payload_preferences_rels" DROP COLUMN "customers_id";
  DROP TYPE "public"."enum_products_fit";
  DROP TYPE "public"."enum_products_gender";
  DROP TYPE "public"."enum_products_status";
  DROP TYPE "public"."enum_product_variants_color_family";
  DROP TYPE "public"."enum_categories_status";
  DROP TYPE "public"."enum_size_guides_unit";
  DROP TYPE "public"."enum_collections_blocks_figure_treatment";
  DROP TYPE "public"."enum_collections_blocks_figure_cta_kind";
  DROP TYPE "public"."enum_collections_blocks_split_feature_image_side";
  DROP TYPE "public"."enum_collections_blocks_split_feature_cta_kind";
  DROP TYPE "public"."enum_collections_blocks_editorial_width";
  DROP TYPE "public"."enum_collections_blocks_editorial_cta_kind";
  DROP TYPE "public"."enum_collections_blocks_gallery_layout";
  DROP TYPE "public"."enum_collections_blocks_product_group_layout";
  DROP TYPE "public"."enum_collections_blocks_look_hotspots_marker_tone";
  DROP TYPE "public"."enum_collections_status";
  DROP TYPE "public"."enum_edits_blocks_figure_treatment";
  DROP TYPE "public"."enum_edits_blocks_figure_cta_kind";
  DROP TYPE "public"."enum_edits_blocks_split_feature_image_side";
  DROP TYPE "public"."enum_edits_blocks_split_feature_cta_kind";
  DROP TYPE "public"."enum_edits_blocks_editorial_width";
  DROP TYPE "public"."enum_edits_blocks_editorial_cta_kind";
  DROP TYPE "public"."enum_edits_blocks_gallery_layout";
  DROP TYPE "public"."enum_edits_blocks_product_group_layout";
  DROP TYPE "public"."enum_edits_blocks_look_hotspots_marker_tone";
  DROP TYPE "public"."enum_edits_status";
  DROP TYPE "public"."enum_campaigns_cta_kind";
  DROP TYPE "public"."enum_campaigns_status";
  DROP TYPE "public"."enum_lookbooks_chapters_hotspots_marker_tone";
  DROP TYPE "public"."enum_lookbooks_status";
  DROP TYPE "public"."enum_journal_category";
  DROP TYPE "public"."enum_journal_status";
  DROP TYPE "public"."enum_carts_currency";
  DROP TYPE "public"."enum_carts_status";
  DROP TYPE "public"."enum_orders_payment_status";
  DROP TYPE "public"."enum_orders_fulfillment_status";
  DROP TYPE "public"."enum_orders_currency";
  DROP TYPE "public"."enum_promotions_type";
  DROP TYPE "public"."enum_promotions_currency";
  DROP TYPE "public"."enum_reviews_status";
  DROP TYPE "public"."enum_newsletter_subscribers_source";
  DROP TYPE "public"."enum_newsletter_subscribers_status";
  DROP TYPE "public"."enum_faqs_topic";
  DROP TYPE "public"."enum_faqs_status";
  DROP TYPE "public"."enum_site_settings_default_currency";
  DROP TYPE "public"."enum_navigation_primary_columns_links_kind";
  DROP TYPE "public"."enum_navigation_primary_kind";
  DROP TYPE "public"."enum_navigation_primary_feature_kind";
  DROP TYPE "public"."enum_navigation_footer_links_kind";
  DROP TYPE "public"."enum_navigation_social_platform";`)
}
