// Utility to sync booking and job statuses for existing data
import prisma from '../config/database';
import { BookingStatus, JobStatus } from '../types';
import { isValidBookingTransition, isValidJobTransition, isValidBookingTransitionForType, isValidJobTransitionForType } from '../middleware/workflow';

/**
 * Map job status to booking status
 */
function mapJobStatusToBookingStatus(jobStatus: JobStatus): BookingStatus | null {
  if (jobStatus === 'collected') {
    return 'collected';
  } else if (jobStatus === 'warehouse') {
    return 'warehouse';
  } else if (jobStatus === 'sanitised') {
    return 'sanitised';
  } else if (jobStatus === 'graded') {
    return 'graded';
  } else if (jobStatus === 'completed') {
    return 'completed';
  } else if (jobStatus === 'cancelled') {
    return 'cancelled';
  }
  return null;
}

/**
 * Map booking status to job status
 */
function mapBookingStatusToJobStatus(bookingStatus: BookingStatus, currentJobStatus: JobStatus): JobStatus | null {
  if (bookingStatus === 'scheduled') {
    return 'routed';
  } else if (bookingStatus === 'collected') {
    // If job is already at warehouse or beyond, keep it; otherwise set to collected
    if (['warehouse', 'sanitised', 'graded', 'completed'].includes(currentJobStatus)) {
      return null; // Don't update
    }
    return 'collected';
  } else if (bookingStatus === 'warehouse') {
    // If job is already at sanitised or beyond, keep it; otherwise set to warehouse
    if (['sanitised', 'graded', 'completed'].includes(currentJobStatus)) {
      return null; // Don't update
    }
    return 'warehouse';
  } else if (bookingStatus === 'sanitised') {
    return 'sanitised';
  } else if (bookingStatus === 'graded') {
    return 'graded';
  } else if (bookingStatus === 'completed') {
    return 'completed';
  } else if (bookingStatus === 'cancelled') {
    return 'cancelled';
  }
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
          // Synced job status
        } else {
          skippedCount++;
          // Skipped invalid transition
        }
      }
    }
  }

  return { syncedCount, skippedCount };
}

