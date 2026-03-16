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
import { BookingStatus, BookingType, JMLSubType } from '@prisma/client';

const bookingRepo = new BookingRepository();
const inventoryService = new InventorySyncService();
const serialReuseService = new SerialReuseService();
const co2Service = new CO2Service();
const buybackService = new BuybackService();

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
    deviceType: 'Windows' | 'Apple';
    siteName: string;
    devices?: Array<{
      category: string;
      make: string;
      model: string;
      quantity: number;
      deviceType: 'Windows' | 'Apple';
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
        // Find category by name
        const category = await prisma.assetCategory.findFirst({
          where: { name: device.category },
        });

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
      deviceType: 'Windows' | 'Apple';
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
        // Find category by name
        const category = await prisma.assetCategory.findFirst({
          where: { name: device.category },
        });

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
    brokenDevices: Array<{
      category: string;
      make: string;
      model: string;
      quantity: number;
      deviceType: 'Windows' | 'Apple';
    }>;
    deviceType: 'Windows' | 'Apple';
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
        // Find category by name
        const category = await prisma.assetCategory.findFirst({
          where: { name: device.category },
        });

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
    const brokenDevicesInfo = data.brokenDevices
      .map(d => `${d.make} ${d.model} (x${d.quantity})`)
      .join(', ');
    const deviceDetails = JSON.stringify(data.brokenDevices.map(d => ({
      category: d.category,
      make: d.make,
      model: d.model,
      quantity: d.quantity,
      deviceType: d.deviceType,
    })));
    await bookingRepo.addStatusHistory(booking.id, {
      status: 'pending',
      changedBy: data.createdBy,
      notes: `Breakfix booking created - broken devices: ${brokenDevicesInfo}. Device details: ${deviceDetails}`,
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
      deviceType: 'Windows' | 'Apple';
    }>;
    deviceType: 'Windows' | 'Apple';
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
        // Find category by name
        const category = await prisma.assetCategory.findFirst({
          where: { name: device.category },
        });

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

    // Allocate serial from inventory
    const inventoryItem = await inventoryService.allocateSerial(bookingId, serialNumber);

    // Get device category CO2 value for tracking
    // Find category by device type (laptop or mobile_phone)
    const category = await prisma.assetCategory.findFirst({
      where: {
        name: {
          in: ['Laptop', 'Smart Phones'],
        },
      },
    });

    const co2ePerUnit = category?.co2ePerUnit || 250; // Default to laptop CO2 if not found

    // Track serial reuse for CO2 calculation
    await serialReuseService.trackSerialReuse(
      serialNumber,
      bookingId,
      booking.bookingType as BookingType,
      booking.jmlSubType as JMLSubType | null,
      co2ePerUnit
    );

    // Update booking status
    if (booking.status === 'pending') {
      await bookingRepo.update(booking.id, {
        status: 'device_allocated',
      });

      await bookingRepo.addStatusHistory(booking.id, {
        status: 'device_allocated',
        changedBy: allocatedBy,
        notes: `Device allocated: ${serialNumber}`,
      });
    }

    return this.getBookingById(bookingId);
  }

  /**
   * Update courier tracking number
   */
  async updateCourierTracking(bookingId: string, trackingNumber: string, updatedBy: string) {
    const booking = await bookingRepo.findById(bookingId);

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    await bookingRepo.update(booking.id, {
      courierTracking: trackingNumber,
      status: booking.status === 'device_allocated' ? 'courier_booked' : booking.status,
    });

    if (booking.status === 'device_allocated') {
      await bookingRepo.addStatusHistory(booking.id, {
        status: 'courier_booked',
        changedBy: updatedBy,
        notes: `Courier tracking: ${trackingNumber}`,
      });
    }

    return this.getBookingById(bookingId);
  }

  /**
   * Mark booking as delivered (for new starter/breakfix outbound)
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

    return this.getBookingById(bookingId);
  }

  /**
   * Get booking by ID with all relations
   */
  private async getBookingById(id: string) {
    return bookingRepo.findById(id);
  }
}
