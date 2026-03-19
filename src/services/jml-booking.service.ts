// JML Booking Service
// Handles JML (Joiners, Leavers, Movers) booking workflows

import { BookingRepository } from '../repositories/booking.repository';
import { InventorySyncService } from './inventory-sync.service';
import { SerialReuseService } from './serial-reuse.service';
import { CO2Service } from './co2.service';
import { BuybackService } from './buyback.service';
import { mockERPService } from './mock-erp.service';
import { ValidationError, NotFoundError } from '../utils/errors';
import { calculateRoadDistance } from '../utils/routing';
import { kmToMiles } from '../utils/co2';
import { config } from '../config/env';
import prisma from '../config/database';
import { BookingStatus, BookingType, JMLSubType, JobStatus } from '@prisma/client';
import { getNextValidBookingStatusesForType, isValidJobTransitionForType } from '../middleware/workflow';
import { JobRepository } from '../repositories/job.repository';
import { JobService } from './job.service';
import {
  isJmlAccessoryOnlyLabel,
  resolveAssetCategoryForJmlDeviceLabel,
} from '../utils/jml-asset-category';

const bookingRepo = new BookingRepository();
const jobRepo = new JobRepository();
const inventoryService = new InventorySyncService();
const serialReuseService = new SerialReuseService();
const co2Service = new CO2Service();
const buybackService = new BuybackService();

const jobService = new JobService();

async function syncJobStatusFromBooking(
  bookingId: string,
  newStatus: BookingStatus,
  changedBy: string
) {
  const job = await jobRepo.findByBookingId(bookingId);
  if (!job) {
    return;
  }

  // Leaver/breakfix/mover (collection phase): booking → collected while job is courier_booked → advance job in two steps (like booking.service)
  if (newStatus === 'collected' && job.status === 'courier_booked') {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { bookingType: true, jmlSubType: true },
    });
    const bookingType = (booking?.bookingType || 'itad_collection') as BookingType;
    const jmlSubType = booking?.jmlSubType ?? null;
    const needsTwoStep =
      bookingType === 'jml' &&
      (jmlSubType === 'leaver' || jmlSubType === 'breakfix' || jmlSubType === 'mover');
    if (
      needsTwoStep &&
      isValidJobTransitionForType('courier_booked', 'dispatched', bookingType, jmlSubType) &&
      isValidJobTransitionForType('dispatched', 'collected', bookingType, jmlSubType)
    ) {
      await jobService.updateStatus(
        job.id,
        'dispatched',
        changedBy,
        `Updated from booking status: ${newStatus} (step 1/2)`,
        { skipSyncToBooking: true }
      );
      await jobService.updateStatus(
        job.id,
        'collected',
        changedBy,
        `Updated from booking status: ${newStatus} (step 2/2)`
      );
      return;
    }
  }

  let targetJobStatus: JobStatus | null = null;

  if (newStatus === 'created') {
    targetJobStatus = 'booked';
  } else if (newStatus === 'scheduled') {
    targetJobStatus = 'routed';
  } else if (newStatus === 'collected') {
    if (['warehouse', 'sanitised', 'graded', 'completed', 'inventory'].includes(job.status as JobStatus)) {
      targetJobStatus = null;
    } else {
      targetJobStatus = 'collected';
    }
  } else if (newStatus === 'warehouse') {
    if (['sanitised', 'graded', 'completed', 'inventory'].includes(job.status as JobStatus)) {
      targetJobStatus = null;
    } else {
      targetJobStatus = 'warehouse';
    }
  } else if (newStatus === 'sanitised') {
    targetJobStatus = 'sanitised';
  } else if (newStatus === 'graded') {
    targetJobStatus = 'graded';
  } else if (newStatus === 'completed') {
    targetJobStatus = 'completed';
  } else if (newStatus === 'cancelled') {
    targetJobStatus = 'cancelled';
  } else if (newStatus === 'device_allocated') {
    targetJobStatus = 'device_allocated';
  } else if (newStatus === 'courier_booked') {
    const bookingRow = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { bookingType: true, jmlSubType: true },
    });
    const bType = (bookingRow?.bookingType || 'itad_collection') as BookingType;
    const jSub = bookingRow?.jmlSubType ?? null;
    // Mover delivery leg: job workflow uses delivery_courier_booked (not courier_booked)
    if (bType === 'jml' && jSub === 'mover' && job.status === 'device_allocated') {
      targetJobStatus = 'delivery_courier_booked' as JobStatus;
    } else {
      targetJobStatus = 'courier_booked';
    }
  } else if (newStatus === 'dispatched') {
    const bookingRow = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { bookingType: true, jmlSubType: true },
    });
    const bType = (bookingRow?.bookingType || 'itad_collection') as BookingType;
    const jSub = bookingRow?.jmlSubType ?? null;
    if (bType === 'jml' && jSub === 'mover' && job.status === 'delivery_courier_booked') {
      targetJobStatus = 'delivery_dispatched' as JobStatus;
    } else {
      targetJobStatus = 'dispatched';
    }
  } else if (newStatus === 'delivered') {
    targetJobStatus = 'delivered';
  } else if (newStatus === 'inventory') {
    targetJobStatus = 'inventory';
  } else if (newStatus === 'collection_scheduled') {
    // Leaver/mover: collection scheduled = courier booked for collection
    targetJobStatus = 'courier_booked';
  }

  if (targetJobStatus && job.status !== targetJobStatus) {
    await jobService.updateStatus(
      job.id,
      targetJobStatus as any,
      changedBy,
      `Updated from booking status: ${newStatus}`
    );
  }
}

export class JMLBookingService {
  /**
   * Create a new starter booking
   */
  async createNewStarterBooking(data: {
    clientId?: string;
    clientName: string;
    tenantId: string;
    employeeName: string;
    email: string;
    address: string;
    postcode: string;
    phone: string;
    startDate: Date;
    deviceType: 'Windows' | 'Apple' | 'Android';
    siteName: string;
    devices?: Array<{
      category: string;
      make: string;
      model: string;
      quantity: number;
      deviceType: 'Windows' | 'Apple' | 'Android';
      notes?: string;
    }>;
    lat?: number;
    lng?: number;
    createdBy: string;
  }) {
    // Validate start date (min 5 working days notice)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(data.startDate);
    startDate.setHours(0, 0, 0, 0);

    // Calculate working days (excluding weekends)
    let workingDays = 0;
    const checkDate = new Date(today);
    while (checkDate < startDate) {
      const dayOfWeek = checkDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workingDays++;
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }

    if (workingDays < 5) {
      throw new ValidationError('Start date must be at least 5 working days from today');
    }

    // Ensure Client record exists (same logic as ITAD booking service)
    let actualClientId: string;
    
    if (data.clientId) {
      const existingClient = await prisma.client.findFirst({
        where: { 
          id: data.clientId,
          tenantId: data.tenantId,
        },
      });
      
      if (existingClient) {
        actualClientId = existingClient.id;
      } else {
        const newClient = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || 'Client',
            status: 'active',
          },
        });
        actualClientId = newClient.id;
      }
    } else {
      // No clientId provided - find or create client for the user
      const user = await prisma.user.findUnique({
        where: { id: data.createdBy },
        select: { email: true, name: true },
      });

      if (!user) {
        throw new NotFoundError('User', data.createdBy);
      }

      // Try to find existing client by email
      let client = await prisma.client.findFirst({
        where: {
          tenantId: data.tenantId,
          email: user.email,
        },
      });

      if (!client) {
        // Create new client for this user
        client = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || user.name || 'Client',
            email: user.email,
            status: 'active',
          },
        });
      }

      actualClientId = client.id;
    }

    // Generate booking number
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 100000);
    const bookingNumber = `JML-NS-${year}-${String(random).padStart(5, '0')}`;

    // Calculate round trip distance: (warehouse → delivery) * 2
    let roundTripDistanceKm = 0;
    let roundTripDistanceMiles = 0;
    if (data.lat && data.lng) {
      try {
        const oneWayDistanceKm = await calculateRoadDistance(
          config.warehouse.lat,
          config.warehouse.lng,
          data.lat,
          data.lng,
          config.routing?.openRouteServiceApiKey
        );
        roundTripDistanceKm = oneWayDistanceKm * 2; // Round trip: warehouse → delivery → warehouse
        roundTripDistanceMiles = kmToMiles(roundTripDistanceKm);
      } catch (error) {
        console.error('Error calculating round trip distance for new starter booking:', error);
        // Set to 0 if calculation fails
        roundTripDistanceKm = 0;
        roundTripDistanceMiles = 0;
      }
    }

    // Create booking
    const booking = await bookingRepo.create({
      bookingNumber,
      clientId: actualClientId,
      tenantId: data.tenantId,
      siteName: data.siteName,
      siteAddress: data.address,
      postcode: data.postcode,
      lat: data.lat,
      lng: data.lng,
      scheduledDate: data.startDate,
      status: 'pending',
      charityPercent: 0,
      estimatedCO2e: 0, // Will be calculated when device is allocated
      estimatedBuyback: 0,
      roundTripDistanceKm,
      roundTripDistanceMiles,
      bookingType: 'jml',
      jmlSubType: 'new_starter',
      employeeName: data.employeeName,
      employeeEmail: data.email,
      employeePhone: data.phone,
      startDate: data.startDate,
      deviceType: data.deviceType,
      createdBy: data.createdBy,
    });

    // Create BookingAsset records for devices
    if (data.devices && data.devices.length > 0) {
      for (const device of data.devices) {
        if (isJmlAccessoryOnlyLabel(device.category)) continue;
        const category = await resolveAssetCategoryForJmlDeviceLabel(device.category);
        if (category) {
          await prisma.bookingAsset.create({
            data: {
              bookingId: booking.id,
              categoryId: category.id,
              categoryName: category.name,
              quantity: device.quantity,
            },
          });
        }
      }
    }

    // Store device details in status history notes as JSON for retrieval
    if (data.devices && data.devices.length > 0) {
      const deviceDetails = JSON.stringify(data.devices.map(d => ({
        category: d.category,
        make: d.make,
        model: d.model,
        quantity: d.quantity,
        deviceType: d.deviceType,
        notes: d.notes,
      })));
      await bookingRepo.addStatusHistory(booking.id, {
        status: 'pending',
        changedBy: data.createdBy,
        notes: `New starter booking created. Device details: ${deviceDetails}`,
      });
    } else {
      // Add status history
      await bookingRepo.addStatusHistory(booking.id, {
        status: 'pending',
        changedBy: data.createdBy,
        notes: 'New starter booking created',
      });
    }

    // Create ERP order (same as ITAD workflow)
    try {
      const erpResponse = await mockERPService.createJob({
        clientName: data.clientName,
        siteName: data.siteName,
        siteAddress: data.address,
        scheduledDate: data.startDate.toISOString(),
        assets: [], // No assets yet - will be added when device is allocated
      });

      await bookingRepo.update(booking.id, {
        erpJobNumber: erpResponse.jobNumber,
      });
    } catch (error) {
      // Log error but don't fail booking creation
      const { logger } = await import('../utils/logger');
      logger.warn('Failed to create ERP order for new starter booking', {
        bookingId: booking.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return this.getBookingById(booking.id);
  }

  /**
   * Create a leaver booking
   */
  async createLeaverBooking(data: {
    clientId?: string;
    clientName: string;
    tenantId: string;
    leaverName: string;
    address: string;
    postcode: string;
    personalEmail: string;
    phone: string;
    leavingDate: Date;
    siteName: string;
    devices?: Array<{
      category: string;
      make: string;
      model: string;
      quantity: number;
      deviceType: 'Windows' | 'Apple' | 'Android';
      notes?: string;
    }>;
    lat?: number;
    lng?: number;
    createdBy: string;
    charityPercent?: number;
    preferredVehicleType?: string;
    assets?: Array<{ categoryId: string; quantity: number }>; // For CO2/buyback calculations
  }) {
    // Ensure Client record exists (same logic as ITAD booking service)
    let actualClientId: string;
    
    if (data.clientId) {
      const existingClient = await prisma.client.findFirst({
        where: { 
          id: data.clientId,
          tenantId: data.tenantId,
        },
      });
      
      if (existingClient) {
        actualClientId = existingClient.id;
      } else {
        const newClient = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || 'Client',
            status: 'active',
          },
        });
        actualClientId = newClient.id;
      }
    } else {
      // No clientId provided - find or create client for the user
      const user = await prisma.user.findUnique({
        where: { id: data.createdBy },
        select: { email: true, name: true },
      });

      if (!user) {
        throw new NotFoundError('User', data.createdBy);
      }

      let client = await prisma.client.findFirst({
        where: {
          tenantId: data.tenantId,
          email: user.email,
        },
      });

      if (!client) {
        client = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || user.name || 'Client',
            email: user.email,
            status: 'active',
          },
        });
      }

      actualClientId = client.id;
    }

    // Generate booking number
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 100000);
    const bookingNumber = `JML-LV-${year}-${String(random).padStart(5, '0')}`;

    // Calculate round trip distance: (warehouse → collection) * 2
    let roundTripDistanceKm = 0;
    let roundTripDistanceMiles = 0;
    if (data.lat && data.lng) {
      try {
        const oneWayDistanceKm = await calculateRoadDistance(
          config.warehouse.lat,
          config.warehouse.lng,
          data.lat,
          data.lng,
          config.routing?.openRouteServiceApiKey
        );
        roundTripDistanceKm = oneWayDistanceKm * 2; // Round trip: warehouse → collection → warehouse
        roundTripDistanceMiles = kmToMiles(roundTripDistanceKm);
      } catch (error) {
        console.error('Error calculating round trip distance for leaver booking:', error);
        // Set to 0 if calculation fails
        roundTripDistanceKm = 0;
        roundTripDistanceMiles = 0;
      }
    }

    // Calculate CO2e and buyback for Leaver bookings (similar to ITAD)
    let estimatedCO2e = 0;
    let estimatedBuyback = 0;
    
    if (data.assets && data.assets.length > 0) {
      // Calculate CO2e
      const co2Result = await co2Service.calculateBookingCO2e({
        assets: data.assets,
        collectionLat: data.lat,
        collectionLng: data.lng,
        vehicleType: data.preferredVehicleType as any,
        tenantId: data.tenantId,
      });
      estimatedCO2e = co2Result.reuseSavings;
      
      // Use calculated distance if available, otherwise use the one we calculated above
      if (co2Result.distanceKm > 0) {
        roundTripDistanceKm = co2Result.distanceKm;
        roundTripDistanceMiles = co2Result.distanceMiles;
      }

      // Calculate buyback estimate
      estimatedBuyback = await buybackService.calculateBuybackEstimate({
        assets: data.assets,
      });
    }

    // Create booking
    const booking = await bookingRepo.create({
      bookingNumber,
      clientId: actualClientId,
      tenantId: data.tenantId,
      siteName: data.siteName,
      siteAddress: data.address,
      postcode: data.postcode,
      lat: data.lat,
      lng: data.lng,
      scheduledDate: data.leavingDate, // Collection will be scheduled after leaving date
      status: 'pending',
      charityPercent: data.charityPercent || 0,
      estimatedCO2e,
      estimatedBuyback,
      preferredVehicleType: data.preferredVehicleType,
      roundTripDistanceKm,
      roundTripDistanceMiles,
      bookingType: 'jml',
      jmlSubType: 'leaver',
      employeeName: data.leaverName,
      employeeEmail: data.personalEmail,
      employeePhone: data.phone,
      createdBy: data.createdBy,
    });

    // Create BookingAsset records for devices
    if (data.devices && data.devices.length > 0) {
      for (const device of data.devices) {
        if (isJmlAccessoryOnlyLabel(device.category)) continue;
        const category = await resolveAssetCategoryForJmlDeviceLabel(device.category);
        if (category) {
          await prisma.bookingAsset.create({
            data: {
              bookingId: booking.id,
              categoryId: category.id,
              categoryName: category.name,
              quantity: device.quantity,
            },
          });
        }
      }
    }

    // Store device details in status history notes as JSON for retrieval
    if (data.devices && data.devices.length > 0) {
      const deviceDetails = JSON.stringify(data.devices.map(d => ({
        category: d.category,
        make: d.make,
        model: d.model,
        quantity: d.quantity,
        deviceType: d.deviceType,
        notes: d.notes,
      })));
      await bookingRepo.addStatusHistory(booking.id, {
        status: 'pending',
        changedBy: data.createdBy,
        notes: `Leaver booking created - team will contact after leaving date. Device details: ${deviceDetails}`,
      });
    } else {
      // Add status history
      await bookingRepo.addStatusHistory(booking.id, {
        status: 'pending',
        changedBy: data.createdBy,
        notes: 'Leaver booking created - team will contact after leaving date',
      });
    }

    return this.getBookingById(booking.id);
  }

  /**
   * Create a breakfix booking
   */
  async createBreakfixBooking(data: {
    clientId?: string;
    clientName: string;
    tenantId: string;
    employeeName: string;
    email: string;
    address: string;
    postcode: string;
    phone: string;
    siteName: string;
    // Replacement device requirements (what admin allocates from inventory)
    devices?: Array<{
      category: string;
      make: string;
      model: string;
      quantity: number;
      deviceType: 'Windows' | 'Apple' | 'Android';
      notes?: string;
    }>;
    brokenDevices: Array<{
      category: string;
      make: string;
      model: string;
      quantity: number;
      deviceType: 'Windows' | 'Apple' | 'Android';
      notes?: string;
    }>;
    deviceType: 'Windows' | 'Apple' | 'Android';
    lat?: number;
    lng?: number;
    createdBy: string;
  }) {
    // Ensure Client record exists (same logic as ITAD booking service)
    let actualClientId: string;
    
    if (data.clientId) {
      const existingClient = await prisma.client.findFirst({
        where: { 
          id: data.clientId,
          tenantId: data.tenantId,
        },
      });
      
      if (existingClient) {
        actualClientId = existingClient.id;
      } else {
        const newClient = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || 'Client',
            status: 'active',
          },
        });
        actualClientId = newClient.id;
      }
    } else {
      // No clientId provided - find or create client for the user
      const user = await prisma.user.findUnique({
        where: { id: data.createdBy },
        select: { email: true, name: true },
      });

      if (!user) {
        throw new NotFoundError('User', data.createdBy);
      }

      let client = await prisma.client.findFirst({
        where: {
          tenantId: data.tenantId,
          email: user.email,
        },
      });

      if (!client) {
        client = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || user.name || 'Client',
            email: user.email,
            status: 'active',
          },
        });
      }

      actualClientId = client.id;
    }

    // Generate booking number
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 100000);
    const bookingNumber = `JML-BF-${year}-${String(random).padStart(5, '0')}`;

    // Calculate round trip distance: (warehouse → collection/delivery) * 2
    // For breakfix: collection and delivery are at the same address
    let roundTripDistanceKm = 0;
    let roundTripDistanceMiles = 0;
    if (data.lat && data.lng) {
      try {
        const oneWayDistanceKm = await calculateRoadDistance(
          config.warehouse.lat,
          config.warehouse.lng,
          data.lat,
          data.lng,
          config.routing?.openRouteServiceApiKey
        );
        roundTripDistanceKm = oneWayDistanceKm * 2; // Round trip: warehouse → address → warehouse
        roundTripDistanceMiles = kmToMiles(roundTripDistanceKm);
      } catch (error) {
        console.error('Error calculating round trip distance for breakfix booking:', error);
        // Set to 0 if calculation fails
        roundTripDistanceKm = 0;
        roundTripDistanceMiles = 0;
      }
    }

    // Create booking for breakfix (combines new starter + leaver)
    const booking = await bookingRepo.create({
      bookingNumber,
      clientId: actualClientId,
      tenantId: data.tenantId,
      siteName: data.siteName,
      siteAddress: data.address,
      postcode: data.postcode,
      lat: data.lat,
      lng: data.lng,
      scheduledDate: new Date(), // Immediate
      status: 'pending',
      charityPercent: 0,
      estimatedCO2e: 0,
      estimatedBuyback: 0,
      roundTripDistanceKm,
      roundTripDistanceMiles,
      bookingType: 'jml',
      jmlSubType: 'breakfix',
      employeeName: data.employeeName,
      employeeEmail: data.email,
      employeePhone: data.phone,
      deviceType: data.deviceType,
      createdBy: data.createdBy,
    });

    // Create BookingAsset records for broken devices
    if (data.brokenDevices && data.brokenDevices.length > 0) {
      for (const device of data.brokenDevices) {
        if (isJmlAccessoryOnlyLabel(device.category)) continue;
        const category = await resolveAssetCategoryForJmlDeviceLabel(device.category);
        if (category) {
          await prisma.bookingAsset.create({
            data: {
              bookingId: booking.id,
              categoryId: category.id,
              categoryName: category.name,
              quantity: device.quantity,
            },
          });
        }
      }
    }

    // Store BOTH replacement requirements (for admin allocation) and broken devices (for admin grading).
    //
    // - Grading.tsx expects device make/model under `Device details:` (currently implemented).
    //   So for breakfix we keep `Device details:` tied to the broken devices being processed.
    // - DeviceAllocation.tsx should use replacement requirements for allocating replacement devices,
    //   so we store them under a separate marker: `Replacement Device details:`.
    const brokenDevicesInfo = data.brokenDevices
      .map(d => `${d.make} ${d.model} (x${d.quantity})`)
      .join(', ');

    const replacementDevices = data.devices && data.devices.length > 0 ? data.devices : data.brokenDevices;
    const brokenDeviceDetails = JSON.stringify(data.brokenDevices.map(d => ({
      category: d.category,
      make: d.make,
      model: d.model,
      quantity: d.quantity,
      deviceType: d.deviceType,
      notes: d.notes,
    })));
    const replacementDeviceDetails = JSON.stringify(replacementDevices.map(d => ({
      category: d.category,
      make: d.make,
      model: d.model,
      quantity: d.quantity,
      deviceType: d.deviceType,
      notes: d.notes,
    })));
    await bookingRepo.addStatusHistory(booking.id, {
      status: 'pending',
      changedBy: data.createdBy,
      notes: `Breakfix booking created - broken devices: ${brokenDevicesInfo}. Device details: ${brokenDeviceDetails}. Replacement Device details: ${replacementDeviceDetails}`,
    });

    // Create ERP order
    try {
      const erpResponse = await mockERPService.createJob({
        clientName: data.clientName,
        siteName: data.siteName,
        siteAddress: data.address,
        scheduledDate: new Date().toISOString(),
        assets: [],
      });

      await bookingRepo.update(booking.id, {
        erpJobNumber: erpResponse.jobNumber,
      });
    } catch (error) {
      const { logger } = await import('../utils/logger');
      logger.warn('Failed to create ERP order for breakfix booking', {
        bookingId: booking.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return this.getBookingById(booking.id);
  }

  /**
   * Create a mover booking (employee department change)
   */
  async createMoverBooking(data: {
    clientId?: string;
    clientName: string;
    tenantId: string;
    employeeName: string;
    email: string;
    address: string; // New address (delivery)
    postcode: string; // New address postcode
    phone: string;
    siteName: string; // New address site name
    scheduledDate: Date; // Move date
    currentAddress?: string; // Current address (collection) - optional for backward compatibility
    currentPostcode?: string; // Current address postcode
    currentSiteName?: string; // Current address site name
    currentLat?: number; // Current address latitude
    currentLng?: number; // Current address longitude
    currentDevices: Array<{
      category: string;
      make: string;
      model: string;
      quantity: number;
      deviceType: 'Windows' | 'Apple' | 'Android';
      notes?: string;
    }>;
    deviceType: 'Windows' | 'Apple' | 'Android';
    lat?: number; // New address latitude
    lng?: number; // New address longitude
    createdBy: string;
  }) {
    // Ensure Client record exists (same logic as ITAD booking service)
    let actualClientId: string;
    
    if (data.clientId) {
      const existingClient = await prisma.client.findFirst({
        where: { 
          id: data.clientId,
          tenantId: data.tenantId,
        },
      });
      
      if (existingClient) {
        actualClientId = existingClient.id;
      } else {
        const newClient = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || 'Client',
            status: 'active',
          },
        });
        actualClientId = newClient.id;
      }
    } else {
      // No clientId provided - find or create client for the user
      const user = await prisma.user.findUnique({
        where: { id: data.createdBy },
        select: { email: true, name: true },
      });

      if (!user) {
        throw new NotFoundError('User', data.createdBy);
      }

      let client = await prisma.client.findFirst({
        where: {
          tenantId: data.tenantId,
          email: user.email,
        },
      });

      if (!client) {
        client = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || user.name || 'Client',
            email: user.email,
            status: 'active',
          },
        });
      }

      actualClientId = client.id;
    }

    // Generate booking number
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 100000);
    const bookingNumber = `JML-MV-${year}-${String(random).padStart(5, '0')}`;

    // Calculate round trip distance for mover:
    // warehouse → current address + current address → new address + new address → warehouse
    let roundTripDistanceKm = 0;
    let roundTripDistanceMiles = 0;
    
    // If we have both addresses, calculate multi-leg journey
    if (data.currentLat && data.currentLng && data.lat && data.lng) {
      try {
        // Leg 1: warehouse → current address (collection)
        const warehouseToCurrentKm = await calculateRoadDistance(
          config.warehouse.lat,
          config.warehouse.lng,
          data.currentLat,
          data.currentLng,
          config.routing?.openRouteServiceApiKey
        );
        
        // Leg 2: current address → new address (delivery)
        const currentToNewKm = await calculateRoadDistance(
          data.currentLat,
          data.currentLng,
          data.lat,
          data.lng,
          config.routing?.openRouteServiceApiKey
        );
        
        // Leg 3: new address → warehouse (return)
        const newToWarehouseKm = await calculateRoadDistance(
          data.lat,
          data.lng,
          config.warehouse.lat,
          config.warehouse.lng,
          config.routing?.openRouteServiceApiKey
        );
        
        roundTripDistanceKm = warehouseToCurrentKm + currentToNewKm + newToWarehouseKm;
        roundTripDistanceMiles = kmToMiles(roundTripDistanceKm);
      } catch (error) {
        console.error('Error calculating round trip distance for mover booking:', error);
        // Set to 0 if calculation fails
        roundTripDistanceKm = 0;
        roundTripDistanceMiles = 0;
      }
    } else if (data.lat && data.lng) {
      // Fallback: if only new address is provided, calculate as (warehouse → new address) * 2
      try {
        const oneWayDistanceKm = await calculateRoadDistance(
          config.warehouse.lat,
          config.warehouse.lng,
          data.lat,
          data.lng,
          config.routing?.openRouteServiceApiKey
        );
        roundTripDistanceKm = oneWayDistanceKm * 2;
        roundTripDistanceMiles = kmToMiles(roundTripDistanceKm);
      } catch (error) {
        console.error('Error calculating round trip distance for mover booking:', error);
        roundTripDistanceKm = 0;
        roundTripDistanceMiles = 0;
      }
    }

    // Create booking for mover (similar to breakfix but for department change)
    const booking = await bookingRepo.create({
      bookingNumber,
      clientId: actualClientId,
      tenantId: data.tenantId,
      siteName: data.siteName,
      siteAddress: data.address,
      postcode: data.postcode,
      lat: data.lat,
      lng: data.lng,
      scheduledDate: data.scheduledDate,
      status: 'pending',
      charityPercent: 0,
      estimatedCO2e: 0,
      estimatedBuyback: 0,
      roundTripDistanceKm,
      roundTripDistanceMiles,
      bookingType: 'jml',
      jmlSubType: 'mover',
      employeeName: data.employeeName,
      employeeEmail: data.email,
      employeePhone: data.phone,
      deviceType: data.deviceType,
      createdBy: data.createdBy,
    });

    // Create BookingAsset records for current devices
    if (data.currentDevices && data.currentDevices.length > 0) {
      for (const device of data.currentDevices) {
        if (isJmlAccessoryOnlyLabel(device.category)) continue;
        const category = await resolveAssetCategoryForJmlDeviceLabel(device.category);
        if (category) {
          await prisma.bookingAsset.create({
            data: {
              bookingId: booking.id,
              categoryId: category.id,
              categoryName: category.name,
              quantity: device.quantity,
            },
          });
        }
      }
    }

    // Store device details and current address in status history notes as JSON for retrieval
    const currentDevicesInfo = data.currentDevices
      .map(d => `${d.make} ${d.model} (x${d.quantity})`)
      .join(', ');
    const deviceDetails = JSON.stringify(data.currentDevices.map(d => ({
      category: d.category,
      make: d.make,
      model: d.model,
      quantity: d.quantity,
      deviceType: d.deviceType,
      notes: d.notes,
    })));
    
    // Store current address information in status history notes
    const currentAddressInfo = data.currentAddress ? JSON.stringify({
      currentAddress: data.currentAddress,
      currentPostcode: data.currentPostcode,
      currentSiteName: data.currentSiteName,
      currentLat: data.currentLat,
      currentLng: data.currentLng,
    }) : null;
    
    const notes = `Mover booking created - current devices: ${currentDevicesInfo}. Device details: ${deviceDetails}${currentAddressInfo ? `. Current address: ${currentAddressInfo}` : ''}`;
    
    await bookingRepo.addStatusHistory(booking.id, {
      status: 'pending',
      changedBy: data.createdBy,
      notes,
    });

    // Create ERP order
    try {
      const erpResponse = await mockERPService.createJob({
        clientName: data.clientName,
        siteName: data.siteName,
        siteAddress: data.address,
        scheduledDate: new Date().toISOString(),
        assets: [],
      });

      await bookingRepo.update(booking.id, {
        erpJobNumber: erpResponse.jobNumber,
      });
    } catch (error) {
      const { logger } = await import('../utils/logger');
      logger.warn('Failed to create ERP order for mover booking', {
        bookingId: booking.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return this.getBookingById(booking.id);
  }

  /**
   * Allocate device from inventory to booking
   */
  async allocateDevice(bookingId: string, serialNumber: string, allocatedBy: string) {
    const booking = await bookingRepo.findById(bookingId);

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    if (booking.bookingType !== 'jml') {
      throw new ValidationError('Device allocation is only for JML bookings');
    }

    if (booking.jmlSubType === 'mover' && booking.status === 'inventory') {
      throw new ValidationError(
        'For mover bookings at inventory, select devices and use the single "Allocate Devices" action to commit all serials at once.'
      );
    }

    // Allocate serial from inventory
    await inventoryService.allocateSerial(bookingId, serialNumber);

    // Get device category CO2 value for tracking - look up by allocated item's category
    const inventoryItem = await prisma.clientInventory.findFirst({
      where: { tenantId: booking.tenantId, serialNumber },
    });
    const categoryName = inventoryItem?.category;
    const category = categoryName
      ? await prisma.assetCategory.findFirst({ where: { name: categoryName } })
      : await prisma.assetCategory.findFirst({
          where: {
            name: { in: ['Laptop', 'Smart Phones', 'Desktop', 'Tablets', 'VOIP', 'WEEE Waste'] },
          },
        });

    const co2ePerUnit = category?.co2ePerUnit ?? 250; // Default to laptop CO2 if not found

    // Track serial reuse for CO2 calculation
    await serialReuseService.trackSerialReuse(
      serialNumber,
      bookingId,
      booking.bookingType as BookingType,
      booking.jmlSubType as JMLSubType | null,
      co2ePerUnit
    );

    // Update booking status to next status based on booking type
    // Get the next valid status for this booking type
    const nextStatuses = getNextValidBookingStatusesForType(
      booking.status,
      booking.bookingType as BookingType,
      booking.jmlSubType as JMLSubType | null
    );
    
    // For new_starter and breakfix, device allocation should move to device_allocated
    // Find device_allocated in the next statuses, or use the first valid next status
    let nextStatus: BookingStatus | null = null;
    
    if (nextStatuses.includes('device_allocated')) {
      nextStatus = 'device_allocated';
    } else if (nextStatuses.length > 0 && !nextStatuses.includes('cancelled')) {
      // Use the first non-cancelled next status
      nextStatus = nextStatuses.find(s => s !== 'cancelled') || nextStatuses[0];
    }

    if (nextStatus) {
      await bookingRepo.update(booking.id, {
        status: nextStatus,
      });

      await bookingRepo.addStatusHistory(booking.id, {
        status: nextStatus,
        changedBy: allocatedBy,
        notes: `Device allocated: ${serialNumber}`,
      });

      await syncJobStatusFromBooking(booking.id, nextStatus, allocatedBy);
    }

    return this.getBookingById(bookingId);
  }

  /**
   * Allocate multiple devices based on criteria (category, make, model, deviceType, quantity)
   */
  async allocateDevicesByCriteria(
    bookingId: string,
    category: string,
    make: string,
    model: string,
    deviceType: string | null,
    quantity: number,
    allocatedBy: string
  ) {
    const booking = await bookingRepo.findById(bookingId);

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    if (booking.bookingType !== 'jml') {
      throw new ValidationError('Device allocation is only for JML bookings');
    }

    if (!booking.clientId) {
      throw new ValidationError('Booking must have a client to allocate devices');
    }

    // Find available inventory matching criteria
    const availableInventory = await inventoryService.getAvailableInventory(
      null, // Unallocated inventory
      booking.tenantId,
      category,
      undefined // conditionCode
    );

    // Filter by make, model, and deviceType
    const matchingInventory = availableInventory.filter(item => {
      const matchesMake = item.make.toLowerCase() === make.toLowerCase();
      const matchesModel = item.model.toLowerCase() === model.toLowerCase();
      const matchesDeviceType = deviceType 
        ? (item.deviceType?.toLowerCase() === deviceType.toLowerCase())
        : (item.deviceType === null || item.deviceType === undefined);
      
      return matchesMake && matchesModel && matchesDeviceType;
    });

    if (matchingInventory.length < quantity) {
      throw new ValidationError(
        `Not enough available devices. Found ${matchingInventory.length} matching devices, but ${quantity} requested.`
      );
    }

    // Allocate the requested quantity
    const allocatedItems = matchingInventory.slice(0, quantity);
    const allocatedSerialNumbers: string[] = [];

    // Get device category CO2 value for tracking - look up by the category being allocated
    const assetCategory = await prisma.assetCategory.findFirst({
      where: { name: category },
    });
    const co2ePerUnit = assetCategory?.co2ePerUnit ?? 250;

    for (const item of allocatedItems) {
      // Allocate each device
      await inventoryService.allocateSerial(bookingId, item.serialNumber);
      allocatedSerialNumbers.push(item.serialNumber);

      // Track serial reuse for CO2 calculation
      await serialReuseService.trackSerialReuse(
        item.serialNumber,
        bookingId,
        booking.bookingType as BookingType,
        booking.jmlSubType as JMLSubType | null,
        co2ePerUnit
      );
    }

    // Update booking status to next status based on booking type
    // Get the next valid status for this booking type
    const nextStatuses = getNextValidBookingStatusesForType(
      booking.status,
      booking.bookingType as BookingType,
      booking.jmlSubType as JMLSubType | null
    );
    
    // For new_starter and breakfix, device allocation should move to device_allocated
    // Find device_allocated in the next statuses, or use the first valid next status
    let nextStatus: BookingStatus | null = null;
    
    if (nextStatuses.includes('device_allocated')) {
      nextStatus = 'device_allocated';
    } else if (nextStatuses.length > 0 && !nextStatuses.includes('cancelled')) {
      // Use the first non-cancelled next status
      nextStatus = nextStatuses.find(s => s !== 'cancelled') || nextStatuses[0];
    }

    if (nextStatus) {
      await bookingRepo.update(booking.id, {
        status: nextStatus,
      });

      const serialNumbersList = allocatedSerialNumbers.join(', ');
      await bookingRepo.addStatusHistory(booking.id, {
        status: nextStatus,
        changedBy: allocatedBy,
        notes: `Allocated ${quantity} device(s): ${serialNumbersList}`,
      });

      await syncJobStatusFromBooking(booking.id, nextStatus, allocatedBy);
    }

    return {
      booking: await this.getBookingById(bookingId),
      allocatedSerialNumbers,
      quantity: allocatedItems.length,
    };
  }

  /**
   * Update courier tracking number and service
   */
  async updateCourierTracking(bookingId: string, trackingNumber: string, courierService: string, updatedBy: string) {
    const booking = await bookingRepo.findById(bookingId);

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    // For new_starter and breakfix, device must be allocated before courier booking
    if ((booking.jmlSubType === 'new_starter' || booking.jmlSubType === 'breakfix') && 
        booking.status !== 'device_allocated') {
      throw new ValidationError(
        `Cannot book courier. Device must be allocated first. Current status: ${booking.status}`
      );
    }

    // Determine next status based on current status and JML subtype
    // Leaver/mover: created → collection_scheduled when courier is booked (workflow allows only that)
    // New starter/breakfix: device_allocated → courier_booked
    let nextStatus = booking.status;
    if (booking.status === 'device_allocated') {
      nextStatus = 'courier_booked';
    } else if (booking.status === 'created' && (booking.jmlSubType === 'leaver' || booking.jmlSubType === 'mover')) {
      nextStatus = 'collection_scheduled';
    }

    const notes = courierService 
      ? `Courier: ${courierService}, Tracking: ${trackingNumber}`
      : `Courier tracking: ${trackingNumber}`;

    const isCollectionPhaseBook =
      booking.status === 'created' &&
      (booking.jmlSubType === 'leaver' || booking.jmlSubType === 'mover');
    const isMoverDeliveryBook =
      booking.jmlSubType === 'mover' && booking.status === 'device_allocated';

    // Persist collection courier separately so mover delivery booking does not overwrite it
    if (isCollectionPhaseBook) {
      await bookingRepo.update(booking.id, {
        collectionCourierTracking: trackingNumber,
        collectionCourierService: courierService,
        courierTracking: trackingNumber,
        courierService: courierService,
        status: nextStatus,
      });
    } else if (isMoverDeliveryBook) {
      await bookingRepo.update(booking.id, {
        courierTracking: trackingNumber,
        courierService: courierService,
        status: nextStatus,
      });
    } else {
      await bookingRepo.update(booking.id, {
        courierTracking: trackingNumber,
        courierService: courierService,
        status: nextStatus,
      });
    }

    if (nextStatus !== booking.status) {
      await bookingRepo.addStatusHistory(booking.id, {
        status: nextStatus,
        changedBy: updatedBy,
        notes: notes,
      });

      await syncJobStatusFromBooking(booking.id, nextStatus, updatedBy);
    }

    return this.getBookingById(bookingId);
  }

  /**
   * Mover: allocate every mover_allocated device linked to this booking (moverSourceBookingId).
   * Ignores device-requirement quantities; disposals etc. are not matched by count.
   * @param options.advanceBookingStatus When false, links serials to the booking but keeps status at `inventory` (for admin review on Device Allocation page). When true (default), also moves to `device_allocated` once every linked row is allocated.
   */
  async allocateAllMoverDevicesForBooking(
    bookingId: string,
    allocatedBy: string,
    options?: { advanceBookingStatus?: boolean }
  ) {
    const advanceBookingStatus = options?.advanceBookingStatus !== false;
    const booking = await bookingRepo.findById(bookingId);

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }
    if (booking.bookingType !== 'jml' || booking.jmlSubType !== 'mover') {
      throw new ValidationError('Automatic mover allocation is only for mover JML bookings');
    }
    if (booking.status !== 'inventory') {
      throw new ValidationError(`Booking must be in inventory status. Current status: ${booking.status}`);
    }
    if (!booking.clientId) {
      throw new ValidationError('Booking must have a client');
    }

    const items = await prisma.clientInventory.findMany({
      where: {
        tenantId: booking.tenantId,
        status: 'mover_allocated',
        allocatedTo: booking.clientId,
        moverSourceBookingId: bookingId,
      } as any,
    });

    if (items.length === 0) {
      throw new ValidationError(
        'No devices linked to this mover booking. Add devices from the booking Add to Inventory page (they must be tagged to this booking).'
      );
    }

    const histories = await prisma.serialReuseHistory.findMany({
      where: { bookingId },
      select: { serialNumber: true },
    });
    const alreadyAllocated = new Set(histories.map((h) => h.serialNumber));

    const allocatedSerialNumbers: string[] = [];

    for (const item of items) {
      if (alreadyAllocated.has(item.serialNumber)) {
        continue;
      }
      await inventoryService.allocateSerial(bookingId, item.serialNumber);

      const categoryName = item.category;
      const category = categoryName
        ? await prisma.assetCategory.findFirst({ where: { name: categoryName } })
        : await prisma.assetCategory.findFirst({
            where: {
              name: { in: ['Laptop', 'Smart Phones', 'Desktop', 'Tablets', 'VOIP', 'WEEE Waste'] },
            },
          });
      const co2ePerUnit = category?.co2ePerUnit ?? 250;

      await serialReuseService.trackSerialReuse(
        item.serialNumber,
        bookingId,
        booking.bookingType as BookingType,
        booking.jmlSubType as JMLSubType | null,
        co2ePerUnit
      );
      allocatedSerialNumbers.push(item.serialNumber);
      alreadyAllocated.add(item.serialNumber);
    }

    const historiesAfter = await prisma.serialReuseHistory.findMany({
      where: { bookingId },
      select: { serialNumber: true },
    });
    const have = new Set(historiesAfter.map((h) => h.serialNumber));
    const allSerials = items.map((i) => i.serialNumber);
    const allLinkedAllocated = allSerials.every((s) => have.has(s));

    const linkedSerialNumbers = historiesAfter.map((h) => h.serialNumber);

    if (
      advanceBookingStatus &&
      booking.status === 'inventory' &&
      allLinkedAllocated
    ) {
      const nextStatuses = getNextValidBookingStatusesForType(
        booking.status,
        booking.bookingType as BookingType,
        booking.jmlSubType as JMLSubType | null
      );
      if (nextStatuses.includes('device_allocated')) {
        await bookingRepo.update(booking.id, {
          status: 'device_allocated',
        });
        await bookingRepo.addStatusHistory(booking.id, {
          status: 'device_allocated',
          changedBy: allocatedBy,
          notes: `Devices auto-allocated: ${allSerials.join(', ')}`,
        });
        await syncJobStatusFromBooking(booking.id, 'device_allocated', allocatedBy);
      }
    }

    return {
      booking: await this.getBookingById(bookingId),
      allocatedSerialNumbers,
      quantity: allocatedSerialNumbers.length,
      allMoverDevicesLinked: allLinkedAllocated,
      linkedSerialNumbers,
    };
  }

  /**
   * Mover @ inventory: commit admin's device selection in one step (same totals as booking line items).
   * Clears prior serial-reuse rows only for serials in this booking's mover inventory pool, then links the chosen serials.
   */
  async commitMoverSelectedDevices(bookingId: string, serialNumbers: string[], committedBy: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }
    if (booking.bookingType !== 'jml' || booking.jmlSubType !== 'mover') {
      throw new ValidationError('This action is only for mover JML bookings');
    }
    if (booking.status !== 'inventory') {
      throw new ValidationError(`Booking must be in inventory status. Current status: ${booking.status}`);
    }
    if (!booking.clientId) {
      throw new ValidationError('Booking must have a client');
    }

    const assets = await prisma.bookingAsset.findMany({ where: { bookingId } });
    const expectedQty = assets.reduce((s, a) => s + a.quantity, 0);
    const unique = [...new Set(serialNumbers.map((s) => s.trim()).filter(Boolean))];

    if (expectedQty <= 0) {
      throw new ValidationError('Booking has no device line items to allocate');
    }
    if (unique.length !== expectedQty) {
      throw new ValidationError(`Select exactly ${expectedQty} device(s) for this booking (${unique.length} selected).`);
    }

    const poolRows = await prisma.clientInventory.findMany({
      where: {
        tenantId: booking.tenantId,
        status: 'mover_allocated',
        allocatedTo: booking.clientId,
        moverSourceBookingId: bookingId,
      } as any,
      select: { serialNumber: true },
    });
    const poolSerials = [...new Set(poolRows.map((r) => r.serialNumber))];
    if (poolSerials.length > 0) {
      await prisma.serialReuseHistory.deleteMany({
        where: { bookingId, serialNumber: { in: poolSerials } },
      });
    }

    for (const sn of unique) {
      await inventoryService.allocateSerial(bookingId, sn);
      const inventoryItem = await prisma.clientInventory.findFirst({
        where: { tenantId: booking.tenantId, serialNumber: sn },
      });
      const categoryName = inventoryItem?.category;
      const category = categoryName
        ? await prisma.assetCategory.findFirst({ where: { name: categoryName } })
        : await prisma.assetCategory.findFirst({
            where: {
              name: { in: ['Laptop', 'Smart Phones', 'Desktop', 'Tablets', 'VOIP', 'WEEE Waste'] },
            },
          });
      const co2ePerUnit = category?.co2ePerUnit ?? 250;
      await serialReuseService.trackSerialReuse(
        sn,
        bookingId,
        booking.bookingType as BookingType,
        booking.jmlSubType as JMLSubType | null,
        co2ePerUnit
      );
    }

    await bookingRepo.update(booking.id, {
      status: 'device_allocated',
    });
    await bookingRepo.addStatusHistory(booking.id, {
      status: 'device_allocated',
      changedBy: committedBy,
      notes: `Allocated ${unique.length} device(s): ${unique.join(', ')}`,
    });
    await syncJobStatusFromBooking(booking.id, 'device_allocated', committedBy);

    return {
      booking: await this.getBookingById(bookingId),
      allocatedSerialNumbers: unique,
      quantity: unique.length,
    };
  }

  /**
   * Mark booking as delivered (for new starter/breakfix/mover outbound).
   * Updates all devices allocated to this booking to inventory status 'delivered'.
   */
  async markDelivered(bookingId: string, deliveredBy: string) {
    const booking = await bookingRepo.findById(bookingId);

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    await bookingRepo.update(booking.id, {
      status: 'delivered',
      deliveryDate: new Date(),
    });

    await bookingRepo.addStatusHistory(booking.id, {
      status: 'delivered',
      changedBy: deliveredBy,
      notes: 'Device delivered - ticket closed',
    });

    await syncJobStatusFromBooking(booking.id, 'delivered', deliveredBy);

    // Update all devices allocated to this booking to inventory status 'delivered'
    const { InventoryRepository } = await import('../repositories/inventory.repository');
    const inventoryRepo = new InventoryRepository();
    const histories = await prisma.serialReuseHistory.findMany({
      where: { bookingId: booking.id },
      select: { serialNumber: true },
    });
    for (const { serialNumber } of histories) {
      const item = await inventoryRepo.findBySerial(booking.tenantId, serialNumber);
      if (item) {
        await inventoryRepo.update(item.id, { status: 'delivered' });
      }
    }

    return this.getBookingById(bookingId);
  }

  /**
   * Mark booking as collected (for leaver/breakfix inbound)
   */
  async markCollected(
    bookingId: string,
    items: Array<{
      make: string;
      model: string;
      serialNumber: string;
      imei?: string;
      accessories?: string[];
    }>,
    collectedBy: string
  ) {
    const booking = await bookingRepo.findById(bookingId);

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    // Create incoming order in ReuseOS ERP
    try {
      const erpOrder = await mockERPService.createIncomingOrder({
        clientId: booking.clientId,
        items: items.map(item => ({
          deviceType: 'laptop', // Could be determined from make/model
          make: item.make,
          model: item.model,
          serialNumber: item.serialNumber,
          imei: item.imei,
        })),
      });

      // Update booking with ERP order number
      await bookingRepo.update(booking.id, {
        erpJobNumber: erpOrder.orderNumber,
        status: 'collected',
        deliveryDate: new Date(), // Using deliveryDate for collection date
      });
    } catch (error) {
      const { logger } = await import('../utils/logger');
      logger.warn('Failed to create incoming order in ReuseOS ERP', {
        bookingId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    await bookingRepo.addStatusHistory(booking.id, {
      status: 'collected',
      changedBy: collectedBy,
      notes: `Items collected: ${items.map(i => `${i.make} ${i.model} (${i.serialNumber})`).join(', ')}`,
    });

    await syncJobStatusFromBooking(booking.id, 'collected', collectedBy);

    return this.getBookingById(bookingId);
  }

  /**
   * Get booking by ID with all relations
   */
  private async getBookingById(id: string) {
    return bookingRepo.findById(id);
  }
}
