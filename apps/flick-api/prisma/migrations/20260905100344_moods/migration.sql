-- CreateTable
CREATE TABLE "moods" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,

    CONSTRAINT "moods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_moods" (
    "movieId" TEXT NOT NULL,
    "moodId" TEXT NOT NULL,

    CONSTRAINT "movie_moods_pkey" PRIMARY KEY ("movieId","moodId")
);

-- CreateIndex
CREATE UNIQUE INDEX "moods_slug_key" ON "moods"("slug");

-- AddForeignKey
ALTER TABLE "movie_moods" ADD CONSTRAINT "movie_moods_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movie_moods" ADD CONSTRAINT "movie_moods_moodId_fkey" FOREIGN KEY ("moodId") REFERENCES "moods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
