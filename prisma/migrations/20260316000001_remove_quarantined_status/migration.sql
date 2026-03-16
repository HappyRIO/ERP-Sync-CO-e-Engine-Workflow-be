-- Remove quarantined status from BookingStatus and JobStatus enums
-- Note: PostgreSQL doesn't support removing enum values directly
-- We need to:
-- 1. Update any records using 'quarantined' to 'inventory' first
-- 2. Then recreate the enum without 'quarantined'

-- Step 1: Update any bookings with 'quarantined' status to 'inventory'
UPDATE "Booking" 
SET status = 'inventory' 
WHERE status = 'quarantined';

-- Step 2: Update any jobs with 'quarantined' status to 'inventory'
UPDATE "Job" 
SET status = 'inventory' 
WHERE status = 'quarantined';

-- Step 3: Update booking status history
UPDATE "BookingStatusHistory" 
SET status = 'inventory' 
WHERE status = 'quarantined';

-- Step 4: Update job status history
UPDATE "JobStatusHistory" 
SET status = 'inventory' 
WHERE status = 'quarantined';

-- Note: PostgreSQL doesn't support removing enum values directly.
-- The 'quarantined' value will remain in the enum type definition but won't be used.
-- To fully remove it, you would need to:
-- 1. Create a new enum type without 'quarantined'
-- 2. Alter all tables to use the new enum type
-- 3. Drop the old enum type
-- This is complex and risky, so we'll leave the enum value but ensure no data uses it.
