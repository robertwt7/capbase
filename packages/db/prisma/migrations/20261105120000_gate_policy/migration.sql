-- Admin overrides of the read gate (configurable visibility). Additive: empty
-- tables mean exactly the code defaults.

-- CreateTable
CREATE TABLE "GateSectionPolicy" (
    "section" TEXT NOT NULL,
    "signedOut" TEXT NOT NULL,
    "signedIn" TEXT NOT NULL,
    "unlocked" TEXT NOT NULL,
    "previewRows" INTEGER NOT NULL,
    "partnerAudience" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "GateSectionPolicy_pkey" PRIMARY KEY ("section")
);

-- CreateTable
CREATE TABLE "GateFieldPolicy" (
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "partnerAudience" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "GateFieldPolicy_pkey" PRIMARY KEY ("entity","field")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);
