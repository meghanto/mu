-- CreateTable
CREATE TABLE "QueueState" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "queue" TEXT NOT NULL,
    "queuePosition" INTEGER NOT NULL DEFAULT 0,
    "nowPlaying" TEXT,
    "loopCurrentSong" BOOLEAN NOT NULL DEFAULT 0,
    "loopCurrentQueue" BOOLEAN NOT NULL DEFAULT 0,
    "volume" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);




