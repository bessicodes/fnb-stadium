CREATE TABLE `accreditations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`pass_code` text NOT NULL,
	`zones` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`checked_in_at` integer,
	`checked_out_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staff_id`) REFERENCES `vendor_staff`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accreditations_pass_code_unique` ON `accreditations` (`pass_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `accred_event_staff_idx` ON `accreditations` (`event_id`,`staff_id`);--> statement-breakpoint
CREATE INDEX `accred_event_idx` ON `accreditations` (`event_id`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`zone_id` text NOT NULL,
	`tier` text NOT NULL,
	`seats` integer NOT NULL,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_code_unique` ON `blocks` (`code`);--> statement-breakpoint
CREATE INDEX `blocks_zone_idx` ON `blocks` (`zone_id`);--> statement-breakpoint
CREATE TABLE `crews` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`base_zone_id` text,
	`call_sign` text NOT NULL,
	`member_count` integer DEFAULT 3 NOT NULL,
	`shift` text DEFAULT 'double' NOT NULL,
	`trolleys` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'off' NOT NULL,
	FOREIGN KEY (`base_zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crews_code_unique` ON `crews` (`code`);--> statement-breakpoint
CREATE INDEX `crews_status_idx` ON `crews` (`status`);--> statement-breakpoint
CREATE TABLE `event_zones` (
	`event_id` text NOT NULL,
	`zone_id` text NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`event_id`, `zone_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`starts_at` integer NOT NULL,
	`doors_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`expected_attendance` integer NOT NULL,
	`actual_attendance` integer,
	`spend_per_head_cents` integer DEFAULT 4500 NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_code_unique` ON `events` (`code`);--> statement-breakpoint
CREATE INDEX `events_start_idx` ON `events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `events_status_idx` ON `events` (`status`);--> statement-breakpoint
CREATE TABLE `haul_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`kiosk_id` text NOT NULL,
	`meters` integer NOT NULL,
	`minutes` integer NOT NULL,
	`via` text,
	`step_free` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `storage_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kiosk_id`) REFERENCES `kiosks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `haul_room_kiosk_idx` ON `haul_routes` (`room_id`,`kiosk_id`);--> statement-breakpoint
CREATE INDEX `haul_kiosk_idx` ON `haul_routes` (`kiosk_id`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text DEFAULT 'low' NOT NULL,
	`kiosk_id` text,
	`room_id` text,
	`vendor_id` text,
	`description` text NOT NULL,
	`reported_by` text NOT NULL,
	`at` integer NOT NULL,
	`resolved_at` integer,
	`resolution` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kiosk_id`) REFERENCES `kiosks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `storage_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inc_event_idx` ON `incidents` (`event_id`);--> statement-breakpoint
CREATE INDEX `inc_severity_idx` ON `incidents` (`severity`);--> statement-breakpoint
CREATE TABLE `kiosk_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`kiosk_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`staff_planned` integer DEFAULT 4 NOT NULL,
	`float_cents` integer DEFAULT 0 NOT NULL,
	`declared_sales_cents` integer,
	`opened_at` integer,
	`closed_at` integer,
	`notes` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kiosk_id`) REFERENCES `kiosks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alloc_event_kiosk_idx` ON `kiosk_allocations` (`event_id`,`kiosk_id`);--> statement-breakpoint
CREATE INDEX `alloc_event_vendor_idx` ON `kiosk_allocations` (`event_id`,`vendor_id`);--> statement-breakpoint
CREATE TABLE `kiosks` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`zone_id` text NOT NULL,
	`kind` text NOT NULL,
	`tills` integer DEFAULT 2 NOT NULL,
	`fitout` text DEFAULT '[]' NOT NULL,
	`throughput_per_hour` integer DEFAULT 180 NOT NULL,
	`serves_blocks` text DEFAULT '[]' NOT NULL,
	`has_gas` integer DEFAULT false NOT NULL,
	`has_water` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kiosks_code_unique` ON `kiosks` (`code`);--> statement-breakpoint
CREATE INDEX `kiosks_zone_idx` ON `kiosks` (`zone_id`);--> statement-breakpoint
CREATE INDEX `kiosks_status_idx` ON `kiosks` (`status`);--> statement-breakpoint
CREATE TABLE `levels` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `levels_code_unique` ON `levels` (`code`);--> statement-breakpoint
CREATE TABLE `load_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`event_id` text NOT NULL,
	`kiosk_id` text NOT NULL,
	`item_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`qty` integer NOT NULL,
	`qty_delivered` integer,
	`priority` text DEFAULT 'routine' NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`from_spot_id` text,
	`crew_id` text,
	`requested_by` text NOT NULL,
	`sla_minutes` integer DEFAULT 30 NOT NULL,
	`requested_at` integer NOT NULL,
	`assigned_at` integer,
	`picked_at` integer,
	`delivered_at` integer,
	`confirmed_at` integer,
	`cancelled_reason` text,
	`note` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kiosk_id`) REFERENCES `kiosks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_spot_id`) REFERENCES `storage_spots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `load_runs_code_unique` ON `load_runs` (`code`);--> statement-breakpoint
CREATE INDEX `runs_event_status_idx` ON `load_runs` (`event_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_crew_idx` ON `load_runs` (`crew_id`);--> statement-breakpoint
CREATE INDEX `runs_kiosk_idx` ON `load_runs` (`kiosk_id`);--> statement-breakpoint
CREATE TABLE `par_levels` (
	`id` text PRIMARY KEY NOT NULL,
	`kiosk_id` text NOT NULL,
	`item_id` text NOT NULL,
	`min_qty` integer NOT NULL,
	`max_qty` integer NOT NULL,
	FOREIGN KEY (`kiosk_id`) REFERENCES `kiosks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `par_kiosk_item_idx` ON `par_levels` (`kiosk_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `stock_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`case_unit` text DEFAULT 'case' NOT NULL,
	`pack_size` integer DEFAULT 24 NOT NULL,
	`unit_weight_kg` real DEFAULT 0.4 NOT NULL,
	`requires_chill` integer DEFAULT false NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_items_sku_unique` ON `stock_items` (`sku`);--> statement-breakpoint
CREATE INDEX `items_category_idx` ON `stock_items` (`category`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`item_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`kind` text NOT NULL,
	`qty` integer NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text,
	`to_type` text NOT NULL,
	`to_id` text,
	`actor` text NOT NULL,
	`ref` text,
	`at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mov_event_idx` ON `stock_movements` (`event_id`);--> statement-breakpoint
CREATE INDEX `mov_event_item_idx` ON `stock_movements` (`event_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `mov_from_idx` ON `stock_movements` (`from_type`,`from_id`);--> statement-breakpoint
CREATE INDEX `mov_to_idx` ON `stock_movements` (`to_type`,`to_id`);--> statement-breakpoint
CREATE INDEX `mov_ref_idx` ON `stock_movements` (`ref`);--> statement-breakpoint
CREATE TABLE `storage_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`spot_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`units_allocated` real NOT NULL,
	`notes` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spot_id`) REFERENCES `storage_spots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storalloc_event_spot_idx` ON `storage_allocations` (`event_id`,`spot_id`);--> statement-breakpoint
CREATE INDEX `storalloc_event_vendor_idx` ON `storage_allocations` (`event_id`,`vendor_id`);--> statement-breakpoint
CREATE TABLE `storage_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`zone_id` text NOT NULL,
	`class` text NOT NULL,
	`temp_min_c` real,
	`temp_max_c` real,
	`area_sqm` real NOT NULL,
	`security` text DEFAULT 'locked' NOT NULL,
	`keyholder` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_rooms_code_unique` ON `storage_rooms` (`code`);--> statement-breakpoint
CREATE INDEX `rooms_zone_idx` ON `storage_rooms` (`zone_id`);--> statement-breakpoint
CREATE INDEX `rooms_class_idx` ON `storage_rooms` (`class`);--> statement-breakpoint
CREATE TABLE `storage_spots` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`room_id` text NOT NULL,
	`kind` text NOT NULL,
	`capacity_units` real NOT NULL,
	`unit` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `storage_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_spots_code_unique` ON `storage_spots` (`code`);--> statement-breakpoint
CREATE INDEX `spots_room_idx` ON `storage_spots` (`room_id`);--> statement-breakpoint
CREATE INDEX `spots_status_idx` ON `storage_spots` (`status`);--> statement-breakpoint
CREATE TABLE `vendor_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`kind` text NOT NULL,
	`reference` text,
	`issued_on` integer,
	`expires_on` integer,
	`issuer` text,
	`notes` text,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `docs_vendor_idx` ON `vendor_documents` (`vendor_id`);--> statement-breakpoint
CREATE INDEX `docs_expiry_idx` ON `vendor_documents` (`expires_on`);--> statement-breakpoint
CREATE TABLE `vendor_staff` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`full_name` text NOT NULL,
	`id_number` text NOT NULL,
	`role` text NOT NULL,
	`phone` text,
	`food_handler_expiry` integer,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `staff_vendor_idx` ON `vendor_staff` (`vendor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `staff_id_number_idx` ON `vendor_staff` (`id_number`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`trading_name` text NOT NULL,
	`registered_name` text NOT NULL,
	`reg_no` text,
	`vat_no` text,
	`category` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_phone` text NOT NULL,
	`contact_email` text NOT NULL,
	`status` text DEFAULT 'prospect' NOT NULL,
	`commission_bp` integer DEFAULT 1500 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_code_unique` ON `vendors` (`code`);--> statement-breakpoint
CREATE INDEX `vendors_status_idx` ON `vendors` (`status`);--> statement-breakpoint
CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`level_id` text NOT NULL,
	`kind` text NOT NULL,
	`sector` text DEFAULT 'ALL' NOT NULL,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zones_code_unique` ON `zones` (`code`);--> statement-breakpoint
CREATE INDEX `zones_level_idx` ON `zones` (`level_id`);