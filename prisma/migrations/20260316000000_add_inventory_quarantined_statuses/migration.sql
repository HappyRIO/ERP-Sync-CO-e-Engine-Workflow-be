-- AlterEnum: Add inventory and quarantined statuses to BookingStatus and JobStatus
-- Note: PostgreSQL doesn't support IF NOT EXISTS for ALTER TYPE ADD VALUE
-- We use DO blocks to check if values exist before adding them

-- Add 'inventory' status to BookingStatus (for Leaver workflow - devices added to inventory for reuse)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'inventory' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'BookingStatus')
    ) THEN
        ALTER TYPE "BookingStatus" ADD VALUE 'inventory';
    END IF;
END $$;

-- Add 'quarantined' status to BookingStatus (for Leaver workflow - devices quarantined for disposal)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'quarantined' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'BookingStatus')
    ) THEN
        ALTER TYPE "BookingStatus" ADD VALUE 'quarantined';
    END IF;
END $$;

-- Add 'inventory' status to JobStatus (for Leaver workflow - devices added to inventory for reuse)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'inventory' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'JobStatus')
    ) THEN
        ALTER TYPE "JobStatus" ADD VALUE 'inventory';
    END IF;
END $$;

-- Add 'quarantined' status to JobStatus (for Leaver workflow - devices quarantined for disposal)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'quarantined' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'JobStatus')
    ) THEN
        ALTER TYPE "JobStatus" ADD VALUE 'quarantined';
    END IF;
END $$;
