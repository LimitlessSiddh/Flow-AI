CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`league` text NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`status` text NOT NULL,
	`home` text NOT NULL,
	`away` text NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`source_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `games_date` ON `games` (`date`);--> statement-breakpoint
CREATE TABLE `left_off` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`market` text NOT NULL,
	`reason` text NOT NULL,
	`scan_id` text
);
--> statement-breakpoint
CREATE TABLE `plays` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`game_id` text NOT NULL,
	`league` text NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`subject_id` text,
	`team` text,
	`position` text,
	`headshot` text,
	`stat` text,
	`side` text NOT NULL,
	`line` real,
	`signal` integer,
	`model` real,
	`quality` integer DEFAULT 1 NOT NULL,
	`watch` text NOT NULL,
	`log` text NOT NULL,
	`windows` text NOT NULL,
	`season_avg` real,
	`season_games` integer,
	`season_rate` real,
	`streak` integer DEFAULT 0 NOT NULL,
	`context` text NOT NULL,
	`read` text,
	`counter` text,
	`availability` text,
	`origin` text DEFAULT 'scan' NOT NULL,
	`researched_by` text,
	`scan_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plays_date` ON `plays` (`date`);--> statement-breakpoint
CREATE TABLE `prices` (
	`play_id` text NOT NULL,
	`book` text NOT NULL,
	`book_title` text NOT NULL,
	`odds` integer NOT NULL,
	`line` real,
	`retrieved_at` text NOT NULL,
	`origin` text NOT NULL,
	PRIMARY KEY(`play_id`, `book`),
	FOREIGN KEY (`play_id`) REFERENCES `plays`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `results` (
	`play_id` text PRIMARY KEY NOT NULL,
	`value` real,
	`won` integer,
	`push` integer DEFAULT false NOT NULL,
	`settled_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`steps` text NOT NULL,
	`odds_credits_remaining` integer,
	`play_count` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`play_id` text NOT NULL,
	`publisher` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`corroborated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`play_id`) REFERENCES `plays`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_state` (
	`play_id` text PRIMARY KEY NOT NULL,
	`saved` integer DEFAULT false NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`tracked` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
