-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'device_allocated';
ALTER TYPE "BookingStatus" ADD VALUE 'courier_booked';
ALTER TYPE "BookingStatus" ADD VALUE 'in_transit';
ALTER TYPE "BookingStatus" ADD VALUE 'delivered';
ALTER TYPE "BookingStatus" ADD VALUE 'collection_scheduled';

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('itad_collection', 'jml');

-- CreateEnum
CREATE TYPE "JMLSubType" AS ENUM ('new_starter', 'leaver', 'breakfix', 'mover');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('available', 'allocated', 'in_transit', 'delivered', 'collected', 'warehouse');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "bookingType" "BookingType" NOT NULL DEFAULT 'itad_collection';
ALTER TABLE "Booking" ADD COLUMN "jmlSubType" "JMLSubType";
ALTER TABLE "Booking" ADD COLUMN "employeeName" TEXT;
ALTER TABLE "Booking" ADD COLUMN "employeeEmail" TEXT;
ALTER TABLE "Booking" ADD COLUMN "employeePhone" TEXT;
ALTER TABLE "Booking" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "deviceType" TEXT;
ALTER TABLE "Booking" ADD COLUMN "courierTracking" TEXT;
ALTER TABLE "Booking" ADD COLUMN "deliveryDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobAsset" ADD COLUMN "allocatedSerialNumber" TEXT;
ALTER TABLE "JobAsset" ADD COLUMN "imei" TEXT;
ALTER TABLE "JobAsset" ADD COLUMN "accessories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ClientInventory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "imei" TEXT,
    "conditionCode" TEXT NOT NULL,
    "erpInventoryId" TEXT,
    "status" "InventoryStatus" NOT NULL DEFAULT 'available',
    "allocatedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "ClientInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialReuseHistory" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "jobId" TEXT,
    "bookingType" "BookingType" NOT NULL,
    "jmlSubType" "JMLSubType",
    "reuseCount" INTEGER NOT NULL DEFAULT 1,
    "co2eSaved" DOUBLE PRECISION NOT NULL,
    "allocatedDate" TIMESTAMP(3) NOT NULL,
    "returnedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SerialReuseHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientInventory_clientId_serialNumber_key" ON "ClientInventory"("clientId", "serialNumber");

-- CreateIndex
CREATE INDEX "ClientInventory_clientId_idx" ON "ClientInventory"("clientId");

-- CreateIndex
CREATE INDEX "ClientInventory_tenantId_idx" ON "ClientInventory"("tenantId");

-- CreateIndex
CREATE INDEX "ClientInventory_status_idx" ON "ClientInventory"("status");

-- CreateIndex
CREATE INDEX "ClientInventory_conditionCode_idx" ON "ClientInventory"("conditionCode");

-- CreateIndex
CREATE INDEX "ClientInventory_erpInventoryId_idx" ON "ClientInventory"("erpInventoryId");

-- CreateIndex
CREATE INDEX "ClientInventory_allocatedTo_idx" ON "ClientInventory"("allocatedTo");

-- CreateIndex
CREATE INDEX "SerialReuseHistory_serialNumber_idx" ON "SerialReuseHistory"("serialNumber");

-- CreateIndex
CREATE INDEX "SerialReuseHistory_clientId_idx" ON "SerialReuseHistory"("clientId");

-- CreateIndex
CREATE INDEX "SerialReuseHistory_bookingId_idx" ON "SerialReuseHistory"("bookingId");

-- CreateIndex
CREATE INDEX "SerialReuseHistory_jobId_idx" ON "SerialReuseHistory"("jobId");

-- CreateIndex
CREATE INDEX "SerialReuseHistory_tenantId_idx" ON "SerialReuseHistory"("tenantId");

-- AddForeignKey
ALTER TABLE "ClientInventory" ADD CONSTRAINT "ClientInventory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInventory" ADD CONSTRAINT "ClientInventory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialReuseHistory" ADD CONSTRAINT "SerialReuseHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialReuseHistory" ADD CONSTRAINT "SerialReuseHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialReuseHistory" ADD CONSTRAINT "SerialReuseHistory_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialReuseHistory" ADD CONSTRAINT "SerialReuseHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
