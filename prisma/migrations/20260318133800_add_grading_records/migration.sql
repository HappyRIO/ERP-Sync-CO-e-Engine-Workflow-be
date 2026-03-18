-- Add grading records table to support multiple gradings per category

-- CreateEnum
CREATE TYPE "GradingGrade" AS ENUM ('A', 'B', 'C', 'D', 'Q');

-- CreateTable
CREATE TABLE "GradingRecord" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "jobId" TEXT,
    "jobAssetId" TEXT,
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "grade" "GradingGrade" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "conditionCode" TEXT,
    "serialNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resaleValue" DOUBLE PRECISION NOT NULL,
    "gradedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradingRecord_bookingId_idx" ON "GradingRecord"("bookingId");
CREATE INDEX "GradingRecord_jobId_idx" ON "GradingRecord"("jobId");
CREATE INDEX "GradingRecord_jobAssetId_idx" ON "GradingRecord"("jobAssetId");
CREATE INDEX "GradingRecord_categoryId_idx" ON "GradingRecord"("categoryId");
CREATE INDEX "GradingRecord_grade_idx" ON "GradingRecord"("grade");
CREATE INDEX "GradingRecord_createdAt_idx" ON "GradingRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "GradingRecord" ADD CONSTRAINT "GradingRecord_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GradingRecord" ADD CONSTRAINT "GradingRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GradingRecord" ADD CONSTRAINT "GradingRecord_jobAssetId_fkey" FOREIGN KEY ("jobAssetId") REFERENCES "JobAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GradingRecord" ADD CONSTRAINT "GradingRecord_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

