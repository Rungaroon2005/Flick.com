-- CreateEnum
CREATE TYPE "SceneMarkerKind" AS ENUM ('INTRO', 'RECAP', 'CREDITS');

-- AlterTable
ALTER TABLE "movies" ADD COLUMN     "originCountry" TEXT;

-- CreateTable
CREATE TABLE "scene_markers" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "kind" "SceneMarkerKind" NOT NULL,
    "startSeconds" INTEGER NOT NULL,
    "endSeconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scene_markers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scene_markers_episodeId_kind_key" ON "scene_markers"("episodeId", "kind");

-- AddForeignKey
ALTER TABLE "scene_markers" ADD CONSTRAINT "scene_markers_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma has no way to express this. A typo'd marker with endSeconds <=
-- startSeconds would otherwise produce a negative skippableSeconds, which
-- silently corrupts every finish-time estimate that reads it -- a CHECK
-- constraint is the cheapest place to stop that before it ever writes.
ALTER TABLE "scene_markers"
  ADD CONSTRAINT "scene_markers_range_valid"
  CHECK ("startSeconds" >= 0 AND "endSeconds" > "startSeconds");
