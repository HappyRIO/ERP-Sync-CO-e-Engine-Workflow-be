-- AlterTable
-- Make clientId nullable in ClientInventory
ALTER TABLE "ClientInventory" ALTER COLUMN "clientId" DROP NOT NULL;

-- Drop the old unique constraint on clientId and serialNumber
ALTER TABLE "ClientInventory" DROP CONSTRAINT IF EXISTS "ClientInventory_clientId_serialNumber_key";

-- Add new unique constraint on tenantId and serialNumber
ALTER TABLE "ClientInventory" ADD CONSTRAINT "ClientInventory_tenantId_serialNumber_key" UNIQUE ("tenantId", "serialNumber");
