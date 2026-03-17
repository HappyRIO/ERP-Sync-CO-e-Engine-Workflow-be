-- Refactor ClientInventory schema
-- 1. Remove clientId and client relation
-- 2. Add category field
-- 3. Change deviceType to be nullable (Windows/Apple for laptop/desktop only)
-- 4. Change allocatedTo to store clientId instead of bookingId

-- Step 1: Add category column (nullable first)
ALTER TABLE "ClientInventory" ADD COLUMN IF NOT EXISTS "category" TEXT;

-- Step 2: Migrate existing deviceType to category
-- Extract base category from deviceType (remove _windows, _apple suffixes)
UPDATE "ClientInventory" 
SET "category" = CASE 
  WHEN "deviceType" LIKE '%_windows' OR "deviceType" LIKE '%_apple' THEN 
    SPLIT_PART("deviceType", '_', 1)
  WHEN "deviceType" = 'mobile_phone' THEN 'mobile'
  WHEN "deviceType" IS NULL THEN 'laptop' -- Default for NULL
  ELSE COALESCE("deviceType", 'laptop') -- Use deviceType as-is for other categories (server, storage, networking, etc.)
END
WHERE "category" IS NULL OR "category" = '';

-- Step 2b: Ensure all rows have a category (fallback)
UPDATE "ClientInventory"
SET "category" = COALESCE("category", 'laptop')
WHERE "category" IS NULL OR "category" = '';

-- Step 3: Extract deviceType (Windows/Apple) from combined deviceType
-- For laptop/desktop, extract the OS type
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
  AND "deviceType" IS NOT NULL
  AND ("category" NOT IN ('laptop', 'desktop') OR "category" IS NULL);

-- Step 5: Migrate clientId to allocatedTo (if status is allocated)
UPDATE "ClientInventory"
SET "allocatedTo" = "clientId"
WHERE "clientId" IS NOT NULL AND "status" = 'allocated';

-- Step 6: Make category NOT NULL (after migration)
-- First ensure all rows have a category
UPDATE "ClientInventory" SET "category" = 'laptop' WHERE "category" IS NULL;
-- Then make it NOT NULL
ALTER TABLE "ClientInventory" ALTER COLUMN "category" SET NOT NULL;

-- Step 7: Remove clientId column and index
DROP INDEX IF EXISTS "ClientInventory_clientId_idx";
ALTER TABLE "ClientInventory" DROP COLUMN IF EXISTS "clientId";

-- Step 8: Add index on category
CREATE INDEX IF NOT EXISTS "ClientInventory_category_idx" ON "ClientInventory"("category");
