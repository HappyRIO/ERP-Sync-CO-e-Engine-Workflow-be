// Transform database booking format to API response format
// Maps Prisma booking model to frontend-expected format

import { BookingStatus, JobStatus } from '../types';

export interface TransformedBooking {
  id: string;
  erpJobNumber: string; // Maps from bookingNumber or erpJobNumber
  status: string;
  estimatedCO2e: number;
  estimatedBuyback: number;
  charityPercent: number;
  createdAt: string;
  bookingNumber?: string;
  clientId?: string;
  clientName?: string;
  organisationName?: string; // Organisation/company name
  resellerId?: string;
  resellerName?: string;
  siteName?: string;
  siteAddress?: string;
  scheduledDate?: string;
  preferredVehicleType?: 'petrol' | 'diesel' | 'electric';
  roundTripDistanceKm?: number;
  roundTripDistanceMiles?: number;
  jobId?: string;
  jobStatus?: string;
  driverId?: string;
  driverName?: string;
  createdBy?: string;
  scheduledBy?: string;
  scheduledAt?: string;
  collectedAt?: string;
  sanitisedAt?: string;
  gradedAt?: string;
  completedAt?: string;
  cancellationNotes?: string; // Notes from cancellation status history
  assets?: Array<{
    id: string;
    categoryId: string;
    category: string;
    categoryName: string;
    quantity: number;
  }>;
}

/**
* Transform booking status from backend format to frontend format
*/
function transformStatus(status: BookingStatus): string {
  const statusMap: Record<BookingStatus, string> = {
    'pending': 'pending',
    'created': 'created',
    'scheduled': 'scheduled',
    'collected': 'collected',
    'sanitised': 'sanitised',
    'graded': 'graded',
    'completed': 'completed',
    'cancelled': 'cancelled',
  };
  
  return statusMap[status] || status;
}

/**
 * Transform job status from backend format to frontend format
 * (mirrors mapping in job-transform.ts)
 */
function transformJobStatus(status: JobStatus): string {
  const statusMap: Record<JobStatus, string> = {
    'booked': 'booked',
    'routed': 'routed',
    'en_route': 'en-route',
    'arrived': 'arrived',
    'collected': 'collected',
    'warehouse': 'warehouse',
    'sanitised': 'sanitised',
    'graded': 'graded',
    'completed': 'completed',
    'cancelled': 'cancelled',
  };

  return statusMap[status] || status;
}

/**
 * Transform a Prisma booking to API response format
 */
export function transformBookingForAPI(booking: any): TransformedBooking {
  return {
    id: booking.id,
    erpJobNumber: booking.erpJobNumber || booking.bookingNumber || booking.id, // Use erpJobNumber if available, fallback to bookingNumber
    status: transformStatus(booking.status),
    estimatedCO2e: booking.estimatedCO2e || 0,
    estimatedBuyback: booking.estimatedBuyback || 0,
    charityPercent: booking.charityPercent ?? 0,
    createdAt: booking.createdAt instanceof Date 
      ? booking.createdAt.toISOString() 
      : booking.createdAt,
    bookingNumber: booking.bookingNumber,
    clientId: booking.clientId,
    clientName: booking.client?.name || booking.clientName,
    organisationName: booking.client?.organisationName || undefined,
    resellerId: booking.resellerId,
    resellerName: booking.resellerName,
    siteName: booking.siteName,
    siteAddress: booking.siteAddress,
    scheduledDate: booking.scheduledDate instanceof Date
      ? booking.scheduledDate.toISOString()
      : booking.scheduledDate,
    preferredVehicleType: booking.preferredVehicleType,
    roundTripDistanceKm: booking.roundTripDistanceKm,
    roundTripDistanceMiles: booking.roundTripDistanceMiles,
    jobId: booking.jobId,
    jobStatus: booking.job ? transformJobStatus(booking.job.status) : undefined,
    driverId: booking.driverId,
    driverName: booking.driverName,
    createdBy: booking.createdBy,
    scheduledBy: booking.scheduledBy,
    scheduledAt: booking.scheduledAt instanceof Date
      ? booking.scheduledAt.toISOString()
      : booking.scheduledAt,
    collectedAt: booking.collectedAt instanceof Date
      ? booking.collectedAt.toISOString()
      : booking.collectedAt,
    sanitisedAt: booking.sanitisedAt instanceof Date
      ? booking.sanitisedAt.toISOString()
      : booking.sanitisedAt,
    gradedAt: booking.gradedAt instanceof Date
      ? booking.gradedAt.toISOString()
      : booking.gradedAt,
    completedAt: booking.completedAt instanceof Date
      ? booking.completedAt.toISOString()
      : booking.completedAt,
    cancellationNotes: (() => {
      // Find cancellation notes from status history
      if (booking.statusHistory && Array.isArray(booking.statusHistory)) {
        // Find the most recent cancelled status entry
        const cancelledHistory = booking.statusHistory.find((h: any) => 
          h.status === 'cancelled' || h.status === 'Cancelled'
        );
        if (cancelledHistory?.notes) {
          return cancelledHistory.notes;
        }
      }
      return undefined;
    })(),
    assets: (booking.assets || []).map((asset: any) => ({
      id: asset.id,
      categoryId: asset.categoryId,
      category: asset.categoryName || asset.category?.name,
      categoryName: asset.categoryName || asset.category?.name,
      quantity: asset.quantity,
    })),
  };
}

/**
 * Transform array of bookings
 */
export function transformBookingsForAPI(bookings: any[]): TransformedBooking[] {
  return bookings.map(transformBookingForAPI);
}

