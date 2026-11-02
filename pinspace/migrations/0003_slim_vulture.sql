ALTER TABLE `rooms` ADD `presentation_deck` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `presentation_state` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `presentation_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `presenter_seen` integer;