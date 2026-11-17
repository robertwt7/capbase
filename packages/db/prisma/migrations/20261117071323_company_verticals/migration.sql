-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "verticals" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Company_verticals_idx" ON "Company" USING GIN ("verticals");
