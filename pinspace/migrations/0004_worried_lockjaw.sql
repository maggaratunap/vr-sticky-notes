CREATE TABLE `room_shortcuts` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`target` text NOT NULL,
	`position` text NOT NULL,
	`created` integer NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shortcut_room_target` ON `room_shortcuts` (`room`,`target`);