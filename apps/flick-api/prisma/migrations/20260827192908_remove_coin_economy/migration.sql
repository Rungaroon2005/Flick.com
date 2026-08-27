/*
  Warnings:

  - You are about to drop the column `coinCost` on the `episodes` table. All the data in the column will be lost.
  - You are about to drop the column `coinBalance` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `user_coins` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "user_coins" DROP CONSTRAINT "user_coins_paymentEventId_fkey";

-- DropForeignKey
ALTER TABLE "user_coins" DROP CONSTRAINT "user_coins_userId_fkey";

-- AlterTable
ALTER TABLE "episodes" DROP COLUMN "coinCost";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "coinBalance";

-- DropTable
DROP TABLE "user_coins";

-- DropEnum
DROP TYPE "TransactionType";
