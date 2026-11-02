CREATE TABLE `audio_packets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room` text NOT NULL,
	`sender` text NOT NULL,
	`seq` integer NOT NULL,
	`data` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audio_room_cursor` ON `audio_packets` (`room`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audio_sender_seq` ON `audio_packets` (`sender`,`seq`);--> statement-breakpoint
ALTER TABLE `assets` ADD `owner` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `removed_at` integer;--> statement-breakpoint
ALTER TABLE `notes` ADD `removed_at` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `portal_position` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `removed_at` integer;