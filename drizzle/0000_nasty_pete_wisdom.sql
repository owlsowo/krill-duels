CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`guest` text,
	`version` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`host_seen` integer NOT NULL,
	`guest_seen` integer DEFAULT 0 NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_expires` ON `rooms` (`expires`);