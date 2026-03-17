-- Refactor ClientInventory schema
-- Step 1: Add category column as nullable first
ALTER TABLE "ClientInventory" ADD COLUMN IF NOT EXISTS "category" TEXT;

-- Step 2: Migrate existing deviceType to category for ALL rows
UPDATE "ClientInventory" 
SET "category" = CASE 
  WHEN "deviceType" LIKE '%_windows' THEN SPLIT_PART("deviceType", '_', 1)
  WHEN "deviceType" LIKE '%_apple' THEN SPLIT_PART("deviceType", '_', 1)
  WHEN "deviceType" = 'mobile_phone' THEN 'mobile'
  WHEN "deviceType" IS NULL THEN 'laptop'
  WHEN "deviceType" = '' THEN 'laptop'
  ELSE "deviceType"
END;

-- Step 2b: Ensure ALL rows have a category (fallback to laptop)
UPDATE "ClientInventory"
SET "category" = COALESCE("category", 'laptop')
WHERE "category" IS NULL OR "category" = '';

-- Step 3: Extract deviceType (Windows/Apple) from combined deviceType
UPDATE "ClientInventory"
SET "deviceType" = CASE
  WHEN "deviceType" LIKE '%_windows' THEN 'Windows'
  WHEN "deviceType" LIKE '%_apple' THEN 'Apple'
  ELSE NULL
END
WHERE "deviceType" LIKE '%_windows' OR "deviceType" LIKE '%_apple';

-- Step 4: For items that don't have _windows or _apple, set deviceType to NULL
UPDATE "ClientInventory"
SET "deviceType" = NULL
WHERE "deviceType" NOT IN ('Windows', 'Apple') 
  AND "deviceType" IS NOT NULL;

-- Step 5: Migrate clientId to allocatedTo (if status is allocated)
UPDATE "ClientInventory"
SET "allocatedTo" = "clientId"
WHERE "clientId" IS NOT NULL AND "status" = 'allocated';

-- Step 6: Final check - ensure ALL rows have category before making NOT NULL
UPDATE "ClientInventory" 
SET "category" = COALESCE("category", 'laptop')
WHERE "category" IS NULL;

-- Step 7: Make category NOT NULL
ALTER TABLE "ClientInventory" ALTER COLUMN "category" SET NOT NULL;

-- Step 8: Remove clientId column and index
DROP INDEX IF EXISTS "ClientInventory_clientId_idx";
ALTER TABLE "ClientInventory" DROP COLUMN IF EXISTS "clientId";

-- Step 9: Add index on category
CREATE INDEX IF NOT EXISTS "ClientInventory_category_idx" ON "ClientInventory"("category");
