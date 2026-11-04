CREATE TABLE `model_transforms` (
    `id` text PRIMARY KEY NOT NULL,
    `room` text NOT NULL,
    `asset` text NOT NULL,
    `transform` text NOT NULL,
    `revision` integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX `model_transform_room_asset` ON `model_transforms` (`room`,`asset`);
