// Utility to sync booking and job statuses for existing data
import prisma from '../config/database';
import { BookingStatus, JobStatus } from '../types';
import { isValidBookingTransitionForType, isValidJobTransitionForType } from '../middleware/workflow';

/**
 * Map job status to booking status.
 * Covers ITAD and JML (device_allocated, courier_booked, dispatched, delivered).
 * delivery_courier_booked/delivery_dispatched have no booking equivalent (mover delivery phase).
 */
function mapJobStatusToBookingStatus(jobStatus: JobStatus): BookingStatus | null {
  if (jobStatus === 'routed') return 'scheduled';
  if (jobStatus === 'collected') return 'collected';
  if (jobStatus === 'warehouse') return 'warehouse';
  if (jobStatus === 'sanitised') return 'sanitised';
  if (jobStatus === 'graded') return 'graded';
  if (jobStatus === 'inventory') return 'inventory';
  if (jobStatus === 'completed') return 'completed';
  if (jobStatus === 'cancelled') return 'cancelled';
  // JML statuses: 1:1 mapping
  if (jobStatus === 'device_allocated') return 'device_allocated';
  if (jobStatus === 'courier_booked') return 'courier_booked';
  if (jobStatus === 'dispatched') return 'dispatched';
  if (jobStatus === 'delivered') return 'delivered';
  // Mover delivery phase: no booking status equivalent (booking stays at device_allocated/courier_booked until delivered)
  if (jobStatus === 'delivery_courier_booked' || jobStatus === 'delivery_dispatched') return null;
  return null;
}

/**
 * Map booking status to job status.
 * Covers ITAD and JML (device_allocated, courier_booked, dispatched, delivered).
 * collection_scheduled has no job status change (job remains booked/courier_booked until collected).
 */
function mapBookingStatusToJobStatus(bookingStatus: BookingStatus, currentJobStatus: JobStatus): JobStatus | null {
  if (bookingStatus === 'scheduled') return 'routed';
  if (bookingStatus === 'collected') {
    if (['warehouse', 'sanitised', 'graded', 'inventory', 'completed'].includes(currentJobStatus)) return null;
    return 'collected';
  }
  if (bookingStatus === 'warehouse') {
    if (['sanitised', 'graded', 'inventory', 'completed'].includes(currentJobStatus)) return null;
    return 'warehouse';
  }
  if (bookingStatus === 'sanitised') return 'sanitised';
  if (bookingStatus === 'graded') return 'graded';
  if (bookingStatus === 'inventory') {
    if (currentJobStatus === 'completed') return null;
    return 'inventory';
  }
  if (bookingStatus === 'completed') return 'completed';
  if (bookingStatus === 'cancelled') return 'cancelled';
  // JML statuses: 1:1 mapping
  if (bookingStatus === 'device_allocated') return 'device_allocated';
  if (bookingStatus === 'courier_booked') return 'courier_booked';
  if (bookingStatus === 'dispatched') return 'dispatched';
  if (bookingStatus === 'delivered') return 'delivered';
  // collection_scheduled: no job status (job stays booked/courier_booked until collection happens)
  return null;
}

/**
 * Sync all booking and job statuses
 */
export async function syncAllStatuses() {
  
  // Get all jobs with their bookings
  const jobs = await prisma.job.findMany({
    where: {
      bookingId: { not: null },
    },
    include: {
      booking: true,
    },
  });

  let syncedCount = 0;
  let skippedCount = 0;

  for (const job of jobs) {
    if (!job.booking) continue;

    const booking = job.booking;
    let updated = false;

    // Sync booking status from job status
    const bookingType = booking.bookingType || 'itad_collection';
    const jmlSubType = booking.jmlSubType;
    const targetBookingStatus = mapJobStatusToBookingStatus(job.status);
    if (targetBookingStatus && booking.status !== targetBookingStatus) {
      if (isValidBookingTransitionForType(booking.status, targetBookingStatus, bookingType, jmlSubType)) {
        const updateData: any = { status: targetBookingStatus };
        
        // Set appropriate timestamps
        if (targetBookingStatus === 'collected' && !booking.collectedAt) {
          updateData.collectedAt = new Date();
        } else if (targetBookingStatus === 'sanitised' && !booking.sanitisedAt) {
          updateData.sanitisedAt = new Date();
        } else if (targetBookingStatus === 'graded' && !booking.gradedAt) {
          updateData.gradedAt = new Date();
        } else if (targetBookingStatus === 'delivered' && !(booking as any).deliveryDate) {
          (updateData as any).deliveryDate = new Date();
        } else if (targetBookingStatus === 'completed' && !booking.completedAt) {
          updateData.completedAt = new Date();
        }

        await prisma.booking.update({
          where: { id: booking.id },
          data: updateData,
        });

        await prisma.bookingStatusHistory.create({
          data: {
            bookingId: booking.id,
            status: targetBookingStatus,
            changedBy: 'system',
            notes: `Synced from job status: ${job.status}`,
          },
        });

        updated = true;
        syncedCount++;
        // Synced booking status
      } else {
        skippedCount++;
        // Skipped invalid transition
      }
    }

    // Sync job status from booking status (only if booking was not just updated)
    if (!updated) {
      const bookingType = booking.bookingType || 'itad_collection';
      const jmlSubType = booking.jmlSubType;

      // Leaver/breakfix/mover (collection phase): when booking is collected and job is courier_booked, do two steps (dispatched → collected)
      const isLeaverBreakfixOrMoverCollected =
        booking.status === 'collected' &&
        bookingType === 'jml' &&
        (jmlSubType === 'leaver' || jmlSubType === 'breakfix' || jmlSubType === 'mover') &&
        job.status === 'courier_booked';

      if (isLeaverBreakfixOrMoverCollected) {
        if (
          isValidJobTransitionForType('courier_booked', 'dispatched', bookingType, jmlSubType) &&
          isValidJobTransitionForType('dispatched', 'collected', bookingType, jmlSubType)
        ) {
          await prisma.job.update({
            where: { id: job.id },
            data: { status: 'dispatched' },
          });
          await prisma.jobStatusHistory.create({
            data: {
              jobId: job.id,
              status: 'dispatched',
              changedBy: 'system',
              notes: `Synced from booking status: ${booking.status} (step 1/2)`,
            },
          });
          await prisma.job.update({
            where: { id: job.id },
            data: { status: 'collected' },
          });
          await prisma.jobStatusHistory.create({
            data: {
              jobId: job.id,
              status: 'collected',
              changedBy: 'system',
              notes: `Synced from booking status: ${booking.status} (step 2/2)`,
            },
          });
          syncedCount++;
        } else {
          skippedCount++;
        }
      } else {
        const targetJobStatus = mapBookingStatusToJobStatus(booking.status, job.status);
        if (targetJobStatus && job.status !== targetJobStatus) {
          if (isValidJobTransitionForType(job.status, targetJobStatus, bookingType, jmlSubType)) {
            const updateData: any = { status: targetJobStatus };

            if (targetJobStatus === 'completed' && !job.completedDate) {
              updateData.completedDate = new Date();
            }

            await prisma.job.update({
              where: { id: job.id },
              data: updateData,
            });

            await prisma.jobStatusHistory.create({
              data: {
                jobId: job.id,
                status: targetJobStatus,
                changedBy: 'system',
                notes: `Synced from booking status: ${booking.status}`,
              },
            });

            syncedCount++;
          } else {
            skippedCount++;
          }
        }
      }
    }
  }

  return { syncedCount, skippedCount };
}

