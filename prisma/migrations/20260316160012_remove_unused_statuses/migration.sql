-- Remove unused enum values from BookingStatus and JobStatus
-- Note: PostgreSQL doesn't support removing enum values directly, so we need to recreate the enums

-- First, check if any records are using the values we want to remove
-- If any exist, this migration will fail and you'll need to update those records first

-- Remove unused values from BookingStatus enum
-- We need to recreate the enum without delivery_scheduled
DO $$ 
BEGIN
    -- Check if delivery_scheduled is still in use
    IF EXISTS (
        SELECT 1 FROM "Booking" WHERE status = 'delivery_scheduled'
    ) THEN
        RAISE EXCEPTION 'Cannot remove delivery_scheduled: still in use by % records', 
            (SELECT COUNT(*) FROM "Booking" WHERE status = 'delivery_scheduled');
    END IF;
END $$;

-- Remove unused values from JobStatus enum
-- We need to recreate the enum without in_transit, delivery_routed, delivery_en_route, delivery_arrived
DO $$ 
BEGIN
    -- Check if any of these statuses are still in use
    IF EXISTS (
        SELECT 1 FROM "Job" WHERE status IN ('in_transit', 'delivery_routed', 'delivery_en_route', 'delivery_arrived')
    ) THEN
        RAISE EXCEPTION 'Cannot remove statuses: still in use. in_transit: %, delivery_routed: %, delivery_en_route: %, delivery_arrived: %', 
            (SELECT COUNT(*) FROM "Job" WHERE status = 'in_transit'),
            (SELECT COUNT(*) FROM "Job" WHERE status = 'delivery_routed'),
            (SELECT COUNT(*) FROM "Job" WHERE status = 'delivery_en_route'),
            (SELECT COUNT(*) FROM "Job" WHERE status = 'delivery_arrived');
    END IF;
END $$;

-- Create new BookingStatus enum without delivery_scheduled
CREATE TYPE "BookingStatus_new" AS ENUM (
    'pending',
    'created',
    'scheduled',
    'collected',
    'warehouse',
    'sanitised',
    'graded',
    'completed',
    'cancelled',
    'device_allocated',
    'courier_booked',
    'dispatched',
    'delivered',
    'collection_scheduled',
    'inventory'
);

-- Create new JobStatus enum without unused values
CREATE TYPE "JobStatus_new" AS ENUM (
    'booked',
    'routed',
    'en_route',
    'arrived',
    'collected',
    'warehouse',
    'sanitised',
    'graded',
    'completed',
    'cancelled',
    'device_allocated',
    'courier_booked',
    'dispatched',
    'delivered',
    'delivery_courier_booked',
    'delivery_dispatched',
    'inventory'
);

-- Update Booking table to use new enum
ALTER TABLE "Booking" 
    ALTER COLUMN "status" TYPE "BookingStatus_new" 
    USING "status"::text::"BookingStatus_new";

-- Update Job table to use new enum
ALTER TABLE "Job" 
    ALTER COLUMN "status" TYPE "JobStatus_new" 
    USING "status"::text::"JobStatus_new";

-- Update JobStatusHistory table if it exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'JobStatusHistory') THEN
        ALTER TABLE "JobStatusHistory" 
            ALTER COLUMN "status" TYPE "JobStatus_new" 
            USING "status"::text::"JobStatus_new";
    END IF;
END $$;

-- Drop old enums
DROP TYPE "BookingStatus";
DROP TYPE "JobStatus";

-- Rename new enums to original names
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";
