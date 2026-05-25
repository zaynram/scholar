CREATE TABLE `anchor_cache` (
	`paper_id` text PRIMARY KEY NOT NULL,
	`anchors_json` text NOT NULL,
	`pages` integer,
	`generated_at` text NOT NULL,
	`extractor` text,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`page` integer,
	`anchor` text,
	`rect` text,
	`body` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "annotations_source_ck" CHECK(source IN ('scholar','pdf-viewer'))
);
--> statement-breakpoint
CREATE INDEX `annotations_paper_idx` ON `annotations` (`paper_id`);--> statement-breakpoint
CREATE INDEX `annotations_paper_dirty_idx` ON `annotations` (`paper_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `citations` (
	`citing_id` text NOT NULL,
	`cited_id` text NOT NULL,
	PRIMARY KEY(`citing_id`, `cited_id`),
	FOREIGN KEY (`citing_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cited_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `corpora` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_opened_at` text,
	`archived_at` text
);
--> statement-breakpoint
CREATE TABLE `digests` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`scope_signature` text NOT NULL,
	`body_md` text NOT NULL,
	`generated_at` text NOT NULL,
	`model` text,
	`paper_count` integer
);
--> statement-breakpoint
CREATE INDEX `digests_scope_idx` ON `digests` (`scope_key`);--> statement-breakpoint
CREATE TABLE `paper_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`page` integer,
	`text` text NOT NULL,
	`embedded_at` text,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_chunks_paper_ord_idx` ON `paper_chunks` (`paper_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `paper_chunks_pending_idx` ON `paper_chunks` (`id`) WHERE embedded_at IS NULL;--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`authors` text,
	`year` integer,
	`venue` text,
	`doi` text,
	`arxiv_id` text,
	`pdf_path` text,
	`role` text,
	`section` text,
	`depth` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`abstract` text,
	`imported_via` text,
	`imported_at` text NOT NULL,
	`status_touched_at` text,
	CONSTRAINT "papers_status_ck" CHECK(status IN ('pending','reading','reviewed','skip')),
	CONSTRAINT "papers_depth_ck" CHECK(depth IS NULL OR depth IN ('cited','background','deep')),
	CONSTRAINT "papers_imported_via_ck" CHECK(imported_via IS NULL OR imported_via IN ('bibtex','ris','crossref','arxiv','manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `papers_key_unique` ON `papers` (`key`);--> statement-breakpoint
CREATE INDEX `papers_status_idx` ON `papers` (`status`);--> statement-breakpoint
CREATE INDEX `papers_section_idx` ON `papers` (`section`);--> statement-breakpoint
CREATE UNIQUE INDEX `papers_doi_idx` ON `papers` (`doi`) WHERE doi IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `papers_arxiv_idx` ON `papers` (`arxiv_id`) WHERE arxiv_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `pdf_roots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`corpus_id` text NOT NULL,
	`path` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`corpus_id`) REFERENCES `corpora`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pdf_roots_corpus_idx` ON `pdf_roots` (`corpus_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pdf_roots_one_default_idx` ON `pdf_roots` (`corpus_id`) WHERE is_default = 1;--> statement-breakpoint
CREATE TABLE `reading_prompts` (
	`paper_id` text PRIMARY KEY NOT NULL,
	`prompts_json` text NOT NULL,
	`generated_at` text NOT NULL,
	`model` text,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reconcile_state` (
	`corpus_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`last_reconciled_at` text NOT NULL,
	PRIMARY KEY(`corpus_id`, `paper_id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`taken_at` text NOT NULL,
	`payload` text NOT NULL,
	`trigger` text,
	CONSTRAINT "snapshots_trigger_ck" CHECK(trigger IS NULL OR trigger IN ('open','manual'))
);
