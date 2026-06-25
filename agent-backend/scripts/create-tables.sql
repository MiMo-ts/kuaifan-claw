-- 创建数据库（如果不存在）
CREATE DATABASE IF NOT EXISTS agent_backend DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE agent_backend;

-- 创建 users 表
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(191) NOT NULL UNIQUE,
  `email` VARCHAR(191) NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('admin', 'agent') NOT NULL DEFAULT 'agent',
  `createdAt` DATETIME,
  `updatedAt` DATETIME,
  INDEX `idx_username` (`username`),
  INDEX `idx_email` (`email`),
  INDEX `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建 invitecodes 表
CREATE TABLE IF NOT EXISTS `invitecodes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(100) NOT NULL UNIQUE,
  `createdBy` INT NOT NULL,
  `createdByName` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME NOT NULL,
  `status` ENUM('active', 'used', 'disabled') DEFAULT 'active',
  `maxDevices` INT DEFAULT 3,
  `usedBy` VARCHAR(191) NULL,
  `usedAt` DATETIME NULL,
  `platform` VARCHAR(100) NULL,
  `metadata` TEXT NULL,
  `createdAt` DATETIME,
  `updatedAt` DATETIME,
  INDEX `idx_code` (`code`),
  INDEX `idx_createdBy` (`createdBy`),
  INDEX `idx_status` (`status`),
  INDEX `idx_expiresAt` (`expiresAt`),
  CONSTRAINT `fk_createdBy` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 创建 invite_code_devices 表
CREATE TABLE IF NOT EXISTS `invite_code_devices` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `invite_code_id` INT NOT NULL,
  `device_fingerprint` VARCHAR(191) NOT NULL,
  `device_name` VARCHAR(191) NULL,
  `platform` VARCHAR(100) DEFAULT 'desktop',
  `bound_at` DATETIME,
  `last_login_at` DATETIME,
  UNIQUE INDEX `idx_invite_code_device` (`invite_code_id`, `device_fingerprint`),
  CONSTRAINT `fk_invite_code` FOREIGN KEY (`invite_code_id`) REFERENCES `invitecodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 管理员账号请通过 node scripts/init-db.js 创建（密码会自动加密）
