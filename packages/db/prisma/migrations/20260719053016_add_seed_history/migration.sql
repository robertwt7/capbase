-- CreateTable
CREATE TABLE "SeedHistory" (
    "name" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeedHistory_pkey" PRIMARY KEY ("name")
);

