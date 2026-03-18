// Transform database job format to API response format
// Maps Prisma job model to frontend-expected format

import { JobStatus } from '../types';
import { isS3Enabled, getPresignedUrl, extractS3KeyFromUrl } from './s3-storage';

export interface TransformedJob {
  id: string;
  erpJobNumber: string;
  bookingId?: string | null;
  organisationName: string; // Organisation/company name (from booking.client)
  createdByName?: string; // Booker name (from booking.creator)
  siteName: string;
  siteAddress: string;
  status: string; // Converted to frontend format (en-route instead of en_route)
  scheduledDate: string;
  completedDate?: string | null;
  assets: Array<{
    id: string;
    category: string; // categoryName
    quantity: number;
    serialNumbers?: string[];
    grade?: string | null;
    weight?: number | null;
    sanitised?: boolean;
    wipeMethod?: string | null;
    sanitisationRecordId?: string | null;
    gradingRecordId?: string | null;
    resaleValue?: number | null;
  }>;
  driver?: {
    id: string;
    name: string;
    vehicleReg: string;
    vehicleType: 'van' | 'truck' | 'car';
    vehicleFuelType?: 'petrol' | 'diesel' | 'electric';
    phone: string;
    eta?: string;
    isEtaDelayed?: boolean; // True if calculated ETA is in the past (driver should have arrived)
  } | null;
  co2eSaved: number;
  travelEmissions: number;
  buybackValue: number;
  charityPercent: number;
  roundTripDistanceKm?: number | null; // From booking
  roundTripDistanceMiles?: number | null; // From booking
  bookingType?: 'itad_collection' | 'jml'; // From booking
  jmlSubType?: 'new_starter' | 'leaver' | 'breakfix' | 'mover'; // From booking
  // Mover booking specific fields (from booking status history)
  currentAddress?: string;
  currentPostcode?: string;
  currentSiteName?: string;
  currentLat?: number;
  currentLng?: number;
  // Driver journey fields (entered before starting journey in routed status)
  dial2Collection?: string | null;
  securityRequirements?: string | null;
  idRequired?: string | null;
  loadingBayLocation?: string | null;
  vehicleHeightRestrictions?: string | null;
  doorLiftSize?: string | null;
  roadWorksPublicEvents?: string | null;
  manualHandlingRequirements?: string | null;
  evidence?: Array<{
    status: string; // Status for which this evidence was submitted
    photos: string[];
    signature?: string | null;
    sealNumbers: string[];
    notes?: string | null;
    createdAt: string;
  }> | null;
  certificates: Array<{
    type: string;
    generatedDate: string;
    downloadUrl: string;
  }>;
}

/**
 * Transform job status from backend format to frontend format
 */
function transformStatus(status: JobStatus): string {
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
 * Transform a Prisma job to API response format
 */
export function transformJobForAPI(job: any): TransformedJob {
  const result: TransformedJob = {
    id: job.id,
    erpJobNumber: job.erpJobNumber,
    bookingId: job.bookingId,
    organisationName: job.booking?.client?.organisationName || job.booking?.client?.name || job.clientName || '',
    createdByName: job.booking?.creator?.name ?? undefined,
    siteName: job.siteName,
    siteAddress: job.siteAddress,
    status: transformStatus(job.status),
    scheduledDate: job.scheduledDate instanceof Date 
      ? job.scheduledDate.toISOString() 
      : job.scheduledDate,
    completedDate: job.completedDate 
      ? (job.completedDate instanceof Date 
          ? job.completedDate.toISOString() 
          : job.completedDate)
      : null,
    assets: (job.assets || []).map((asset: any) => ({
      id: asset.id,
      category: asset.categoryName,
      categoryId: asset.categoryId, // Include categoryId for frontend matching
      categoryName: asset.categoryName, // Include categoryName for display
      quantity: asset.quantity,
      serialNumbers: asset.serialNumbers || [],
      grade: asset.grade,
      weight: asset.weight,
      sanitised: asset.sanitised || false,
      wipeMethod: asset.wipeMethod,
      sanitisationRecordId: asset.sanitisationRecordId,
      gradingRecordId: asset.gradingRecordId,
      resaleValue: asset.resaleValue,
    })),
    // Prefer full driver relation; if missing but booking has driver info, fall back to booking driver
    driver: (job.driver || job.booking?.driverId) ? (() => {
      const baseDriver = job.driver || {
        id: job.booking?.driverId,
        name: job.booking?.driverName || 'Assigned driver',
        driverProfile: null,
        vehicleDrivers: [],
        phone: null,
        email: null,
      };

      // Get the first vehicle assigned to the driver
      const firstVehicle = baseDriver.vehicleDrivers?.[0]?.vehicle;

      const driverData = {
        id: baseDriver.id,
        name: baseDriver.name,
        vehicleReg: firstVehicle?.vehicleReg ?? 'N/A',
        vehicleType: (firstVehicle?.vehicleType ?? 'van') as 'van' | 'truck' | 'car',
        vehicleFuelType: (firstVehicle?.vehicleFuelType ?? 'diesel') as 'petrol' | 'diesel' | 'electric',
        phone: baseDriver.driverProfile?.phone ?? baseDriver.phone ?? baseDriver.email ?? 'N/A',
      };

      let eta: string | undefined;
      let isEtaDelayed: boolean | undefined;
      const now = new Date();
      
      if (job.status === 'routed') {
        // Driver hasn't started traveling yet - no ETA available
        eta = undefined; // Will display as "--:--" on frontend
      } else if (job.status === 'en_route') {
        // Use stored ETA (calculated and saved when driver started)
        if (job.estimatedArrival) {
          const estimatedArrival = job.estimatedArrival instanceof Date 
            ? job.estimatedArrival 
            : new Date(job.estimatedArrival);
          
          eta = estimatedArrival.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          
          // Check if stored ETA is in the past (driver should have arrived but hasn't)
          isEtaDelayed = estimatedArrival < now;
        } else {
          // No stored ETA - use scheduled time as fallback (don't recalculate from current time)
          const scheduledDate = job.scheduledDate instanceof Date ? job.scheduledDate : new Date(job.scheduledDate);
          eta = scheduledDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          isEtaDelayed = scheduledDate < now;
        }
      }

      return {
        ...driverData,
        ...(eta ? { eta } : {}),
        ...(isEtaDelayed !== undefined ? { isEtaDelayed } : {}),
      };
    })() : null,
    co2eSaved: job.co2eSaved || 0,
    travelEmissions: job.travelEmissions || 0,
    buybackValue: job.buybackValue || 0,
    charityPercent: job.charityPercent || 0,
    roundTripDistanceKm: job.booking?.roundTripDistanceKm ?? null,
    roundTripDistanceMiles: job.booking?.roundTripDistanceMiles ?? null,
    bookingType: (job.booking?.bookingType === 'jml' ? 'jml' : 'itad_collection') as 'itad_collection' | 'jml',
    jmlSubType: job.booking?.jmlSubType || null,
    // Extract current address from booking status history for mover bookings
    ...(job.booking?.jmlSubType === 'mover' && job.booking?.statusHistory ? (() => {
      try {
        // Debug logging
        console.log('[Job Transform] Mover job detected, checking statusHistory:', {
          hasBooking: !!job.booking,
          jmlSubType: job.booking?.jmlSubType,
          hasStatusHistory: !!job.booking?.statusHistory,
          statusHistoryLength: job.booking?.statusHistory?.length || 0,
          statusHistoryEntries: job.booking?.statusHistory?.map((h: any) => ({
            status: h.status,
            hasNotes: !!h.notes,
            notesPreview: h.notes ? h.notes.substring(0, 100) : null,
          })) || [],
        });

        // Find the first status history entry that contains current address info
        const historyWithAddress = job.booking.statusHistory.find((h: any) => 
          h.notes && h.notes.includes('Current address:')
        );
        
        if (!historyWithAddress) {
          console.log('[Job Transform] No statusHistory entry found with "Current address:"');
          return {};
        }

        if (historyWithAddress?.notes) {
          console.log('[Job Transform] Found statusHistory with address, notes:', historyWithAddress.notes);
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
              console.log('[Job Transform] Extracted JSON string:', jsonString);
              const addressInfo = JSON.parse(jsonString);
              console.log('[Job Transform] Parsed address info:', addressInfo);
              const result = {
                currentAddress: addressInfo.currentAddress,
                currentPostcode: addressInfo.currentPostcode,
                currentSiteName: addressInfo.currentSiteName,
                currentLat: addressInfo.currentLat,
                currentLng: addressInfo.currentLng,
              };
              console.log('[Job Transform] Returning address fields:', result);
              return result;
            } else {
              console.log('[Job Transform] Failed to find complete JSON object');
            }
          } else {
            console.log('[Job Transform] "Current address:" prefix not found in notes');
          }
        }
      } catch (e) {
        // If parsing fails, return empty object
        console.error('[Job Transform] Failed to extract currentAddress from booking statusHistory:', e);
      }
      return {};
    })() : (() => {
      // Debug logging for non-mover or missing statusHistory
      if (job.booking?.jmlSubType === 'mover') {
        console.log('[Job Transform] Mover job but missing statusHistory:', {
          hasBooking: !!job.booking,
          hasStatusHistory: !!job.booking?.statusHistory,
        });
      }
      return {};
    })()),
    dial2Collection: job.dial2Collection ?? null,
    securityRequirements: job.securityRequirements ?? null,
    idRequired: job.idRequired ?? null,
    loadingBayLocation: job.loadingBayLocation ?? null,
    vehicleHeightRestrictions: job.vehicleHeightRestrictions ?? null,
    doorLiftSize: job.doorLiftSize ?? null,
    roadWorksPublicEvents: job.roadWorksPublicEvents ?? null,
    manualHandlingRequirements: job.manualHandlingRequirements ?? null,
    evidence: (() => {
      // Check if evidence exists and is an array
      if (!job.evidence) {
        return null;
      }
      
      // Since we need async operations, we'll handle evidence transformation differently
      // For now, return the structure - presigned URLs will be generated in the controller
      // This is a synchronous function, so we'll mark S3 URLs for later conversion
      if (!Array.isArray(job.evidence)) {
        // If evidence is a single object (shouldn't happen but handle it), convert to array
        if (job.evidence && typeof job.evidence === 'object') {
          return [job.evidence].map((ev: any) => {
            const photos = Array.isArray(ev.photos) 
              ? ev.photos.filter((p: any) => p && typeof p === 'string' && p.trim().length > 0)
              : [];
            const sealNumbers = Array.isArray(ev.sealNumbers)
              ? ev.sealNumbers.filter((s: any) => s && typeof s === 'string' && s.trim().length > 0)
              : [];
            return {
              status: transformStatus(ev.status),
              photos: photos,
              signature: (ev.signature && typeof ev.signature === 'string' && ev.signature.trim().length > 0) ? ev.signature : null,
              sealNumbers: sealNumbers,
              notes: (ev.notes && typeof ev.notes === 'string' && ev.notes.trim().length > 0) ? ev.notes : null,
              createdAt: ev.createdAt instanceof Date ? ev.createdAt.toISOString() : ev.createdAt,
            };
          });
        }
        return null;
      }
      
      if (job.evidence.length === 0) {
        return []; // Return empty array instead of null if evidence array exists but is empty
      }
      
      // Process each evidence record - don't filter out records, just clean the data
      // Note: Presigned URLs will be generated asynchronously in the controller
      return job.evidence.map((ev: any) => {
        // Ensure photos is always an array, filter out empty strings
        const photos = Array.isArray(ev.photos) 
          ? ev.photos.filter((p: any) => p && typeof p === 'string' && p.trim().length > 0)
          : [];
        
        // Ensure sealNumbers is always an array, filter out empty strings
        const sealNumbers = Array.isArray(ev.sealNumbers)
          ? ev.sealNumbers.filter((s: any) => s && typeof s === 'string' && s.trim().length > 0)
          : [];
        
        return {
          status: transformStatus(ev.status),
          photos: photos,
          signature: (ev.signature && typeof ev.signature === 'string' && ev.signature.trim().length > 0) ? ev.signature : null,
          sealNumbers: sealNumbers,
          notes: (ev.notes && typeof ev.notes === 'string' && ev.notes.trim().length > 0) ? ev.notes : null,
          createdAt: ev.createdAt instanceof Date ? ev.createdAt.toISOString() : ev.createdAt,
        };
      });
    })(),
      certificates: (job.certificates || []).map((cert: any) => ({
        type: cert.type.replace(/_/g, '-'), // chain_of_custody -> chain-of-custody
        generatedDate: cert.generatedDate instanceof Date
          ? cert.generatedDate.toISOString()
          : cert.generatedDate,
        downloadUrl: cert.downloadUrl,
      })),
  };
  
  // Debug: Log the final transformed object to verify currentAddress fields are included
  if (result.jmlSubType === 'mover') {
    console.log('[Job Transform] Final transformed object includes currentAddress fields:', {
      currentAddress: result.currentAddress,
      currentPostcode: result.currentPostcode,
      currentSiteName: result.currentSiteName,
      hasAllFields: !!(result.currentAddress && result.currentPostcode && result.currentSiteName),
    });
  }
  
  return result;
}

/**
 * Transform array of jobs
 */
export function transformJobsForAPI(jobs: any[]): TransformedJob[] {
  return jobs.map(transformJobForAPI);
}

/**
 * Convert S3 URLs/keys in evidence to presigned URLs (async)
 * This should be called after transformJobForAPI for jobs with evidence
 */
export async function processEvidenceUrls(job: TransformedJob): Promise<TransformedJob> {
  if (!job.evidence || job.evidence.length === 0) {
    return job;
  }

  const processedEvidence = await Promise.all(
    job.evidence.map(async (ev) => {
      // Process photo URLs
      const processedPhotos = await Promise.all(
        (ev.photos || []).map(async (photoUrl: string) => {
          return await convertToPresignedUrlIfNeeded(photoUrl);
        })
      );

      // Process signature URL
      const processedSignature = ev.signature
        ? await convertToPresignedUrlIfNeeded(ev.signature)
        : null;

      return {
        ...ev,
        photos: processedPhotos,
        signature: processedSignature,
      };
    })
  );

  return {
    ...job,
    evidence: processedEvidence,
  };
}

/**
 * Helper function to convert S3 URLs/keys to presigned URLs if needed
 */
async function convertToPresignedUrlIfNeeded(urlOrKey: string): Promise<string> {
  if (!isS3Enabled()) {
    // Not using S3, return as is (might be base64 or local file path)
    return urlOrKey;
  }

  // Check if it's already a base64 data URL - return as is
  if (urlOrKey.startsWith('data:')) {
    return urlOrKey;
  }

  // Check if it's an S3 key (starts with evidence/ or documents/)
  if (urlOrKey.startsWith('evidence/') || urlOrKey.startsWith('documents/')) {
    try {
      return await getPresignedUrl(urlOrKey, 3600); // 1 hour expiry
    } catch (error) {
      // If presigned URL generation fails, return original key
      return urlOrKey;
    }
  }

  // Check if it's an S3 URL (contains .s3. and amazonaws.com)
  if (urlOrKey.startsWith('https://') && urlOrKey.includes('.s3.') && urlOrKey.includes('amazonaws.com')) {
    // Extract S3 key from full URL
    const key = extractS3KeyFromUrl(urlOrKey);
    if (key) {
      try {
        return await getPresignedUrl(key, 3600); // 1 hour expiry
      } catch (error) {
        // If presigned URL generation fails, return original URL
        return urlOrKey;
      }
    }
  }

  // Not an S3 URL/key, return as is (might be local file path or base64)
  return urlOrKey;
}
