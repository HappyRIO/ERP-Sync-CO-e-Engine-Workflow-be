-- AlterEnum: Add missing enum values to JobStatus
-- Add Breakfix re-delivery statuses and in_transit status

-- Add 'in_transit' status to JobStatus (if not already present)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'in_transit' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'JobStatus')
    ) THEN
        ALTER TYPE "JobStatus" ADD VALUE 'in_transit';
    END IF;
END $$;

-- Add 'delivery_routed' status to JobStatus (for Breakfix re-delivery workflow)
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

-- Add 'delivery_en_route' status to JobStatus (for Breakfix re-delivery workflow)
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

-- Add 'delivery_arrived' status to JobStatus (for Breakfix re-delivery workflow)
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
