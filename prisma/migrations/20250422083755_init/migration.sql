-- AlterTable
ALTER TABLE `ShortenedURL` ADD COLUMN `expiredAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `ShortenedURL_expiredAt_idx` ON `ShortenedURL`(`expiredAt`);
