-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "companyType" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "operatingStatus" TEXT,
ADD COLUMN     "primarySector" TEXT,
ADD COLUMN     "twitterUrl" TEXT,
ADD COLUMN     "websiteUrl" TEXT;

-- AlterTable
ALTER TABLE "InvestorHolding" ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "websiteUrl" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "title" TEXT;
