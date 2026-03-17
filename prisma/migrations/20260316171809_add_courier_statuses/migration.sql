/*
  Warnings:

  - The values [in_transit,quarantined] on the enum `BookingStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [quarantined] on the enum `JobStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "BookingStatus_new" AS ENUM ('pending', 'created', 'scheduled', 'collected', 'warehouse', 'sanitised', 'graded', 'completed', 'cancelled', 'device_allocated', 'courier_booked', 'dispatched', 'delivered', 'collection_scheduled', 'delivery_scheduled', 'inventory');
ALTER TABLE "Booking" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TABLE "BookingStatusHistory" ALTER COLUMN "status" TYPE "BookingStatus_new" USING ("status"::text::"BookingStatus_new");
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
ALTER TYPE "BookingStatus_new" RENAME TO "BookingStatus";
DROP TYPE "BookingStatus_old";
ALTER TABLE "Booking" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "JobStatus_new" AS ENUM ('booked', 'routed', 'en_route', 'arrived', 'collected', 'in_transit', 'warehouse', 'sanitised', 'graded', 'completed', 'cancelled', 'device_allocated', 'courier_booked', 'dispatched', 'delivered', 'delivery_routed', 'delivery_en_route', 'delivery_arrived', 'delivery_courier_booked', 'inventory');
ALTER TABLE "Job" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Job" ALTER COLUMN "status" TYPE "JobStatus_new" USING ("status"::text::"JobStatus_new");
ALTER TABLE "JobStatusHistory" ALTER COLUMN "status" TYPE "JobStatus_new" USING ("status"::text::"JobStatus_new");
ALTER TABLE "Evidence" ALTER COLUMN "status" TYPE "JobStatus_new" USING ("status"::text::"JobStatus_new");
ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";
DROP TYPE "JobStatus_old";
ALTER TABLE "Job" ALTER COLUMN "status" SET DEFAULT 'booked';
COMMIT;
