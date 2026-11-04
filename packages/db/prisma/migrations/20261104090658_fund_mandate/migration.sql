-- AlterTable
ALTER TABLE "Fund" ADD COLUMN     "detailedStrategy" TEXT,
ADD COLUMN     "domicile" TEXT,
ADD COLUMN     "geographicExposure" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "geographicFocus" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "legalStructure" TEXT,
ADD COLUMN     "mandateReportedOn" TIMESTAMP(3),
ADD COLUMN     "structure" TEXT,
ADD COLUMN     "verticals" TEXT[] DEFAULT ARRAY[]::TEXT[];
