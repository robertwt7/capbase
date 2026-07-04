-- CreateTable
CREATE TABLE "SavedCompany" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedCompany_userId_idx" ON "SavedCompany"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedCompany_userId_companyId_key" ON "SavedCompany"("userId", "companyId");

-- AddForeignKey
ALTER TABLE "SavedCompany" ADD CONSTRAINT "SavedCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedCompany" ADD CONSTRAINT "SavedCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
