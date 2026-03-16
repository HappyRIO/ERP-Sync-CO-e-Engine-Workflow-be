-- AlterEnum: Add missing enum values to BookingStatus and JobStatus
-- Note: PostgreSQL doesn't support IF NOT EXISTS for ALTER TYPE ADD VALUE
-- We use DO blocks to check if values exist before adding them

-- Add 'warehouse' status to BookingStatus (for ITAD and Leaver workflows)
-- This should be added after 'collected' and before 'sanitised' in the enum order
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'warehouse' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'BookingStatus')
    ) THEN
        ALTER TYPE "BookingStatus" ADD VALUE 'warehouse';
    END IF;
END $$;

-- Add 'delivery_scheduled' status to BookingStatus (for Breakfix re-delivery workflow)
-- This should be added after 'graded' in the enum order
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'delivery_scheduled' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'BookingStatus')
    ) THEN
        ALTER TYPE "BookingStatus" ADD VALUE 'delivery_scheduled';
    END IF;
END $$;

-- Add Breakfix re-delivery statuses to JobStatus
-- These should be added after 'graded' in the enum order
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'delivery_routed' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'JobStatus')
    ) THEN
        ALTER TYPE "JobStatus" ADD VALUE 'delivery_routed';
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'delivery_en_route' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'JobStatus')
    ) THEN
        ALTER TYPE "JobStatus" ADD VALUE 'delivery_en_route';
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'delivery_arrived' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'JobStatus')
    ) THEN
        ALTER TYPE "JobStatus" ADD VALUE 'delivery_arrived';
    END IF;
END $$;
