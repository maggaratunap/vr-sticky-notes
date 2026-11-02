CREATE TABLE `guests` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`ip_hash` text,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guests_token_hash_unique` ON `guests` (`token_hash`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `public_room` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `owner` text;