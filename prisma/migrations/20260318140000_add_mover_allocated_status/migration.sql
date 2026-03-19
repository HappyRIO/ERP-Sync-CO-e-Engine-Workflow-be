-- AlterEnum: Add mover_allocated to InventoryStatus (for mover booking device pool)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'mover_allocated'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'InventoryStatus')
    ) THEN
        ALTER TYPE "InventoryStatus" ADD VALUE 'mover_allocated';
    END IF;
END
$$;
