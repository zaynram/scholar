CREATE TABLE `annotation_tombstones` (
	`annotation_id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`deleted_at` text NOT NULL,
	`deleted_by` text,
	`deletion_reason` text
);
--> statement-breakpoint
CREATE INDEX `annotation_tombstones_paper_idx` ON `annotation_tombstones` (`paper_id`);