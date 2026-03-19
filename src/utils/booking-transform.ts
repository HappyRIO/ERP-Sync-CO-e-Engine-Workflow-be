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
  createdByName?: string;
  scheduledBy?: string;
  scheduledAt?: string;
  collectedAt?: string;
  sanitisedAt?: string;
  gradedAt?: string;
  completedAt?: string;
  cancellationNotes?: string; // Notes from cancellation status history
  bookingType?: 'itad_collection' | 'jml';
  jmlSubType?: 'new_starter' | 'leaver' | 'breakfix' | 'mover';
  employeeName?: string;
  employeeEmail?: string;
  employeePhone?: string;
  startDate?: string;
  deviceType?: string;
  courierTracking?: string;
  courierService?: string;
  collectionCourierTracking?: string;
  collectionCourierService?: string;
  deliveryDate?: string;
  // Mover booking specific fields
  currentAddress?: string;
  currentPostcode?: string;
  currentSiteName?: string;
  currentLat?: number;
  currentLng?: number;
  statusHistory?: Array<{
    id: string;
    status: string;
    changedBy?: string;
    notes?: string;
    createdAt: string;
  }>;
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
    'warehouse': 'warehouse',
    'sanitised': 'sanitised',
    'graded': 'graded',
    'completed': 'completed',
    'cancelled': 'cancelled',
    'device_allocated': 'device_allocated',
    'courier_booked': 'courier_booked',
    'dispatched': 'dispatched',
    'delivered': 'delivered',
    'collection_scheduled': 'collection_scheduled',
    'inventory': 'inventory',
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
    'device_allocated': 'device-allocated',
    'courier_booked': 'courier-booked',
    'dispatched': 'dispatched',
    'delivered': 'delivered',
    'delivery_courier_booked': 'delivery-courier-booked',
    'delivery_dispatched': 'delivery-dispatched',
    'inventory': 'inventory',
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
    createdByName: booking.creator?.name ?? undefined,
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
    bookingType: (booking.bookingType === 'jml' ? 'jml' : 'itad_collection') as 'itad_collection' | 'jml',
    jmlSubType: booking.jmlSubType || undefined,
    employeeName: booking.employeeName,
    employeeEmail: booking.employeeEmail,
    employeePhone: booking.employeePhone,
    startDate: booking.startDate instanceof Date
      ? booking.startDate.toISOString()
      : booking.startDate,
    deviceType: booking.deviceType,
    courierTracking: booking.courierTracking,
    courierService: booking.courierService,
    collectionCourierTracking: (booking as any).collectionCourierTracking ?? undefined,
    collectionCourierService: (booking as any).collectionCourierService ?? undefined,
    deliveryDate: booking.deliveryDate instanceof Date
      ? booking.deliveryDate.toISOString()
      : booking.deliveryDate,
    // Extract current address from status history for mover bookings
    ...(booking.jmlSubType === 'mover' && booking.statusHistory ? (() => {
      try {
        // Find the first status history entry that contains current address info
        const historyWithAddress = booking.statusHistory.find((h: any) => 
          h.notes && h.notes.includes('Current address:')
        );
        if (historyWithAddress?.notes) {
          // Extract JSON object after "Current address: "
          // The JSON string starts after "Current address: " and goes to the end or until next period
          const addressPrefix = 'Current address: ';
          const prefixIndex = historyWithAddress.notes.indexOf(addressPrefix);
          if (prefixIndex !== -1) {
            const jsonStart = prefixIndex + addressPrefix.length;
            // Find the JSON object - it starts with { and we need to find the matching }
            let braceCount = 0;
            let jsonEnd = jsonStart;
            for (let i = jsonStart; i < historyWithAddress.notes.length; i++) {
              if (historyWithAddress.notes[i] === '{') braceCount++;
              if (historyWithAddress.notes[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                  jsonEnd = i + 1;
                  break;
                }
              }
            }
            if (jsonEnd > jsonStart) {
              const jsonString = historyWithAddress.notes.substring(jsonStart, jsonEnd);
              const addressInfo = JSON.parse(jsonString);
              return {
                currentAddress: addressInfo.currentAddress,
                currentPostcode: addressInfo.currentPostcode,
                currentSiteName: addressInfo.currentSiteName,
                currentLat: addressInfo.currentLat,
                currentLng: addressInfo.currentLng,
              };
            }
          }
        }
      } catch (e) {
        // If parsing fails, return empty object
        console.error('Failed to extract currentAddress from booking statusHistory:', e);
      }
      return {};
    })() : {}),
    statusHistory: (booking.statusHistory || []).map((h: any) => ({
      id: h.id,
      status: transformStatus(h.status),
      changedBy: h.changedBy,
      notes: h.notes,
      createdAt: h.createdAt instanceof Date
        ? h.createdAt.toISOString()
        : h.createdAt,
    })),
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

