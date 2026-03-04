-- CreateTable
CREATE TABLE "VehicleDriver" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDriver_pkey" PRIMARY KEY ("id")
);

-- Migrate existing data from Vehicle.driverId to VehicleDriver
INSERT INTO "VehicleDriver" ("id", "vehicleId", "driverId", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    "id",
    "driverId",
    "createdAt",
    "updatedAt"
FROM "Vehicle"
WHERE "driverId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "VehicleDriver_vehicleId_idx" ON "VehicleDriver"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleDriver_driverId_idx" ON "VehicleDriver"("driverId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "VehicleDriver_vehicleId_driverId_key" ON "VehicleDriver"("vehicleId", "driverId");

-- AddForeignKey
ALTER TABLE "VehicleDriver" ADD CONSTRAINT "VehicleDriver_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDriver" ADD CONSTRAINT "VehicleDriver_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX IF EXISTS "Vehicle_driverId_key";

-- DropIndex
DROP INDEX IF EXISTS "Vehicle_driverId_idx";

-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "driverId";
