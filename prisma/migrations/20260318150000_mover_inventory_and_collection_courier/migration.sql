-- Mover: scope inventory to booking; persist collection courier when booking delivery courier
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "collectionCourierTracking" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "collectionCourierService" TEXT;

ALTER TABLE "ClientInventory" ADD COLUMN IF NOT EXISTS "moverSourceBookingId" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ClientInventory_moverSourceBookingId_fkey'
    ) THEN
        ALTER TABLE "ClientInventory"
        ADD CONSTRAINT "ClientInventory_moverSourceBookingId_fkey"
        FOREIGN KEY ("moverSourceBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ClientInventory_moverSourceBookingId_idx" ON "ClientInventory"("moverSourceBookingId");

-- Backfill collection courier from existing tracking (collection phase only)
UPDATE "Booking"
SET "collectionCourierTracking" = "courierTracking",
    "collectionCourierService" = "courierService"
WHERE "jmlSubType" IN ('mover', 'leaver')
  AND "collectionCourierTracking" IS NULL
  AND "courierTracking" IS NOT NULL
  AND "status" IN ('collection_scheduled', 'collected', 'warehouse');
