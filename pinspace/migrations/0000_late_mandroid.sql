CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`size` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`author` text NOT NULL,
	`owner` text NOT NULL,
	`body` text NOT NULL,
	`color` text NOT NULL,
	`position` text NOT NULL,
	`asset` text,
	`resolved` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `peers` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`pose` text NOT NULL,
	`mic` integer DEFAULT 0 NOT NULL,
	`seen` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`sender` text NOT NULL,
	`receiver` text NOT NULL,
	`payload` text NOT NULL,
	`created` integer NOT NULL
);
