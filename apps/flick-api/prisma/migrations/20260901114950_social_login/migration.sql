-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE', 'APPLE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_nonces" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identities_userId_idx" ON "identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "identities_provider_providerAccountId_key" ON "identities"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "identities_userId_provider_key" ON "identities"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_nonces_nonce_key" ON "oauth_nonces"("nonce");

-- CreateIndex
CREATE INDEX "oauth_nonces_expiresAt_idx" ON "oauth_nonces"("expiresAt");

-- AddForeignKey
ALTER TABLE "identities" ADD CONSTRAINT "identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing users.email was proven by OTP delivery: the only write is in
-- OtpService.verify, reachable only by receiving a code at that address. This
-- states that existing fact rather than asserting a new one. Without it, every
-- current email user would hit the refuse-to-auto-link branch on their first
-- social sign-in.
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "email" IS NOT NULL;
