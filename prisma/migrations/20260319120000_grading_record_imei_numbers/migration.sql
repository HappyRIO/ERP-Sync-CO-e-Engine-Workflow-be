-- AlterTable
ALTER TABLE "GradingRecord" ADD COLUMN "imeiNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];
